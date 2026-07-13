import type {
    EntityId,
    Extensions,
    ParamsOverride,
    ResourceBinding,
} from './types'

/**
 * Params are applied from the first entry to the last entry. Keeping the order
 * here (rather than trusting caller object/array order) makes precedence part of
 * the domain contract.
 */
export const PARAMS_PRECEDENCE_ORDER = [
    'engine-defaults',
    'profile-defaults',
    'module-defaults',
    'recipe-step-override',
    'recipe-override',
    'scene-override',
    'workflow-runtime-override',
    'transport-derived-override',
    'capability-safety-clamp',
] as const

export type ParamsPrecedenceSource = typeof PARAMS_PRECEDENCE_ORDER[number]
export type CoreParams = Omit<ParamsOverride, 'extensions'>
export type CoreParamsField = keyof CoreParams

/**
 * Deliberately enumerated: extension keys must never become generation params
 * through object spreading.
 */
export const CORE_PARAMS_FIELDS = [
    'model',
    'width',
    'height',
    'steps',
    'cfgScale',
    'cfgRescale',
    'sampler',
    'scheduler',
    'smea',
    'smeaDyn',
    'variety',
    'seed',
    'seedLocked',
    'qualityToggle',
    'ucPreset',
    'sourceMode',
    'sourceImageResourceId',
    'maskResourceId',
    'strength',
    'noise',
    'characterPositionEnabled',
] as const satisfies readonly CoreParamsField[]

export type ResourceBindingOperation =
    | {
        operation: 'append'
        bindings: readonly ResourceBinding[]
    }
    | {
        operation: 'remove'
        resourceIds: readonly EntityId[]
    }
    | {
        operation: 'replace'
        bindings: readonly ResourceBinding[]
    }

export interface ParamsPrecedenceLayer {
    params?: Readonly<ParamsOverride>
    /** Operations are applied in their listed order inside this layer. */
    resourceBindingOperations?: readonly ResourceBindingOperation[]
}

export type ParamsPrecedenceLayers = Readonly<
    Partial<Record<ParamsPrecedenceSource, Readonly<ParamsPrecedenceLayer>>>
>

export interface IgnoredParamsExtensions {
    source: ParamsPrecedenceSource
    reason: 'extensions-are-not-core-params'
    extensions: Extensions
}

export type DimensionPairValidation =
    | {
        valid: true
        state: 'absent'
    }
    | {
        valid: true
        state: 'complete'
        width: number
        height: number
    }
    | {
        valid: false
        state: 'incomplete'
        missing: 'width' | 'height'
    }

export interface ParamsPrecedenceResult {
    /** Core fields only. The extensions property is intentionally absent. */
    params: CoreParams
    resourceBindings: ResourceBinding[]
    winnerByField: Partial<Record<CoreParamsField, ParamsPrecedenceSource>>
    ignoredExtensions: IgnoredParamsExtensions[]
    dimensionPair: DimensionPairValidation
}

/**
 * Checks whether effective dimensions are both absent or both present. Numeric
 * range/capability checks belong to semantic validation and clamping.
 */
export function validateDimensionPair(
    params: Readonly<Pick<ParamsOverride, 'width' | 'height'>>,
): DimensionPairValidation {
    const hasWidth = params.width !== undefined
    const hasHeight = params.height !== undefined

    if (!hasWidth && !hasHeight) return { valid: true, state: 'absent' }
    if (!hasWidth) return { valid: false, state: 'incomplete', missing: 'width' }
    if (!hasHeight) return { valid: false, state: 'incomplete', missing: 'height' }

    return {
        valid: true,
        state: 'complete',
        width: params.width as number,
        height: params.height as number,
    }
}

function applyResourceBindingOperation(
    current: readonly ResourceBinding[],
    operation: ResourceBindingOperation,
): ResourceBinding[] {
    switch (operation.operation) {
        case 'append':
            return [...current, ...operation.bindings]
        case 'remove': {
            const removedIds = new Set(operation.resourceIds)
            return current.filter(binding => !removedIds.has(binding.resourceId))
        }
        case 'replace':
            return [...operation.bindings]
    }
}

/**
 * Merges the nine canonical layers. A defined value wins even when it is false
 * or zero; undefined never clears an earlier value.
 */
export function mergeParamsByPrecedence(layers: ParamsPrecedenceLayers): ParamsPrecedenceResult {
    const params: CoreParams = {}
    const winnerByField: Partial<Record<CoreParamsField, ParamsPrecedenceSource>> = {}
    const ignoredExtensions: IgnoredParamsExtensions[] = []
    let resourceBindings: ResourceBinding[] = []

    for (const source of PARAMS_PRECEDENCE_ORDER) {
        const layer = layers[source]
        if (layer === undefined) continue

        if (layer.params?.extensions !== undefined) {
            ignoredExtensions.push({
                source,
                reason: 'extensions-are-not-core-params',
                extensions: { ...layer.params.extensions },
            })
        }

        if (layer.params !== undefined) {
            for (const field of CORE_PARAMS_FIELDS) {
                const value = layer.params[field]
                if (value === undefined) continue
                Object.assign(params, { [field]: value })
                winnerByField[field] = source
            }
        }

        for (const operation of layer.resourceBindingOperations ?? []) {
            resourceBindings = applyResourceBindingOperation(resourceBindings, operation)
        }
    }

    return {
        params,
        resourceBindings,
        winnerByField,
        ignoredExtensions,
        dimensionPair: validateDimensionPair(params),
    }
}
