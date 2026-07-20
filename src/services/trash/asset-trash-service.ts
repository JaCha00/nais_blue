import { copyFile, exists, mkdir, remove, rename } from '@tauri-apps/plugin-fs'
import { dirname, join } from '@tauri-apps/api/path'
import { getMediaStorageRoot } from '@/platform/storage'
import { useLibraryStore, type LibraryItem } from '@/stores/library-store'
import { useSceneStore, type SceneCard, type SceneImage, type ScenePreset } from '@/stores/scene-store'
import { publishGeneratedArtifact } from '@/stores/artifact-lifecycle-store'
import {
    makeTrashItemId,
    trashExpiryAt,
    type TrashItem,
    type TrashedImage,
    type TrashedImageRestoreTarget,
} from '@/stores/trash-store'

const TRASH_DIRECTORY_NAME = 'NAIS_Trash'

interface ImageArchiveInput {
    image: SceneImage
    fallbackName: string
}

export interface TrashRemovalResult {
    success: boolean
    failedPaths: string[]
}

export interface TrashRestoreResult {
    success: boolean
    /** Existing destination paths or store identities that were deliberately not overwritten. */
    conflictPaths: string[]
    /** Missing, locked, or otherwise unavailable files. The trash journal remains on every failure. */
    failedPaths: string[]
}

export interface SceneImageArchiveSource {
    presetId: string
    presetName: string
    sceneId: string
    sceneName: string
}

function filenameFromPath(path: string, fallbackName: string): string {
    const filename = path.split(/[\\/]/).pop()?.trim()
    return filename && filename.length > 0 ? filename : `${fallbackName}.png`
}

