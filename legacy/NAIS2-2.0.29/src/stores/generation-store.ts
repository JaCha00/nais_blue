import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'
import { attachStoreBackup } from '@/lib/auto-backup'
import { useAuthStore } from './auth-store'
import { useSettingsStore } from './settings-store'
import { generateImage, generateImageStream } from '@/services/novelai-api'
import { writeFile, mkdir, exists, BaseDirectory } from '@tauri-apps/plugin-fs'
import { pictureDir, join } from '@tauri-apps/api/path'
import { useCharacterStore } from './character-store'
import { useCharacterPromptStore } from './character-prompt-store'
import { processWildcards } from '@/lib/fragment-processor'
import i18n from '@/i18n'
import { toast } from '@/components/ui/use-toast'

// Generate thumbnail from base64 image (max 256px, JPEG quality 0.7)
const createThumbnail = (base64Image: string, maxSize = 256): Promise<string> => {
    return new Promise((resolve) => {
        const img = new Image()
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas')
                const ctx = canvas.getContext('2d')

                if (!ctx) {
                    resolve(base64Image) // Fallback to original
                    return
                }

                // Calculate thumbnail dimensions
                let width = img.width
                let height = img.height
                if (width > height) {
                    if (width > maxSize) {
                        height = Math.round(height * maxSize / width)
                        width = maxSize
                    }
                } else {
                    if (height > maxSize) {
                        width = Math.round(width * maxSize / height)
                        height = maxSize
                    }
                }

                canvas.width = width
                canvas.height = height
                ctx.drawImage(img, 0, 0, width, height)

                // Use JPEG for smaller size (~10-30KB instead of 2-5MB)
                const thumbnail = canvas.toDataURL('image/jpeg', 0.7)
                resolve(thumbnail)
            } catch {
                resolve(base64Image) // Fallback to original
            }
        }
        img.onerror = () => {
            resolve(base64Image) // Fallback to original
        }
        img.src = base64Image
    })
}

interface Resolution {
    label: string
    width: number
    height: number
}

interface HistoryItem {
    id: string
    url: string // Base64 or Blob URL
    thumbnail?: string
    prompt: string
    seed: number
    timestamp: Date
}

export const AVAILABLE_MODELS = [
    { id: 'nai-diffusion-4-5-curated', name: 'NAI Diffusion V4.5 Curated' },
    { id: 'nai-diffusion-4-5-full', name: 'NAI Diffusion V4.5 Full' },
    { id: 'nai-diffusion-4-curated-preview', name: 'NAI Diffusion V4 Curated' },
    { id: 'nai-diffusion-4-full', name: 'NAI Diffusion V4 Full' },
    { id: 'nai-diffusion-3', name: 'NAI Diffusion V3 (Anime)' },
    { id: 'nai-diffusion-furry-3', name: 'NAI Diffusion Furry V3' },
] as const

interface GenerationState {
    // Prompt fields
    basePrompt: string
    additionalPrompt: string
    detailPrompt: string
    negativePrompt: string
    inpaintingPrompt: string

    // Model selection
    model: string

    // Generation settings
    steps: number
    cfgScale: number
    cfgRescale: number
    sampler: string
    scheduler: string
    smea: boolean
    smeaDyn: boolean
    variety: boolean

    seed: number
    previewSeed: number | null
    seedLocked: boolean
    selectedResolution: Resolution

    // Quality settings
    qualityToggle: boolean
    ucPreset: number

    // Batch generation
    batchCount: number
    currentBatch: number

    // I2I & Inpainting
    sourceImage: string | null
    strength: number
    noise: number
    mask: string | null
    i2iMode: 'i2i' | 'inpaint' | null

    // Timing
    lastGenerationTime: number | null  // ms
    estimatedTime: number | null

