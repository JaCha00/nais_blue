import { isTauri } from '@tauri-apps/api/core'
import { BaseDirectory, exists, mkdir, readTextFile, rename, stat, writeTextFile } from '@tauri-apps/plugin-fs'
import {
    createDefaultAssetProfile,
    type AssetModuleProfile,
    type AssetProfile,
    type AssetProfileJsonRecord,
    type AssetProfileOutput,
    type AssetProfileR2,
    type AssetProfileUpdatedBy,
    type AssetRecipe,
    type AssetRecipeStep,
} from '@/types/asset-profile'

export const ASSET_PROFILE_BASE_DIR = BaseDirectory.AppData
export const ASSET_PROFILE_DIRECTORY = 'asset-profiles'
export const ASSET_PROFILE_FILE_NAME = 'default.json'
export const ASSET_PROFILE_FILE_PATH = `${ASSET_PROFILE_DIRECTORY}/${ASSET_PROFILE_FILE_NAME}`
export const ASSET_PROFILE_POLL_INTERVAL_MS = 800

export interface AssetProfileFileSnapshot {
    exists: boolean
    path: string
    profile: AssetProfile
    mtimeMs: number | null
    size: number | null
}

export interface SaveAssetProfileFileOptions {
    expectedRevision: number
    updatedBy?: AssetProfileUpdatedBy
    path?: string
}

export type SaveAssetProfileFileResult =
    | {
        status: 'saved'
        path: string
        profile: AssetProfile
        previousRevision: number | null
        mtimeMs: number | null
    }
    | {
        status: 'conflict'
        path: string
        conflictPath: string
        diskProfile: AssetProfile
        attemptedProfile: AssetProfile
        diskRevision: number
        expectedRevision: number
        mtimeMs: number | null
    }

export interface WatchAssetProfileFileOptions {
    intervalMs?: number
    path?: string
    onError?: (error: unknown) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asJsonRecord(value: unknown): AssetProfileJsonRecord {
    return isRecord(value) ? value as AssetProfileJsonRecord : {}
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined
}

function boolOr(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback
}

function revisionOr(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.floor(value))
        : fallback
}

function normalizeOutput(value: unknown): AssetProfileOutput {
    const record = isRecord(value) ? value : {}
    return {
        ...record,
        directory: optionalString(record.directory),
        filenameTemplate: optionalString(record.filenameTemplate),
        format: optionalString(record.format),
        metadataSidecar: typeof record.metadataSidecar === 'boolean' ? record.metadataSidecar : undefined,
        settings: record.settings === undefined ? undefined : asJsonRecord(record.settings),
    } as AssetProfileOutput
}

function normalizeR2(value: unknown): AssetProfileR2 {
    const record = isRecord(value) ? value : {}
    return {
        ...record,
        enabled: boolOr(record.enabled, false),
        bucket: optionalString(record.bucket),
        keyPrefix: optionalString(record.keyPrefix),
        publicBaseUrl: optionalString(record.publicBaseUrl),
        accountId: optionalString(record.accountId),
        metadata: record.metadata === undefined ? undefined : asJsonRecord(record.metadata),
    } as AssetProfileR2
}

function normalizeModule(id: string, value: unknown): AssetModuleProfile {
    const record = isRecord(value) ? value : {}
    return {
        ...record,
        id: optionalString(record.id) ?? id,
        enabled: boolOr(record.enabled, true),
        kind: optionalString(record.kind),
        label: optionalString(record.label),
        settings: asJsonRecord(record.settings),
        output: record.output === undefined ? undefined : normalizeOutput(record.output),
        r2: record.r2 === undefined ? undefined : normalizeR2(record.r2),
    } as AssetModuleProfile
}

function normalizeRecipeStep(value: unknown): AssetRecipeStep {
    const record = isRecord(value) ? value : {}
    return {
        ...record,
        moduleId: optionalString(record.moduleId) ?? '',
        enabled: typeof record.enabled === 'boolean' ? record.enabled : undefined,
        settings: record.settings === undefined ? undefined : asJsonRecord(record.settings),
    } as AssetRecipeStep
}

