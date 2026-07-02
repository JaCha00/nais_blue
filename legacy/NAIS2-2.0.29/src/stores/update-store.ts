import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Update, check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

interface PendingUpdateInfo {
    version: string
    downloadedAt: number
}

interface UpdateStore {
    // State
    pendingUpdate: PendingUpdateInfo | null
    isDownloading: boolean
    downloadProgress: number

    // Actions
    setPendingUpdate: (info: PendingUpdateInfo | null) => void
    setIsDownloading: (value: boolean) => void
    setDownloadProgress: (progress: number) => void
    clearPendingUpdate: () => void
}

// Store the actual Update object in memory (not persisted)
let currentUpdateObject: Update | null = null
// Track if download was completed in THIS session
let downloadedInSession = false

export const setCurrentUpdateObject = (update: Update | null, downloaded = false) => {
    currentUpdateObject = update
    downloadedInSession = downloaded
}

export const getCurrentUpdateObject = () => currentUpdateObject

export const installPendingUpdate = async () => {
    // If we have an Update object that was downloaded in this session, just install
    if (currentUpdateObject && downloadedInSession) {
        await currentUpdateObject.install()
        await relaunch()
    } else {
        // Either no Update object, or it's a fresh one from check() that wasn't downloaded
        // Use downloadAndInstall() to be safe
        const update = currentUpdateObject || await check()
        if (update) {
            await update.downloadAndInstall()
            await relaunch()
        } else {
            throw new Error('No update available')
        }
    }
}

export const useUpdateStore = create<UpdateStore>()(
    persist(
        (set) => ({
            pendingUpdate: null,
            isDownloading: false,
            downloadProgress: 0,

            setPendingUpdate: (info) => set({ pendingUpdate: info }),
            setIsDownloading: (value) => set({ isDownloading: value }),
            setDownloadProgress: (progress) => set({ downloadProgress: progress }),
            clearPendingUpdate: () => {
                currentUpdateObject = null
                set({ pendingUpdate: null, downloadProgress: 0 })
            },
        }),
        {
            name: 'nais-update',
            partialize: (state) => ({
                // Only persist pendingUpdate info, not the actual Update object
                pendingUpdate: state.pendingUpdate,
            }),
        }
    )
)
