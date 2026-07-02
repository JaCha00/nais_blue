import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useSceneStore } from '@/stores/scene-store'
import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import { useAuthStore } from '@/stores/auth-store'
import { useGenerationStore } from '@/stores/generation-store'
import { toast } from '@/components/ui/use-toast'

/**
 * Character Rotation — automates "queue one full pass per character, swap to
 * the next, repeat". Features:
 *   - Pinned characters (always enabled every pass; excluded from order + folder).
 *   - Per-character output folders: NAIS_Scene/{preset}/{character}/{scene}/.
 *   - Rest scheduler: after a (randomized) work window, pause generation for a
 *     (randomized) rest window to avoid ban-triggering continuous load.
 *   - Crash-safe resume: the full session (snapshot + progress + rest state) is
 *     persisted, so after an unexpected shutdown the user can continue with one
 *     click instead of restarting from scratch.
 *   - Non-user interruptions (no token / slot paused / main-mode) PAUSE
 *     (resumable) instead of aborting; a genuine user Stop routes through
 *     cancel().
 */

interface Snapshot {
    presetId: string                       // preset the rotation is pinned to
    queueCounts: Record<string, number>    // sceneId -> count (only non-zero)
    enabledStates: Record<string, boolean> // charId -> enabled at start (all stage chars)
}

interface RotationState {
    // --- Persisted user prefs ---
    characterIds: string[]
    pinnedCharacterIds: string[]   // always enabled; excluded from order + folder naming
    repeats: number
    // Rest scheduler config
    restEnabled: boolean
    workMinutes: number            // base work window before a rest
    workJitterMinutes: number      // ± randomness on the work window
    restMinutes: number            // base rest window
    restJitterMinutes: number      // ± randomness on the rest window

    // --- Session runtime (persisted for crash-safe resume) ---
    active: boolean
    paused: boolean                // interrupted by a non-user cause; resumable
    awaitingWorker: boolean        // startPass armed isGenerating but no worker confirmed yet
    resting: boolean               // in a scheduled rest window
    restUntil: number | null       // epoch ms the rest ends
    workStartedAt: number | null   // epoch ms the current work window began
    nextWorkTargetMs: number | null// randomized work duration for this window
    currentIndex: number
    currentRepeat: number          // 0-based
    snapshot: Snapshot | null

    // --- Actions ---
    setCharacterIds: (ids: string[]) => void
    setPinnedCharacterIds: (ids: string[]) => void
    setRepeats: (n: number) => void
    setRestConfig: (cfg: Partial<Pick<RotationState,
        'restEnabled' | 'workMinutes' | 'workJitterMinutes' | 'restMinutes' | 'restJitterMinutes'>>) => void
    start: () => string | null     // null on success, error message otherwise
    resumeSavedSession: () => string | null
    discardSavedSession: () => void
    stop: (reason?: string) => void  // user stop — halts but KEEPS the session resumable
    cancel: (reason?: string) => void // fatal teardown — discards the session
    resume: () => void             // resume from a PAUSE (not a rest)
    endRest: () => void            // rest window finished / skipped → continue
    _onPassComplete: () => void
    _onInterrupted: (reason: string, userVisible?: string) => void
    _enterRestIfDue: () => boolean
}

// Re-entrancy guard for enabled-state rewrites (contamination watcher also toggles).
let enforcing = false
// Module-level rest timer (not persisted; re-established on resume).
let restTimer: ReturnType<typeof setTimeout> | null = null

function rollMs(baseMin: number, jitterMin: number): number {
    const j = Math.max(0, jitterMin || 0)
    const delta = (Math.random() * 2 - 1) * j
    const minutes = Math.max(1, (baseMin || 0) + delta)
    return Math.round(minutes * 60000)
}

function clearRestTimer() {
    if (restTimer) { clearTimeout(restTimer); restTimer = null }
}

function scheduleRestEnd() {
    clearRestTimer()
    const until = useRotationStore.getState().restUntil
    if (!until) return
    const delay = Math.max(0, until - Date.now())
    restTimer = setTimeout(() => { useRotationStore.getState().endRest() }, delay)
}