function normalizeRecipe(value: unknown, index: number): AssetRecipe {
    const record = isRecord(value) ? value : {}
    return {
        ...record,
        id: optionalString(record.id) ?? `recipe-${index + 1}`,
        enabled: boolOr(record.enabled, true),
        label: optionalString(record.label),
        steps: Array.isArray(record.steps) ? record.steps.map(normalizeRecipeStep) : [],
        settings: record.settings === undefined ? undefined : asJsonRecord(record.settings),
        output: record.output === undefined ? undefined : normalizeOutput(record.output),
        r2: record.r2 === undefined ? undefined : normalizeR2(record.r2),
    } as AssetRecipe
}

export function normalizeAssetProfile(value: unknown): AssetProfile {
    if (!isRecord(value)) {
        throw new Error('Asset profile JSON root must be an object.')
    }

    const modules: Record<string, AssetModuleProfile> = {}
    if (isRecord(value.modules)) {
        for (const [id, moduleValue] of Object.entries(value.modules)) {
            modules[id] = normalizeModule(id, moduleValue)
        }
    }

    return {
        ...value,
        revision: revisionOr(value.revision),
        updatedBy: optionalString(value.updatedBy) ?? 'agent',
        updatedAt: optionalString(value.updatedAt) ?? new Date().toISOString(),
        settings: asJsonRecord(value.settings),
        output: normalizeOutput(value.output),
        r2: normalizeR2(value.r2),
        modules,
        recipes: Array.isArray(value.recipes) ? value.recipes.map(normalizeRecipe) : [],
    } as AssetProfile
}

function serializeProfile(profile: AssetProfile): string {
    return `${JSON.stringify(profile, null, 2)}\n`
}

