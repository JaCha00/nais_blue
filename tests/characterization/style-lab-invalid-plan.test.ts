import JSZip from 'jszip'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompositionEngineIssue } from '@/domain/composition/engine'
import type { GenerationParams } from '@/services/novelai-types'
import type { StyleCombination } from '@/stores/style-lab-store'
import type {
    BuildStyleLabGenerationOptions,
    StyleLabGenerationBuildResult,
} from '@/lib/style-lab/build-style-lab-params'

const buildFacade = vi.hoisted(() => vi.fn<(
    combination: StyleCombination,
    options?: BuildStyleLabGenerationOptions,
) => Promise<StyleLabGenerationBuildResult>>())

const runtimeCapture = vi.hoisted(() => ({
    fetchBodies: [] as Array<Record<string, unknown>>,
    events: [] as Array<{ type: string; detail: Record<string, unknown> }>,
    queueTransitions: [] as Array<{ running: boolean; total?: number; done?: number }>,
    releasedImages: 0,
    refreshedAnlas: 0,
    toasts: [] as unknown[],
    zipBytes: new Uint8Array(),
}))

vi.mock('@/lib/style-lab/build-style-lab-params', async importOriginal => {
    const actual = await importOriginal<typeof import('@/lib/style-lab/build-style-lab-params')>()
    return {
        ...actual,
        buildStyleLabGenerationParams: buildFacade,
    }
})

vi.mock('@/lib/indexed-db', () => ({
    indexedDBStorage: {
        getItem: async () => null,
        setItem: async () => undefined,
        removeItem: async () => undefined,
    },
}))

vi.mock('@/components/ui/use-toast', () => ({
    toast: (value: unknown) => {
        runtimeCapture.toasts.push(value)
    },
}))

vi.mock('@/i18n', () => ({
    default: {
        t: (key: string, fallback?: string) => fallback ?? key,
    },
}))

vi.mock('@/lib/image-utils', () => ({
    createThumbnail: async () => 'data:image/jpeg;base64,VEhVTUI=',
    saveReferenceImage: async () => 'synthetic-reference.bin',
    loadReferenceImage: async () => null,
    deleteReferenceImage: async () => undefined,
    saveEncodedVibe: async () => 'synthetic-vibe.bin',
    loadEncodedVibe: async () => null,
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { Picture: 1, AppData: 2 },
    exists: async () => false,
    mkdir: async () => undefined,
    rename: async () => undefined,
    writeFile: async () => undefined,
}))

vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: async () => 'C:/Synthetic/AppData',
    pictureDir: async () => 'C:/Synthetic/Pictures',
    join: async (...parts: string[]) => parts.join('/').replace(/\/+/g, '/'),
}))

vi.mock('@tauri-apps/api/core', () => ({
    invoke: async () => ({ success: false }),
    isTauri: () => false,
}))

vi.mock('@/services/asset-profile-file', () => ({
    ASSET_PROFILE_FILE_PATH: 'synthetic/asset-profile.json',
    loadAssetProfileFile: async () => {
        throw new Error('not used by invalid-plan characterization')
    },
    saveAssetProfileFile: async () => {
        throw new Error('not used by invalid-plan characterization')
    },
    watchAssetProfileFile: () => () => undefined,
}))

const FIXED_TIME = Date.parse('2026-07-12T00:00:00.000Z')
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+4xVnAAAAAElFTkSuQmCC'

interface RuntimeModules {
    useAuthStore: typeof import('@/stores/auth-store').useAuthStore
    useCharacterStore: typeof import('@/stores/character-store').useCharacterStore
    useGenerationStore: typeof import('@/stores/generation-store').useGenerationStore
    useSettingsStore: typeof import('@/stores/settings-store').useSettingsStore
    useStyleLabStore: typeof import('@/stores/style-lab-store').useStyleLabStore
    generateStyleLabPreviews: typeof import('@/services/style-lab-generation').generateStyleLabPreviews
}

let runtime: RuntimeModules

