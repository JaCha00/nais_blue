import { processWildcards } from '@/lib/fragment-processor'
import type {
    AssetModuleProfile,
    AssetProfile,
    AssetProfileJsonRecord,
    AssetProfileOutput,
    AssetProfileR2,
    AssetRecipe,
    AssetRecipeStep,
} from '@/types/asset-profile'
import { dedupePromptTokens } from './dedupe'
import { createFallbackFilename, renderFilenameTemplate } from './filename-template'

export interface ResolveParams {
    profile?: AssetProfile | null
    recipeId?: string
    seed?: number
    now?: Date
    filenameTemplate?: string
    filenameContext?: Record<string, unknown>
    outputDirectory?: string
    baseParams?: Record<string, unknown>
    wildcardProcessor?: (prompt: string) => string | Promise<string>
}

export interface ResolvedAssetModule {
    module: AssetModuleProfile
    step: AssetRecipeStep
    settings: AssetProfileJsonRecord
}

export interface AssetModulePromptContribution {
    moduleId: string
    recipeId: string
    target: string
    order: number
    prompt: string
}

export interface AssetModulePlan {
    recipe: AssetRecipe | null
    recipeId: string | null
    modules: ResolvedAssetModule[]
    contributions: AssetModulePromptContribution[]
    promptGroups: Record<string, string>
    generationParams: Record<string, unknown>
    settings: AssetProfileJsonRecord
    output: AssetProfileOutput
    r2: AssetProfileR2
    filename: string
    outputPath: string
    seed: number
    warnings: string[]
}

interface ContributionDraft {
    target: string
    order: number
    prompt: string
}

interface IndexedContribution extends AssetModulePromptContribution {
    index: number
}

const DEFAULT_TARGET = 'main.base'
const DEFAULT_FILENAME_TEMPLATE = '{profile}_{seed}_{datetime:YYYYMMDD-HHmmss}'
const DEFAULT_OUTPUT_DIRECTORY = 'NAIS_Output'

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isJsonRecord(value: unknown): value is AssetProfileJsonRecord {
    return isRecord(value)
}

function mergeJsonRecords(...records: Array<AssetProfileJsonRecord | undefined>): AssetProfileJsonRecord {
    return Object.assign({}, ...records.filter(isJsonRecord))
}

function isAssetProfile(value: unknown): value is AssetProfile {
    return (
        isRecord(value) &&
        typeof value.revision === 'number' &&
        Array.isArray(value.recipes) &&
        isRecord(value.modules)
    )
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
    const value = source[key]
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readNumber(source: Record<string, unknown>, key: string): number | undefined {
    const value = source[key]

    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)

    return undefined
}

function normalizeTarget(target: string | undefined): string {
    return target?.trim() || DEFAULT_TARGET
}

function normalizeSeed(seed: number | undefined, now: Date): number {
    if (typeof seed === 'number' && Number.isFinite(seed)) {
        return Math.trunc(seed)
    }

    return now.getTime()
}

function collectPromptValue(value: unknown, target: string, order: number, drafts: ContributionDraft[]): void {
    if (typeof value === 'string') {
        const prompt = value.trim()
        if (prompt) drafts.push({ target, order, prompt })
        return
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            collectPromptValue(item, target, order, drafts)
        }
        return
    }

    if (!isRecord(value)) return

    const nestedPrompt = readString(value, 'prompt') ?? readString(value, 'text')
    if (nestedPrompt) {
        drafts.push({
            target: normalizeTarget(readString(value, 'target') ?? target),
            order: readNumber(value, 'order') ?? order,
            prompt: nestedPrompt,
        })
        return
    }

    for (const [nestedTarget, nestedValue] of Object.entries(value)) {
        collectPromptValue(nestedValue, normalizeTarget(nestedTarget), order, drafts)
    }
}