export const useRotationStore = create<RotationState>()(
    persist(
        (set, get) => ({
            characterIds: [],
            pinnedCharacterIds: [],
            repeats: 1,
            restEnabled: false,
            workMinutes: 480,        // 8h
            workJitterMinutes: 30,
            restMinutes: 300,        // 5h
            restJitterMinutes: 30,

            active: false,
            paused: false,
            awaitingWorker: false,
            resting: false,
            restUntil: null,
            workStartedAt: null,
            nextWorkTargetMs: null,
            currentIndex: 0,
            currentRepeat: 0,
            snapshot: null,

            setCharacterIds: (ids) => set({ characterIds: ids }),
            setPinnedCharacterIds: (ids) => set({ pinnedCharacterIds: ids }),
            setRepeats: (n) => set({ repeats: Math.max(1, Math.min(100, Math.floor(n))) }),
            setRestConfig: (cfg) => set((s) => ({
                restEnabled: cfg.restEnabled ?? s.restEnabled,
                workMinutes: cfg.workMinutes !== undefined ? Math.max(1, Math.floor(cfg.workMinutes)) : s.workMinutes,
                workJitterMinutes: cfg.workJitterMinutes !== undefined ? Math.max(0, Math.floor(cfg.workJitterMinutes)) : s.workJitterMinutes,
                restMinutes: cfg.restMinutes !== undefined ? Math.max(1, Math.floor(cfg.restMinutes)) : s.restMinutes,
                restJitterMinutes: cfg.restJitterMinutes !== undefined ? Math.max(0, Math.floor(cfg.restJitterMinutes)) : s.restJitterMinutes,
            })),

            start: () => {
                if (get().active) return '이미 로테이션이 진행 중입니다.'
                if (useGenerationStore.getState().generatingMode === 'main') {
                    return '메인 모드에서 생성 중입니다. 먼저 메인 생성을 멈춰주세요.'
                }

                const { characterIds, repeats, workMinutes, workJitterMinutes } = get()
                if (characterIds.length === 0) return '로테이션할 캐릭터를 선택하세요.'

                const sceneStore = useSceneStore.getState()
                const charStore = useCharacterPromptStore.getState()
                const activePresetId = sceneStore.activePresetId
                if (!activePresetId) return '활성 프리셋이 없습니다.'

                const activePreset = sceneStore.presets.find(p => p.id === activePresetId)
                if (!activePreset) return '활성 프리셋을 찾을 수 없습니다.'

                const queueCounts: Record<string, number> = {}
                for (const scene of activePreset.scenes) {
                    if (scene.queueCount > 0) queueCounts[scene.id] = scene.queueCount
                }
                if (Object.keys(queueCounts).length === 0) {
                    return '큐가 비어있습니다. 씬에 큐를 먼저 채워주세요.'
                }

                const missing = characterIds.filter(id => !charStore.characters.find(c => c.id === id))
                if (missing.length > 0) {
                    return '선택된 캐릭터 중 일부가 스테이지에 없습니다. 다시 선택해주세요.'
                }

                const enabledStates: Record<string, boolean> = {}
                for (const c of charStore.characters) enabledStates[c.id] = c.enabled

                clearRestTimer()
                set({
                    active: true,
                    paused: false,
                    awaitingWorker: false,
                    resting: false,
                    restUntil: null,
                    workStartedAt: Date.now(),
                    nextWorkTargetMs: rollMs(workMinutes, workJitterMinutes),
                    currentIndex: 0,
                    currentRepeat: 0,
                    snapshot: { presetId: activePresetId, queueCounts, enabledStates },
                })

                startPass(characterIds[0])
                console.log(`[Rotation] started — ${characterIds.length} chars × ${repeats} repeats`)
                return null
            },

            resumeSavedSession: () => {
                const s = get()
                if (s.active) return '이미 로테이션이 진행 중입니다.'
                if (!s.snapshot) return '이어서 시작할 세션이 없습니다.'
                if (useGenerationStore.getState().generatingMode === 'main') {
                    return '메인 모드에서 생성 중입니다. 먼저 메인 생성을 멈춰주세요.'
                }
                const sceneStore = useSceneStore.getState()
                const charStore = useCharacterPromptStore.getState()
                if (!sceneStore.presets.find(p => p.id === s.snapshot!.presetId)) {
                    get().discardSavedSession()
                    return '이어서 시작할 프리셋이 삭제되었습니다.'
                }
                const missing = s.characterIds.filter(id => !charStore.characters.find(c => c.id === id))
                if (missing.length > 0) return '세션의 캐릭터 일부가 스테이지에 없습니다.'

                clearRestTimer()
                const stillResting = s.resting && !!s.restUntil && s.restUntil > Date.now()
                set({
                    active: true,
                    paused: false,
                    awaitingWorker: false,
                    // Fresh work window on resume (time the app was off counts as rest anyway).
                    workStartedAt: Date.now(),
                    nextWorkTargetMs: rollMs(s.workMinutes, s.workJitterMinutes),
                    resting: stillResting,
                    restUntil: stillResting ? s.restUntil : null,
                })
                console.log(`[Rotation] resumed saved session at ${s.currentIndex + 1}/${s.characterIds.length}, repeat ${s.currentRepeat + 1}/${s.repeats}`)
                if (stillResting) {
                    scheduleRestEnd()
                    return null
                }

                // Warm vs cold resume. After a manual Stop (no reload) the live
                // queue still holds the remaining count for the current pass —
                // continue draining it (don't regenerate finished images). After
                // a crash/reload the queue was zeroed by persistence, so restore
                // the full snapshot for the current pass.
                const liveTotal = sceneStore.presets.find(p => p.id === s.snapshot!.presetId)
                    ?.scenes.reduce((sum, sc) => sum + sc.queueCount, 0) ?? 0
                if (liveTotal > 0) {
                    useRotationStore.setState({ awaitingWorker: true })
                    if (!reassertCharacterAndPreset(s.characterIds[s.currentIndex])) return '재개 중 오류가 발생했습니다.'
                    useSceneStore.getState().setIsGenerating(true)
                } else {
                    startPass(s.characterIds[s.currentIndex])
                }
                return null
            },

            discardSavedSession: () => {
                const snap = get().snapshot
                clearRestTimer()
                set({
                    active: false, paused: false, awaitingWorker: false, resting: false,
                    restUntil: null, workStartedAt: null, nextWorkTargetMs: null,
                    currentIndex: 0, currentRepeat: 0, snapshot: null,
                })
                if (snap) restoreEnabledStates(snap)
            },

            // User Stop — halts generation but PRESERVES the session (snapshot +
            // progress) so pressing Start / "이어서 시작" continues from here.
            stop: (reason) => {
                if (!get().active) return
                console.log(`[Rotation] stopped (resumable)${reason ? ': ' + reason : ''}`)
                const snap = get().snapshot
                clearRestTimer()
                // Keep snapshot, currentIndex, currentRepeat, repeats, characterIds,
                // pinned, rest config. Only reset volatile run-flags + rest runtime.
                set({
                    active: false, paused: false, awaitingWorker: false, resting: false,
                    restUntil: null, workStartedAt: null, nextWorkTargetMs: null,
                })
                if (snap) restoreEnabledStates(snap)   // sane stage while stopped
                useSceneStore.getState().setIsGenerating(false)
            },

            cancel: (reason) => {
                if (!get().active && !get().snapshot) return
                console.log(`[Rotation] cancelled${reason ? ': ' + reason : ''}`)
                const snap = get().snapshot
                clearRestTimer()
                set({
                    active: false, paused: false, awaitingWorker: false, resting: false,
                    restUntil: null, workStartedAt: null, nextWorkTargetMs: null,
                    currentIndex: 0, currentRepeat: 0, snapshot: null,
                })
                if (snap) restoreEnabledStates(snap)
                useSceneStore.getState().setIsGenerating(false)
            },

            resume: () => {
                const s = get()
                if (!s.active || !s.paused || !s.snapshot) return
                if (s.awaitingWorker) return
                if (useSceneStore.getState().isGenerating) return
                if (useGenerationStore.getState().generatingMode === 'main') return
                if (useAuthStore.getState().getActiveTokens().length === 0) return
                console.log('[Rotation] resuming current pass')
                set({ paused: false, awaitingWorker: true })
                if (!reassertCharacterAndPreset(s.characterIds[s.currentIndex])) return
                useSceneStore.getState().setIsGenerating(true)
            },

            endRest: () => {
                const s = get()
                clearRestTimer()
                if (!s.active || !s.snapshot) return
                set({
                    resting: false,
                    restUntil: null,
                    workStartedAt: Date.now(),
                    nextWorkTargetMs: rollMs(s.workMinutes, s.workJitterMinutes),
                })
                console.log('[Rotation] rest finished — resuming work')
                toast({ title: '휴식 종료', description: '로테이션 생성을 다시 시작해요.', variant: 'success' })
                startPass(get().characterIds[get().currentIndex])
            },

            _enterRestIfDue: () => {
                const s = get()
                if (!s.restEnabled || !s.workStartedAt || !s.nextWorkTargetMs) return false
                if (Date.now() - s.workStartedAt < s.nextWorkTargetMs) return false
                const restMs = rollMs(s.restMinutes, s.restJitterMinutes)
                const until = Date.now() + restMs
                set({ resting: true, restUntil: until })
                scheduleRestEnd()
                const mins = Math.round(restMs / 60000)
                console.log(`[Rotation] entering rest for ${mins} min`)
                toast({ title: '휴식 시작', description: `밴 방지를 위해 약 ${mins}분 휴식 후 자동 재개돼요.`, variant: 'default' })
                return true
            },

            _onInterrupted: (reason, userVisible) => {
                const s = get()
                if (!s.active || s.paused) return
                console.log(`[Rotation] paused: ${reason}`)
                set({ paused: true, awaitingWorker: false })
                toast({
                    title: '로테이션 일시정지',
                    description: userVisible || '생성이 중단되어 로테이션을 일시정지했어요. 원인을 해결하면 자동/수동으로 재개됩니다.',
                    variant: 'destructive',
                })
            },

            _onPassComplete: () => {
                const s = get()
                if (!s.active || !s.snapshot) return

                let nextIndex = s.currentIndex + 1
                let nextRepeat = s.currentRepeat
                if (nextIndex >= s.characterIds.length) {
                    nextIndex = 0
                    nextRepeat++
                    if (nextRepeat >= s.repeats) {
                        console.log('[Rotation] complete')
                        const snap = s.snapshot
                        clearRestTimer()
                        set({
                            active: false, paused: false, awaitingWorker: false, resting: false,
                            restUntil: null, workStartedAt: null, nextWorkTargetMs: null,
                            currentIndex: 0, currentRepeat: 0, snapshot: null,
                        })
                        restoreEnabledStates(snap)
                        toast({ title: '로테이션 완료', description: '모든 캐릭터 × 반복이 끝났어요.', variant: 'success' })
                        return
                    }
                }

                set({ currentIndex: nextIndex, currentRepeat: nextRepeat })

                // Time for a scheduled rest? If so, stop here; endRest() resumes.
                if (get()._enterRestIfDue()) return

                // Otherwise advance after a short settle delay.
                setTimeout(() => {
                    const cur = get()
                    if (!cur.active || cur.paused || cur.resting || !cur.snapshot) return
                    if (useSceneStore.getState().isGenerating) {
                        cur._onInterrupted('generation started during inter-pass gap',
                            '다른 생성이 시작되어 로테이션을 일시정지했어요.')
                        return
                    }
                    startPass(cur.characterIds[cur.currentIndex])
                }, 800)
            },
        }),
        {
            name: 'nais2-character-rotation',
            partialize: (state) => ({
                // User prefs
                characterIds: state.characterIds,
                pinnedCharacterIds: state.pinnedCharacterIds,
                repeats: state.repeats,
                restEnabled: state.restEnabled,
                workMinutes: state.workMinutes,
                workJitterMinutes: state.workJitterMinutes,
                restMinutes: state.restMinutes,
                restJitterMinutes: state.restJitterMinutes,
                // Session (for crash-safe resume)
                active: state.active,
                snapshot: state.snapshot,
                currentIndex: state.currentIndex,
                currentRepeat: state.currentRepeat,
                resting: state.resting,
                restUntil: state.restUntil,
            }),
            onRehydrateStorage: () => (state) => {
                if (!state) return
                const hadSession = state.active && state.snapshot
                const snap = state.snapshot
                // Boot inactive — never auto-run across a reload. The session
                // (snapshot + progress + rest state) is KEPT so the user can
                // resume with one click; only volatile flags are reset.
                state.active = false
                state.paused = false
                state.awaitingWorker = false
                state.workStartedAt = null
                state.nextWorkTargetMs = null
                if (hadSession && snap) {
                    // Heal the stage (one char was enabled, rest off) so that if the
                    // user does NOT resume, the lineup is sane. Resume re-asserts anyway.
                    const doRestore = () => restoreEnabledStates(snap)
                    const charPersist = (useCharacterPromptStore as any).persist
                    if (charPersist?.hasHydrated?.()) {
                        setTimeout(doRestore, 0)
                    } else if (charPersist?.onFinishHydration) {
                        charPersist.onFinishHydration(() => setTimeout(doRestore, 0))
                    } else {
                        setTimeout(doRestore, 0)
                    }
                }
            },
        }
    )
)

