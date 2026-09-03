import { isR2BucketName, normalizeR2Prefix } from '@/domain/r2/types'

export const DEFAULT_GENERATION_FOLDER_ID = 'generation-folder-default'
export const MAX_GENERATION_FOLDER_NAME_LENGTH = 96
/** Rotation output gets one stable parent without changing explicit flat destinations. */
export const CHARACTER_SCENES_DIRECTORY_NAME = 'Character_Scenes'

export interface GenerationFolderR2Policy {
    readonly autoUpload: boolean
    /** null inherits the closest parent override, then the saved R2 profile. */
    readonly bucket: string | null
    /** null derives from the closest parent prefix, then the saved R2 profile. */
    readonly prefix: string | null
}

export interface GenerationFolder {
    readonly schemaVersion: 1
    readonly id: string
    readonly name: string
    readonly parentId: string | null
    /** Only a root folder owns the local directory authority. */
    readonly rootDirectory: string | null
    readonly useAbsolutePath: boolean
    readonly commonPrompt: string
    readonly r2: GenerationFolderR2Policy
    readonly createdAt: string
    readonly updatedAt: string
}

export interface ResolvedGenerationFolder {
    readonly id: string
    readonly path: string
    readonly directory: string
    readonly useAbsolutePath: boolean
    readonly commonPrompt: string
    readonly r2: {
        readonly autoUpload: boolean
        readonly bucket: string | null
        readonly prefix: string
        readonly prefixSource: 'folder' | 'ancestor' | 'profile'
    }
}

export interface GenerationFolderSelection {
    readonly folder: ResolvedGenerationFolder
    readonly r2Ready: boolean
}

/** Legacy Zustand fields needed to reproduce V1 folder hydration and resolution. */
export interface GenerationFolderV1Projection {
    readonly savePath: string
    readonly useAbsolutePath: boolean
    readonly generationFolders: GenerationFolder[]
    readonly activeGenerationFolderId: string
}

export interface GenerationFolderDefaults {
    readonly directory: string
    readonly useAbsolutePath: boolean
    readonly r2Bucket?: string | null
    readonly r2Prefix?: string | null
}

function boundedText(value: string, maximum: number): boolean {
    return value.length > 0
        && value.length <= maximum
        && value.trim() === value
        && !/[\u0000-\u001f\u007f]/u.test(value)
}

