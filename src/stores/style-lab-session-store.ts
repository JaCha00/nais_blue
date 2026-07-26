import { create } from 'zustand'

export type StyleLabTab =
    | 'battle'
    | 'market'
    | 'collection'
    | 'manage'
    | 'evolve'
    | 'analyze'
    | 'stats'
    | 'settings'

interface StyleLabSessionState {
    activeTab: StyleLabTab
    activeBoardId: string | null
    comparisonTrayIds: readonly string[]
    setActiveTab: (tab: StyleLabTab) => void
    setActiveBoardId: (boardId: string | null) => void
    toggleComparisonCandidate: (comboId: string) => void
    clearComparisonTray: () => void
}

/**
 * Navigation and the two-item comparison tray are intentionally session-only.
 * Durable preference facts flow through application use cases and the repository,
 * while a reload may safely reset this small interaction state.
 */
export const useStyleLabSessionStore = create<StyleLabSessionState>()(set => ({
    activeTab: 'battle',
    activeBoardId: null,
    comparisonTrayIds: [],
    setActiveTab: activeTab => set({ activeTab }),
    setActiveBoardId: activeBoardId => set({ activeBoardId }),
    toggleComparisonCandidate: comboId => set(state => {
        if (state.comparisonTrayIds.includes(comboId)) {
            return { comparisonTrayIds: state.comparisonTrayIds.filter(id => id !== comboId) }
        }
        return {
            comparisonTrayIds: [...state.comparisonTrayIds.slice(-1), comboId],
        }
    }),
    clearComparisonTray: () => set({ comparisonTrayIds: [] }),
}))
