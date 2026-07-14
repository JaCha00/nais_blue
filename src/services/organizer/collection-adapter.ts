import { dirname, join } from '@tauri-apps/api/path'
import { readDir } from '@tauri-apps/plugin-fs'

import type { PortablePathRef } from '@/domain/composition/types'
import type { ArtifactPortableFileRef, OrganizerSourceImageFormat } from '@/domain/organizer/types'
import { runtimeCapabilities, type RuntimeCapability } from '@/platform/capabilities'
import {
    runtimePortablePathTokenRegistry,
    type PlatformTokenRegistry,
} from '@/platform/portable-resources'
import { createRuntimeOutputPlatformAdapter } from '@/services/output/tauri-output-adapter'
import { toArtifactSidecarPath } from '@/services/output/filename-policy'
import { childOutputRef, type OutputFileRef, type OutputPlatformAdapter } from '@/services/output/platform-adapter'

export const MANAGED_ARTIFACT_COLLECTION_DIRECTORY: PortablePathRef = {
    kind: 'standard',
    root: 'app-data',
    segments: ['nais2', 'organizer', 'artifacts'],
}

export interface OrganizerCollection {
    readonly id: string
    readonly label: string
    readonly directory: PortablePathRef
    readonly source: 'managed' | 'external'
}

export interface OrganizerCollectionEntry {
    readonly entryId: string
    readonly file: ArtifactPortableFileRef
    readonly format: OrganizerSourceImageFormat
}

export interface OrganizerCollectionCapability {
    readonly supported: boolean
    readonly reason?: string
    readonly alternative?: string
}

export interface OrganizerConflictPreview {
    readonly status: 'available' | 'conflict'
    readonly imageExists: boolean
    readonly artifactSidecarExists: boolean
}

function formatFromFileName(fileName: string): OrganizerSourceImageFormat | null {
    const extension = fileName.split('.').pop()?.toLowerCase()
    if (extension === 'png') return 'png'
    if (extension === 'webp') return 'webp'
    if (extension === 'jpg' || extension === 'jpeg') return 'jpeg'
    return null
}

function projectDirectory(directory: PortablePathRef): PortablePathRef {
    if (directory.kind === 'standard') {
        return { kind: 'standard', root: directory.root, segments: [...directory.segments] }
    }
    return { kind: 'bookmark', bookmarkId: directory.bookmarkId, segments: [...directory.segments] }
}

function outputOptions(directory: PortablePathRef): { portableDirectory: PortablePathRef; workflowDefaultDirectory: string } {
    return { portableDirectory: projectDirectory(directory), workflowDefaultDirectory: 'nais2/organizer/artifacts' }
}

function optionsFor(file: OutputFileRef): { baseDir?: NonNullable<OutputFileRef['baseDir']> } | undefined {
    return file.baseDir === undefined ? undefined : { baseDir: file.baseDir }
}

function displayLabel(path: string): string {
    const parts = path.split(/[\\/]+/).filter(Boolean)
    return parts[parts.length - 1] ?? 'Selected folder'
}

function platformForToken(): typeof runtimeCapabilities.platform {
    return runtimeCapabilities.platform === 'unknown' ? 'desktop' : runtimeCapabilities.platform
}

/**
 * Folder scanning is deliberately a platform adapter.  Records retain only
 * PortablePathRef values; opaque absolute paths are held by the token registry
 * for the active platform session.
 */
export class TauriOrganizerCollectionAdapter {
    constructor(
        private readonly platform: OutputPlatformAdapter = createRuntimeOutputPlatformAdapter(),
        private readonly tokens: PlatformTokenRegistry = runtimePortablePathTokenRegistry,
    ) {}

    managedCollection(): OrganizerCollection {
        return {
            id: 'managed-artifacts',
            label: 'Managed artifacts',
            directory: projectDirectory(MANAGED_ARTIFACT_COLLECTION_DIRECTORY),
            source: 'managed',
        }
    }

    externalFolderCapability(): OrganizerCollectionCapability {
        const capability: RuntimeCapability = runtimeCapabilities.absoluteOutputPath
        return capability.supported
            ? { supported: true }
            : { supported: false, reason: capability.reason, alternative: capability.alternative }
    }

