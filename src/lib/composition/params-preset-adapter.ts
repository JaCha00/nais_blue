import type {
    ActorRef,
    ParamsOverride,
    ParamsPreset,
} from '@/domain/composition/types'
import { deterministicMigrationId } from '@/lib/composition/legacy-migration-id'

export interface ParamsPresetProjectionContext {
    revision: number
    timestamp: string
    actor: ActorRef
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key]
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
    const value = record[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
    const value = record[key]
    return typeof value === 'boolean' ? value : undefined
}

function assign<Key extends keyof ParamsOverride>(
    target: ParamsOverride,
    key: Key,
    value: ParamsOverride[Key],
): void {
    if (value !== undefined) Object.assign(target, { [key]: value })
}

/** Only generation-relevant fields cross into ParamsPreset.params. */
export function legacyPresetParams(value: unknown): ParamsOverride {
    const record = isRecord(value) ? value : {}
    const resolution = isRecord(record.selectedResolution) ? record.selectedResolution : {}
    const params: ParamsOverride = {}

    assign(params, 'model', readString(record, 'model'))
    assign(params, 'width', readNumber(resolution, 'width') ?? readNumber(record, 'width'))
    assign(params, 'height', readNumber(resolution, 'height') ?? readNumber(record, 'height'))
    assign(params, 'steps', readNumber(record, 'steps'))
    assign(params, 'cfgScale', readNumber(record, 'cfgScale'))
    assign(params, 'cfgRescale', readNumber(record, 'cfgRescale'))
    assign(params, 'sampler', readString(record, 'sampler'))
    assign(params, 'scheduler', readString(record, 'scheduler'))
    assign(params, 'smea', readBoolean(record, 'smea'))
    assign(params, 'smeaDyn', readBoolean(record, 'smeaDyn'))
    assign(params, 'variety', readBoolean(record, 'variety'))
    assign(params, 'qualityToggle', readBoolean(record, 'qualityToggle'))
    assign(params, 'ucPreset', readNumber(record, 'ucPreset'))
    return params
}

function timestampFromLegacy(value: unknown, fallback: string): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? fallback : date.toISOString()
}

function projectOne(
    value: unknown,
    index: number,
    context: ParamsPresetProjectionContext,
    forcedId?: string,
): ParamsPreset {
    const record = isRecord(value) ? value : {}
    const id = forcedId
        ?? (typeof record.id === 'string' && record.id.trim().length > 0
            ? record.id
            : deterministicMigrationId('params-preset', record, String(index)))
    return {
        id,
        orderKey: `params-preset:${String(index).padStart(6, '0')}`,
        revision: Math.max(0, Math.trunc(context.revision)),
        createdAt: timestampFromLegacy(record.createdAt, context.timestamp),
        createdBy: context.actor,
        updatedAt: context.timestamp,
        updatedBy: context.actor,
        name: readString(record, 'name') ?? id,
        enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
        params: legacyPresetParams(record),
    }
}

export function projectLegacyParamsPreset(
    value: unknown,
    index: number,
    context: ParamsPresetProjectionContext,
): ParamsPreset {
    return projectOne(value, index, context)
}

export function projectLegacyParamsPresets(
    values: readonly unknown[],
    context: ParamsPresetProjectionContext,
): ParamsPreset[] {
    const usedIds = new Set<string>()
    return values.map((value, index) => {
        let projected = projectOne(value, index, context)
        if (usedIds.has(projected.id)) {
            let salt = 0
            let id: string
            do {
                id = deterministicMigrationId('params-preset', value, `${index}:duplicate:${salt}`)
                salt += 1
            } while (usedIds.has(id))
            projected = projectOne(value, index, context, id)
        }
        usedIds.add(projected.id)
        return projected
    })
}
