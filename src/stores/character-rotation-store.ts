import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'
import { useSceneStore } from '@/stores/scene-store'
import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import { useAuthStore } from '@/stores/auth-store'
import { useGenerationStore } from '@/stores/generation-store'
import { toast } from '@/components/ui/use-toast'

export type RotationStatus = 'idle' | 'arming_pass' | 'generating_pass' | 'paused' | 'resting' | 'completed'

interface RotationSnapshot {
    presetId: string
    queueCounts: Record<string, number>
    enabledStates: Record<string, boolean>
}

interface RotationStopOptions {
    reason?: string
    keepSnapshot?: boolean
}

type RotationStopInput = string | RotationStopOptions

interface RotationRuntimeFlags {
    active: boolean
    paused: boolean
    awaitingWorker: boolean
    resting: boolean
}

interface RotationState extends RotationRuntimeFlags {
    status: RotationStatus
    characterIds: string[]
    pinnedCharacterIds: string[]
    repeats: number
    restEnabled: boolean
    workMinutes: number
    workJitterMinutes: number
    restMinutes: number
    restJitterMinutes: number
    restUntil: number | null
    workStartedAt: number | null
    nextWorkTargetMs: number | null
    currentIndex: number
    currentRepeat: number
    snapshot: RotationSnapshot | null

    setCharacterIds: (ids: string[]) => void
    setPinnedCharacterIds: (ids: string[]) => void
    setRepeats: (count: number) => void
    setRestConfig: (config: Partial<Pick<RotationState,
        'restEnabled' | 'workMinutes' | 'workJitterMinutes' | 'restMinutes' | 'restJitterMinutes'>>) => void
    start: () => string | null
    resumeSavedSession: () => string | null
    discardSavedSession: () => void
    stop: (options?: RotationStopInput) => void
    cancel: (reason?: string) => void
    resume: () => void
    endRest: () => void
    onWorkerConfirmed: () => void
    onPassComplete: () => void
    pauseForInterruption: (reason: string, userMessage?: string) => void
    _enterRestIfDue: () => boolean
}

let enforcingCharacterState = false
let previousSceneGenerating = false
let restTimer: ReturnType<typeof setTimeout> | null = null

function flagsForStatus(status: RotationStatus): RotationRuntimeFlags {
    return {
        active: status === 'arming_pass' || status === 'generating_pass' || status === 'paused' || status === 'resting',
        paused: status === 'paused',
        awaitingWorker: status === 'arming_pass',
        resting: status === 'resting',
    }
}

function clampMinutes(value: number | undefined, fallback: number, min = 1): number {
    return Math.max(min, Math.floor(value ?? fallback))
}

function rollDurationMs(baseMinutes: number, jitterMinutes: number): number {
    const jitter = Math.max(0, jitterMinutes || 0)
    const offset = (Math.random() * 2 - 1) * jitter
    return Math.round(Math.max(1, baseMinutes + offset) * 60000)
}

function clearRestTimer(): void {
    if (restTimer) {
        clearTimeout(restTimer)
        restTimer = null
    }
}

function normalizeStopOptions(input?: RotationStopInput): RotationStopOptions {
    if (typeof input === 'string') return { reason: input, keepSnapshot: true }
    return { keepSnapshot: true, ...input }
}

function scheduleRestEnd(): void {
    clearRestTimer()
    const restUntil = useRotationStore.getState().restUntil
    if (!restUntil) return
    restTimer = setTimeout(() => {
        useRotationStore.getState().endRest()
    }, Math.max(0, restUntil - Date.now()))
}

