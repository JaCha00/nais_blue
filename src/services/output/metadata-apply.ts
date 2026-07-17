import { sha256Utf8 } from '@/domain/composition/canonical-serialize'
import type { NAIMetadata } from '@/lib/metadata-parser'
import type { Nais2ParamsV2 } from '@/lib/nais2-png-meta'
import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import { useCharacterStore } from '@/stores/character-store'
import { useGenerationStore } from '@/stores/generation-store'
import { usePresetStore } from '@/stores/preset-store'

export interface MetadataApplyOptions {
    targetPresetId: string
    prompts: boolean
    parameters: boolean
    resolution: boolean
    seed: boolean
    characterPrompts: boolean
    vibeTransfer: boolean
}

interface GenerationPatch {
    basePrompt?: string
    additionalPrompt?: string
    detailPrompt?: string
    inpaintingPrompt?: string
    negativePrompt?: string
    model?: string
    steps?: number
    cfgScale?: number
    cfgRescale?: number
    sampler?: string
    scheduler?: string
    smea?: boolean
    smeaDyn?: boolean
    variety?: boolean
    qualityToggle?: boolean
    ucPreset?: number
    width?: number
    height?: number
    seed?: number
}

export interface MetadataCharacterChange {
    stableId: string
    prompt: string
    negative: string
    enabled: boolean
    positions: Array<{ x: number, y: number }>
}

export interface MetadataVibeChange {
    encoded: string
    informationExtracted: number
    strength: number
}

export interface MetadataRepositoryChangeSet {
    sourceVersion: 'v2' | 'legacy'
    targetPresetId: string
    generation: GenerationPatch
    characters: MetadataCharacterChange[]
    vibes: MetadataVibeChange[]
}

export interface MetadataApplyDiffEntry {
    repository: 'generation' | 'character-prompts' | 'vibe-transfer' | 'preset'
    path: string
    before: unknown
    after: unknown
}

export interface MetadataApplyValidationIssue {
    code: string
    message: string
    path?: string
}

export interface MetadataApplyPreview {
    sourceVersion: 'v2' | 'legacy'
    changeSet: MetadataRepositoryChangeSet
    diff: MetadataApplyDiffEntry[]
    validation: {
        valid: boolean
        errors: MetadataApplyValidationIssue[]
        warnings: MetadataApplyValidationIssue[]
    }
}

export interface MetadataApplyCurrentState {
    activePresetId: string
    targetPresetExists: boolean
    generation: Required<GenerationPatch>
    characterIds: string[]
    vibeCount: number
}

function generationSnapshotForPreset(targetPresetId: string): Required<GenerationPatch> {
    const generation = useGenerationStore.getState()
    const presetState = usePresetStore.getState()
    const preset = presetState.presets.find(candidate => candidate.id === targetPresetId)
    const source = presetState.activePresetId === targetPresetId || !preset ? generation : preset
    return {
        basePrompt: source.basePrompt,
        additionalPrompt: source.additionalPrompt,
        detailPrompt: source.detailPrompt,
        inpaintingPrompt: generation.inpaintingPrompt,
        negativePrompt: source.negativePrompt,
        model: source.model,
        steps: source.steps,
        cfgScale: source.cfgScale,
        cfgRescale: source.cfgRescale,
        sampler: source.sampler,
        scheduler: source.scheduler,
        smea: source.smea,
        smeaDyn: source.smeaDyn,
        variety: source.variety ?? false,
        qualityToggle: source.qualityToggle ?? true,
        ucPreset: source.ucPreset ?? 0,
        width: source.selectedResolution.width,
        height: source.selectedResolution.height,
        seed: generation.seed,
    }
}

export function captureMetadataApplyCurrentState(targetPresetId: string): MetadataApplyCurrentState {
    const presetState = usePresetStore.getState()
    return {
        activePresetId: presetState.activePresetId,
        targetPresetExists: presetState.presets.some(preset => preset.id === targetPresetId),
        generation: generationSnapshotForPreset(targetPresetId),
        characterIds: useCharacterPromptStore.getState().characters.map(character => character.id),
        vibeCount: useCharacterStore.getState().vibeImages.length,
    }
}

