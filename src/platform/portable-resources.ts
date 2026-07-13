import type {
    PortablePathRef,
    ResourceRef,
} from '@/domain/composition/types'
import type { CompositionEnginePlan } from '@/domain/composition/engine'
import type { DeepReadonly } from '@/domain/composition/provenance'
import type { RuntimeCapabilities, RuntimePlatform } from './capabilities'

export type PlatformTokenKind = 'file' | 'directory'

/**
 * Stored outside CompositionDocument. `opaqueToken` may be an absolute path,
 * Android content URI, or a future security-scoped bookmark and must never be
 * copied into composition sync/export payloads.
 */
export interface PlatformTokenRecord {
    logicalId: string
    platform: RuntimePlatform
    kind: PlatformTokenKind
    opaqueToken: string
    displayPath: string
}

export interface PlatformTokenRegistry {
    register(record: PlatformTokenRecord): void
    resolve(logicalId: string): Readonly<PlatformTokenRecord> | undefined
    remove(logicalId: string): void
}

export class InMemoryPlatformTokenRegistry implements PlatformTokenRegistry {
    private readonly records = new Map<string, PlatformTokenRecord>()

    register(record: PlatformTokenRecord): void {
        if (!record.logicalId.trim() || !record.opaqueToken.trim()) {
            throw new Error('Platform token records require a logical ID and opaque token')
        }
        this.records.set(record.logicalId, { ...record })
    }

    resolve(logicalId: string): Readonly<PlatformTokenRecord> | undefined {
        const record = this.records.get(logicalId)
        return record === undefined ? undefined : { ...record }
    }

    remove(logicalId: string): void {
        this.records.delete(logicalId)
    }
}

/** Process-local default; a platform persistence adapter may hydrate it on startup. */
export const runtimePortablePathTokenRegistry: PlatformTokenRegistry = new InMemoryPlatformTokenRegistry()

export type PortableResourceRepairAction = {
    kind: 'select-file' | 'select-directory' | 'copy-to-app-data'
    resourceId?: string
    bookmarkId?: string
    label: string
}

export interface PortableResourceIssue {
    code:
        | 'E_PORTABLE_PATH_INVALID'
        | 'E_PORTABLE_PATH_TOKEN_MISSING'
        | 'E_PORTABLE_PATH_PLATFORM_MISMATCH'
        | 'E_PORTABLE_PATH_ROOT_UNSUPPORTED'
    message: string
    blocking: true
    resourceId?: string
    repairAction: PortableResourceRepairAction
}

export interface MaterializedPortablePath {
    kind: 'standard' | 'user-selected'
    /** Logical root is kept separate from the relative path. */
    root?: Extract<PortablePathRef, { kind: 'standard' }>['root']
    relativePath: string
    /** Present only at the platform edge; never serialize it into a document. */
    opaqueToken?: string
    displayPath: string
}

export type PortablePathAssessment =
    | { status: 'resolved'; materialized: MaterializedPortablePath; issues: [] }
    | { status: 'unresolved'; materialized: null; issues: PortableResourceIssue[] }

function isSafeSegment(segment: string): boolean {
    return Boolean(segment.trim())
        && segment !== '.'
        && segment !== '..'
        && !/[\\/\0]/.test(segment)
        && !/^[A-Za-z]:$/.test(segment)
}

function relativePath(segments: readonly string[]): string | null {
    return segments.every(isSafeSegment) ? segments.join('/') : null
}

function unsupportedRootOnMobile(root: Extract<PortablePathRef, { kind: 'standard' }>['root']): boolean {
    return root !== 'app-data' && root !== 'cache'
}

function unresolved(issue: PortableResourceIssue): PortablePathAssessment {
    return { status: 'unresolved', materialized: null, issues: [issue] }
}

/**
 * Resolves logical document paths at the platform boundary. A document remains
 * loadable when this returns unresolved; generation callers must treat every
 * returned issue as blocking until its repair action succeeds.
 */