export const useRotationStore = create<RotationState>()(
    persist(
        (set, get) => ({
            status: 'idle',
            characterIds: [],
            pinnedCharacterIds: [],
            repeats: 1,
            restEnabled: false,
            workMinutes: 480,
            workJitterMinutes: 30,
            restMinutes: 300,
            restJitterMinutes: 30,
            restUntil: null,
            workStartedAt: null,
            nextWorkTargetMs: null,
            currentIndex: 0,
            currentRepeat: 0,
            snapshot: null,
            ...flagsForStatus('idle'),

            setCharacterIds: (ids) => set({ characterIds: ids }),
            setPinnedCharacterIds: (ids) => set({ pinnedCharacterIds: ids }),
            setRepeats: (count) => set({ repeats: Math.max(1, Math.min(100, Math.floor(count))) }),
            setRestConfig: (config) => set(state => ({
                restEnabled: config.restEnabled ?? state.restEnabled,
                workMinutes: clampMinutes(config.workMinutes, state.workMinutes),
                workJitterMinutes: clampMinutes(config.workJitterMinutes, state.workJitterMinutes, 0),
                restMinutes: clampMinutes(config.restMinutes, state.restMinutes),
                restJitterMinutes: clampMinutes(config.restJitterMinutes, state.restJitterMinutes, 0),
            })),

            start: () => {
                const state = get()
                if (state.active) return '로테이션이 이미 진행 중입니다.'
                if (useGenerationStore.getState().generatingMode === 'main') return '메인 모드 생성을 먼저 멈춰주세요.'
                if (useAuthStore.getState().getActiveTokens().length === 0) return '사용 가능한 NovelAI 토큰 슬롯이 없습니다.'
                if (state.characterIds.length === 0) return '로테이션할 캐릭터를 선택하세요.'

                const sceneStore = useSceneStore.getState()
                const activePresetId = sceneStore.activePresetId
                if (!activePresetId) return '활성 씬 프리셋이 없습니다.'

                const activePreset = sceneStore.presets.find(preset => preset.id === activePresetId)
                if (!activePreset) return '활성 씬 프리셋을 찾을 수 없습니다.'

                const queueCounts: Record<string, number> = {}
                for (const scene of activePreset.scenes) {
                    if (scene.queueCount > 0) queueCounts[scene.id] = scene.queueCount
                }
                if (Object.keys(queueCounts).length === 0) return '씬 큐를 먼저 채워주세요.'

                const characterStore = useCharacterPromptStore.getState()
                const missing = state.characterIds.filter(id => !characterStore.characters.some(character => character.id === id))
                if (missing.length > 0) return '선택된 캐릭터 일부가 스테이지에 없습니다.'

                const enabledStates: Record<string, boolean> = {}
                for (const character of characterStore.characters) {
                    enabledStates[character.id] = character.enabled
                }

                clearRestTimer()
                set({
                    status: 'idle',
                    ...flagsForStatus('idle'),
                    currentIndex: 0,
                    currentRepeat: 0,
                    restUntil: null,
                    workStartedAt: Date.now(),
                    nextWorkTargetMs: rollDurationMs(state.workMinutes, state.workJitterMinutes),
                    snapshot: { presetId: activePresetId, queueCounts, enabledStates },
                })

                startPass(state.characterIds[0])
                return null
            },

            resumeSavedSession: () => {
                const state = get()
                if (state.active) return '로테이션이 이미 진행 중입니다.'
                if (!state.snapshot) return '저장된 로테이션 세션이 없습니다.'
                if (useGenerationStore.getState().generatingMode === 'main') return '메인 모드 생성을 먼저 멈춰주세요.'
                if (useAuthStore.getState().getActiveTokens().length === 0) return '사용 가능한 NovelAI 토큰 슬롯이 없습니다.'

                const sceneStore = useSceneStore.getState()
                if (!sceneStore.presets.some(preset => preset.id === state.snapshot!.presetId)) {
                    get().discardSavedSession()
                    return '저장된 세션의 씬 프리셋이 삭제되었습니다.'
                }

                const characterStore = useCharacterPromptStore.getState()
                const missing = state.characterIds.filter(id => !characterStore.characters.some(character => character.id === id))
                if (missing.length > 0) return '저장된 세션의 캐릭터 일부가 스테이지에 없습니다.'

                clearRestTimer()
                const stillResting = state.status === 'resting' && !!state.restUntil && state.restUntil > Date.now()
                set({
                    status: stillResting ? 'resting' : 'idle',
                    ...flagsForStatus(stillResting ? 'resting' : 'idle'),
                    restUntil: stillResting ? state.restUntil : null,
                    workStartedAt: Date.now(),
                    nextWorkTargetMs: rollDurationMs(state.workMinutes, state.workJitterMinutes),
                })

                if (stillResting) {
                    scheduleRestEnd()
                    return null
                }

                const liveQueue = sceneStore.presets
                    .find(preset => preset.id === state.snapshot!.presetId)
                    ?.scenes.reduce((sum, scene) => sum + scene.queueCount, 0) ?? 0

                if (liveQueue > 0) {
                    if (!reassertCharacterAndPreset(state.characterIds[state.currentIndex])) return '로테이션 상태 복원에 실패했습니다.'
                    set({ status: 'arming_pass', ...flagsForStatus('arming_pass') })
                    sceneStore.startNewGenerationSession()
                } else {
                    startPass(state.characterIds[state.currentIndex])
                }

                return null
            },

            discardSavedSession: () => {
                const snapshot = get().snapshot
                clearRestTimer()
                set({
                    status: 'idle',
                    ...flagsForStatus('idle'),
                    currentIndex: 0,
                    currentRepeat: 0,
                    restUntil: null,
                    workStartedAt: null,
                    nextWorkTargetMs: null,
                    snapshot: null,
                })
                if (snapshot) restoreEnabledStates(snapshot)
            },

            stop: (optionsInput) => {
                const options = normalizeStopOptions(optionsInput)
                const snapshot = get().snapshot
                console.log(`[Rotation] stopped${options.reason ? `: ${options.reason}` : ''}`)
                clearRestTimer()
                set({
                    status: 'idle',
                    ...flagsForStatus('idle'),
                    ...(options.keepSnapshot === false ? { currentIndex: 0, currentRepeat: 0, snapshot: null } : {}),
                    restUntil: null,
                    workStartedAt: null,
                    nextWorkTargetMs: null,
                })
                if (snapshot) restoreEnabledStates(snapshot)
                useSceneStore.getState().setIsGenerating(false)
            },

            cancel: (reason) => {
                const snapshot = get().snapshot
                console.log(`[Rotation] cancelled${reason ? `: ${reason}` : ''}`)
                clearRestTimer()
                set({
                    status: 'idle',
                    ...flagsForStatus('idle'),
                    currentIndex: 0,
                    currentRepeat: 0,
                    restUntil: null,
                    workStartedAt: null,
                    nextWorkTargetMs: null,
                    snapshot: null,
                })
                if (snapshot) restoreEnabledStates(snapshot)
                useSceneStore.getState().setIsGenerating(false)
            },

            resume: () => {
                const state = get()
                if (state.status !== 'paused' || !state.snapshot) return
                if (useSceneStore.getState().isGenerating) return
                if (useGenerationStore.getState().generatingMode === 'main') return
                if (useAuthStore.getState().getActiveTokens().length === 0) return
                if (!reassertCharacterAndPreset(state.characterIds[state.currentIndex])) return
                set({ status: 'arming_pass', ...flagsForStatus('arming_pass') })
                useSceneStore.getState().startNewGenerationSession()
            },

            endRest: () => {
                const state = get()
                clearRestTimer()
                if (state.status !== 'resting' || !state.snapshot) return
                set({
                    status: 'idle',
                    ...flagsForStatus('idle'),
                    restUntil: null,
                    workStartedAt: Date.now(),
                    nextWorkTargetMs: rollDurationMs(state.workMinutes, state.workJitterMinutes),
                })
                toast({ title: '휴식 종료', description: '로테이션 생성을 다시 시작합니다.', variant: 'success' })
                startPass(get().characterIds[get().currentIndex])
            },

            onWorkerConfirmed: () => {
                const state = get()
                if (!state.active || state.status !== 'arming_pass') return
                set({ status: 'generating_pass', ...flagsForStatus('generating_pass') })
            },

            onPassComplete: () => {
                const state = get()
                if (!state.active || !state.snapshot) return

                let nextIndex = state.currentIndex + 1
                let nextRepeat = state.currentRepeat
                if (nextIndex >= state.characterIds.length) {
                    nextIndex = 0
                    nextRepeat += 1
                }

                if (nextRepeat >= state.repeats) {
                    const snapshot = state.snapshot
                    clearRestTimer()
                    set({
                        status: 'completed',
                        ...flagsForStatus('completed'),
                        currentIndex: 0,
                        currentRepeat: 0,
                        restUntil: null,
                        workStartedAt: null,
                        nextWorkTargetMs: null,
                        snapshot: null,
                    })
                    restoreEnabledStates(snapshot)
                    toast({ title: '로테이션 완료', description: '모든 캐릭터 반복 생성이 끝났습니다.', variant: 'success' })
                    return
                }

                set({ currentIndex: nextIndex, currentRepeat: nextRepeat })
                if (get()._enterRestIfDue()) return

                setTimeout(() => {
                    const latest = useRotationStore.getState()
                    if (!latest.active || latest.status === 'paused' || latest.status === 'resting' || !latest.snapshot) return
                    if (useSceneStore.getState().isGenerating) {
                        latest.pauseForInterruption('generation started during inter-pass gap', '다른 생성이 시작되어 로테이션을 일시정지했습니다.')
                        return
                    }
                    startPass(latest.characterIds[latest.currentIndex])
                }, 800)
            },

            pauseForInterruption: (reason, userMessage) => {
                const state = get()
                if (!state.active || state.status === 'paused') return
                console.log(`[Rotation] paused: ${reason}`)
                set({ status: 'paused', ...flagsForStatus('paused') })
                toast({
                    title: '로테이션 일시정지',
                    description: userMessage || '생성이 중단되었습니다. 토큰/슬롯 상태를 확인한 뒤 재개하세요.',
                    variant: 'destructive',
                })
            },

            _enterRestIfDue: () => {
                const state = get()
                if (!state.restEnabled || !state.workStartedAt || !state.nextWorkTargetMs) return false
                if (Date.now() - state.workStartedAt < state.nextWorkTargetMs) return false

                const restMs = rollDurationMs(state.restMinutes, state.restJitterMinutes)
                const restUntil = Date.now() + restMs
                set({ status: 'resting', ...flagsForStatus('resting'), restUntil })
                scheduleRestEnd()
                toast({
                    title: '휴식 시작',
                    description: `밴 방지를 위해 약 ${Math.round(restMs / 60000)}분 휴식 후 자동 재개합니다.`,
                })
                return true
            },
        }),
        {
            name: 'nais2-character-rotation',
            storage: createJSONStorage(() => indexedDBStorage),
            partialize: (state) => ({
                status: state.status,
                characterIds: state.characterIds,
                pinnedCharacterIds: state.pinnedCharacterIds,
                repeats: state.repeats,
                restEnabled: state.restEnabled,
                workMinutes: state.workMinutes,
                workJitterMinutes: state.workJitterMinutes,
                restMinutes: state.restMinutes,
                restJitterMinutes: state.restJitterMinutes,
                restUntil: state.restUntil,
                currentIndex: state.currentIndex,
                currentRepeat: state.currentRepeat,
                snapshot: state.snapshot,
            }),
            onRehydrateStorage: () => (state) => {
                if (!state) return
                const hydratedStatus = state.status ?? 'idle'
                const snapshot = state.snapshot
                Object.assign(state, {
                    status: hydratedStatus,
                    ...flagsForStatus('idle'),
                    workStartedAt: null,
                    nextWorkTargetMs: null,
                })
                if (snapshot) {
                    setTimeout(() => restoreEnabledStates(snapshot), 0)
                }
            },
        }
    )
)

