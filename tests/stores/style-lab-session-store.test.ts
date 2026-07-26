import { beforeEach, describe, expect, it } from 'vitest'
import { useStyleLabSessionStore } from '@/stores/style-lab-session-store'

describe('Style-Lab session store', () => {
    beforeEach(() => {
        useStyleLabSessionStore.setState({
            activeTab: 'battle',
            activeBoardId: null,
            comparisonTrayIds: [],
        })
    })

    it('keeps navigation and a bounded two-candidate comparison tray in session memory', () => {
        const state = useStyleLabSessionStore.getState()
        state.setActiveTab('market')
        state.setActiveBoardId('board-a')
        state.toggleComparisonCandidate('a')
        state.toggleComparisonCandidate('b')
        state.toggleComparisonCandidate('c')

        expect(useStyleLabSessionStore.getState()).toMatchObject({
            activeTab: 'market',
            activeBoardId: 'board-a',
            comparisonTrayIds: ['b', 'c'],
        })
        useStyleLabSessionStore.getState().toggleComparisonCandidate('b')
        expect(useStyleLabSessionStore.getState().comparisonTrayIds).toEqual(['c'])
    })
})