    // State
    isGenerating: boolean // Deprecated in favor of generatingMode check? Or keep for local main mode state?
    generatingMode: 'main' | 'scene' | null
    isCancelled: boolean
    previewImage: string | null
    history: HistoryItem[]

    // AbortController for cancellation
    abortController: AbortController | null

    // Streaming progress (0-100)
    streamProgress: number

    // Actions
    setBasePrompt: (prompt: string) => void
    setAdditionalPrompt: (prompt: string) => void
    setDetailPrompt: (prompt: string) => void
    setNegativePrompt: (prompt: string) => void
    setInpaintingPrompt: (prompt: string) => void

    setModel: (model: string) => void
    setSteps: (steps: number) => void
    setCfgScale: (v: number) => void
    setCfgRescale: (v: number) => void
    setSampler: (v: string) => void
    setScheduler: (v: string) => void
    setSmea: (v: boolean) => void
    setSmeaDyn: (v: boolean) => void
    setVariety: (v: boolean) => void

    setSeed: (seed: number) => void
    setPreviewSeed: (seed: number | null) => void
    setSeedLocked: (locked: boolean) => void
    setSelectedResolution: (resolution: Resolution) => void
    setQualityToggle: (v: boolean) => void
    setUcPreset: (v: number) => void

    setBatchCount: (count: number) => void

    // I2I Actions
    setSourceImage: (img: string | null) => void
    setReferenceImage: (img: string | null) => void
    setStrength: (v: number) => void
    setNoise: (v: number) => void
    setMask: (mask: string | null) => void
    setI2IMode: (mode: 'i2i' | 'inpaint' | null) => void
    resetI2IParams: () => void

    generate: () => Promise<void>
    cancelGeneration: () => void
    addToHistory: (item: HistoryItem) => void
    clearHistory: () => void
    setPreviewImage: (url: string | null) => void
    setIsGenerating: (v: boolean) => void // Only for Main Mode use ideally
    setGeneratingMode: (mode: 'main' | 'scene' | null) => void
    setStreamProgress: (progress: number) => void
}