function startPass(characterId: string): void {
    const rotation = useRotationStore.getState()
    const snapshot = rotation.snapshot
    if (!snapshot) {
        rotation.cancel('missing snapshot')
        return
    }
    if (!reassertCharacterAndPreset(characterId)) return

    const sceneStore = useSceneStore.getState()
    const preset = sceneStore.presets.find(p => p.id === snapshot.presetId)
    if (!preset) {
        rotation.cancel('missing preset')
        return
    }

    const liveSceneIds = new Set(preset.scenes.map(scene => scene.id))
    let restoredCount = 0
    for (const [sceneId, count] of Object.entries(snapshot.queueCounts)) {
        if (!liveSceneIds.has(sceneId)) continue
        sceneStore.setQueueCount(snapshot.presetId, sceneId, count)
        restoredCount += count
    }

    if (restoredCount === 0) {
        rotation.cancel('no scenes to restore')
        return
    }

    useRotationStore.setState({ status: 'arming_pass', ...flagsForStatus('arming_pass') })
    sceneStore.initGenerationProgress()
    sceneStore.startNewGenerationSession()
}

function reassertCharacterAndPreset(characterId: string): boolean {
    const rotation = useRotationStore.getState()
    const snapshot = rotation.snapshot
    if (!snapshot) return false

    const sceneStore = useSceneStore.getState()
    if (!sceneStore.presets.some(preset => preset.id === snapshot.presetId)) {
        rotation.cancel('target preset deleted')
        return false
    }
    if (sceneStore.activePresetId !== snapshot.presetId) {
        sceneStore.setActivePreset(snapshot.presetId)
    }

    enforceCharacterSelection(characterId)
    return true
}

