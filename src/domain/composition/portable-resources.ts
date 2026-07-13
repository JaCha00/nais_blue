import type {
    EntityId,
    ExportedPortablePathRef,
    Extensions,
    PortablePathRef,
    PortablePathRoot,
    ResourceRef,
    ResourceRefBase,
} from './types'

export interface PortablePathResolutionContext {
    /** Diagnostic platform label only; core logic does not branch on known platform names. */
    platform: string
    supportedRoots: readonly PortablePathRoot[]
    /** Logical ids whose opaque grants have been materialized by the current adapter. */
    availableUserSelectionIds: readonly EntityId[]
}

/** Minimal readonly identity accepted from immutable resolved plans. */
export type PortablePathResolutionRef =
    | { readonly kind: 'standard'; readonly root: PortablePathRoot }
    | { readonly kind: 'bookmark'; readonly bookmarkId: EntityId }

export type PortablePathResolution =
    | {
        status: 'available'
        platform: string
    }
    | {
        status: 'unresolved'
        platform: string
        reason: 'unsupported-standard-root' | 'user-selection-unavailable'
        repairAction: 'choose-supported-root' | 'reselect-user-resource'
        logicalTokenId?: EntityId
    }

function cloneExtensions(extensions: Extensions | undefined): Extensions | undefined {
    if (extensions === undefined) return undefined
    return JSON.parse(JSON.stringify(extensions)) as Extensions
}

/**
 * Creates the only path shape permitted in sync/export payloads. Display paths
 * are volatile, while a bookmark id is only the logical lookup id. Opaque
 * desktop bookmarks and Android content URIs are never accepted by this API.
 */
export function projectPortablePathForExport(path: PortablePathRef): ExportedPortablePathRef {
    const extensions = cloneExtensions(path.extensions)
    if (path.kind === 'standard') {
        return {
            kind: 'standard',
            root: path.root,
            segments: [...path.segments],
            ...(extensions === undefined ? {} : { extensions }),
        }
    }
    return {
        kind: 'bookmark',
        bookmarkId: path.bookmarkId,
        segments: [...path.segments],
        ...(extensions === undefined ? {} : { extensions }),
    }
}

function exportResourceBase(resource: ResourceRef): ResourceRefBase {
    const extensions = cloneExtensions(resource.extensions)
    return {
        id: resource.id,
        orderKey: resource.orderKey,
        revision: resource.revision,
        createdAt: resource.createdAt,
        createdBy: { ...resource.createdBy },
        updatedAt: resource.updatedAt,
        updatedBy: { ...resource.updatedBy },
        ...(resource.deletedAt === undefined ? {} : { deletedAt: resource.deletedAt }),
        ...(extensions === undefined ? {} : { extensions }),
        enabled: resource.enabled,
        role: resource.role,
        ...(resource.mimeType === undefined ? {} : { mimeType: resource.mimeType }),
        ...(resource.contentHash === undefined
            ? {}
            : { contentHash: { ...resource.contentHash } }),
        ...(resource.digest === undefined ? {} : { digest: resource.digest }),
    }
}

/**
 * Detaches a reference for sync/export and reconstructs only core identity
 * fields. Bytes, native paths, opaque grants, and any accidental runtime-only
 * properties cannot pass through object spreading.
 */
export function projectResourceRefForExport(resource: ResourceRef): ResourceRef {
    const common = exportResourceBase(resource)
    switch (resource.kind) {
        case 'managed':
            return { ...common, kind: 'managed', resourceId: resource.resourceId }
        case 'library-image':
            return { ...common, kind: 'library-image', libraryImageId: resource.libraryImageId }
        case 'path':
            return { ...common, kind: 'path', path: projectPortablePathForExport(resource.path) }
        case 'uri':
            return { ...common, kind: 'uri', uri: resource.uri }
    }
}

/**
 * Pure preflight for adapters. It never resolves a native path and therefore
 * cannot silently turn an unavailable desktop grant into an Android path.
 */
export function inspectPortablePathAvailability(
    path: PortablePathResolutionRef,
    context: PortablePathResolutionContext,
): PortablePathResolution {
    if (path.kind === 'standard') {
        return context.supportedRoots.includes(path.root)
            ? { status: 'available', platform: context.platform }
            : {
                status: 'unresolved',
                platform: context.platform,
                reason: 'unsupported-standard-root',
                repairAction: 'choose-supported-root',
            }
    }

    return context.availableUserSelectionIds.includes(path.bookmarkId)
        ? { status: 'available', platform: context.platform }
        : {
            status: 'unresolved',
            platform: context.platform,
            reason: 'user-selection-unavailable',
            repairAction: 'reselect-user-resource',
            logicalTokenId: path.bookmarkId,
        }
}

/** Resource-level adapter preflight; managed ids and URIs need other adapters. */
export function inspectPortableFileResourceAvailability(
    resource: {
        readonly kind: ResourceRef['kind']
        readonly path?: PortablePathResolutionRef
    },
    context: PortablePathResolutionContext,
): PortablePathResolution | undefined {
    return resource.kind === 'path' && resource.path !== undefined
        ? inspectPortablePathAvailability(resource.path, context)
        : undefined
}