function stamp(d = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function normalizePath(path: string): string {
    return path.replace(/\\/g, '/')
}

function parentDir(path: string): string | null {
    const normalized = normalizePath(path)
    const slash = normalized.lastIndexOf('/')
    return slash > 0 ? normalized.slice(0, slash) : null
}

async function ensureParentDir(path: string): Promise<void> {
    const dir = parentDir(path)
    if (!dir) return
    if (!(await exists(dir, { baseDir: ASSET_PROFILE_BASE_DIR }))) {
        await mkdir(dir, { baseDir: ASSET_PROFILE_BASE_DIR, recursive: true })
    }
}

async function fileSnapshotInfo(path: string): Promise<Pick<AssetProfileFileSnapshot, 'mtimeMs' | 'size'>> {
    if (!isTauri() || !(await exists(path, { baseDir: ASSET_PROFILE_BASE_DIR }))) {
        return { mtimeMs: null, size: null }
    }

    const info = await stat(path, { baseDir: ASSET_PROFILE_BASE_DIR })
    return {
        mtimeMs: info.mtime?.getTime() ?? null,
        size: info.size,
    }
}

async function writeProfileAtomically(path: string, profile: AssetProfile): Promise<void> {
    await ensureParentDir(path)
    const tmpPath = `${path}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // The JSON file is the source of truth; write temp first, then rename so a
    // crash cannot leave a half-written canonical profile for the store to mirror.
    await writeTextFile(tmpPath, serializeProfile(profile), { baseDir: ASSET_PROFILE_BASE_DIR })
    await rename(tmpPath, path, {
        oldPathBaseDir: ASSET_PROFILE_BASE_DIR,
        newPathBaseDir: ASSET_PROFILE_BASE_DIR,
    })
}

function conflictPathFor(path: string, attempt: number): string {
    const normalized = normalizePath(path)
    const base = normalized.toLowerCase().endsWith('.json')
        ? normalized.slice(0, -5)
        : normalized
    const attemptSuffix = attempt === 0 ? '' : `-${attempt + 1}`
    return `${base}.conflict-${stamp()}${attemptSuffix}.json`
}

async function writeConflictProfile(path: string, profile: AssetProfile): Promise<string> {
    await ensureParentDir(path)

    for (let attempt = 0; attempt < 20; attempt += 1) {
        const conflictPath = conflictPathFor(path, attempt)
        try {
            await writeTextFile(conflictPath, serializeProfile(profile), {
                baseDir: ASSET_PROFILE_BASE_DIR,
                createNew: true,
            })
            return conflictPath
        } catch (error) {
            if (attempt === 19) throw error
        }
    }

    throw new Error('Failed to create an asset profile conflict file.')
}

export async function loadAssetProfileFile(options: { path?: string; createIfMissing?: boolean } = {}): Promise<AssetProfileFileSnapshot> {
    const path = options.path ?? ASSET_PROFILE_FILE_PATH

    if (!isTauri()) {
        return {
            exists: false,
            path,
            profile: createDefaultAssetProfile(),
            mtimeMs: null,
            size: null,
        }
    }

    const fileExists = await exists(path, { baseDir: ASSET_PROFILE_BASE_DIR })
    if (!fileExists) {
        const profile = createDefaultAssetProfile()
        if (options.createIfMissing) {
            await writeProfileAtomically(path, profile)
            const info = await fileSnapshotInfo(path)
            return { exists: true, path, profile, ...info }
        }
        return { exists: false, path, profile, mtimeMs: null, size: null }
    }

    const raw = await readTextFile(path, { baseDir: ASSET_PROFILE_BASE_DIR })
    const profile = normalizeAssetProfile(JSON.parse(raw))
    const info = await fileSnapshotInfo(path)
    return { exists: true, path, profile, ...info }
}

export async function saveAssetProfileFile(profile: AssetProfile, options: SaveAssetProfileFileOptions): Promise<SaveAssetProfileFileResult> {
    if (!isTauri()) {
        throw new Error('Asset profile files can only be saved inside the Tauri app.')
    }

    const path = options.path ?? ASSET_PROFILE_FILE_PATH
    const updatedBy = options.updatedBy ?? 'gui'
    const diskExists = await exists(path, { baseDir: ASSET_PROFILE_BASE_DIR })
    const diskSnapshot = diskExists ? await loadAssetProfileFile({ path }) : null
    const diskRevision = diskSnapshot?.profile.revision ?? null

    const attemptedProfile: AssetProfile = {
        ...profile,
        revision: options.expectedRevision + 1,
        updatedBy,
        updatedAt: new Date().toISOString(),
    }

    if (diskSnapshot && diskRevision !== options.expectedRevision) {
        const conflictDiskRevision = diskSnapshot.profile.revision
        const conflictPath = await writeConflictProfile(path, attemptedProfile)
        return {
            status: 'conflict',
            path,
            conflictPath,
            diskProfile: diskSnapshot.profile,
            attemptedProfile,
            diskRevision: conflictDiskRevision,
            expectedRevision: options.expectedRevision,
            mtimeMs: diskSnapshot.mtimeMs,
        }
    }

    await writeProfileAtomically(path, attemptedProfile)
    const info = await fileSnapshotInfo(path)
    return {
        status: 'saved',
        path,
        profile: attemptedProfile,
        previousRevision: diskRevision,
        mtimeMs: info.mtimeMs,
    }
}

export async function getAssetProfileFileFingerprint(path = ASSET_PROFILE_FILE_PATH): Promise<string> {
    if (!isTauri()) return 'not-tauri'
    if (!(await exists(path, { baseDir: ASSET_PROFILE_BASE_DIR }))) return 'missing'

    const info = await stat(path, { baseDir: ASSET_PROFILE_BASE_DIR })
    return `${info.mtime?.getTime() ?? 'no-mtime'}:${info.size}`
}

export function watchAssetProfileFile(
    onChange: (snapshot: AssetProfileFileSnapshot) => void | Promise<void>,
    options: WatchAssetProfileFileOptions = {},
): () => void {
    if (!isTauri()) return () => undefined

    const path = options.path ?? ASSET_PROFILE_FILE_PATH
    const intervalMs = options.intervalMs ?? ASSET_PROFILE_POLL_INTERVAL_MS
    let stopped = false
    let timer: number | null = null
    let lastFingerprint: string | null = null

    const tick = async () => {
        if (stopped) return

        try {
            const nextFingerprint = await getAssetProfileFileFingerprint(path)
            if (lastFingerprint === null) {
                lastFingerprint = nextFingerprint
            } else if (nextFingerprint !== lastFingerprint) {
                lastFingerprint = nextFingerprint
                await onChange(await loadAssetProfileFile({ path }))
            }
        } catch (error) {
            options.onError?.(error)
        } finally {
            if (!stopped) {
                timer = window.setTimeout(() => {
                    void tick()
                }, intervalMs)
            }
        }
    }

    void tick()

    return () => {
        stopped = true
        if (timer) {
            window.clearTimeout(timer)
            timer = null
        }
    }
}