function reassertCharacterAndPreset(characterId: string): boolean {
    const rot = useRotationStore.getState()
    const snap = rot.snapshot
    if (!snap) { rot.cancel('no snapshot'); return false }
    const sceneStore = useSceneStore.getState()
    const presetId = snap.presetId

    if (!sceneStore.presets.find(p => p.id === presetId)) {
        rot.cancel('로테이션 대상 프리셋이 삭제되었습니다.')
        return false
    }
    if (sceneStore.activePresetId !== presetId) {
        sceneStore.setActivePreset(presetId)
    }
    enforceSingleEnabled(characterId)
    return true
}

function enforceSingleEnabled(characterId: string) {
    enforcing = true
    try {
        const charStore = useCharacterPromptStore.getState()
        const pinned = new Set(useRotationStore.getState().pinnedCharacterIds)
        for (const c of charStore.characters) {
            const shouldBeEnabled = c.id === characterId || pinned.has(c.id)
            if (c.enabled !== shouldBeEnabled) charStore.toggleEnabled(c.id)
        }
    } finally {
        enforcing = false
    }
}

function startPass(characterId: string) {
    const rot = useRotationStore.getState()
    const snap = rot.snapshot
    if (!snap) { rot.cancel('no snapshot'); return }
    if (!reassertCharacterAndPreset(characterId)) return

    const sceneStore = useSceneStore.getState()
    const presetId = snap.presetId

    const liveIds = new Set((sceneStore.presets.find(p => p.id === presetId)?.scenes ?? []).map(s => s.id))
    let restored = 0
    for (const [sceneId, count] of Object.entries(snap.queueCounts)) {
        if (!liveIds.has(sceneId)) continue
        sceneStore.setQueueCount(presetId, sceneId, count)
        restored += count
    }
    if (restored === 0) {
        rot.cancel('큐에 복원할 씬이 없습니다 (씬이 삭제됨).')
        return
    }

    useRotationStore.setState({ awaitingWorker: true })
    sceneStore.initGenerationProgress()
    sceneStore.setIsGenerating(true)
    console.log(`[Rotation] pass start — char ${characterId}`)
}

