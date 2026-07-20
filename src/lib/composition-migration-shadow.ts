import { hashCanonicalValue } from '@/domain/composition/canonical-serialize'
import { CompositionEngine } from '@/domain/composition/engine'
import { createFragmentLookup, resolveFragments } from '@/domain/composition/fragment-resolver'
import type { CharacterPosition, ResolvedGenerationParams } from '@/domain/composition/types'
import {
    buildMainResolveRequest,
    resolveMainComposition,
    type BuildMainCompositionInput,
    type MainCharacterPromptSnapshot,
    type MainCompositionSnapshot,
} from '@/lib/composition/main-adapter'
import type {
    CompositionMigrationShadowInput,
    MigrationShadowResolveComparison,
} from '@/lib/composition-migration-runtime'
import { createDefaultAssetProfile, type AssetProfile } from '@/types/asset-profile'
import { normalizeAssetProfile } from '@/services/asset-profile-file'
import type { CharacterGroup, CharacterPreset } from '@/stores/character-prompt-store'
import { resolveAssetModulePlan, type AssetModulePlan } from '@/lib/asset-modules/resolver'

const SHADOW_SEED = 1_903_117

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseJsonOrRaw(value: string | undefined): unknown {
    if (value === undefined) return undefined
    try {
        return JSON.parse(value) as unknown
    } catch {
        return value
    }
}

function unwrap(value: unknown): Record<string, unknown> {
    if (!isRecord(value)) return {}
    return isRecord(value.state) ? value.state : value
}

function storeState(input: CompositionMigrationShadowInput, key: string): Record<string, unknown> {
    return unwrap(parseJsonOrRaw(input.source.serializedStores[key]))
}

function stringValue(value: unknown, fallback: string): string {
    return typeof value === 'string' ? value : fallback
}