function promptPatch(metadata: NAIMetadata): GenerationPatch {
    if (metadata.promptParts) {
        return {
            basePrompt: metadata.promptParts.base,
            additionalPrompt: metadata.promptParts.additional,
            detailPrompt: metadata.promptParts.detail,
            ...(metadata.promptParts.inpainting === undefined
                ? {}
                : { inpaintingPrompt: metadata.promptParts.inpainting }),
            ...(metadata.promptParts.negative === undefined
                ? {}
                : { negativePrompt: metadata.promptParts.negative }),
        }
    }
    return {
        ...(metadata.prompt === undefined ? {} : { basePrompt: metadata.prompt }),
        ...(metadata.v4_negative_prompt?.caption?.base_caption !== undefined
            ? { negativePrompt: metadata.v4_negative_prompt.caption.base_caption }
            : metadata.negativePrompt === undefined
                ? {}
                : { negativePrompt: metadata.negativePrompt }),
    }
}

function legacyCharacters(metadata: NAIMetadata): MetadataCharacterChange[] {
    const positive = metadata.v4_prompt?.caption?.char_captions ?? []
    const negative = metadata.v4_negative_prompt?.caption?.char_captions ?? []
    return positive.map((character, index) => {
        const stableId = `legacy-import:${sha256Utf8(JSON.stringify({ index, character }))}`
        return {
            stableId,
            prompt: character.char_caption,
            negative: negative[index]?.char_caption ?? '',
            enabled: true,
            positions: character.centers.map(center => ({ ...center })),
        }
    })
}

function legacyVibes(metadata: NAIMetadata): MetadataVibeChange[] {
    const infos = metadata.vibeTransferInfo ?? []
    return (metadata.encodedVibes ?? []).map((encoded, index) => ({
        encoded,
        informationExtracted: infos[index]?.informationExtracted ?? 1,
        strength: infos[index]?.strength ?? 0.6,
    }))
}

function normalizeLegacyModel(model: string | undefined): string | undefined {
    if (model === undefined) return undefined
    const normalized = model.toLowerCase()
    if (normalized.startsWith('nai-diffusion-')) return model
    if (normalized.includes('4.5') || normalized.includes('4-5')) {
        return normalized.includes('curated') ? 'nai-diffusion-4-5-curated' : 'nai-diffusion-4-5-full'
    }
    if (normalized.includes('v4') || /\b4\b/.test(normalized)) {
        return normalized.includes('curated') ? 'nai-diffusion-4-curated-preview' : 'nai-diffusion-4-full'
    }
    if (normalized.includes('furry')) return 'nai-diffusion-furry-3'
    if (normalized.includes('v3') || /\b3\b/.test(normalized)) return 'nai-diffusion-3'
    return undefined
}

/** Explicit compatibility boundary for NAI/legacy NAIS blue v1/A1111 metadata. */
export function importLegacyMetadataCompatibility(
    metadata: NAIMetadata,
    options: MetadataApplyOptions,
): MetadataRepositoryChangeSet {
    const generation: GenerationPatch = {}
    if (options.prompts) Object.assign(generation, promptPatch(metadata))
    if (options.parameters) {
        const normalizedModel = normalizeLegacyModel(metadata.model)
        Object.assign(generation, {
            ...(normalizedModel === undefined ? {} : { model: normalizedModel }),
            ...(metadata.steps === undefined ? {} : { steps: metadata.steps }),
            ...(metadata.cfgScale === undefined ? {} : { cfgScale: metadata.cfgScale }),
            ...(metadata.cfgRescale === undefined ? {} : { cfgRescale: metadata.cfgRescale }),
            ...(metadata.sampler === undefined ? {} : { sampler: metadata.sampler }),
            ...(metadata.scheduler === undefined ? {} : { scheduler: metadata.scheduler }),
            ...(metadata.smea === undefined ? {} : { smea: metadata.smea }),
            ...(metadata.smeaDyn === undefined ? {} : { smeaDyn: metadata.smeaDyn }),
            ...(metadata.variety === undefined ? {} : { variety: metadata.variety }),
            ...(metadata.qualityToggle === undefined ? {} : { qualityToggle: metadata.qualityToggle }),
            ...(metadata.ucPreset === undefined ? {} : { ucPreset: metadata.ucPreset }),
        })
    }
    if (options.resolution && metadata.width !== undefined && metadata.height !== undefined) {
        generation.width = metadata.width
        generation.height = metadata.height
    }
    if (options.seed && metadata.seed !== undefined) generation.seed = metadata.seed

    return {
        sourceVersion: 'legacy',
        targetPresetId: options.targetPresetId,
        generation,
        characters: options.characterPrompts ? legacyCharacters(metadata) : [],
        vibes: options.vibeTransfer ? legacyVibes(metadata) : [],
    }
}