function restoreEnabledStates(snap: Snapshot) {
    enforcing = true
    try {
        const charStore = useCharacterPromptStore.getState()
        for (const [cid, wasEnabled] of Object.entries(snap.enabledStates)) {
            const c = charStore.characters.find(x => x.id === cid)
            if (c && c.enabled !== wasEnabled) charStore.toggleEnabled(cid)
        }
    } finally {
        enforcing = false
    }
}

// --- Generation completion watcher ---
let prevIsGenerating = false
useSceneStore.subscribe((state) => {
    const isGenerating = state.isGenerating
    if (prevIsGenerating && !isGenerating) {
        const rot = useRotationStore.getState()
        if (rot.active && !rot.paused && !rot.resting) {
            const snap = rot.snapshot
            const presetId = snap?.presetId
            const remaining = presetId
                ? (state.presets.find(p => p.id === presetId)?.scenes.reduce((sum, s) => sum + s.queueCount, 0) ?? 0)
                : 0

            if (rot.awaitingWorker) {
                rot._onInterrupted('generation could not start',
                    '생성을 시작할 수 없어 로테이션을 일시정지했어요. (토큰/슬롯/메인모드 확인)')
            } else if (remaining === 0) {
                rot._onPassComplete()
            } else {
                rot._onInterrupted('generation interrupted with queue remaining',
                    '생성이 중단되어 로테이션을 일시정지했어요. 슬롯/토큰을 확인 후 재개하세요.')
            }
        }
    }
    prevIsGenerating = isGenerating
})

// --- Contamination guard ---
useCharacterPromptStore.subscribe((state) => {
    if (enforcing) return
    const rot = useRotationStore.getState()
    if (!rot.active || rot.paused || rot.resting) return
    const currentId = rot.characterIds[rot.currentIndex]
    const pinned = new Set(rot.pinnedCharacterIds)
    const dirty = state.characters.some(c => c.enabled !== (c.id === currentId || pinned.has(c.id)))
    if (dirty) enforceSingleEnabled(currentId)
})

// --- Auto-resume watcher (slot becomes usable again) ---
let prevActive1 = useAuthStore.getState().isSlotActive(1)
let prevActive2 = useAuthStore.getState().isSlotActive(2)
useAuthStore.subscribe(() => {
    const auth = useAuthStore.getState()
    const a1 = auth.isSlotActive(1)
    const a2 = auth.isSlotActive(2)
    const justUsable = (!prevActive1 && a1) || (!prevActive2 && a2)
    prevActive1 = a1
    prevActive2 = a2
    if (!justUsable) return
    const rot = useRotationStore.getState()
    if (rot.active && rot.paused && !rot.resting
        && !useSceneStore.getState().isGenerating
        && useGenerationStore.getState().generatingMode !== 'main') {
        rot.resume()
    }
})