function enforceCharacterSelection(characterId: string): void {
    enforcingCharacterState = true
    try {
        const pinnedIds = new Set(useRotationStore.getState().pinnedCharacterIds)
        const characterStore = useCharacterPromptStore.getState()
        for (const character of characterStore.characters) {
            const shouldBeEnabled = character.id === characterId || pinnedIds.has(character.id)
            if (character.enabled !== shouldBeEnabled) {
                characterStore.toggleEnabled(character.id)
            }
        }
    } finally {
        enforcingCharacterState = false
    }
}

function restoreEnabledStates(snapshot: RotationSnapshot): void {
    enforcingCharacterState = true
    try {
        const characterStore = useCharacterPromptStore.getState()
        for (const [characterId, wasEnabled] of Object.entries(snapshot.enabledStates)) {
            const character = characterStore.characters.find(c => c.id === characterId)
            if (character && character.enabled !== wasEnabled) {
                characterStore.toggleEnabled(characterId)
            }
        }
    } finally {
        enforcingCharacterState = false
    }
}

useSceneStore.subscribe((state) => {
    const isGenerating = state.isGenerating
    if (previousSceneGenerating && !isGenerating) {
        const rotation = useRotationStore.getState()
        if (rotation.active && rotation.status !== 'resting') {
            const presetId = rotation.snapshot?.presetId
            const remaining = presetId
                ? state.presets.find(preset => preset.id === presetId)?.scenes.reduce((sum, scene) => sum + scene.queueCount, 0) ?? 0
                : 0

            if (remaining === 0) {
                rotation.onPassComplete()
            } else {
                rotation.pauseForInterruption('scene generation stopped with queue remaining')
            }
        }
    }
    previousSceneGenerating = isGenerating
})

useCharacterPromptStore.subscribe((state) => {
    if (enforcingCharacterState) return
    const rotation = useRotationStore.getState()
    if (!rotation.active || rotation.status === 'paused' || rotation.status === 'resting') return
    const currentId = rotation.characterIds[rotation.currentIndex]
    const pinnedIds = new Set(rotation.pinnedCharacterIds)
    const dirty = state.characters.some(character => character.enabled !== (character.id === currentId || pinnedIds.has(character.id)))
    if (dirty) enforceCharacterSelection(currentId)
})

let previousSlot1Active = useAuthStore.getState().isSlotActive(1)
let previousSlot2Active = useAuthStore.getState().isSlotActive(2)

useAuthStore.subscribe(() => {
    const auth = useAuthStore.getState()
    const slot1Active = auth.isSlotActive(1)
    const slot2Active = auth.isSlotActive(2)
    const becameUsable = (!previousSlot1Active && slot1Active) || (!previousSlot2Active && slot2Active)
    previousSlot1Active = slot1Active
    previousSlot2Active = slot2Active

    const rotation = useRotationStore.getState()
    if (becameUsable && rotation.status === 'paused' && !useSceneStore.getState().isGenerating) {
        rotation.resume()
    }
})