function importV2Metadata(
    metadata: NAIMetadata,
    nais2: Nais2ParamsV2,
    options: MetadataApplyOptions,
): MetadataRepositoryChangeSet {
    const generation: GenerationPatch = {}
    if (options.prompts) Object.assign(generation, promptPatch(metadata))
    if (options.parameters) {
        const resolved = nais2.resolvedParams
        Object.assign(generation, {
            model: resolved.model,
            steps: resolved.steps,
            cfgScale: resolved.cfgScale,
            cfgRescale: resolved.cfgRescale,
            sampler: resolved.sampler,
            scheduler: resolved.scheduler,
            smea: resolved.smea,
            smeaDyn: resolved.smeaDyn,
            variety: resolved.variety,
            ...(resolved.qualityToggle === undefined ? {} : { qualityToggle: resolved.qualityToggle }),
            ...(resolved.ucPreset === undefined ? {} : { ucPreset: resolved.ucPreset }),
        })
    }
    if (options.resolution) {
        generation.width = nais2.resolvedParams.width
        generation.height = nais2.resolvedParams.height
    }
    if (options.seed) generation.seed = nais2.resolvedParams.seed

    return {
        sourceVersion: 'v2',
        targetPresetId: options.targetPresetId,
        generation,
        characters: options.characterPrompts
            ? nais2.characters.map(character => ({
                stableId: character.stableId,
                prompt: character.prompt,
                negative: character.negative,
                enabled: character.enabled,
                positions: character.positions.map(position => ({ ...position })),
            }))
            : [],
        // v2 intentionally contains no encoded reference bytes.
        vibes: [],
    }
}

function validateChangeSet(
    changeSet: MetadataRepositoryChangeSet,
    current: MetadataApplyCurrentState,
): MetadataApplyPreview['validation'] {
    const errors: MetadataApplyValidationIssue[] = []
    const warnings: MetadataApplyValidationIssue[] = []
    const patch = changeSet.generation
    if (!current.targetPresetExists) {
        errors.push({ code: 'target-preset-missing', message: 'The selected target preset no longer exists.' })
    }
    if (patch.steps !== undefined && (!Number.isInteger(patch.steps) || patch.steps < 1 || patch.steps > 100)) {
        errors.push({ code: 'steps-out-of-range', message: 'Steps must be an integer between 1 and 100.', path: 'generation.steps' })
    }
    for (const dimension of ['width', 'height'] as const) {
        const value = patch[dimension]
        if (value !== undefined && (!Number.isInteger(value) || value < 64 || value > 8192)) {
            errors.push({ code: 'resolution-out-of-range', message: `${dimension} must be between 64 and 8192.`, path: `generation.${dimension}` })
        }
    }
    if (patch.seed !== undefined && (!Number.isInteger(patch.seed) || patch.seed < 0 || patch.seed > 4_294_967_295)) {
        errors.push({ code: 'seed-out-of-range', message: 'Seed must be a uint32 value.', path: 'generation.seed' })
    }
    const stableIds = new Set<string>()
    for (const character of changeSet.characters) {
        if (!character.stableId.trim() || stableIds.has(character.stableId)) {
            errors.push({ code: 'character-id-invalid', message: 'Character stable IDs must be non-empty and unique.', path: 'characters' })
        }
        stableIds.add(character.stableId)
        for (const position of character.positions) {
            if (!Number.isFinite(position.x) || !Number.isFinite(position.y)
                || position.x < 0 || position.x > 1 || position.y < 0 || position.y > 1) {
                errors.push({ code: 'character-position-invalid', message: 'Character positions must be within 0..1.', path: `characters.${character.stableId}.positions` })
            }
        }
        const importedIds = character.positions.map((_, index) => `metadata:${character.stableId}:${index}`)
        if (importedIds.some(id => current.characterIds.includes(id))) {
            errors.push({ code: 'character-id-conflict', message: `Character ${character.stableId} was already imported.`, path: 'characters' })
        }
    }
    if (changeSet.sourceVersion === 'legacy') {
        warnings.push({ code: 'legacy-compatibility-import', message: 'Legacy metadata will be applied through the compatibility importer.' })
    }
    if (Object.keys(patch).length === 0 && changeSet.characters.length === 0 && changeSet.vibes.length === 0) {
        errors.push({ code: 'empty-change-set', message: 'No metadata fields are selected for apply.' })
    }
    return { valid: errors.length === 0, errors, warnings }
}

