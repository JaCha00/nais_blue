import type { JsonObject, JsonValue } from '../types'

export type MigrationIssueSeverity = 'info' | 'warning' | 'error' | 'fatal'

export type MigrationIssueCode =
    | 'M_ID_GENERATED'
    | 'M_DUPLICATE_ID_REPAIRED'
    | 'M_INVALID_SOURCE_REPAIRED'
    | 'M_INVALID_METADATA_REPAIRED'
    | 'M_UNKNOWN_SETTING_PRESERVED'
    | 'M_UNKNOWN_TARGET_ORPHANED'
    | 'M_CHARACTER_TARGET_OUT_OF_RANGE'
    | 'M_MODULE_REFERENCE_MISSING'
    | (string & {})

export interface MigrationIssue {
    code: MigrationIssueCode
    severity: MigrationIssueSeverity
    path: Array<string | number>
    message: string
    repairable: boolean
    /** Detached JSON-only evidence; never contains resource bytes. */
    details?: JsonObject
}

export interface MigrationEntityCounts {
    source: number
    migrated: number
    generatedIds: number
    repairedIds: number
    orphaned: number
}

export interface MigrationReport {
    migrationId: string
    sourceSchemaVersion: number | 'legacy' | 'unknown'
    targetSchemaVersion: number
    changed: boolean
    fatal: boolean
    sourceCounts: Record<string, number>
    targetCounts: Record<string, number>
    /** Canonical SHA-256 digests; transaction code may recompute before commit. */
    sourceHash: string
    targetHash: string
    entityCounts: Record<string, MigrationEntityCounts>
    issues: MigrationIssue[]
    ignoredKeys: string[]
    extensions?: JsonObject
}

export interface MigrationResult<T> {
    value: T
    report: MigrationReport
}

export function emptyMigrationEntityCounts(source = 0): MigrationEntityCounts {
    return {
        source,
        migrated: 0,
        generatedIds: 0,
        repairedIds: 0,
        orphaned: 0,
    }
}

export function migrationHasFatalIssues(issues: readonly MigrationIssue[]): boolean {
    return issues.some(issue => issue.severity === 'fatal')
}

/** Keeps report details JSON-only when a caller needs to attach raw scalar evidence. */
export function migrationIssueDetails(
    values: Readonly<Record<string, JsonValue>>,
): JsonObject {
    return { ...values }
}