export function assessPortablePath(
    path: DeepReadonly<PortablePathRef>,
    capabilities: RuntimeCapabilities,
    registry: PlatformTokenRegistry = runtimePortablePathTokenRegistry,
    resourceId?: string,
): PortablePathAssessment {
    const relative = relativePath(path.segments)
    if (relative === null) {
        return unresolved({
            code: 'E_PORTABLE_PATH_INVALID',
            message: 'The portable path contains an invalid or absolute segment.',
            blocking: true,
            resourceId,
            repairAction: {
                kind: path.kind === 'bookmark' ? 'select-file' : 'copy-to-app-data',
                resourceId,
                ...(path.kind === 'bookmark' ? { bookmarkId: path.bookmarkId } : {}),
                label: 'Repair resource location',
            },
        })
    }

    if (path.kind === 'standard') {
        const mobile = capabilities.platform === 'android' || capabilities.platform === 'ios'
        if (mobile && unsupportedRootOnMobile(path.root)) {
            return unresolved({
                code: 'E_PORTABLE_PATH_ROOT_UNSUPPORTED',
                message: `${path.root} resources are not directly available in the mobile app sandbox.`,
                blocking: true,
                resourceId,
                repairAction: {
                    kind: 'copy-to-app-data',
                    resourceId,
                    label: 'Import a copy into app data',
                },
            })
        }
        return {
            status: 'resolved',
            materialized: {
                kind: 'standard',
                root: path.root,
                relativePath: relative,
                displayPath: `${path.root}:/${relative}`,
            },
            issues: [],
        }
    }

    const token = registry.resolve(path.bookmarkId)
    if (token === undefined) {
        return unresolved({
            code: 'E_PORTABLE_PATH_TOKEN_MISSING',
            message: 'This user-selected resource must be located again on this device.',
            blocking: true,
            resourceId,
            repairAction: {
                kind: 'select-file',
                resourceId,
                bookmarkId: path.bookmarkId,
                label: 'Locate resource',
            },
        })
    }
    const tokenIsDesktop = token.platform === 'desktop'
        || token.platform === 'windows'
        || token.platform === 'macos'
        || token.platform === 'linux'
        || token.platform === 'unknown'
    const runtimeIsDesktop = capabilities.platform === 'desktop'
        || capabilities.platform === 'windows'
        || capabilities.platform === 'macos'
        || capabilities.platform === 'linux'
        || capabilities.platform === 'unknown'
    const abstractDesktopMatch = (token.platform === 'desktop' && runtimeIsDesktop)
        || (capabilities.platform === 'desktop' && tokenIsDesktop)
    if (token.platform !== capabilities.platform && !abstractDesktopMatch) {
        return unresolved({
            code: 'E_PORTABLE_PATH_PLATFORM_MISMATCH',
            message: `This resource token belongs to ${token.platform} and cannot be used on ${capabilities.platform}.`,
            blocking: true,
            resourceId,
            repairAction: {
                kind: token.kind === 'directory' ? 'select-directory' : 'select-file',
                resourceId,
                bookmarkId: path.bookmarkId,
                label: token.kind === 'directory' ? 'Choose replacement directory' : 'Locate replacement file',
            },
        })
    }

    return {
        status: 'resolved',
        materialized: {
            kind: 'user-selected',
            relativePath: relative,
            opaqueToken: token.opaqueToken,
            displayPath: relative ? `${token.displayPath}/${relative}` : token.displayPath,
        },
        issues: [],
    }
}

export interface PortableResourceAssessment {
    loadable: true
    readyForGeneration: boolean
    issues: PortableResourceIssue[]
}

export function assessPortableCompositionPlan(
    plan: DeepReadonly<CompositionEnginePlan>,
    capabilities: RuntimeCapabilities,
    registry: PlatformTokenRegistry = runtimePortablePathTokenRegistry,
): PortableResourceAssessment {
    const resourceAssessment = assessPortableResourcesForGeneration(
        plan.resources,
        capabilities,
        registry,
    )
    if (plan.outputPolicy.destination.kind !== 'filesystem') return resourceAssessment

    const outputAssessment = assessPortablePath(
        plan.outputPolicy.destination.directory,
        capabilities,
        registry,
        'output-destination',
    )
    const outputIssues = outputAssessment.status === 'unresolved' ? outputAssessment.issues : []
    const issues = [...resourceAssessment.issues, ...outputIssues]
    return {
        loadable: true,
        readyForGeneration: issues.length === 0,
        issues,
    }
}

export function assessPortableResourcesForGeneration(
    resources: readonly DeepReadonly<ResourceRef>[],
    capabilities: RuntimeCapabilities,
    registry: PlatformTokenRegistry = runtimePortablePathTokenRegistry,
): PortableResourceAssessment {
    const issues = resources.flatMap(resource => {
        if (!resource.enabled || resource.kind !== 'path') return []
        const result = assessPortablePath(resource.path, capabilities, registry, resource.id)
        return result.status === 'unresolved' ? result.issues : []
    })
    return {
        // Resolution is deliberately not a document-load gate.
        loadable: true,
        readyForGeneration: issues.length === 0,
        issues,
    }
}

export interface PortableResourceByteReader {
    read(materialized: MaterializedPortablePath): Promise<Uint8Array>
}

export async function materializePortableResourceBytes(input: {
    resource: DeepReadonly<Extract<ResourceRef, { kind: 'path' }>>
    capabilities: RuntimeCapabilities
    registry?: PlatformTokenRegistry
    reader: PortableResourceByteReader
}): Promise<{ status: 'resolved'; bytes: Uint8Array } | { status: 'unresolved'; issues: PortableResourceIssue[] }> {
    const assessment = assessPortablePath(
        input.resource.path,
        input.capabilities,
        input.registry,
        input.resource.id,
    )
    if (assessment.status === 'unresolved') return assessment
    return { status: 'resolved', bytes: await input.reader.read(assessment.materialized) }
}

export const PORTABLE_TOKEN_SYNC_POLICY = Object.freeze({
    compositionDocumentStores: 'logical-reference-only',
    exportIncludesOpaqueTokens: false,
    syncIncludesOpaqueTokens: false,
    repairRequiredOnNewPlatform: true,
} as const)