function extractContributions(
    module: AssetModuleProfile,
    step: AssetRecipeStep,
    recipeId: string,
): AssetModulePromptContribution[] {
    const moduleSource = module as unknown as Record<string, unknown>
    const stepSource = step as unknown as Record<string, unknown>
    const source = {
        ...moduleSource,
        ...module.settings,
        ...step.settings,
        ...stepSource,
    }

    const target = normalizeTarget(readString(source, 'target'))
    const order = readNumber(source, 'order') ?? 0
    const drafts: ContributionDraft[] = []

    collectPromptValue(source.prompt, target, order, drafts)
    collectPromptValue(source.prompts, target, order, drafts)
    collectPromptValue(source.targets, target, order, drafts)

    const negativePrompt = readString(source, 'negative') ?? readString(source, 'negativePrompt')
    if (negativePrompt) {
        drafts.push({
            target: 'main.negative',
            order,
            prompt: negativePrompt,
        })
    }

    return drafts.map(draft => ({
        moduleId: module.id,
        recipeId,
        target: draft.target,
        order: draft.order,
        prompt: draft.prompt,
    }))
}

function findActiveRecipe(profile: AssetProfile, recipeId: string | undefined): AssetRecipe | null {
    if (recipeId) {
        return profile.recipes.find(recipe => recipe.id === recipeId && recipe.enabled) ?? null
    }

    return profile.recipes.find(recipe => recipe.enabled) ?? null
}

function buildCharacterPrompts(promptGroups: Record<string, string>): Array<{
    prompt: string
    negative: string
    enabled: boolean
    position: { x: number; y: number }
}> {
    const byIndex = new Map<number, { prompt: string; negative: string }>()
    const pattern = /^v4\.char\.(\d+)\.(positive|negative)$/

    for (const [target, prompt] of Object.entries(promptGroups)) {
        const match = target.match(pattern)
        if (!match) continue

        const index = Number(match[1])
        const kind = match[2]
        const current = byIndex.get(index) ?? { prompt: '', negative: '' }

        if (kind === 'positive') current.prompt = prompt
        if (kind === 'negative') current.negative = prompt

        byIndex.set(index, current)
    }

    return Array.from(byIndex.entries())
        .sort(([left], [right]) => left - right)
        .filter(([, value]) => value.prompt || value.negative)
        .map(([, value]) => ({
            prompt: value.prompt,
            negative: value.negative,
            enabled: true,
            position: { x: 0.5, y: 0.5 },
        }))
}

function buildGenerationParams(
    baseParams: Record<string, unknown>,
    promptGroups: Record<string, string>,
    seed: number,
): Record<string, unknown> {
    const prompt = promptGroups['main.base'] || promptGroups['main.positive'] || String(baseParams.prompt ?? '')
    const negativePrompt = promptGroups['main.negative'] || String(baseParams.negative_prompt ?? '')
    const characterPrompts = buildCharacterPrompts(promptGroups)

    return {
        ...baseParams,
        seed,
        prompt,
        negative_prompt: negativePrompt,
        promptGroups,
        ...(characterPrompts.length > 0 ? { characterPrompts } : {}),
    }
}

function buildOutputPath(directory: string, filename: string): string {
    const trimmedDirectory = directory.trim().replace(/[\\/]+$/g, '')
    if (!trimmedDirectory) return filename

    return `${trimmedDirectory}/${filename}`
}

function appendOutputExtension(filename: string, output: AssetProfileOutput): string {
    const format = typeof output.format === 'string' ? output.format.replace(/^\./, '').trim() : ''
    if (!format || /\.[A-Za-z0-9]{2,5}$/.test(filename)) return filename

    return `${filename}.${format}`
}

function createEmptyPlan(params: {
    seed: number
    now: Date
    warnings: string[]
    baseParams?: Record<string, unknown>
}): AssetModulePlan {
    const filename = createFallbackFilename(params.now)

    return {
        recipe: null,
        recipeId: null,
        modules: [],
        contributions: [],
        promptGroups: {},
        generationParams: buildGenerationParams(params.baseParams ?? {}, {}, params.seed),
        settings: {},
        output: {},
        r2: { enabled: false },
        filename,
        outputPath: buildOutputPath(DEFAULT_OUTPUT_DIRECTORY, filename),
        seed: params.seed,
        warnings: params.warnings,
    }
}

