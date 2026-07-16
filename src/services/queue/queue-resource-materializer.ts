import {
    BaseDirectory,
    exists,
    mkdir,
    readFile,
    remove,
    rename,
    writeFile,
} from '@tauri-apps/plugin-fs'

import type { JsonValue } from '@/domain/composition/types'
import type {
    GenerationSnapshotResource,
    QueueResourceRecord,
    SnapshotResourceRole,
} from '@/domain/queue/types'
import type { GenerationParams } from '@/services/novelai-types'

const RESOURCE_DIRECTORY = 'queue-resources'

export interface QueueResourceStorage {
    ensureDirectory(): Promise<void>
    exists(relativePath: string): Promise<boolean>
    read(relativePath: string): Promise<Uint8Array>
    write(relativePath: string, bytes: Uint8Array): Promise<void>
}

export class QueueResourceError extends Error {
    constructor(
        readonly code:
            | 'E_QUEUE_RESOURCE_INVALID'
            | 'E_QUEUE_RESOURCE_DIGEST_MISMATCH'
            | 'E_QUEUE_RESOURCE_MISSING',
        message: string,
    ) {
        super(message)
        this.name = 'QueueResourceError'
    }
}

interface ManagedResourceReference {
    relativePath: string
    mediaType: string
    encoding: 'data-url' | 'utf8'
}

export interface MaterializedQueueResource {
    snapshotResource: GenerationSnapshotResource
    record: QueueResourceRecord
}

type ResourceField = 'sourceImage' | 'mask' | 'charImages' | 'vibeImages' | 'preEncodedVibes'

interface ResourceBinding {
    resourceId: string
    field: ResourceField
    index?: number
}

export interface DehydratedGenerationParameters {
    generationParams: JsonValue
    resourceBindings: ResourceBinding[]
    resourceArrayLengths: Partial<Record<ResourceField, number>>
}

export interface DehydratedGenerationResult {
    parameters: DehydratedGenerationParameters
    resources: GenerationSnapshotResource[]
    records: QueueResourceRecord[]
}

export type QueueResourceMaterializationCache = Map<string, Promise<MaterializedQueueResource>>

function bytesToHex(bytes: Uint8Array): string {
    return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
}

export async function hashQueueResourceBytes(bytes: Uint8Array): Promise<string> {
    const source = new Uint8Array(bytes)
    const digest = await globalThis.crypto.subtle.digest('SHA-256', source.buffer)
    return `sha256:${bytesToHex(new Uint8Array(digest))}`
}

function decodeDataUrl(value: string): { mediaType: string; bytes: Uint8Array } {
    const match = /^data:([^,;]+);base64,([A-Za-z0-9+/=]+)$/i.exec(value)
    if (match === null) {
        throw new QueueResourceError('E_QUEUE_RESOURCE_INVALID', 'Queue image resource must be a base64 data URL')
    }
    try {
        const binary = atob(match[2])
        return {
            mediaType: match[1].toLowerCase(),
            bytes: Uint8Array.from(binary, character => character.charCodeAt(0)),
        }
    } catch {
        throw new QueueResourceError('E_QUEUE_RESOURCE_INVALID', 'Queue image resource encoding is invalid')
    }
}

function encodeDataUrl(mediaType: string, bytes: Uint8Array): string {
    let binary = ''
    const chunkSize = 32_768
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
    }
    return `data:${mediaType};base64,${btoa(binary)}`
}

function parseReference(value: JsonValue): ManagedResourceReference {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new QueueResourceError('E_QUEUE_RESOURCE_INVALID', 'Managed queue resource reference is invalid')
    }
    const reference = value as Record<string, JsonValue>
    if (typeof reference.relativePath !== 'string'
        || !reference.relativePath.startsWith(`${RESOURCE_DIRECTORY}/sha256-`)
        || typeof reference.mediaType !== 'string'
        || (reference.encoding !== 'data-url' && reference.encoding !== 'utf8')) {
        throw new QueueResourceError('E_QUEUE_RESOURCE_INVALID', 'Managed queue resource reference is invalid')
    }
    return reference as unknown as ManagedResourceReference
}

export class TauriQueueResourceStorage implements QueueResourceStorage {
    async ensureDirectory(): Promise<void> {
        await mkdir(RESOURCE_DIRECTORY, { baseDir: BaseDirectory.AppData, recursive: true })
    }

    exists(relativePath: string): Promise<boolean> {
        return exists(relativePath, { baseDir: BaseDirectory.AppData })
    }

    read(relativePath: string): Promise<Uint8Array> {
        return readFile(relativePath, { baseDir: BaseDirectory.AppData })
    }

