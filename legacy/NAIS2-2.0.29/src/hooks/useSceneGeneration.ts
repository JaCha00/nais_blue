import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/components/ui/use-toast'
import { useSceneStore } from '@/stores/scene-store'
import { useGenerationStore } from '@/stores/generation-store'
import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useAuthStore } from '@/stores/auth-store'
import { generateImage, generateImageStream, GenerationParams } from '@/services/novelai-api'
import { BaseDirectory, writeFile, mkdir, exists } from '@tauri-apps/plugin-fs'
import { pictureDir, join } from '@tauri-apps/api/path'
import { processWildcards } from '@/lib/fragment-processor'
import { useCharacterStore } from '@/stores/character-store'
import { useRotationStore } from '@/lib/character-rotation'

// Module-level worker tracking. Each running worker owns one API token slot, so
// the total worker count is bounded by the number of verified+enabled accounts (1 or 2).
let activeWorkerCount = 0
// Tracks which slots currently have a live worker. Used to make the spawn
// effect idempotent — re-runs of the effect don't double-spawn the same slot,
// and a slot that was disabled mid-run can be re-enabled to spin up a new worker.
const runningSlots = new Set<1 | 2>()

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

// Sanitize a string for use as a folder/file name on Windows.
const sanitizePathComponent = (s: string): string => s.replace(/[<>:"/\\|?*]/g, '_').trim()

const roundTo64 = (value: number): number => Math.round(value / 64) * 64

interface WorkerContext {
    activePresetId: string
    streamingView: boolean
    savePath: string
    t: ReturnType<typeof useTranslation>['t']
}

// Process a single scene with the given token. Returns true on success.
async function processOneScene(
    token: string,
    scene: { id: string; name: string; scenePrompt: string; width?: number; height?: number; excludePinned?: boolean },
    ctx: WorkerContext
): Promise<boolean> {
    const { activePresetId, streamingView, savePath, t } = ctx

    useSceneStore.getState().setStreamingData(scene.id, null, 0)

    const genState = useGenerationStore.getState()

    const parts = [
        genState.basePrompt,
        genState.i2iMode === 'inpaint' ? genState.inpaintingPrompt : null,
        genState.additionalPrompt,
        scene.scenePrompt,
        genState.detailPrompt,
    ].filter(p => p && p.trim())

    const finalPrompt = await processWildcards(parts.join(', '))

    const characterStoreState = useCharacterStore.getState()
    const { characterImages, vibeImages } = characterStoreState
    const { characters: characterPrompts } = useCharacterPromptStore.getState()

    // Solo scenes (excludePinned) drop the rotation's pinned characters (e.g. the
    // male partner "boy") for THIS scene only — no need to split presets.
    const rotForPinned = useRotationStore.getState()
    const skipPinned = (rotForPinned.active && scene.excludePinned)
        ? new Set(rotForPinned.pinnedCharacterIds)
        : null

    const processedCharacterPrompts = await Promise.all(
        characterPrompts
            .filter(c => c.enabled && !(skipPinned && skipPinned.has(c.id)))
            .map(async c => ({
                prompt: await processWildcards(c.prompt),
                negative: await processWildcards(c.negative),
                enabled: c.enabled,
                position: c.position,
            }))
    )

    const finalSeed = genState.seedLocked ? genState.seed : Math.floor(Math.random() * 4294967295)

    let finalWidth = roundTo64(scene.width || genState.selectedResolution.width)
    let finalHeight = roundTo64(scene.height || genState.selectedResolution.height)

    if (genState.sourceImage) {
        try {
            const img = new Image()
            await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve()
                img.onerror = () => reject(new Error('Failed to load source image'))
                img.src = genState.sourceImage!
            })
            finalWidth = roundTo64(img.width)
            finalHeight = roundTo64(img.height)
        } catch {
            console.warn('[SceneGeneration] Failed to get source image dimensions, using scene/global resolution')
        }
    }

    const params: GenerationParams = {
        prompt: finalPrompt,
        negative_prompt: genState.negativePrompt,
        steps: genState.steps,
        cfg_scale: genState.cfgScale,
        cfg_rescale: genState.cfgRescale,
        sampler: genState.sampler,
        scheduler: genState.scheduler,
        smea: genState.smea,
        smea_dyn: genState.smeaDyn,
        variety: genState.variety ?? false,
        seed: finalSeed,
        width: finalWidth,
        height: finalHeight,
        model: genState.model,
        sourceImage: genState.sourceImage || undefined,
        strength: genState.strength,
        noise: genState.noise,
        mask: genState.mask || undefined,
        charImages: characterImages.map(img => img.base64),
        charStrength: characterImages.map(img => img.strength),
        charFidelity: characterImages.map(img => img.fidelity ?? 1.0),
        charMode: characterImages.map(img => img.mode || 'character&style'),
        vibeImages: vibeImages.map(img => img.base64),
        vibeInfo: vibeImages.map(img => img.informationExtracted),
        vibeStrength: vibeImages.map(img => img.strength),
        preEncodedVibes: vibeImages.map(img => img.encodedVibe || null),
        characterPrompts: processedCharacterPrompts,
    }

    const result = streamingView
        ? await generateImageStream(token, params, (progress, image) => {
            if (image) {
                useSceneStore.getState().setStreamingData(scene.id, `data:image/png;base64,${image}`, progress / 100)
            } else {
                useSceneStore.getState().setStreamingData(scene.id, null, progress / 100)
            }
        })
        : await generateImage(token, params)

    if (!result.success || !result.imageData) {
        console.error('Generation failed:', result.error)
        toast({ title: t('common.error', '오류'), description: result.error || 'Generation failed', variant: 'destructive' })
        return false
    }

    // Save image
    const currentPreset = useSceneStore.getState().presets.find(p => p.id === activePresetId)
    const safePresetName = sanitizePathComponent(currentPreset?.name || 'Default')
    const safeSceneName = sanitizePathComponent(scene.name) || 'Untitled_Scene'
    const fileName = `NAIS_SCENE_${Date.now()}_${Math.floor(Math.random() * 1000)}.png`

    // During a character rotation, group output under the CURRENT rotation
    // character's name: NAIS_Scene/{preset}/{character}/{scene}/. Pinned
    // (always-included) characters are NOT used for folder naming.
    let safeCharName = ''
    const rot = useRotationStore.getState()
    if (rot.active && rot.snapshot) {
        const curId = rot.characterIds[rot.currentIndex]
        const ch = useCharacterPromptStore.getState().characters.find(c => c.id === curId)
        const rawName = ch?.name?.trim() || ch?.prompt?.split(',')[0]?.trim() || ''
        safeCharName = sanitizePathComponent(rawName)
    }

    try {
        const base64Data = result.imageData.replace(/^data:image\/png;base64,/, '')
        const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0))

        const { useAbsolutePath } = useSettingsStore.getState()
        let fullPath: string

        // Build the path segments below NAIS_Scene, optionally inserting the
        // rotation character folder between preset and scene.
        const subSegments = [safePresetName]
        if (safeCharName) subSegments.push(safeCharName)
        subSegments.push(safeSceneName)

        if (useAbsolutePath && savePath) {
            let dir = await join(savePath, 'NAIS_Scene')
            if (!(await exists(dir))) await mkdir(dir, { recursive: true })
            for (const seg of subSegments) {
                dir = await join(dir, seg)
                if (!(await exists(dir))) await mkdir(dir, { recursive: true })
            }
            fullPath = await join(dir, fileName)
            await writeFile(fullPath, binaryData)
        } else {
            const baseDir = await pictureDir()
            let rel = 'NAIS_Scene'
            if (!(await exists(rel, { baseDir: BaseDirectory.Picture }))) {
                await mkdir(rel, { baseDir: BaseDirectory.Picture })
            }
            for (const seg of subSegments) {
                rel = `${rel}/${seg}`
                if (!(await exists(rel, { baseDir: BaseDirectory.Picture }))) {
                    await mkdir(rel, { baseDir: BaseDirectory.Picture })
                }
            }
            await writeFile(`${rel}/${fileName}`, binaryData, { baseDir: BaseDirectory.Picture })
            fullPath = await join(baseDir, rel, fileName)
        }

        window.dispatchEvent(new CustomEvent('newImageGenerated', {
            detail: { path: fullPath, data: `data:image/png;base64,${result.imageData}` }
        }))

        useSceneStore.getState().addImageToScene(activePresetId, scene.id, fullPath)

        useGenerationStore.getState().addToHistory({
            id: Date.now().toString(),
            url: fullPath,
            thumbnail: result.imageData ? `data:image/png;base64,${result.imageData}` : undefined,
            prompt: finalPrompt,
            seed: params.seed,
            timestamp: new Date(),
        })

        if (result.encodedVibes && result.encodedVibes.length > 0) {
            const { vibeImages: vbs, updateVibeImage } = useCharacterStore.getState()
            let encodedIndex = 0
            for (let vi = 0; vi < vbs.length && encodedIndex < result.encodedVibes.length; vi++) {
                if (!vbs[vi].encodedVibe) {
                    updateVibeImage(vbs[vi].id, { encodedVibe: result.encodedVibes[encodedIndex] })
                    encodedIndex++
                }
            }
        }
    } catch (saveError) {
        console.error('Failed to save scene image file:', saveError)
        toast({ title: t('common.saveFailed', '파일 저장 실패'), description: String(saveError), variant: 'destructive' })
        return false
    }

    const currentState = useSceneStore.getState()
    currentState.setGenerationProgress(currentState.completedCount + 1, currentState.totalQueuedCount)

    return true
}