function fileSafeName(value: string): string {
    return value.replace(/[<>:"/\\|?*]/g, '_').trim() || 'image.png'
}

async function trashItemDirectory(itemId: string): Promise<string> {
    const root = await getMediaStorageRoot()
    const directory = await join(root, TRASH_DIRECTORY_NAME, itemId)
    await mkdir(directory, { recursive: true })
    return directory
}

/**
 * Depends on Tauri's move/copy primitives and supplies paths used by the
 * persisted trash store. A rename keeps files recoverable without duplicating
 * disk usage; the copy/remove fallback covers output folders on another volume.
 */
async function archiveImageFile(
    image: SceneImage,
    itemDirectory: string,
    sequence: number,
    fallbackName: string,
): Promise<TrashedImage> {
    const originalUrl = image.url
    if (originalUrl.startsWith('data:') || originalUrl.startsWith('memory:')) {
        return { ...image, originalUrl }
    }

    const destination = await join(
        itemDirectory,
        `${String(sequence).padStart(3, '0')}-${fileSafeName(filenameFromPath(originalUrl, fallbackName))}`,
    )

    try {
        await rename(originalUrl, destination)
        return { ...image, url: destination, originalUrl }
    } catch (renameError) {
        try {
            await copyFile(originalUrl, destination)
            await remove(originalUrl)
            return { ...image, url: destination, originalUrl }
        } catch (copyError) {
            // Keeping the original is deliberately safer than deleting it when a
            // sandboxed or external path cannot be moved. The trash UI exposes it.
            console.warn('[Trash] Could not move image into trash:', { originalUrl, renameError, copyError })
            return { ...image, originalUrl, retainedAtOriginalPath: true }
        }
    }
}

async function archiveImages(
    itemId: string,
    inputs: readonly ImageArchiveInput[],
): Promise<TrashedImage[]> {
    const needsDirectory = inputs.some(({ image }) => !image.url.startsWith('data:') && !image.url.startsWith('memory:'))
    const directory = needsDirectory ? await trashItemDirectory(itemId) : ''
    const archived: TrashedImage[] = []
    for (let index = 0; index < inputs.length; index += 1) {
        const input = inputs[index]
        archived.push(await archiveImageFile(input.image, directory, index, input.fallbackName))
    }
    return archived
}

function createBaseItem(id: string, title: string) {
    const deletedAt = Date.now()
    return { id, title, deletedAt, expiresAt: trashExpiryAt(deletedAt) }
}

export async function archiveSceneImage(
    image: SceneImage,
    source: 'scene' | 'library' | 'history',
    title: string,
    restoreTarget?: TrashedImageRestoreTarget,
): Promise<TrashItem> {
    const id = makeTrashItemId()
    const [archived] = await archiveImages(id, [{ image, fallbackName: title }])
    return {
        ...createBaseItem(id, title),
        kind: 'image',
        source,
        image: restoreTarget ? { ...archived, restoreTarget } : archived,
    }
}

export async function archiveSceneImages(
    images: readonly SceneImage[],
    source: SceneImageArchiveSource,
): Promise<TrashItem[]> {
    const items: TrashItem[] = []
    for (const image of images) {
        items.push(await archiveSceneImage(image, 'scene', `${source.sceneName} 이미지`, { scene: source }))
    }
    return items
}

/**
 * Depends on a caller-owned SceneStore commit and intentionally archives one
 * Scene at a time. A later failure therefore cannot leave an already-moved
 * image in a still-visible source Scene; callers receive the exact retry set.
 */
export async function archiveScenesIndividually(
    scenes: readonly SceneCard[],
    preset: ScenePreset,
    onArchived: (item: TrashItem) => void,
    onRemoveSource: (sceneId: string) => void,
): Promise<{ archivedSceneIds: string[]; failedSceneIds: string[] }> {
    const archivedSceneIds: string[] = []
    const failedSceneIds: string[] = []
    for (const scene of scenes) {
        try {
            const trashItem = await archiveScene(scene, preset)
            onArchived(trashItem)
            onRemoveSource(scene.id)
            archivedSceneIds.push(scene.id)
        } catch (error) {
            console.error('[Trash] Failed to archive Scene:', { sceneId: scene.id, error })
            failedSceneIds.push(scene.id)
        }
    }
    return { archivedSceneIds, failedSceneIds }
}

export async function archiveScene(scene: SceneCard, preset: ScenePreset): Promise<TrashItem> {
    const id = makeTrashItemId()
    const images = await archiveImages(id, scene.images.map(image => ({ image, fallbackName: scene.name })))
    const { scenes: _scenes, ...presetSnapshot } = preset
    return {
        ...createBaseItem(id, scene.name),
        kind: 'scene',
        scene: {
            preset: presetSnapshot,
            scene: { ...scene, images },
        },
    }
}

function clonePresetWithoutImages(preset: ScenePreset, imagesByScene: Map<string, TrashedImage[]>) {
    return {
        ...preset,
        scenes: preset.scenes.map(scene => ({ ...scene, images: imagesByScene.get(scene.id) ?? [] })),
    }
}

/**
 * Depends on the Scene folder parentId tree and is called before SceneStore's
 * cascade deletion. It archives every descendant's image snapshot first, so a
 * folder entry can still display the same nested scenes after the source branch is removed.
 */
export async function archiveSceneFolder(rootPresetId: string, presets: readonly ScenePreset[]): Promise<TrashItem | null> {
    const root = presets.find(preset => preset.id === rootPresetId)
    if (!root) return null

    const branchIds = new Set([rootPresetId])
    let changed = true
    while (changed) {
        changed = false
        presets.forEach(preset => {
            if (preset.parentId && branchIds.has(preset.parentId) && !branchIds.has(preset.id)) {
                branchIds.add(preset.id)
                changed = true
            }
        })
    }

    const branch = presets.filter(preset => branchIds.has(preset.id))
    const id = makeTrashItemId()
    const inputs = branch.flatMap(preset => preset.scenes.flatMap(scene => scene.images.map(image => ({
        image,
        fallbackName: `${preset.name}-${scene.name}`,
        sceneId: scene.id,
    }))))
    const archived = await archiveImages(id, inputs)
    const imagesByScene = new Map<string, TrashedImage[]>()
    archived.forEach((image, index) => {
        const sceneId = inputs[index]?.sceneId
        if (!sceneId) return
        imagesByScene.set(sceneId, [...(imagesByScene.get(sceneId) ?? []), image])
    })

    return {
        ...createBaseItem(id, root.name),
        kind: 'folder',
        folder: {
            rootPresetId,
            presets: branch.map(preset => clonePresetWithoutImages(preset, imagesByScene)),
        },
    }
}

function cloneLibraryItem(item: LibraryItem): LibraryItem {
    return {
        ...item,
        ...(item.stackItems ? { stackItems: item.stackItems.map(cloneLibraryItem) } : {}),
    }
}

function flattenLibraryItems(items: readonly LibraryItem[]): LibraryItem[] {
    return items.flatMap(item => item.stackItems?.length
        ? flattenLibraryItems(item.stackItems)
        : [item])
}

/** Archives library files while retaining stack relationships for the trash detail explorer. */
export async function archiveLibraryItems(items: readonly LibraryItem[], sourceStackId: string | null): Promise<TrashItem> {
    const id = makeTrashItemId()
    const copied = items.map(cloneLibraryItem)
    const flatItems = flattenLibraryItems(copied)
    const originalPaths = Object.fromEntries(flatItems.map(item => [item.id, item.path]))
    const imageInputs: ImageArchiveInput[] = flatItems.map(item => ({
        image: { id: item.id, url: item.path, timestamp: item.createdAt, isFavorite: false },
        fallbackName: item.name,
    }))
    const archived = await archiveImages(id, imageInputs)
    const archivedPathById = new Map(archived.map(image => [image.id, image.url]))
    const applyPaths = (item: LibraryItem): LibraryItem => {
        const stackItems = item.stackItems?.map(applyPaths)
        return {
            ...item,
            // Stack cards borrow their first child thumbnail; this keeps the
            // explorer preview valid after the leaf files are moved to trash.
            path: archivedPathById.get(item.id) ?? stackItems?.[0]?.path ?? item.path,
            ...(stackItems ? { stackItems } : {}),
        }
    }

    return {
        ...createBaseItem(id, items.length === 1 ? items[0].name : `${items.length}개 라이브러리 이미지`),
        kind: 'library',
        library: { items: copied.map(applyPaths), sourceStackId, originalPaths },
    }
}

interface FileRestoreOperation {
    archivedPath: string
    originalPath: string
    retainedAtOriginalPath?: boolean
}

interface DomainRestorePlan {
    conflictPaths: string[]
    apply: () => void
}

const isVirtualImagePath = (path: string): boolean => path.startsWith('data:') || path.startsWith('memory:')

function toRestoredSceneImage(image: TrashedImage): SceneImage {
    const { originalUrl, retainedAtOriginalPath: _retainedAtOriginalPath, restoreTarget: _restoreTarget, ...restored } = image
    return { ...restored, url: originalUrl }
}

function collectTrashedImages(item: Exclude<TrashItem, { kind: 'library' }>): TrashedImage[] {
    if (item.kind === 'image') return [item.image]
    if (item.kind === 'scene') return item.scene.scene.images
    return item.folder.presets.flatMap(preset => preset.scenes.flatMap(scene => scene.images))
}

function collectFileRestoreOperations(item: TrashItem): FileRestoreOperation[] {
    if (item.kind !== 'library') {
        return collectTrashedImages(item).map(image => ({
            archivedPath: image.url,
            originalPath: image.originalUrl,
            retainedAtOriginalPath: image.retainedAtOriginalPath,
        }))
    }
    return flattenLibraryItems(item.library.items).map(libraryItem => ({
        archivedPath: libraryItem.path,
        originalPath: item.library.originalPaths?.[libraryItem.id] ?? '',
    }))
}

async function moveFileSafely(source: string, destination: string): Promise<void> {
    const destinationDirectory = await dirname(destination)
    await mkdir(destinationDirectory, { recursive: true })
    try {
        await rename(source, destination)
        return
    } catch (renameError) {
        try {
            await copyFile(source, destination)
            await remove(source)
        } catch (copyError) {
            // A copied destination with an undeleted source is not a completed
            // move. Best-effort cleanup preserves the all-or-nothing restore
            // rule before the caller exposes a restored store record.
            try {
                if (await exists(destination)) await remove(destination)
            } catch (cleanupError) {
                console.warn('[Trash] Failed to clean partial restore copy:', { destination, cleanupError })
            }
            throw new Error(`Could not move ${source} to ${destination}: ${String(renameError)}; ${String(copyError)}`)
        }
    }
}

/**
 * Depends on paths captured by the archive service and precedes every store
 * mutation. It rejects a destination that already exists, then rolls back any
 * earlier moves on a later error so a retained journal always describes one
 * recoverable state instead of a half-restored asset.
 */
async function restoreArchivedFiles(item: TrashItem): Promise<{
    success: boolean
    conflictPaths: string[]
    failedPaths: string[]
    rollback: () => Promise<void>
}> {
    const operations = collectFileRestoreOperations(item)
    const conflictPaths: string[] = []
    const failedPaths: string[] = []

    for (const operation of operations) {
        if (!operation.originalPath) {
            failedPaths.push(operation.archivedPath)
            continue
        }
        if (isVirtualImagePath(operation.archivedPath) || isVirtualImagePath(operation.originalPath)) continue
        if (operation.retainedAtOriginalPath) {
            if (!await exists(operation.originalPath)) failedPaths.push(operation.originalPath)
            continue
        }
        if (operation.archivedPath === operation.originalPath) continue
        if (await exists(operation.originalPath)) conflictPaths.push(operation.originalPath)
        else if (!await exists(operation.archivedPath)) failedPaths.push(operation.archivedPath)
    }

    if (conflictPaths.length > 0 || failedPaths.length > 0) {
        return { success: false, conflictPaths, failedPaths, rollback: async () => undefined }
    }

    const moved: FileRestoreOperation[] = []
    const rollback = async () => {
        for (const operation of [...moved].reverse()) {
            try {
                await moveFileSafely(operation.originalPath, operation.archivedPath)
            } catch (error) {
                console.warn('[Trash] Failed to roll back partial restore:', { operation, error })
            }
        }
    }

    try {
        for (const operation of operations) {
            if (isVirtualImagePath(operation.archivedPath) || isVirtualImagePath(operation.originalPath)
                || operation.retainedAtOriginalPath || operation.archivedPath === operation.originalPath) continue
            await moveFileSafely(operation.archivedPath, operation.originalPath)
            moved.push(operation)
        }
        return { success: true, conflictPaths: [], failedPaths: [], rollback }
    } catch (error) {
        console.warn('[Trash] Failed to restore archived file:', error)
        await rollback()
        return {
            success: false,
            conflictPaths: [],
            failedPaths: [error instanceof Error ? error.message : String(error)],
            rollback: async () => undefined,
        }
    }
}

function allSceneIds(presets: readonly ScenePreset[]): Set<string> {
    return new Set(presets.flatMap(preset => preset.scenes.map(scene => scene.id)))
}

function allSceneImageIds(presets: readonly ScenePreset[]): Set<string> {
    return new Set(presets.flatMap(preset => preset.scenes.flatMap(scene => scene.images.map(image => image.id))))
}

function makeRecoveredScene(id: string, name: string, image: SceneImage): SceneCard {
    return {
        id,
        name,
        scenePrompt: '',
        queueCount: 0,
        images: [image],
        createdAt: image.timestamp || Date.now(),
    }
}

function sceneNameConflict(preset: ScenePreset, sceneName: string): boolean {
    return preset.scenes.some(scene => scene.name === sceneName)
}

function prepareSingleSceneImageRestore(item: Extract<TrashItem, { kind: 'image' }>): DomainRestorePlan {
    if (item.source === 'history') {
        return {
            conflictPaths: [],
            apply: () => {
                // Disk-backed History items return via its directory scan. A
                // memory-only History item has no file to scan, so republish it
                // through the existing transient History delivery channel.
                useSceneStore.getState().triggerHistoryRefresh()
                if (item.image.restoreTarget?.historyPath?.startsWith('memory:') && item.image.originalUrl.startsWith('data:')) {
                    publishGeneratedArtifact({
                        path: item.image.restoreTarget.historyPath,
                        data: item.image.originalUrl,
                    })
                }
            },
        }
    }

    if (item.source === 'library') {
        const libraryIds = collectLibraryIds(useLibraryStore.getState().items)
        return {
            conflictPaths: libraryIds.has(item.image.id) ? [`library-id:${item.image.id}`] : [],
            // Legacy single-library journals did not carry stack dimensions or
            // placement. Restoring a conservative top-level card is preferable
            // to stranding an otherwise intact original file in the trash.
            apply: () => useLibraryStore.setState(state => ({
                items: [{
                    id: item.image.id,
                    name: item.title,
                    path: item.image.originalUrl,
                    width: 0,
                    height: 0,
                    createdAt: item.image.timestamp,
                }, ...state.items],
            })),
        }
    }

    const target = item.image.restoreTarget?.scene
    const restoredImage = toRestoredSceneImage(item.image)
    const sceneState = useSceneStore.getState()
    const presets = sceneState.presets
    const imageIds = allSceneImageIds(presets)
    if (imageIds.has(restoredImage.id)) {
        return { conflictPaths: [`scene-image-id:${restoredImage.id}`], apply: () => undefined }
    }

    // Older journals lacked owner ids. A dedicated fallback avoids losing a
    // restorable file while making the non-original destination obvious.
    const fallbackTarget = target ?? {
        presetId: `restored-preset-${item.id}`,
        presetName: '복구된 씬',
        sceneId: `restored-scene-${item.id}`,
        sceneName: item.title || '복구된 이미지',
    }
    const preset = presets.find(candidate => candidate.id === fallbackTarget.presetId)
    if (preset && preset.name !== fallbackTarget.presetName) {
        return { conflictPaths: [`scene-preset-id:${fallbackTarget.presetId}`], apply: () => undefined }
    }
    const conflictingPresetName = presets.find(candidate => candidate.id !== fallbackTarget.presetId && candidate.name === fallbackTarget.presetName)
    if (conflictingPresetName) {
        return { conflictPaths: [`scene-preset-name:${fallbackTarget.presetName}`], apply: () => undefined }
    }
    const targetScene = preset?.scenes.find(candidate => candidate.id === fallbackTarget.sceneId)
    if (targetScene && targetScene.name !== fallbackTarget.sceneName) {
        return { conflictPaths: [`scene-id:${fallbackTarget.sceneId}`], apply: () => undefined }
    }
    if (!targetScene && preset && sceneNameConflict(preset, fallbackTarget.sceneName)) {
        return { conflictPaths: [`scene-name:${fallbackTarget.sceneName}`], apply: () => undefined }
    }
    if (!targetScene && allSceneIds(presets).has(fallbackTarget.sceneId)) {
        return { conflictPaths: [`scene-id:${fallbackTarget.sceneId}`], apply: () => undefined }
    }

    return {
        conflictPaths: [],
        apply: () => {
            useSceneStore.setState(state => {
                const currentPreset = state.presets.find(candidate => candidate.id === fallbackTarget.presetId)
                if (!currentPreset) {
                    return {
                        presets: [...state.presets, {
                            id: fallbackTarget.presetId,
                            name: fallbackTarget.presetName,
                            parentId: null,
                            scenes: [makeRecoveredScene(fallbackTarget.sceneId, fallbackTarget.sceneName, restoredImage)],
                            createdAt: Date.now(),
                        }],
                    }
                }
                return {
                    presets: state.presets.map(candidate => {
                        if (candidate.id !== fallbackTarget.presetId) return candidate
                        const currentScene = candidate.scenes.find(scene => scene.id === fallbackTarget.sceneId)
                        return currentScene
                            ? {
                                ...candidate,
                                scenes: candidate.scenes.map(scene => scene.id === fallbackTarget.sceneId
                                    ? { ...scene, images: [restoredImage, ...scene.images] }
                                    : scene),
                            }
                            : {
                                ...candidate,
                                scenes: [...candidate.scenes, makeRecoveredScene(fallbackTarget.sceneId, fallbackTarget.sceneName, restoredImage)],
                            }
                    }),
                }
            })
        },
    }
}

function prepareSceneRestore(item: Extract<TrashItem, { kind: 'scene' }>): DomainRestorePlan {
    const sceneState = useSceneStore.getState()
    const snapshot = item.scene
    const currentPreset = sceneState.presets.find(preset => preset.id === snapshot.preset.id)
    const conflicts: string[] = []
    if (currentPreset && currentPreset.name !== snapshot.preset.name) conflicts.push(`scene-preset-id:${snapshot.preset.id}`)
    if (!currentPreset && sceneState.presets.some(preset => preset.name === snapshot.preset.name)) conflicts.push(`scene-preset-name:${snapshot.preset.name}`)
    if (allSceneIds(sceneState.presets).has(snapshot.scene.id)) conflicts.push(`scene-id:${snapshot.scene.id}`)
    if (allSceneImageIds(sceneState.presets).size > 0) {
        const existingImageIds = allSceneImageIds(sceneState.presets)
        snapshot.scene.images.forEach(image => {
            if (existingImageIds.has(image.id)) conflicts.push(`scene-image-id:${image.id}`)
        })
    }
    if (currentPreset && sceneNameConflict(currentPreset, snapshot.scene.name)) conflicts.push(`scene-name:${snapshot.scene.name}`)

    return {
        conflictPaths: conflicts,
        apply: () => {
            const restoredScene: SceneCard = {
                ...snapshot.scene,
                images: snapshot.scene.images.map(toRestoredSceneImage),
            }
            useSceneStore.setState(state => {
                const preset = state.presets.find(candidate => candidate.id === snapshot.preset.id)
                if (preset) {
                    return {
                        presets: state.presets.map(candidate => candidate.id === snapshot.preset.id
                            ? { ...candidate, scenes: [...candidate.scenes, restoredScene] }
                            : candidate),
                    }
                }
                return {
                    presets: [...state.presets, {
                        ...snapshot.preset,
                        // A separately deleted parent can no longer be trusted.
                        // Rooting the recovered preset avoids creating an orphan.
                        parentId: snapshot.preset.parentId && state.presets.some(candidate => candidate.id === snapshot.preset.parentId)
                            ? snapshot.preset.parentId
                            : null,
                        scenes: [restoredScene],
                    }],
                }
            })
        },
    }
}

function prepareFolderRestore(item: Extract<TrashItem, { kind: 'folder' }>): DomainRestorePlan {
    const sceneState = useSceneStore.getState()
    const snapshotPresets = item.folder.presets
    const snapshotPresetIds = new Set(snapshotPresets.map(preset => preset.id))
    const snapshotSceneIds = new Set(snapshotPresets.flatMap(preset => preset.scenes.map(scene => scene.id)))
    const snapshotImageIds = new Set(snapshotPresets.flatMap(preset => preset.scenes.flatMap(scene => scene.images.map(image => image.id))))
    const conflicts: string[] = []
    const existingSceneIds = allSceneIds(sceneState.presets)
    const existingImageIds = allSceneImageIds(sceneState.presets)

    snapshotPresets.forEach(preset => {
        if (sceneState.presets.some(candidate => candidate.id === preset.id)) conflicts.push(`scene-preset-id:${preset.id}`)
        if (sceneState.presets.some(candidate => candidate.name === preset.name)) conflicts.push(`scene-preset-name:${preset.name}`)
    })
    snapshotSceneIds.forEach(sceneId => {
        if (existingSceneIds.has(sceneId)) conflicts.push(`scene-id:${sceneId}`)
    })
    snapshotImageIds.forEach(imageId => {
        if (existingImageIds.has(imageId)) conflicts.push(`scene-image-id:${imageId}`)
    })

    return {
        conflictPaths: conflicts,
        apply: () => {
            useSceneStore.setState(state => ({
                presets: [...state.presets, ...snapshotPresets.map(preset => ({
                    ...preset,
                    parentId: preset.parentId && (snapshotPresetIds.has(preset.parentId)
                        || state.presets.some(candidate => candidate.id === preset.parentId))
                        ? preset.parentId
                        : null,
                    scenes: preset.scenes.map(scene => ({
                        ...scene,
                        images: scene.images.map(toRestoredSceneImage),
                    })),
                }))],
            }))
        },
    }
}

function restoreLibraryItemPaths(item: LibraryItem, originalPaths: Record<string, string>): LibraryItem {
    const stackItems = item.stackItems?.map(stackItem => restoreLibraryItemPaths(stackItem, originalPaths))
    return {
        ...item,
        // Stack cards display their first child as the thumbnail. Their own
        // id has no physical leaf path, so rebuild that relationship after
        // children regain their original paths.
        path: originalPaths[item.id] ?? stackItems?.[0]?.path ?? item.path,
        ...(stackItems ? { stackItems } : {}),
    }
}

function collectLibraryIds(items: readonly LibraryItem[]): Set<string> {
    const ids = new Set<string>()
    const visit = (item: LibraryItem) => {
        ids.add(item.id)
        item.stackItems?.forEach(visit)
    }
    items.forEach(visit)
    return ids
}

function prepareLibraryRestore(item: Extract<TrashItem, { kind: 'library' }>): DomainRestorePlan {
    const libraryState = useLibraryStore.getState()
    const originalPaths = item.library.originalPaths
    const archivedLeaves = flattenLibraryItems(item.library.items)
    const missingOrigins = archivedLeaves
        .filter(libraryItem => !originalPaths?.[libraryItem.id])
        .map(libraryItem => libraryItem.path)
    if (missingOrigins.length > 0) {
        return { conflictPaths: [], apply: () => undefined }
    }
    const existingIds = collectLibraryIds(libraryState.items)
    const conflicts = [...collectLibraryIds(item.library.items)]
        .filter(id => existingIds.has(id))
        .map(id => `library-id:${id}`)
    const sourceStack = item.library.sourceStackId
        ? libraryState.items.find(libraryItem => libraryItem.id === item.library.sourceStackId)
        : undefined
    if (item.library.sourceStackId && (!sourceStack || !sourceStack.isStack)) {
        conflicts.push(`library-stack:${item.library.sourceStackId}`)
    }
    const restoredItems = item.library.items.map(libraryItem => restoreLibraryItemPaths(libraryItem, originalPaths))

    return {
        conflictPaths: conflicts,
        apply: () => {
            useLibraryStore.setState(state => {
                if (!item.library.sourceStackId) return { items: [...restoredItems, ...state.items] }
                return {
                    items: state.items.map(libraryItem => libraryItem.id === item.library.sourceStackId
                        ? { ...libraryItem, stackItems: [...(libraryItem.stackItems ?? []), ...restoredItems] }
                        : libraryItem),
                }
            })
        },
    }
}

function prepareDomainRestore(item: TrashItem): DomainRestorePlan {
    if (item.kind === 'image') return prepareSingleSceneImageRestore(item)
    if (item.kind === 'scene') return prepareSceneRestore(item)
    if (item.kind === 'folder') return prepareFolderRestore(item)
    return prepareLibraryRestore(item)
}

/**
 * Depends on the persisted journal plus Scene, Library, and History owners.
 * Files are returned first only after collision checks, then the matching
 * store snapshot is restored. The caller may delete the journal only when
 * this reports success; every failed branch remains visibly retryable.
 */
export async function restoreTrashItem(item: TrashItem): Promise<TrashRestoreResult> {
    const domainPlan = prepareDomainRestore(item)
    if (domainPlan.conflictPaths.length > 0) {
        return { success: false, conflictPaths: domainPlan.conflictPaths, failedPaths: [] }
    }

    const fileResult = await restoreArchivedFiles(item)
    if (!fileResult.success) {
        return {
            success: false,
            conflictPaths: fileResult.conflictPaths,
            failedPaths: fileResult.failedPaths,
        }
    }

    try {
        domainPlan.apply()
        return { success: true, conflictPaths: [], failedPaths: [] }
    } catch (error) {
        await fileResult.rollback()
        console.error('[Trash] Failed to restore owner store:', error)
        return {
            success: false,
            conflictPaths: [],
            failedPaths: [error instanceof Error ? error.message : String(error)],
        }
    }
}

/** Removes all physical data associated with an expired or explicitly emptied trash item. */
/**
 * The journal is removed only when every associated file is either gone or
 * deleted successfully. Reporting failed paths keeps permission/lock errors
 * recoverable from the trash instead of converting them into silent data loss.
 */
export async function permanentlyRemoveTrashItem(item: TrashItem): Promise<TrashRemovalResult> {
    const paths = collectTrashFilePaths(item)
    const results = await Promise.all(paths.map(async path => {
        if (path.startsWith('data:') || path.startsWith('memory:')) return { path, success: true }
        try {
            if (await exists(path)) await remove(path)
            return { path, success: true }
        } catch (error) {
            console.warn('[Trash] Failed to permanently remove item file:', { path, error })
            return { path, success: false }
        }
    }))
    const failedPaths = results.filter(result => !result.success).map(result => result.path)
    return { success: failedPaths.length === 0, failedPaths }
}

export function collectTrashFilePaths(item: TrashItem): string[] {
    if (item.kind === 'image') return [item.image.url]
    if (item.kind === 'scene') return item.scene.scene.images.map(image => image.url)
    if (item.kind === 'folder') return item.folder.presets.flatMap(preset => preset.scenes.flatMap(scene => scene.images.map(image => image.url)))
    return flattenLibraryItems(item.library.items).map(libraryItem => libraryItem.path)
}

export async function pruneExpiredTrashItems(items: readonly TrashItem[]): Promise<string[]> {
    const expired = items.filter(item => item.expiresAt <= Date.now())
    const outcomes = await Promise.all(expired.map(async item => ({
        id: item.id,
        result: await permanentlyRemoveTrashItem(item),
    })))
    return outcomes.filter(outcome => outcome.result.success).map(outcome => outcome.id)
}