    /** The dialog boundary is injected by the UI to keep tests and mobile explicit. */
    registerExternalDirectory(path: string): OrganizerCollection {
        const capability = this.externalFolderCapability()
        if (!capability.supported) {
            throw new Error(`${capability.reason ?? 'External folder access is unsupported.'} ${capability.alternative ?? ''}`.trim())
        }
        const logicalId = `organizer-folder-${crypto.randomUUID()}`
        this.tokens.register({
            logicalId,
            platform: platformForToken(),
            kind: 'directory',
            opaqueToken: path,
            displayPath: displayLabel(path),
        })
        return {
            id: logicalId,
            label: displayLabel(path),
            directory: { kind: 'bookmark', bookmarkId: logicalId, segments: [] },
            source: 'external',
        }
    }

    async listEntries(collection: OrganizerCollection): Promise<OrganizerCollectionEntry[]> {
        const directory = await this.platform.resolveDirectory(outputOptions(collection.directory))
        if (collection.source === 'managed') await this.platform.ensureDirectory(directory)
        const entries = await readDir(directory.path, optionsFor(directory))
        return entries
            .filter(entry => entry.isFile)
            .flatMap(entry => {
                const format = formatFromFileName(entry.name)
                if (format === null) return []
                return [{
                    entryId: `${collection.id}:${entry.name}`,
                    file: { directory: projectDirectory(collection.directory), fileName: entry.name },
                    format,
                } satisfies OrganizerCollectionEntry]
            })
            .sort((left, right) => left.file.fileName.localeCompare(right.file.fileName))
    }

    async readEntry(entry: OrganizerCollectionEntry): Promise<Uint8Array> {
        const directory = await this.platform.resolveDirectory(outputOptions(entry.file.directory))
        return this.platform.readFile({
            path: `${directory.path}${directory.path.endsWith('/') || directory.path.endsWith('\\') ? '' : '/'}${entry.file.fileName}`,
            displayPath: `${directory.displayPath}${directory.displayPath.endsWith('/') || directory.displayPath.endsWith('\\') ? '' : '/'}${entry.file.fileName}`,
            ...(directory.baseDir === undefined ? {} : { baseDir: directory.baseDir }),
        })
    }

    /** Read-only preflight; OutputWriter repeats this immediately before commit. */
    async previewDistributionConflict(
        collection: OrganizerCollection,
        fileName: string,
    ): Promise<OrganizerConflictPreview> {
        const directory = await this.platform.resolveDirectory(outputOptions(collection.directory))
        const imageExists = await this.platform.exists(childOutputRef(directory, fileName))
        const artifactSidecarExists = await this.platform.exists(childOutputRef(directory, toArtifactSidecarPath(fileName)))
        return {
            status: imageExists || artifactSidecarExists ? 'conflict' : 'available',
            imageExists,
            artifactSidecarExists,
        }
    }

    async listSiblingCollections(collection: OrganizerCollection): Promise<OrganizerCollection[]> {
        const directory = await this.platform.resolveDirectory(outputOptions(collection.directory))
        if (collection.directory.kind === 'standard') {
            const parentSegments = collection.directory.segments.slice(0, -1)
            const standardRoot = collection.directory.root
            const parent: PortablePathRef = {
                kind: 'standard',
                root: standardRoot,
                segments: parentSegments,
            }
            const parentDirectory = await this.platform.resolveDirectory(outputOptions(parent))
            const entries = await readDir(parentDirectory.path, optionsFor(parentDirectory))
            return entries
                .filter(entry => entry.isDirectory)
                .map(entry => ({
                    id: `managed:${[...parentSegments, entry.name].join('/')}`,
                    label: entry.name,
                    directory: { kind: 'standard', root: standardRoot, segments: [...parentSegments, entry.name] },
                    source: 'managed' as const,
                } satisfies OrganizerCollection))
                .sort((left, right) => left.label.localeCompare(right.label))
        }

        const parentPath = await dirname(directory.path)
        const entries = await readDir(parentPath)
        const siblings: OrganizerCollection[] = []
        for (const entry of entries.filter(candidate => candidate.isDirectory)) {
            const path = await join(parentPath, entry.name)
            const logicalId = `organizer-folder-${crypto.randomUUID()}`
            this.tokens.register({
                logicalId,
                platform: platformForToken(),
                kind: 'directory',
                opaqueToken: path,
                displayPath: entry.name,
            })
            siblings.push({
                id: logicalId,
                label: entry.name,
                directory: { kind: 'bookmark', bookmarkId: logicalId, segments: [] },
                source: 'external',
            })
        }
        return siblings.sort((left, right) => left.label.localeCompare(right.label))
    }
}
