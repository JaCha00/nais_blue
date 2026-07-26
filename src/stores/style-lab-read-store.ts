import { create } from 'zustand'
import type { PreferenceProjection, StylePreviewAsset, TasteBoard } from '@/domain/style-lab'
import { preferenceProjectionRecord } from '@/application/style-lab/rebuild-projections'

interface StyleLabReadState {
    preferenceProjections: Readonly<Record<string, PreferenceProjection>>
    projectionsReady: boolean
    tasteBoards: readonly TasteBoard[]
    boardsReady: boolean
    previewAssetsByCombo: Readonly<Record<string, readonly StylePreviewAsset[]>>
    replacePreferenceProjections: (projections: readonly PreferenceProjection[]) => void
    clearPreferenceProjections: () => void
    replaceTasteBoards: (boards: readonly TasteBoard[]) => void
    replacePreviewAssets: (assets: readonly StylePreviewAsset[]) => void
}

const EMPTY_STYLE_PREVIEW_ASSETS: readonly StylePreviewAsset[] = Object.freeze([])

/**
 * Depends on the atomic preview projection and is consumed by combination cards.
 * Returning one shared empty value keeps Zustand's external-store snapshot
 * reference stable when a combination has no rendered previews.
 */
export function selectStylePreviewAssets(
    state: Pick<StyleLabReadState, 'previewAssetsByCombo'>,
    comboId: string,
): readonly StylePreviewAsset[] {
    return state.previewAssetsByCombo[comboId] ?? EMPTY_STYLE_PREVIEW_ASSETS
}

/**
 * UI components depend on this non-persisted read cache, while IndexedDB events and
 * projections remain owned by the repository. Replacing the complete projection map
 * makes render updates atomic and avoids candidate-by-candidate transient rankings.
 */
export const useStyleLabReadStore = create<StyleLabReadState>()(set => ({
    preferenceProjections: {},
    projectionsReady: false,
    tasteBoards: [],
    boardsReady: false,
    previewAssetsByCombo: {},
    replacePreferenceProjections: projections => set({
        preferenceProjections: preferenceProjectionRecord(projections),
        projectionsReady: true,
    }),
    clearPreferenceProjections: () => set({
        preferenceProjections: {},
        projectionsReady: false,
    }),
    replaceTasteBoards: boards => set({
        tasteBoards: [...boards],
        boardsReady: true,
    }),
    replacePreviewAssets: assets => set({
        previewAssetsByCombo: assets.reduce<Record<string, StylePreviewAsset[]>>((grouped, asset) => {
            const current = grouped[asset.comboId] ?? []
            current.push(asset)
            grouped[asset.comboId] = current
            return grouped
        }, {}),
    }),
}))