    async write(relativePath: string, bytes: Uint8Array): Promise<void> {
        await this.ensureDirectory()
        const temp = `${relativePath}.tmp-${globalThis.crypto.randomUUID()}`
        try {
            await writeFile(temp, bytes, { baseDir: BaseDirectory.AppData })
            if (await exists(relativePath, { baseDir: BaseDirectory.AppData })) {
                await remove(temp, { baseDir: BaseDirectory.AppData })
                return
            }
            try {
                await rename(temp, relativePath, {
                    oldPathBaseDir: BaseDirectory.AppData,
                    newPathBaseDir: BaseDirectory.AppData,
                })
            } catch (error) {
                // Another Main/Scene planner may win the same content-addressed
                // path between exists() and rename(). The caller verifies the
                // winning bytes by digest before accepting the resource.
                if (!await exists(relativePath, { baseDir: BaseDirectory.AppData })) throw error
                await remove(temp, { baseDir: BaseDirectory.AppData })
            }
        } catch (error) {
            if (await exists(temp, { baseDir: BaseDirectory.AppData }).catch(() => false)) {
                await remove(temp, { baseDir: BaseDirectory.AppData }).catch(() => undefined)
            }
            throw error
        }
    }
}

export class QueueResourceMaterializer {
    constructor(
        private readonly storage: QueueResourceStorage = new TauriQueueResourceStorage(),
        private readonly now: () => string = () => new Date().toISOString(),
    ) {}

    materializeDataUrl(value: string, role: SnapshotResourceRole): Promise<MaterializedQueueResource> {
        const decoded = decodeDataUrl(value)
        return this.materialize(decoded.bytes, role, decoded.mediaType, 'data-url')
    }

    materializeText(value: string, role: SnapshotResourceRole): Promise<MaterializedQueueResource> {
        return this.materialize(
            new TextEncoder().encode(value),
            role,
            'application/x-nais-encoded-vibe',
            'utf8',
        )
    }

    private async materialize(
        bytes: Uint8Array,
        role: SnapshotResourceRole,
        mediaType: string,
        encoding: ManagedResourceReference['encoding'],
    ): Promise<MaterializedQueueResource> {
        const digest = await hashQueueResourceBytes(bytes)
        const digestHex = digest.slice('sha256:'.length)
        const relativePath = `${RESOURCE_DIRECTORY}/sha256-${digestHex}.bin`
        const reference: ManagedResourceReference = { relativePath, mediaType, encoding }
        await this.storage.ensureDirectory()
        if (!await this.storage.exists(relativePath)) await this.storage.write(relativePath, bytes)
        const persisted = await this.storage.read(relativePath)
        if (await hashQueueResourceBytes(persisted) !== digest) {
            throw new QueueResourceError(
                'E_QUEUE_RESOURCE_DIGEST_MISMATCH',
                'Managed queue resource failed digest verification',
            )
        }
        const timestamp = this.now()
        const resourceId = `resource:${digestHex}`
        return {
            snapshotResource: {
                resourceId,
                role,
                persistence: 'managed-app-data',
                digest,
                reference: reference as unknown as JsonValue,
            },
            record: {
                id: resourceId,
                persistence: 'managed-app-data',
                digest,
                reference: reference as unknown as JsonValue,
                availability: 'available',
                createdAt: timestamp,
                updatedAt: timestamp,
            },
        }
    }

    async read(resource: GenerationSnapshotResource): Promise<string> {
        const reference = parseReference(resource.reference)
        if (!await this.storage.exists(reference.relativePath)) {
            throw new QueueResourceError('E_QUEUE_RESOURCE_MISSING', 'Managed queue resource is missing')
        }
        const bytes = await this.storage.read(reference.relativePath)
        if (await hashQueueResourceBytes(bytes) !== resource.digest) {
            throw new QueueResourceError(
                'E_QUEUE_RESOURCE_DIGEST_MISMATCH',
                'Managed queue resource digest does not match its immutable snapshot',
            )
        }
        return reference.encoding === 'utf8'
            ? new TextDecoder().decode(bytes)
            : encodeDataUrl(reference.mediaType, bytes)
    }
}

