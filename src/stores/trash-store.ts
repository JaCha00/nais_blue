import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'
import type { LibraryItem } from '@/stores/library-store'
import type { SceneCard, SceneImage, ScenePreset } from '@/stores/scene-store'

export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export interface TrashedImage extends SceneImage {
    /** Original disk location lets the detail view explain where the item came from. */
    originalUrl: string
    /** True when a platform move failed and the original file was safely left in place. */
    retainedAtOriginalPath?: boolean
    /**
     * Depends on the deletion surface's domain identity and is consumed by the
     * restore service. It lets a standalone image return to its Scene or
     * History owner after its former card has disappeared, rather than merely
     * moving bytes back to disk.
     */
    restoreTarget?: TrashedImageRestoreTarget
}

export interface TrashedSceneImageTarget {
    presetId: string
    presetName: string
    sceneId: string
    sceneName: string
}

export interface TrashedImageRestoreTarget {
    scene?: TrashedSceneImageTarget
    /** History is file-scan based, so its original path is enough to reappear. */
    historyPath?: string
}

export interface TrashedSceneSnapshot {
    preset: Omit<ScenePreset, 'scenes'>
    scene: Omit<SceneCard, 'images'> & { images: TrashedImage[] }
}

export interface TrashedFolderSnapshot {
    rootPresetId: string
    presets: Array<Omit<ScenePreset, 'scenes'> & {
        scenes: Array<Omit<SceneCard, 'images'> & { images: TrashedImage[] }>
    }>
}

export interface TrashedLibrarySnapshot {
    /** A library stack is kept intact so its child images can still be inspected together. */
    items: LibraryItem[]
    sourceStackId: string | null
    /** Leaf paths are replaced with trash paths while archived; retain the reversible mapping. */
    originalPaths: Record<string, string>
}

export type TrashItem = {
    id: string
    deletedAt: number
    expiresAt: number
    title: string
}
    & (
        | { kind: 'image'; image: TrashedImage; source: 'scene' | 'library' | 'history' }
        | { kind: 'scene'; scene: TrashedSceneSnapshot }
        | { kind: 'folder'; folder: TrashedFolderSnapshot }
        | { kind: 'library'; library: TrashedLibrarySnapshot }
    )

interface TrashState {
    items: TrashItem[]
    add: (item: TrashItem) => void
    remove: (id: string) => void
    removeMany: (ids: readonly string[]) => void
}

/**
 * Depends on the shared IndexedDB adapter and is consumed by every asset-delete
 * surface. Keeping a small, typed deletion journal outside individual feature
 * stores preserves scene, library, and history items for a common 30-day UI.
 */
export const useTrashStore = create<TrashState>()(
    persist(
        set => ({
            items: [],
            add: item => set(state => ({ items: [item, ...state.items] })),
            remove: id => set(state => ({ items: state.items.filter(item => item.id !== id) })),
            removeMany: ids => {
                const removed = new Set(ids)
                set(state => ({ items: state.items.filter(item => !removed.has(item.id)) }))
            },
        }),
        {
            name: 'nais2-trash',
            storage: createJSONStorage(() => indexedDBStorage),
            partialize: state => ({ items: state.items }),
        },
    ),
)

export function makeTrashItemId(): string {
    return `trash-${Date.now()}-${crypto.randomUUID()}`
}

export function trashExpiryAt(deletedAt: number): number {
    return deletedAt + TRASH_RETENTION_MS
}