export const useGenerationStore = create<GenerationState>()(
    persist(
        (set, get) => ({
            // Initial state
            basePrompt: '',
            additionalPrompt: '',
            detailPrompt: '',
            negativePrompt: '',
            inpaintingPrompt: '',

            model: 'nai-diffusion-4-5-full',

            steps: 28,
            cfgScale: 5.0,
            cfgRescale: 0.0,
            sampler: 'k_euler_ancestral',
            scheduler: 'karras',
            smea: true,
            smeaDyn: true,
            variety: false,

            seed: Math.floor(Math.random() * 4294967295),
            previewSeed: null,
            seedLocked: false,
            selectedResolution: { label: 'Portrait', width: 832, height: 1216 },

            qualityToggle: true,
            ucPreset: 0,

            batchCount: 1,
            currentBatch: 0,

            // I2I Init
            sourceImage: null,
            strength: 0.7,
            noise: 0.0,
            mask: null,
            i2iMode: null,

            lastGenerationTime: null,
            estimatedTime: null,

            isGenerating: false,
            generatingMode: null,
            isCancelled: false,
            previewImage: null,
            history: [],
            abortController: null,
            streamProgress: 0,

            // Actions
            setBasePrompt: (prompt) => set({ basePrompt: prompt }),
            setAdditionalPrompt: (prompt) => set({ additionalPrompt: prompt }),
            setDetailPrompt: (prompt) => set({ detailPrompt: prompt }),
            setNegativePrompt: (prompt) => set({ negativePrompt: prompt }),
            setInpaintingPrompt: (prompt) => set({ inpaintingPrompt: prompt }),

            setModel: (model) => set({ model }),
            setSteps: (steps) => set({ steps }),
            setCfgScale: (cfgScale) => set({ cfgScale }),
            setCfgRescale: (cfgRescale) => set({ cfgRescale }),
            setSampler: (sampler) => set({ sampler }),
            setScheduler: (scheduler) => set({ scheduler }),
            setSmea: (smea) => set({ smea }),
            setSmeaDyn: (smeaDyn) => set({ smeaDyn }),
            setVariety: (variety) => set({ variety }),

            setSeed: (seed) => set({ seed }),
            setPreviewSeed: (previewSeed) => set({ previewSeed }),
            setSeedLocked: (locked) => set({ seedLocked: locked }),
            setSelectedResolution: (resolution) => set({ selectedResolution: resolution }),
            setQualityToggle: (qualityToggle) => set({ qualityToggle }),
            setUcPreset: (ucPreset) => set({ ucPreset }),

            setBatchCount: (count) => set({ batchCount: count }),

            setSourceImage: (img) => set({ sourceImage: img }),
            setReferenceImage: (img) => set({ sourceImage: img }), // Alias for now
            setStrength: (v) => set({ strength: v }),
            setNoise: (v) => set({ noise: v }),
            setMask: (mask) => set({ mask }),
            setI2IMode: (mode) => set({ i2iMode: mode }),
            resetI2IParams: () => set({ sourceImage: null, mask: null, strength: 0.7, noise: 0.0, inpaintingPrompt: '', i2iMode: null }),

            cancelGeneration: () => {
                const { abortController, seedLocked } = get()
                if (abortController) {
                    abortController.abort()
                }
                // Generate new seed if not locked (same as successful generation)
                const newSeed = seedLocked ? undefined : Math.floor(Math.random() * 4294967295)
                set({ 
                    isCancelled: true, 
                    isGenerating: false, 
                    generatingMode: null, 
                    currentBatch: 0,
                    ...(newSeed !== undefined && { seed: newSeed })
                })
                toast({
                    title: i18n.t('toast.generationCancelled.title'),
                    description: i18n.t('toast.generationCancelled.desc'),
                })
            },

            generate: async () => {
                const {
                    basePrompt, additionalPrompt, detailPrompt, negativePrompt, inpaintingPrompt,
                    model, steps, cfgScale, cfgRescale, sampler, scheduler, smea, smeaDyn, variety,
                    selectedResolution, batchCount, lastGenerationTime,
                    sourceImage, strength, noise, mask
                } = get()

                const tokens = useAuthStore.getState().getActiveTokens()

                if (tokens.length === 0) {
                    toast({
                        title: i18n.t('toast.tokenRequired.title'),
                        description: i18n.t('toast.tokenRequired.desc'),
                        variant: 'destructive',
                    })
                    return
                }

                // Check for cross-mode conflict
                if (get().generatingMode === 'scene') {
                    toast({
                        title: i18n.t('common.error'),
                        description: i18n.t('generate.conflictScene', '씬 모드에서 생성 중입니다.'),
                        variant: 'destructive',
                    })
                    return
                }

                // Create new AbortController
                const abortController = new AbortController()
                set({
                    isGenerating: true,
                    generatingMode: 'main',
                    isCancelled: false,
                    abortController,
                    estimatedTime: lastGenerationTime ? lastGenerationTime * batchCount : null
                })

                try {
                    // ============================================================
                    // Parallel batch generation
                    //
                    // - Single token: one worker runs the full batch (original behavior).
                    // - Two tokens (dual API): two workers run concurrently, pulling from
                    //   a shared atomic counter. For batchCount=100 with 2 workers, each
                    //   ends up doing ~50 (first-come, first-served — slightly skewed if
                    //   one account is faster, but always sums to exactly batchCount).
                    //
                    // Streaming preview is forced off when running parallel because two
                    // workers writing to the same `previewImage` / `streamProgress` would
                    // produce constant flicker. Single-token batches keep streaming.
                    // ============================================================

                    const numWorkers = tokens.length
                    const useStreamingForBatch = useSettingsStore.getState().useStreaming && numWorkers === 1

                    const roundTo64 = (value: number): number => Math.round(value / 64) * 64

                    // Resolve source-image dimensions ONCE — they don't change per iteration.
                    let finalWidth = roundTo64(selectedResolution.width)
                    let finalHeight = roundTo64(selectedResolution.height)
                    if (sourceImage) {
                        try {
                            const img = new Image()
                            await new Promise<void>((resolve, reject) => {
                                img.onload = () => resolve()
                                img.onerror = () => reject(new Error('Failed to load source image'))
                                img.src = sourceImage
                            })
                            finalWidth = roundTo64(img.width)
                            finalHeight = roundTo64(img.height)
                            console.log(`[Generate] Using source image dimensions: ${img.width}x${img.height} → ${finalWidth}x${finalHeight}`)
                        } catch {
                            console.warn('[Generate] Failed to get source image dimensions, using global resolution')
                        }
                    }

                    const batchTotal = batchCount
                    let nextSlot = 0 // shared atomic-ish counter — JS is single-threaded, so ++ is atomic across awaited callsites

                    set({ currentBatch: 0, streamProgress: 0 })

                    const generateOne = async (token: string, slot: 1 | 2): Promise<boolean> => {
                        if (get().isCancelled) return false

                        // Per-iteration prompt (wildcards re-rolled each call so each image differs)
                        let finalPrompt = [basePrompt, inpaintingPrompt, additionalPrompt, detailPrompt].filter(Boolean).join(', ')
                        finalPrompt = await processWildcards(finalPrompt)

                        const currentSeed = get().seedLocked ? get().seed : Math.floor(Math.random() * 4294967295)

                        const { characterImages, vibeImages } = useCharacterStore.getState()
                        const { characters: characterPrompts, positionEnabled } = useCharacterPromptStore.getState()

                        const processedCharacterPrompts = await Promise.all(
                            characterPrompts.filter(c => c.enabled).map(async c => ({
                                ...c,
                                prompt: await processWildcards(c.prompt),
                                negative: await processWildcards(c.negative),
                            }))
                        )

                        const generationParams = {
                            prompt: finalPrompt,
                            negative_prompt: negativePrompt,
                            model,
                            width: finalWidth,
                            height: finalHeight,
                            steps,
                            cfg_scale: cfgScale,
                            cfg_rescale: cfgRescale,
                            sampler,
                            scheduler,
                            smea,
                            smea_dyn: smeaDyn,
                            variety,
                            seed: currentSeed,
                            sourceImage: sourceImage || undefined,
                            strength,
                            noise,
                            mask: mask || undefined,
                            charImages: characterImages.map(img => img.base64),
                            charStrength: characterImages.map(img => img.strength),
                            charFidelity: characterImages.map(img => img.fidelity ?? 1.0),
                            charMode: characterImages.map(img => img.mode || 'character&style'),
                            vibeImages: vibeImages.map(img => img.base64),
                            vibeInfo: vibeImages.map(img => img.informationExtracted),
                            vibeStrength: vibeImages.map(img => img.strength),
                            preEncodedVibes: vibeImages.map(img => img.encodedVibe || null),
                            characterPrompts: processedCharacterPrompts,
                            characterPositionEnabled: positionEnabled,
                        }

                        let result
                        if (useStreamingForBatch) {
                            result = await generateImageStream(token, generationParams, (progress, partialImage) => {
                                if (partialImage) {
                                    set({ streamProgress: progress, previewImage: `data:image/png;base64,${partialImage}` })
                                } else {
                                    set({ streamProgress: progress })
                                }
                            })
                            set({ streamProgress: 0 })
                        } else {
                            result = await generateImage(token, generationParams)
                        }

                        if (get().isCancelled) return false

                        if (!result.success || !result.imageData) {
                            toast({
                                title: i18n.t('toast.generationFailed.title'),
                                description: result.error || i18n.t('toast.unknownError'),
                                variant: 'destructive',
                            })
                            return false
                        }

                        const imageUrl = `data:image/png;base64,${result.imageData}`
                        set({ previewImage: imageUrl })

                        // Cache newly encoded vibes back to character store
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

                        const thumbnail = await createThumbnail(imageUrl)

                        const historyItem: HistoryItem = {
                            id: `${Date.now()}_s${slot}_${Math.floor(Math.random() * 1000)}`,
                            url: thumbnail,
                            prompt: finalPrompt,
                            seed: currentSeed,
                            timestamp: new Date(),
                        }

                        // Save image
                        const { savePath, autoSave, useAbsolutePath } = useSettingsStore.getState()

                        if (autoSave) {
                            try {
                                const binaryString = atob(result.imageData)
                                const bytes = new Uint8Array(binaryString.length)
                                for (let j = 0; j < binaryString.length; j++) {
                                    bytes[j] = binaryString.charCodeAt(j)
                                }

                                let typePrefix = ''
                                if (mask) typePrefix = 'INPAINT_'
                                else if (sourceImage) typePrefix = 'I2I_'

                                const fileName = `NAIS_${typePrefix}${Date.now()}_${Math.floor(Math.random() * 10000)}.png`
                                const outputDir = savePath || 'NAIS_Output'

                                let fullPath: string

                                if (useAbsolutePath) {
                                    if (!(await exists(outputDir))) {
                                        await mkdir(outputDir, { recursive: true })
                                    }
                                    fullPath = await join(outputDir, fileName)
                                    await writeFile(fullPath, bytes)
                                } else {
                                    if (!(await exists(outputDir, { baseDir: BaseDirectory.Picture }))) {
                                        await mkdir(outputDir, { baseDir: BaseDirectory.Picture })
                                    }
                                    await writeFile(`${outputDir}/${fileName}`, bytes, { baseDir: BaseDirectory.Picture })
                                    const picPath = await pictureDir()
                                    fullPath = await join(picPath, outputDir, fileName)
                                }

                                window.dispatchEvent(new CustomEvent('newImageGenerated', {
                                    detail: { path: fullPath, data: imageUrl }
                                }))
                            } catch (e) {
                                console.warn('Tauri FS save failed:', e)
                                // Skip the browser download fallback in parallel mode — multiple
                                // simultaneous link.click() calls would clobber each other.
                                if (numWorkers === 1) {
                                    const link = document.createElement('a')
                                    link.href = imageUrl
                                    link.download = `NAIS_${Date.now()}.png`
                                    document.body.appendChild(link)
                                    link.click()
                                    document.body.removeChild(link)
                                }
                            }
                        } else {
                            const memoryPath = `memory://NAIS_${Date.now()}_${Math.floor(Math.random() * 10000)}.png`
                            window.dispatchEvent(new CustomEvent('newImageGenerated', {
                                detail: { path: memoryPath, data: imageUrl }
                            }))
                        }

                        set(state => ({
                            history: [historyItem, ...state.history].slice(0, 20)
                        }))

                        // Refresh Anlas for the slot that just paid
                        useAuthStore.getState().refreshAnlas(slot)

                        // Roll a fresh seed for the next call (single global seed UI element)
                        if (!get().seedLocked) {
                            set({ seed: Math.floor(Math.random() * 4294967295) })
                        }

                        return true
                    }

                    const workerLoop = async (token: string, slot: 1 | 2): Promise<void> => {
                        while (true) {
                            if (get().isCancelled) return

                            // User toggled this slot off mid-batch — exit cleanly. The other
                            // worker (if any) keeps consuming `nextSlot` until done.
                            if (!useAuthStore.getState().isSlotActive(slot)) {
                                console.log(`[Main Worker slot ${slot}] paused by user`)
                                return
                            }

                            const myBatchIdx = nextSlot++
                            if (myBatchIdx >= batchTotal) return

                            const startTime = Date.now()
                            const ok = await generateOne(token, slot)
                            if (!ok) return

                            const generationTime = Date.now() - startTime
                            set(state => ({
                                lastGenerationTime: generationTime,
                                currentBatch: Math.min(state.currentBatch + 1, batchTotal),
                            }))

                            // Inter-image jitter, but only if there's more work left for ANY worker
                            if (nextSlot < batchTotal && !get().isCancelled) {
                                const delay = 3000 + Math.floor(Math.random() * 2001)
                                await new Promise(resolve => setTimeout(resolve, delay))
                            }
                        }
                    }

                    // Spawn one worker per active slot. They share `nextSlot`, so total
                    // images generated = batchTotal regardless of how the work splits.
                    // If a slot is paused mid-batch, the still-running worker absorbs the
                    // remaining work (so 100 images stays 100 images, just slower).
                    await Promise.all(tokens.map(({ token: tok, slot }) => workerLoop(tok, slot)))

                    if (!get().isCancelled && batchCount > 1) {
                        toast({
                            title: i18n.t('toast.batchComplete.title'),
                            description: i18n.t('toast.batchComplete.desc', { count: batchCount }),
                            variant: 'success',
                        })
                    }

                } catch (error) {
                    if (get().isCancelled) {
                        return
                    }
                    console.error('Generation failed:', error)
                    toast({
                        title: i18n.t('toast.errorOccurred.title'),
                        description: i18n.t('toast.errorOccurred.desc'),
                        variant: 'destructive',
                    })
                } finally {
                    set({ isGenerating: false, generatingMode: null, currentBatch: 0, abortController: null })
                }
            },

            addToHistory: (item) => set(state => ({
                history: [item, ...state.history].slice(0, 20)
            })),

            clearHistory: () => set({ history: [] }),

            setPreviewImage: (url) => set({ previewImage: url }),
            setIsGenerating: (v) => set({ isGenerating: v, generatingMode: v ? 'main' : null }),
            setGeneratingMode: (mode) => set({ generatingMode: mode }),
            setStreamProgress: (progress) => set({ streamProgress: progress }),
        }),
        {
            name: 'nais2-generation',
            storage: createJSONStorage(() => indexedDBStorage),
            partialize: (state) => ({
                // Prompts
                basePrompt: state.basePrompt,
                additionalPrompt: state.additionalPrompt,
                detailPrompt: state.detailPrompt,
                negativePrompt: state.negativePrompt,
                // Model & Parameters
                model: state.model,
                steps: state.steps,
                cfgScale: state.cfgScale,
                cfgRescale: state.cfgRescale,
                sampler: state.sampler,
                scheduler: state.scheduler,
                smea: state.smea,
                smeaDyn: state.smeaDyn,
                variety: state.variety,
                // Seed - only save if locked
                ...(state.seedLocked ? { seed: state.seed } : {}),
                seedLocked: state.seedLocked,
                selectedResolution: state.selectedResolution,
                // Batch
                batchCount: state.batchCount,
                // Timing (for estimated time)
                lastGenerationTime: state.lastGenerationTime,
                // I2I & Inpainting state (sourceImage/mask excluded - too large for persist)
                i2iMode: state.i2iMode,
                strength: state.strength,
                noise: state.noise,
                inpaintingPrompt: state.inpaintingPrompt,
                // History - limit to 20 items, strip thumbnails to keep IndexedDB write small
                history: state.history.slice(0, 20).map(({ thumbnail, ...rest }) => rest),
            }),
            onRehydrateStorage: () => (state) => {
                // Trim history to 20 items on load to prevent OOM
                if (state && state.history && state.history.length > 20) {
                    console.log(`[GenerationStore] Trimming history from ${state.history.length} to 20 items`)
                    state.history = state.history.slice(0, 20)
                }
            },
        }
    )
)

attachStoreBackup(useGenerationStore as any, 'generation')