function numberValue(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function booleanValue(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback
}

function profileFromSource(input: CompositionMigrationShadowInput): AssetProfile {
    const stored = storeState(input, 'nais2-asset-modules')
    const rawSource = input.source.assetProfileJson ?? stored.profile
    const source = typeof rawSource === 'string' ? parseJsonOrRaw(rawSource) : rawSource
    if (source === undefined) return createDefaultAssetProfile(input.document.updatedAt)
    try {
        return normalizeAssetProfile(source)
    } catch {
        return createDefaultAssetProfile(input.document.updatedAt)
    }
}

function characterSnapshots(value: unknown): MainCharacterPromptSnapshot[] {
    if (!Array.isArray(value)) return []
    return value.filter(isRecord).map((character, index) => {
        const rawPosition = isRecord(character.position) ? character.position : {}
        const position = rawPosition.mode === 'ai-choice'
            ? { mode: 'ai-choice' as const }
            : rawPosition.mode === 'manual'
                ? {
                    mode: 'manual' as const,
                    x: numberValue(rawPosition.x, 0.5),
                    y: numberValue(rawPosition.y, 0.5),
                }
                : {
                    x: numberValue(rawPosition.x, 0.5),
                    y: numberValue(rawPosition.y, 0.5),
                }
        return {
            id: stringValue(character.id, `migration-shadow:character:${index}`),
            ...(typeof character.name === 'string' ? { name: character.name } : {}),
            prompt: stringValue(character.prompt, ''),
            negative: stringValue(character.negative, ''),
            enabled: booleanValue(character.enabled, true),
            position,
            ...(typeof character.presetId === 'string' ? { presetId: character.presetId } : {}),
            ...(typeof character.groupId === 'string' ? { groupId: character.groupId } : {}),
        }
    })
}

function characterPresetSnapshots(value: unknown): CharacterPreset[] {
    if (!Array.isArray(value)) return []
    return value.filter(isRecord).map((preset, index) => ({
        id: stringValue(preset.id, `migration-shadow:preset:${index}`),
        name: stringValue(preset.name, ''),
        prompt: stringValue(preset.prompt, ''),
        negative: stringValue(preset.negative, ''),
        ...(typeof preset.groupId === 'string' ? { groupId: preset.groupId } : {}),
    }))
}

function characterGroupSnapshots(value: unknown): CharacterGroup[] {
    if (!Array.isArray(value)) return []
    return value.filter(isRecord).map((group, index) => ({
        id: stringValue(group.id, `migration-shadow:group:${index}`),
        name: stringValue(group.name, ''),
        collapsed: booleanValue(group.collapsed, false),
        colorIndex: numberValue(group.colorIndex, 0),
    }))
}

function paramsFromState(state: Record<string, unknown>): ResolvedGenerationParams {
    const resolution = isRecord(state.selectedResolution) ? state.selectedResolution : {}
    return {
        model: stringValue(state.model, 'nai-diffusion-4-5-full'),
        width: numberValue(resolution.width, 832),
        height: numberValue(resolution.height, 1216),
        steps: numberValue(state.steps, 28),
        cfgScale: numberValue(state.cfgScale, 5),
        cfgRescale: numberValue(state.cfgRescale, 0),
        sampler: stringValue(state.sampler, 'k_euler_ancestral'),
        scheduler: stringValue(state.scheduler, 'karras'),
        smea: booleanValue(state.smea, true),
        smeaDyn: booleanValue(state.smeaDyn, true),
        variety: booleanValue(state.variety, false),
        seed: SHADOW_SEED,
        qualityToggle: booleanValue(state.qualityToggle, true),
        ucPreset: numberValue(state.ucPreset, 0),
        sourceMode: 'text-to-image',
        strength: numberValue(state.strength, 0.7),
        noise: numberValue(state.noise, 0),
        characterPositionEnabled: false,
    }
}

function snapshotFromSource(input: CompositionMigrationShadowInput): MainCompositionSnapshot {
    const generation = storeState(input, 'nais2-generation')
    const character = storeState(input, 'nais2-character-prompts')
    const preset = storeState(input, 'nais2-presets')
    const settings = storeState(input, 'nais2-settings')
    const params = paramsFromState(generation)
    const characters = characterSnapshots(character.characters)
    const positionEnabled = booleanValue(character.positionEnabled, false)
    params.characterPositionEnabled = positionEnabled

    return {
        profile: profileFromSource(input),
        selectedRecipeId: null,
        prompt: {
            base: stringValue(generation.basePrompt, ''),
            inpainting: stringValue(generation.inpaintingPrompt, ''),
            additional: stringValue(generation.additionalPrompt, ''),
            detail: stringValue(generation.detailPrompt, ''),
            negative: stringValue(generation.negativePrompt, ''),
        },
        characters,
        characterPresets: characterPresetSnapshots(character.presets),
        characterGroups: characterGroupSnapshots(character.groups),
        positionEnabled,
        references: [],
        paramsPresets: Array.isArray(preset.presets) ? preset.presets : [],
        activeParamsPresetId: stringValue(preset.activePresetId, 'default'),
        params,
        output: {
            autoSave: booleanValue(settings.autoSave, false),
            savePath: stringValue(settings.savePath, 'NAIS_Output'),
            useAbsolutePath: booleanValue(settings.useAbsolutePath, false),
            imageFormat: settings.imageFormat === 'webp' ? 'webp' : 'png',
            metadataMode: settings.metadataMode === 'sidecar-only'
                || settings.metadataMode === 'strip-and-sidecar'
                || settings.metadataMode === 'strip-only'
                ? settings.metadataMode
                : 'embedded',
        },
        source: {
            hasSourceImage: false,
            hasMask: false,
            width: params.width,
            height: params.height,
            strength: params.strength,
            noise: params.noise,
        },
    }
}

function normalizedPosition(position: CharacterPosition | { x: number; y: number }): CharacterPosition {
    return 'mode' in position
        ? position
        : { mode: 'manual', x: position.x, y: position.y }
}

function characterProjection(
    characters: readonly {
        readonly positive: string
        readonly negative: string
        readonly enabled: boolean
        readonly position: unknown
    }[],
    positionEnabled: boolean,
): unknown[] {
    return characters.filter(character => character.enabled).map(character => ({
        positive: character.positive,
        negative: character.negative,
        enabled: character.enabled,
        position: positionEnabled ? character.position : null,
    }))
}

function planProjection(plan: {
    positivePrompt: string
    negativePrompt: string
    characters: readonly {
        readonly positive: string
        readonly negative: string
        readonly enabled: boolean
        readonly position: unknown
    }[]
    params: Readonly<ResolvedGenerationParams>
}): unknown {
    return {
        positivePrompt: plan.positivePrompt,
        negativePrompt: plan.negativePrompt,
        characters: characterProjection(plan.characters, plan.params.characterPositionEnabled),
        params: plan.params,
    }
}

function removeFullLineComments(text: string): string {
    return text
        .split('\n')
        .filter(line => !line.trimStart().startsWith('#'))
        .join('\n')
}

function hasAssetModulePrompts(plan: AssetModulePlan | null): plan is AssetModulePlan {
    return Boolean(plan && Object.values(plan.promptGroups).some(prompt => prompt.trim().length > 0))
}

function shadowFragmentRuntime(input: CompositionMigrationShadowInput) {
    const sidecar = input.migrated.sidecars.fragments
    const entries = sidecar.meta.map(meta => ({
        id: meta.id,
        path: meta.folder ? `${meta.folder}/${meta.name}` : meta.name,
        lines: sidecar.contents[meta.id]
            ?? sidecar.contents[meta.contentKey]
            ?? input.source.wildcardContent[meta.contentKey]
            ?? [],
    }))
    const lookup = createFragmentLookup(entries)
    const sequenceSnapshot = {
        revision: sidecar.sequenceState.revision,
        counters: { ...sidecar.sequenceState.counters },
    }
    const localCounters = { ...sequenceSnapshot.counters }
    const process = async (text: string): Promise<string> => {
        const result = resolveFragments({
            text,
            seed: SHADOW_SEED,
            scope: 'migration-shadow:legacy-main',
            lookup,
            sequenceSnapshot: {
                revision: sequenceSnapshot.revision,
                counters: { ...localCounters },
            },
            mode: 'generate',
            maxRecursion: 10,
            strictness: 'compatible',
        })
        if (!result.success) {
            throw new Error(result.errors.map(issue => issue.code).join(', ') || 'fragment-resolution-failed')
        }
        for (const change of result.sequenceCommitProposal?.changes ?? []) {
            localCounters[change.fragmentId] = change.nextCounter
        }
        return result.resolvedText
    }
    return { lookup, sequenceSnapshot, process }
}

async function resolveActualLegacyProjection(
    input: CompositionMigrationShadowInput,
    snapshot: MainCompositionSnapshot,
    processFragment: (text: string) => Promise<string>,
): Promise<unknown> {
    const enabledRecipe = snapshot.profile.recipes.find(recipe => recipe.enabled)
    let modulePlan: AssetModulePlan | null = null
    if (enabledRecipe !== undefined) {
        const resolved = await resolveAssetModulePlan({
            profile: snapshot.profile,
            recipeId: enabledRecipe.id,
            seed: SHADOW_SEED,
            now: new Date(input.document.updatedAt),
            baseParams: { prompt: '', negative_prompt: '' },
            filenameContext: { seed: SHADOW_SEED },
            wildcardProcessor: processFragment,
        })
        modulePlan = resolved.recipe && resolved.modules.length > 0 ? resolved : null
    }

    const modulePromptsActive = hasAssetModulePrompts(modulePlan)
    const positivePrompt = modulePromptsActive
        ? stringValue(modulePlan!.generationParams.prompt, '')
        : await processFragment([
            removeFullLineComments(snapshot.prompt.base),
            removeFullLineComments(snapshot.prompt.inpainting),
            removeFullLineComments(snapshot.prompt.additional),
            removeFullLineComments(snapshot.prompt.detail),
        ].filter(Boolean).join(', '))
    const negativePrompt = modulePromptsActive
        ? stringValue(modulePlan!.generationParams.negative_prompt, '')
        : removeFullLineComments(snapshot.prompt.negative)

    const rawModuleCharacters = modulePlan?.generationParams.characterPrompts
    const moduleCharacters = Array.isArray(rawModuleCharacters)
        ? characterSnapshots(rawModuleCharacters)
        : null
    const selectedCharacters = modulePromptsActive && moduleCharacters !== null
        ? moduleCharacters
        : snapshot.characters.filter(character => character.enabled)
    const positionEnabled = modulePromptsActive && moduleCharacters !== null
        ? true
        : snapshot.positionEnabled
    const characters = await Promise.all(selectedCharacters.map(async character => ({
        positive: modulePromptsActive
            ? character.prompt
            : await processFragment(character.prompt),
        negative: modulePromptsActive
            ? character.negative
            : await processFragment(character.negative),
        enabled: character.enabled,
        position: positionEnabled ? normalizedPosition(character.position) : null,
    })))

    return {
        positivePrompt,
        negativePrompt,
        characters,
        params: {
            ...snapshot.params,
            seed: SHADOW_SEED,
            characterPositionEnabled: positionEnabled,
        },
    }
}

/**
 * Characterizes the retained legacy Main builder independently, then compares
 * its semantic request with the v2 adapter/document. This deliberately avoids
 * using the Composition adapter as the "legacy" oracle.
 */
export async function compareLegacyAuthorityToMigratedDocument(
    input: CompositionMigrationShadowInput,
): Promise<MigrationShadowResolveComparison> {
    const profile = input.document.profiles.find(item => (
        item.id === input.document.activeProfileId && item.enabled
    )) ?? input.document.profiles.find(item => item.enabled)
    if (profile === undefined) {
        return {
            status: 'different',
            matches: false,
            fatal: true,
            differences: ['v2:E_PROFILE_REF_MISSING'],
        }
    }

    const snapshot = snapshotFromSource(input)
    const fragment = shadowFragmentRuntime(input)
    const buildInput: BuildMainCompositionInput = {
        snapshot,
        requestId: 'migration-shadow:v2',
        now: input.document.updatedAt,
        seed: SHADOW_SEED,
        fragment: {
            lookup: fragment.lookup,
            sequenceSnapshot: fragment.sequenceSnapshot,
            mode: 'generate',
            strictness: 'compatible',
            maxRecursion: 10,
        },
    }
    let legacyProjection: unknown
    try {
        legacyProjection = await resolveActualLegacyProjection(input, snapshot, fragment.process)
    } catch (error) {
        return {
            status: 'different',
            matches: false,
            fatal: true,
            differences: [`legacy:${error instanceof Error ? error.message : String(error)}`],
        }
    }

    const built = buildMainResolveRequest(buildInput)
    const enabledLegacyRecipe = snapshot.profile.recipes.find(recipe => recipe.enabled)
    let v2Plan: Parameters<typeof planProjection>[0]
    if (enabledLegacyRecipe === undefined) {
        const direct = resolveMainComposition(buildInput)
        if (!direct.result.success) {
            return {
                status: 'different',
                matches: false,
                fatal: true,
                differences: direct.result.errors.map(issue => `v2:${issue.code}`),
            }
        }
        v2Plan = direct.result.plan
    } else {
        const migratedRecipe = input.document.recipes.find(recipe => (
            recipe.id === enabledLegacyRecipe.id
            && recipe.enabled
            && profile.recipeIds.includes(recipe.id)
        ))
        if (migratedRecipe === undefined) {
            return {
                status: 'different',
                matches: false,
                fatal: true,
                differences: [`v2:E_RECIPE_REF_MISSING:${enabledLegacyRecipe.id}`],
            }
        }
        const v2 = CompositionEngine.resolve({
            request: {
                ...built.request,
                requestId: 'migration-shadow:v2',
                document: input.document,
                profileId: profile.id,
                recipeId: migratedRecipe.id,
            },
            now: input.document.updatedAt,
            engineDefaults: built.engineDefaults,
            fragment: buildInput.fragment,
            referencePolicy: 'strict',
            dedupePolicy: 'exact-token',
            transportDerivedOverride: {
                params: {
                    width: snapshot.source.width,
                    height: snapshot.source.height,
                    sourceMode: 'text-to-image',
                    strength: snapshot.source.strength,
                    noise: snapshot.source.noise,
                },
                sourceRef: { kind: 'external', source: 'migration-shadow:transport-derived' },
            },
        })
        if (!v2.success) {
            return {
                status: 'different',
                matches: false,
                fatal: true,
                differences: v2.errors.map(issue => `v2:${issue.code}`),
            }
        }
        v2Plan = v2.plan
    }

    const legacyHash = `sha256:${hashCanonicalValue(legacyProjection)}`
    const v2Hash = `sha256:${hashCanonicalValue(planProjection(v2Plan))}`
    const matches = legacyHash === v2Hash
    return {
        status: matches ? 'match' : 'different',
        matches,
        fatal: false,
        legacyHash,
        v2Hash,
        differences: matches ? [] : ['semantic-plan'],
    }
}