function buildDiff(
    changeSet: MetadataRepositoryChangeSet,
    current: MetadataApplyCurrentState,
): MetadataApplyDiffEntry[] {
    const diff: MetadataApplyDiffEntry[] = []
    if (current.activePresetId !== changeSet.targetPresetId) {
        diff.push({
            repository: 'preset',
            path: 'activePresetId',
            before: current.activePresetId,
            after: changeSet.targetPresetId,
        })
    }
    for (const [path, after] of Object.entries(changeSet.generation)) {
        const before = current.generation[path as keyof GenerationPatch]
        if (!Object.is(before, after)) diff.push({ repository: 'generation', path, before, after })
    }
    for (const character of changeSet.characters) {
        diff.push({
            repository: 'character-prompts',
            path: `characters.${character.stableId}`,
            before: null,
            after: character,
        })
    }
    if (changeSet.vibes.length > 0) {
        diff.push({
            repository: 'vibe-transfer',
            path: 'vibeImages.length',
            before: current.vibeCount,
            after: current.vibeCount + changeSet.vibes.length,
        })
    }
    return diff
}

export function createMetadataApplyPreview(
    metadata: NAIMetadata,
    options: MetadataApplyOptions,
    current: MetadataApplyCurrentState = captureMetadataApplyCurrentState(options.targetPresetId),
): MetadataApplyPreview {
    const embeddedMetadata = metadata.naisBlue ?? metadata.nais2
    const changeSet = embeddedMetadata?.version === 2
        ? importV2Metadata(metadata, embeddedMetadata, options)
        : importLegacyMetadataCompatibility(metadata, options)
    return {
        sourceVersion: changeSet.sourceVersion,
        changeSet,
        diff: buildDiff(changeSet, current),
        validation: validateChangeSet(changeSet, current),
    }
}

function applyGenerationPatch(patch: GenerationPatch): void {
    const generation = useGenerationStore.getState()
    if (patch.basePrompt !== undefined) generation.setBasePrompt(patch.basePrompt)
    if (patch.additionalPrompt !== undefined) generation.setAdditionalPrompt(patch.additionalPrompt)
    if (patch.detailPrompt !== undefined) generation.setDetailPrompt(patch.detailPrompt)
    if (patch.inpaintingPrompt !== undefined) generation.setInpaintingPrompt(patch.inpaintingPrompt)
    if (patch.negativePrompt !== undefined) generation.setNegativePrompt(patch.negativePrompt)
    if (patch.model !== undefined) generation.setModel(patch.model)
    if (patch.steps !== undefined) generation.setSteps(patch.steps)
    if (patch.cfgScale !== undefined) generation.setCfgScale(patch.cfgScale)
    if (patch.cfgRescale !== undefined) generation.setCfgRescale(patch.cfgRescale)
    if (patch.sampler !== undefined) generation.setSampler(patch.sampler)
    if (patch.scheduler !== undefined) generation.setScheduler(patch.scheduler)
    if (patch.smea !== undefined) generation.setSmea(patch.smea)
    if (patch.smeaDyn !== undefined) generation.setSmeaDyn(patch.smeaDyn)
    if (patch.variety !== undefined) generation.setVariety(patch.variety)
    if (patch.qualityToggle !== undefined) generation.setQualityToggle(patch.qualityToggle)
    if (patch.ucPreset !== undefined) generation.setUcPreset(patch.ucPreset)
    if (patch.width !== undefined && patch.height !== undefined) {
        generation.setSelectedResolution({
            label: `${patch.width}x${patch.height}`,
            width: patch.width,
            height: patch.height,
        })
    }
    if (patch.seed !== undefined) {
        generation.setSeed(patch.seed)
        generation.setSeedLocked(true)
    }
}

function applyCharacters(characters: MetadataCharacterChange[]): void {
    const store = useCharacterPromptStore.getState()
    for (const character of characters) {
        const presetId = `metadata-preset:${character.stableId}`
        store.addPreset({
            id: presetId,
            name: `Imported ${character.stableId}`,
            prompt: character.prompt,
            negative: character.negative,
        })
        character.positions.forEach((position, index) => {
            store.addCharacter({
                id: `metadata:${character.stableId}:${index}`,
                presetId,
                prompt: character.prompt,
                negative: character.negative,
                position,
                enabled: character.enabled,
            })
        })
    }
}

export async function applyMetadataPreview(preview: MetadataApplyPreview): Promise<void> {
    if (!preview.validation.valid) {
        throw new Error(preview.validation.errors.map(issue => issue.message).join(' '))
    }
    const preset = usePresetStore.getState()
    if (preset.activePresetId !== preview.changeSet.targetPresetId) {
        preset.loadPreset(preview.changeSet.targetPresetId)
    }
    applyGenerationPatch(preview.changeSet.generation)
    applyCharacters(preview.changeSet.characters)
    for (const vibe of preview.changeSet.vibes) {
        await useCharacterStore.getState().addVibeImage(
            '',
            vibe.encoded,
            vibe.informationExtracted,
            vibe.strength,
        )
    }
    usePresetStore.getState().syncFromGenerationStore()
}
