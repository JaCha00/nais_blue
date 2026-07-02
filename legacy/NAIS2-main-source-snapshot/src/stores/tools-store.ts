import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'

interface ToolsState {
    activeImage: string | null
    setActiveImage: (image: string | null) => void

    // Persisted Settings
    mosaicPixelSize: number
    setMosaicPixelSize: (size: number) => void
    mosaicBrushSize: number
    setMosaicBrushSize: (size: number) => void

    inpaintingBrushSize: number
    setInpaintingBrushSize: (size: number) => void
}

export const useToolsStore = create<ToolsState>()(
    persist(
        (set) => ({
            activeImage: null,
            setActiveImage: (image) => set({ activeImage: image }),

            mosaicPixelSize: 10,
            setMosaicPixelSize: (size) => set({ mosaicPixelSize: size }),

            mosaicBrushSize: 50,
            setMosaicBrushSize: (size) => set({ mosaicBrushSize: size }),

            inpaintingBrushSize: 50,
            setInpaintingBrushSize: (size) => set({ inpaintingBrushSize: size }),
        }),
        {
            name: 'nais2-tools',
            storage: createJSONStorage(() => indexedDBStorage),
            partialize: (state) => ({
                mosaicPixelSize: state.mosaicPixelSize,
                mosaicBrushSize: state.mosaicBrushSize,
                inpaintingBrushSize: state.inpaintingBrushSize,
            }),
        }
    )
)