export async function dehydrateGenerationParams(
    params: GenerationParams,
    materializer: QueueResourceMaterializer,
    cache?: QueueResourceMaterializationCache,
): Promise<DehydratedGenerationResult> {
    const candidate = { ...params } as GenerationParams & Record<string, unknown>
    delete candidate.sourceImage
    delete candidate.mask
    delete candidate.charImages
    delete candidate.vibeImages
    delete candidate.preEncodedVibes
    delete candidate.charCacheKeys
    delete candidate.sentPayloadSummary

    const resources: GenerationSnapshotResource[] = []
    const records = new Map<string, QueueResourceRecord>()
    const resourceBindings: ResourceBinding[] = []
    const resourceArrayLengths: Partial<Record<ResourceField, number>> = {}
    const cached = (
        key: string,
        create: () => Promise<MaterializedQueueResource>,
    ): Promise<MaterializedQueueResource> => {
        if (cache === undefined) return create()
        const existing = cache.get(key)
        if (existing !== undefined) return existing
        const pending = create().catch(error => {
            cache.delete(key)
            throw error
        })
        cache.set(key, pending)
        return pending
    }
    const add = async (
        materialized: Promise<MaterializedQueueResource>,
        field: ResourceField,
        index?: number,
    ) => {
        const value = await materialized
        resources.push(value.snapshotResource)
        records.set(value.record.id, value.record)
        resourceBindings.push({ resourceId: value.record.id, field, ...(index === undefined ? {} : { index }) })
    }

    if (params.sourceImage !== undefined) {
        await add(cached(
            `data-url:source:${params.sourceImage}`,
            () => materializer.materializeDataUrl(params.sourceImage as string, 'source'),
        ), 'sourceImage')
    }
    if (params.mask !== undefined) {
        await add(cached(
            `data-url:mask:${params.mask}`,
            () => materializer.materializeDataUrl(params.mask as string, 'mask'),
        ), 'mask')
    }
    if (params.charImages !== undefined) {
        resourceArrayLengths.charImages = params.charImages.length
        for (let index = 0; index < params.charImages.length; index += 1) {
            const value = params.charImages[index]
            await add(cached(
                `data-url:character-reference:${value}`,
                () => materializer.materializeDataUrl(value, 'character-reference'),
            ), 'charImages', index)
        }
    }
    if (params.vibeImages !== undefined) {
        resourceArrayLengths.vibeImages = params.vibeImages.length
        for (let index = 0; index < params.vibeImages.length; index += 1) {
            const value = params.vibeImages[index]
            await add(cached(
                `data-url:vibe-reference:${value}`,
                () => materializer.materializeDataUrl(value, 'vibe-reference'),
            ), 'vibeImages', index)
        }
    }
    if (params.preEncodedVibes !== undefined) {
        resourceArrayLengths.preEncodedVibes = params.preEncodedVibes.length
        for (let index = 0; index < params.preEncodedVibes.length; index += 1) {
            const value = params.preEncodedVibes[index]
            if (value !== null) {
                await add(cached(
                    `text:vibe-reference:${value}`,
                    () => materializer.materializeText(value, 'vibe-reference'),
                ), 'preEncodedVibes', index)
            }
        }
    }

    const generationParams = JSON.parse(JSON.stringify(candidate)) as JsonValue
    return {
        parameters: { generationParams, resourceBindings, resourceArrayLengths },
        resources,
        records: [...records.values()],
    }
}

export async function hydrateGenerationParams(
    parameters: DehydratedGenerationParameters,
    resources: readonly GenerationSnapshotResource[],
    materializer: QueueResourceMaterializer,
): Promise<GenerationParams> {
    if (typeof parameters.generationParams !== 'object'
        || parameters.generationParams === null
        || Array.isArray(parameters.generationParams)) {
        throw new QueueResourceError('E_QUEUE_RESOURCE_INVALID', 'Queue generation parameters are invalid')
    }
    const result = structuredClone(parameters.generationParams) as unknown as GenerationParams & Record<string, unknown>
    const mutableResult = result as unknown as Record<string, unknown>
    for (const [field, length] of Object.entries(parameters.resourceArrayLengths)) {
        if (length !== undefined) mutableResult[field] = Array.from({ length }, () => null)
    }
    for (const binding of parameters.resourceBindings) {
        const resource = resources.find(candidate => candidate.resourceId === binding.resourceId)
        if (resource === undefined) {
            throw new QueueResourceError('E_QUEUE_RESOURCE_MISSING', 'Queue resource binding is missing')
        }
        const value = await materializer.read(resource)
        if (binding.index === undefined) {
            mutableResult[binding.field] = value
        } else {
            const values = mutableResult[binding.field]
            if (!Array.isArray(values)) {
                throw new QueueResourceError('E_QUEUE_RESOURCE_INVALID', 'Queue resource array binding is invalid')
            }
            values[binding.index] = value
        }
    }
    return result as GenerationParams
}

let runtimeMaterializer: QueueResourceMaterializer | null = null

export function getRuntimeQueueResourceMaterializer(): QueueResourceMaterializer {
    runtimeMaterializer ??= new QueueResourceMaterializer()
    return runtimeMaterializer
}