// Long-running worker tied to a single account slot. Pulls scenes off the shared
// queue (decrementFirstQueuedScene is atomic via Zustand's set) until the
// queue is drained, the user stops generation, OR the user disables this slot.
//
// Per-iteration `isSlotActive(slot)` check is what makes "1개만 멈추기" work —
// flipping `slotXEnabled` to false from the UI causes that worker to exit
// cleanly after its current image without affecting the other worker.
async function workerLoop(slot: 1 | 2, token: string, ctx: WorkerContext): Promise<void> {
    activeWorkerCount++
    try {
        while (true) {
            const sceneState = useSceneStore.getState()
            if (!sceneState.isGenerating) return
            if (!ctx.activePresetId) return

            // User toggled this slot off (or cleared its token) — exit gracefully.
            if (!useAuthStore.getState().isSlotActive(slot)) {
                console.log(`[Scene Worker slot ${slot}] paused by user`)
                return
            }

            const scene = sceneState.decrementFirstQueuedScene(ctx.activePresetId)
            if (!scene) {
                // Queue drained from this worker's perspective.
                return
            }

            try {
                const ok = await processOneScene(token, scene, ctx)
                // Refresh Anlas for the slot that just paid so the pill in the
                // header updates immediately — mirrors generation-store.ts:540.
                if (ok) {
                    useAuthStore.getState().refreshAnlas(slot)
                }
            } catch (e) {
                const errorMessage = String(e)
                console.error(`[Scene Worker slot ${slot}] error:`, e)
                useSceneStore.getState().setStreamingData(null, null, 0)

                if (errorMessage.includes('429') || errorMessage.toLowerCase().includes('too many requests')) {
                    console.log(`[Scene Worker slot ${slot}] 429 detected, retrying after 3s...`)
                    await sleep(3000)
                    continue
                }

                toast({ title: ctx.t('common.error', '오류'), description: errorMessage, variant: 'destructive' })
                return
            }

            useSceneStore.getState().setStreamingData(null, null, 0)

            // Inter-generation jitter delay. Skipped if there's nothing left
            // queued or the user cancelled.
            const stillGenerating = useSceneStore.getState().isGenerating
            const stillQueued = useSceneStore.getState().getQueuedScenes(ctx.activePresetId).length > 0
            if (stillGenerating && stillQueued) {
                await sleep(3000 + Math.floor(Math.random() * 2001))
            }
        }
    } finally {
        activeWorkerCount--
        if (activeWorkerCount === 0) {
            // Last worker exited — clean up shared generation state.
            const sceneStore = useSceneStore.getState()
            const stillGenerating = sceneStore.isGenerating
            const queueRemaining = ctx.activePresetId
                ? sceneStore.getQueuedScenes(ctx.activePresetId).length
                : 0

            sceneStore.setIsGenerating(false)
            useGenerationStore.getState().setGeneratingMode(null)
            sceneStore.setGenerationProgress(0, 0)

            if (stillGenerating && queueRemaining === 0) {
                toast({
                    title: ctx.t('generate.complete', '생성 완료'),
                    description: ctx.t('generate.allComplete', '모든 예약된 작업이 완료되었습니다.'),
                    variant: 'success',
                })
            }
        }
    }
}

