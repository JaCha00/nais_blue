import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'

interface LayoutState {
    leftSidebarVisible: boolean
    rightSidebarVisible: boolean
    /** Transient compact-shell surface; a single value prevents overlapping sheets. */
    supportSheet: 'prompt' | 'history' | null
    toggleLeftSidebar: () => void
    toggleRightSidebar: () => void
    setLeftSidebarVisible: (visible: boolean) => void
    setRightSidebarVisible: (visible: boolean) => void
    openSupportSheet: (sheet: Exclude<LayoutState['supportSheet'], null>) => void
    closeSupportSheet: () => void
}

export const useLayoutStore = create<LayoutState>()(
    persist(
        (set) => ({
            leftSidebarVisible: true,
            rightSidebarVisible: true,
            supportSheet: null,
            toggleLeftSidebar: () => set((state) => ({ leftSidebarVisible: !state.leftSidebarVisible })),
            toggleRightSidebar: () => set((state) => ({ rightSidebarVisible: !state.rightSidebarVisible })),
            setLeftSidebarVisible: (visible) => set({ leftSidebarVisible: visible }),
            setRightSidebarVisible: (visible) => set({ rightSidebarVisible: visible }),
            openSupportSheet: (supportSheet) => set({ supportSheet }),
            closeSupportSheet: () => set({ supportSheet: null }),
        }),
        {
            name: 'nais2-layout',
            storage: createJSONStorage(() => indexedDBStorage),
            // Dock preferences survive restarts; an open modal surface does not.
            partialize: ({ leftSidebarVisible, rightSidebarVisible }) => ({
                leftSidebarVisible,
                rightSidebarVisible,
            }),
        }
    )
)