function combination(id: string, artist: string): StyleCombination {
    return {
        id,
        tags: [{ tag: artist, kind: 'artist', weight: 1, artist }],
        elo: 1200,
        wins: 0,
        losses: 0,
        battles: 0,
        favorite: false,
        locked: false,
        note: '',
        generation: 0,
        createdAt: FIXED_TIME,
        updatedAt: FIXED_TIME,
    }
}

function validGenerationParams(): GenerationParams {
    return {
        prompt: 'valid artist portrait',
        negative_prompt: '',
        model: 'nai-diffusion-4-5-full',
        width: 832,
        height: 1216,
        steps: 28,
        cfg_scale: 6,
        cfg_rescale: 0,
        sampler: 'k_euler',
        scheduler: 'native',
        smea: false,
        smea_dyn: false,
        variety: false,
        seed: 424242,
        imageFormat: 'png',
        qualityToggle: false,
        ucPreset: 0,
        promptParts: {
            base: 'valid artist portrait',
            additional: '',
            detail: '',
            negative: '',
            inpainting: '',
            workflow: '',
        },
        compositionMode: 'v2',
    }
}

function invalidRecipeIssue(): CompositionEngineIssue {
    return {
        code: 'E_RECIPE_MISSING',
        severity: 'error',
        messageKey: 'composition.issue.recipeMissing',
        sourceRef: { kind: 'request', requestId: 'style-lab:invalid' },
        entityRef: { kind: 'profile', id: 'main:profile' },
        fieldPath: ['recipeId'],
        repairHintKey: 'composition.repair.selectRecipe',
        actionId: 'select-recipe',
        blocking: true,
    }
}

function installBrowserBoundary(): void {
    vi.stubGlobal('window', {
        fetch: async (_input: string | URL | Request, init?: RequestInit) => {
            runtimeCapture.fetchBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
            return new Response(runtimeCapture.zipBytes, { status: 200 })
        },
        dispatchEvent: (event: { type: string; detail?: Record<string, unknown> }) => {
            runtimeCapture.events.push({ type: event.type, detail: event.detail ?? {} })
            return true
        },
        setTimeout,
        clearTimeout,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
    })
    vi.stubGlobal('CustomEvent', class<T> {
        type: string
        detail: T

        constructor(type: string, init: { detail: T }) {
            this.type = type
            this.detail = init.detail
        }
    })
}

beforeAll(async () => {
    installBrowserBoundary()
    const zip = new JSZip()
    zip.file('image.png', Uint8Array.from(atob(TINY_PNG_BASE64), character => character.charCodeAt(0)))
    runtimeCapture.zipBytes = await zip.generateAsync({ type: 'uint8array' })

    const [authStore, characterStore, generationStore, settingsStore, styleStore, styleGeneration] = await Promise.all([
        import('@/stores/auth-store'),
        import('@/stores/character-store'),
        import('@/stores/generation-store'),
        import('@/stores/settings-store'),
        import('@/stores/style-lab-store'),
        import('@/services/style-lab-generation'),
    ])
    runtime = {
        useAuthStore: authStore.useAuthStore,
        useCharacterStore: characterStore.useCharacterStore,
        useGenerationStore: generationStore.useGenerationStore,
        useSettingsStore: settingsStore.useSettingsStore,
        useStyleLabStore: styleStore.useStyleLabStore,
        generateStyleLabPreviews: styleGeneration.generateStyleLabPreviews,
    }
})

beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_TIME)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    runtimeCapture.fetchBodies.length = 0
    runtimeCapture.events.length = 0
    runtimeCapture.queueTransitions.length = 0
    runtimeCapture.releasedImages = 0
    runtimeCapture.refreshedAnlas = 0
    runtimeCapture.toasts.length = 0

    runtime.useAuthStore.setState({
        token: 'synthetic-style-token',
        isVerified: true,
        slot1Enabled: true,
        refreshAnlas: async () => {
            runtimeCapture.refreshedAnlas += 1
        },
    })
    runtime.useSettingsStore.setState({
        autoSave: false,
        useStreaming: false,
        imageFormat: 'png',
        styleLabSavePath: 'nais-style',
        useAbsoluteStyleLabPath: false,
    })
    runtime.useGenerationStore.setState({
        model: 'nai-diffusion-4-5-full',
        generatingMode: null,
        isGenerating: false,
        isCancelled: false,
        styleLabCompositionMode: 'v2',
        history: [],
    })
    runtime.useCharacterStore.setState({
        characterImages: [],
        vibeImages: [],
        _imagesLoaded: true,
        releaseImageData: () => {
            runtimeCapture.releasedImages += 1
        },
    })

    const styleActions = runtime.useStyleLabStore.getState()
    const setPreviewQueueState = styleActions.setPreviewQueueState
    runtime.useStyleLabStore.setState({
        combinations: [
            combination('invalid-combination', 'Broken Artist'),
            combination('valid-combination', 'Valid Artist'),
        ],
        settings: {
            ...styleActions.settings,
            previewDelayMs: 0,
        },
        activeBattlePair: null,
        isPreviewQueueRunning: false,
        previewQueueTotal: 0,
        previewQueueDone: 0,
        setPreviewQueueState: (running, total, done) => {
            runtimeCapture.queueTransitions.push({ running, total, done })
            setPreviewQueueState(running, total, done)
        },
    })

    const error = invalidRecipeIssue()
    buildFacade.mockImplementation(async combo => combo.id === 'invalid-combination'
        ? {
            success: false,
            mode: 'v2',
            warnings: [],
            errors: [error],
            plan: null,
            sourceRevision: 17,
            combinationProvenance: null,
            sequenceCommitProposal: null,
        }
        : {
            success: true,
            mode: 'v2',
            warnings: [],
            errors: [],
            params: validGenerationParams(),
            prompt: 'valid artist portrait',
            seed: 424242,
            plan: null,
            sourceRevision: 17,
            combinationProvenance: null,
            sequenceCommitProposal: null,
        })
})

describe('Style Lab invalid plan isolation', () => {
    it('reports one invalid preview without transport and continues the queue with the valid preview', async () => {
        await runtime.generateStyleLabPreviews(['invalid-combination', 'valid-combination'])

        expect(buildFacade).toHaveBeenCalledTimes(2)
        expect(buildFacade.mock.calls.map(([combo]) => combo.id)).toEqual([
            'invalid-combination',
            'valid-combination',
        ])
        expect(runtimeCapture.fetchBodies).toHaveLength(1)
        expect(runtimeCapture.fetchBodies[0]).toMatchObject({
            input: expect.stringContaining('valid artist portrait'),
        })

        const styleState = runtime.useStyleLabStore.getState()
        const invalid = styleState.combinations.find(combo => combo.id === 'invalid-combination')
        const valid = styleState.combinations.find(combo => combo.id === 'valid-combination')
        expect(invalid).toMatchObject({
            isPreviewing: false,
            previewProgress: 0,
        })
        expect(invalid?.previewError).toContain('[E_RECIPE_MISSING] @ recipeId')
        expect(invalid?.previewPath).toBeUndefined()
        expect(valid).toMatchObject({
            isPreviewing: false,
            previewProgress: 0,
            previewSeed: 424242,
            previewPrompt: 'valid artist portrait',
        })
        expect(valid?.previewError).toBeUndefined()
        expect(valid?.previewPath).toMatch(/^memory:\/\/NAIS_STYLELAB_/)

        expect(runtimeCapture.events).toHaveLength(1)
        expect(runtimeCapture.refreshedAnlas).toBe(1)
        expect(runtimeCapture.toasts).toHaveLength(1)
        expect(runtimeCapture.queueTransitions).toEqual([
            { running: true, total: 2, done: 0 },
            { running: true, total: 2, done: 1 },
            { running: true, total: 2, done: 2 },
            { running: false, total: 0, done: 0 },
        ])
        expect(styleState).toMatchObject({
            isPreviewQueueRunning: false,
            previewQueueTotal: 0,
            previewQueueDone: 0,
        })
        expect(runtime.useGenerationStore.getState()).toMatchObject({
            isGenerating: false,
            generatingMode: null,
            abortController: null,
            streamProgress: 0,
        })
        expect(runtimeCapture.releasedImages).toBe(1)
    })
})