export function useSceneGeneration() {
    const { t } = useTranslation()
    const savePath = useSettingsStore(s => s.savePath)
    const streamingView = useSettingsStore(s => s.useStreaming)

    const isGenerating = useSceneStore(s => s.isGenerating)
    const activePresetId = useSceneStore(s => s.activePresetId)
    const setIsGenerating = useSceneStore(s => s.setIsGenerating)
    const initGenerationProgress = useSceneStore(s => s.initGenerationProgress)
    const completedCount = useSceneStore(s => s.completedCount)
    const totalQueuedCount = useSceneStore(s => s.totalQueuedCount)

    // Subscribe to per-slot enabled flags so this effect re-runs when the
    // user enables a slot mid-generation — that lets a slot REJOIN an
    // already-running batch (slot 1 running solo → user enables slot 2 → slot 2 spins up).
    const slot1Enabled = useAuthStore(s => s.slot1Enabled)
    const slot2Enabled = useAuthStore(s => s.slot2Enabled)
    const isVerified = useAuthStore(s => s.isVerified)
    const isVerified2 = useAuthStore(s => s.isVerified2)

    useEffect(() => {
        if (!isGenerating) return

        if (!activePresetId) {
            setIsGenerating(false)
            return
        }

        // Conflict: main mode owns the API right now.
        if (useGenerationStore.getState().generatingMode === 'main') {
            setIsGenerating(false)
            toast({
                title: t('common.error', '오류'),
                description: t('generate.conflictMain', '메인 모드에서 생성 중입니다.'),
                variant: 'destructive',
            })
            return
        }

        const tokens = useAuthStore.getState().getActiveTokens()

        if (tokens.length === 0) {
            setIsGenerating(false)
            toast({
                title: t('toast.tokenRequired.title', '토큰 필요'),
                description: t('toast.tokenRequired.desc', '먼저 API 토큰을 검증해주세요.'),
                variant: 'destructive',
            })
            return
        }

        // Initialize progress on first start
        if (completedCount === 0 && totalQueuedCount === 0) {
            initGenerationProgress()
        }

        // Switch global mode to scene
        useGenerationStore.getState().setGeneratingMode('scene')

        const ctx: WorkerContext = {
            activePresetId,
            streamingView,
            savePath,
            t,
        }

        // A real worker is about to spawn — clear the rotation's awaitingWorker
        // flag so the completion watcher knows generation genuinely started
        // (vs. being torn down before any worker ran).
        if (useRotationStore.getState().awaitingWorker) {
            useRotationStore.setState({ awaitingWorker: false })
        }

        // Spawn workers for slots that aren't already running. Tracking by slot
        // (not by index) lets us idempotently restart a slot that was disabled
        // and re-enabled mid-batch.
        tokens.forEach(({ slot, token }) => {
            if (runningSlots.has(slot)) return
            runningSlots.add(slot)
            void workerLoop(slot, token, ctx).finally(() => {
                runningSlots.delete(slot)
            })
        })
    }, [isGenerating, activePresetId, savePath, streamingView, t, completedCount, totalQueuedCount, initGenerationProgress, setIsGenerating, slot1Enabled, slot2Enabled, isVerified, isVerified2])

    return { isGenerating }
}