export function isGenerationFolderName(value: unknown): value is string {
    return typeof value === 'string'
        && boundedText(value, MAX_GENERATION_FOLDER_NAME_LENGTH)
        && value !== '.'
        && value !== '..'
        && !/[<>:"/\\|?*]/u.test(value)
}

export function createDefaultGenerationFolder(
    directory = 'NAI_Blue_Output',
    useAbsolutePath = false,
    now = new Date().toISOString(),
): GenerationFolder {
    return {
        schemaVersion: 1,
        id: DEFAULT_GENERATION_FOLDER_ID,
        name: '기본 출력',
        parentId: null,
        rootDirectory: directory.trim() || 'NAI_Blue_Output',
        useAbsolutePath,
        commonPrompt: '',
        r2: { autoUpload: false, bucket: null, prefix: null },
        createdAt: now,
        updatedAt: now,
    }
}

/**
 * Projects unknown V1 settings through the same legacy save-path authority used
 * by Zustand hydration, without introducing a new persisted document or write.
 */
export function normalizeGenerationFolderV1Projection(value: unknown): GenerationFolderV1Projection {
    const persisted = typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {}
    const savePath = typeof persisted.savePath === 'string' && persisted.savePath.trim()
        ? persisted.savePath
        : 'NAI_Blue_Output'
    const useAbsolutePath = typeof persisted.useAbsolutePath === 'boolean'
        ? persisted.useAbsolutePath
        : false
    const validFolders = Array.isArray(persisted.generationFolders)
        ? persisted.generationFolders.filter(isGenerationFolder)
        : []
    const hasDefaultFolder = validFolders.some(folder => folder.id === DEFAULT_GENERATION_FOLDER_ID)
    const generationFolders = (hasDefaultFolder
        ? validFolders
        : [createDefaultGenerationFolder(savePath, useAbsolutePath), ...validFolders])
        .map(folder => folder.id === DEFAULT_GENERATION_FOLDER_ID
            ? { ...folder, rootDirectory: savePath, useAbsolutePath }
            : folder)
    const activeGenerationFolderId = typeof persisted.activeGenerationFolderId === 'string'
        && generationFolders.some(folder => folder.id === persisted.activeGenerationFolderId)
        ? persisted.activeGenerationFolderId
        : DEFAULT_GENERATION_FOLDER_ID

    return { savePath, useAbsolutePath, generationFolders, activeGenerationFolderId }
}

function folderChain(folders: readonly GenerationFolder[], folderId: string): GenerationFolder[] | null {
    const byId = new Map(folders.map(folder => [folder.id, folder]))
    const visited = new Set<string>()
    const chain: GenerationFolder[] = []
    let current = byId.get(folderId)
    while (current) {
        if (visited.has(current.id)) return null
        visited.add(current.id)
        chain.unshift(current)
        current = current.parentId === null ? undefined : byId.get(current.parentId)
        if (chain[0]?.parentId !== null && current === undefined) return null
    }
    return chain.length === 0 ? null : chain
}

function appendLocalPath(root: string, segments: readonly string[]): string {
    const base = root.replace(/[\\/]+$/u, '')
    const separator = base.includes('\\') && !base.includes('/') ? '\\' : '/'
    return [base, ...segments].filter(Boolean).join(separator)
}

function joinR2Prefix(...parts: Array<string | null | undefined>): string {
    return parts
        .flatMap(part => normalizeR2Prefix(part)?.split('/') ?? [])
        .join('/')
}

export function resolveGenerationFolder(
    folders: readonly GenerationFolder[],
    folderId: string | null | undefined,
    defaults: GenerationFolderDefaults,
): ResolvedGenerationFolder | null {
    if (!folderId) return null
    const chain = folderChain(folders, folderId)
    if (chain === null) return null
    const selected = chain[chain.length - 1]
    const root = chain[0]
    const rootDirectory = root.rootDirectory?.trim() || defaults.directory.trim() || 'NAI_Blue_Output'
    const childNames = chain.slice(1).map(folder => folder.name)

    let bucket = defaults.r2Bucket?.trim() || null
    for (const folder of chain) {
        if (folder.r2.bucket?.trim()) bucket = folder.r2.bucket.trim()
    }

    let explicitPrefixIndex = -1
    for (let index = 0; index < chain.length; index += 1) {
        if (normalizeR2Prefix(chain[index].r2.prefix) !== null) explicitPrefixIndex = index
    }
    const implicitPrefixNames = chain
        .filter(folder => folder.id !== DEFAULT_GENERATION_FOLDER_ID)
        .map(folder => folder.name)
    const prefix = explicitPrefixIndex >= 0
        ? joinR2Prefix(chain[explicitPrefixIndex].r2.prefix, ...chain.slice(explicitPrefixIndex + 1).map(folder => folder.name))
        : joinR2Prefix(defaults.r2Prefix, ...implicitPrefixNames)

    return {
        id: selected.id,
        path: chain.map(folder => folder.name).join(' / '),
        directory: appendLocalPath(rootDirectory, childNames),
        useAbsolutePath: root.useAbsolutePath,
        commonPrompt: selected.commonPrompt,
        r2: {
            autoUpload: selected.r2.autoUpload,
            bucket,
            prefix,
            prefixSource: explicitPrefixIndex === chain.length - 1
                ? 'folder'
                : explicitPrefixIndex >= 0
                    ? 'ancestor'
                    : 'profile',
        },
    }
}

export function generationFolderDescendantIds(
    folders: readonly GenerationFolder[],
    folderId: string,
): string[] {
    const descendants = new Set<string>()
    let changed = true
    while (changed) {
        changed = false
        for (const folder of folders) {
            if (folder.parentId === folderId || (folder.parentId !== null && descendants.has(folder.parentId))) {
                if (!descendants.has(folder.id)) {
                    descendants.add(folder.id)
                    changed = true
                }
            }
        }
    }
    return [...descendants]
}

export function isGenerationFolder(value: unknown): value is GenerationFolder {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const folder = value as Partial<GenerationFolder>
    if (folder.schemaVersion !== 1
        || typeof folder.id !== 'string'
        || !boundedText(folder.id, 128)
        || !isGenerationFolderName(folder.name)
        || (folder.parentId !== null && typeof folder.parentId !== 'string')
        || (folder.rootDirectory !== null && typeof folder.rootDirectory !== 'string')
        || typeof folder.useAbsolutePath !== 'boolean'
        || typeof folder.commonPrompt !== 'string'
        || folder.commonPrompt.length > 20_000
        || typeof folder.r2 !== 'object'
        || folder.r2 === null
        || typeof folder.r2.autoUpload !== 'boolean'
        || (folder.r2.bucket !== null && !isR2BucketName(folder.r2.bucket))
        || typeof folder.createdAt !== 'string'
        || typeof folder.updatedAt !== 'string') return false
    try {
        normalizeR2Prefix(folder.r2.prefix)
        return folder.r2.prefix === null || typeof folder.r2.prefix === 'string'
    } catch {
        return false
    }
}