async function resolvePromptGroups(
    contributions: AssetModulePromptContribution[],
    wildcardProcessor: (prompt: string) => string | Promise<string>,
    warnings: string[],
): Promise<Record<string, string>> {
    const grouped = new Map<string, IndexedContribution[]>()

    contributions.forEach((contribution, index) => {
        const group = grouped.get(contribution.target) ?? []
        group.push({ ...contribution, index })
        grouped.set(contribution.target, group)
    })

    const promptGroups: Record<string, string> = {}

    for (const [target, items] of grouped.entries()) {
        const merged = items
            .sort((left, right) => left.order - right.order || left.index - right.index)
            .map(item => item.prompt)
            .join(', ')
        const deduped = dedupePromptTokens(merged)

        try {
            const wildcarded = await wildcardProcessor(deduped)
            const finalPrompt = dedupePromptTokens(wildcarded)
            if (finalPrompt) promptGroups[target] = finalPrompt
        } catch (error) {
            warnings.push(`Wildcard processing failed for ${target}: ${error instanceof Error ? error.message : String(error)}`)
            if (deduped) promptGroups[target] = deduped
        }
    }

    return promptGroups
}

export async function resolveAssetModulePlan(params: ResolveParams): Promise<AssetModulePlan> {
    const now = params?.now ?? new Date()
    const seed = normalizeSeed(params?.seed, now)
    const warnings: string[] = []

    if (!params || !isAssetProfile(params.profile)) {
        warnings.push('Invalid asset profile; using fallback filename and empty prompt plan.')
        return createEmptyPlan({ seed, now, warnings, baseParams: params?.baseParams })
    }

    const recipe = findActiveRecipe(params.profile, params.recipeId)

    if (!recipe) {
        warnings.push(params.recipeId ? `Recipe "${params.recipeId}" is missing or disabled.` : 'No enabled recipe found.')
        return createEmptyPlan({ seed, now, warnings, baseParams: params.baseParams })
    }

    const modules: ResolvedAssetModule[] = []
    const contributions: AssetModulePromptContribution[] = []
    let settings = mergeJsonRecords(params.profile.settings)
    let output: AssetProfileOutput = { ...params.profile.output }
    let r2: AssetProfileR2 = { ...params.profile.r2 }

    for (const step of recipe.steps) {
        if (step.enabled === false) continue

        const module = params.profile.modules[step.moduleId]
        if (!module) {
            warnings.push(`Module "${step.moduleId}" referenced by recipe "${recipe.id}" was not found.`)
            continue
        }

        if (!module.enabled) continue

        const mergedSettings = mergeJsonRecords(module.settings, step.settings)
        modules.push({ module, step, settings: mergedSettings })
        contributions.push(...extractContributions(module, step, recipe.id))
        settings = mergeJsonRecords(settings, mergedSettings)
        output = { ...output, ...module.output }
        r2 = { ...r2, ...module.r2 }
    }

    settings = mergeJsonRecords(settings, recipe.settings)
    output = { ...output, ...recipe.output }
    r2 = { ...r2, ...recipe.r2 }

    const promptGroups = await resolvePromptGroups(
        contributions,
        params.wildcardProcessor ?? processWildcards,
        warnings,
    )
    const generationParams = buildGenerationParams(params.baseParams ?? {}, promptGroups, seed)
    const filenameContext = {
        profile: readString(params.profile.settings, 'name') ?? params.profile.updatedBy,
        recipe: { id: recipe.id, label: recipe.label },
        seed,
        ...params.filenameContext,
    }
    const filenameTemplate = params.filenameTemplate ?? output.filenameTemplate ?? DEFAULT_FILENAME_TEMPLATE
    const renderedFilename = renderFilenameTemplate({
        template: filenameTemplate,
        context: filenameContext,
        now,
        fallback: createFallbackFilename(now),
    })
    const filename = appendOutputExtension(renderedFilename, output)
    const outputWithFileName = { ...output, fileName: filename }
    const directory = params.outputDirectory ?? output.directory ?? DEFAULT_OUTPUT_DIRECTORY

    return {
        recipe,
        recipeId: recipe.id,
        modules,
        contributions,
        promptGroups,
        generationParams,
        settings,
        output: outputWithFileName,
        r2,
        filename,
        outputPath: buildOutputPath(directory, filename),
        seed,
        warnings,
    }
}
