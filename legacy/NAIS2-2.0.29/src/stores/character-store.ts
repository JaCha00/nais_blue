import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type PreciseReferenceMode = 'character&style' | 'character' | 'style'

export interface ReferenceImage {
    id: string
    base64: string
    encodedVibe?: string  // Pre-encoded vibe data from PNG metadata (skips /ai/encode-vibe API)
    informationExtracted: number // vibe: 0 to 1
    strength: number // vibe: reference strength / character (precise) reference: Strength (0-1)
    // --- Precise (character) reference only, matching NAI web UI ---
    fidelity?: number              // Fidelity slider (0-1)
    mode?: PreciseReferenceMode    // Character & Style / Character / Style
}

interface CharacterState {
    characterImages: ReferenceImage[]
    vibeImages: ReferenceImage[]

    // Actions
    addCharacterImage: (base64: string) => void
    updateCharacterImage: (id: string, updates: Partial<ReferenceImage>) => void
    removeCharacterImage: (id: string) => void

    addVibeImage: (base64: string, encodedVibe?: string, informationExtracted?: number, strength?: number) => void
    updateVibeImage: (id: string, updates: Partial<ReferenceImage>) => void
    removeVibeImage: (id: string) => void

    clearAll: () => void
}

import { createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'
import { attachStoreBackup } from '@/lib/auto-backup'

export const useCharacterStore = create<CharacterState>()(
    persist(
        (set) => ({
            characterImages: [],
            vibeImages: [],

            addCharacterImage: (base64) => set((state) => ({
                characterImages: [
                    ...state.characterImages,
                    {
                        id: Date.now().toString(),
                        base64,
                        informationExtracted: 1.0,
                        strength: 1.0,          // NAI web "Strength" default
                        fidelity: 1.0,          // NAI web "Fidelity" default
                        mode: 'character&style' // NAI web default mode
                    }
                ]
            })),

            updateCharacterImage: (id, updates) => set((state) => ({
                characterImages: state.characterImages.map(img =>
                    img.id === id ? { ...img, ...updates } : img
                )
            })),

            removeCharacterImage: (id) => set((state) => ({
                characterImages: state.characterImages.filter(img => img.id !== id)
            })),

            addVibeImage: (base64, encodedVibe, informationExtracted, strength) => {
                console.log('[CharacterStore] addVibeImage called', { encodedVibe: !!encodedVibe })
                set((state) => ({
                    vibeImages: [
                        ...state.vibeImages,
                        {
                            id: Date.now().toString(),
                            base64,
                            encodedVibe,
                            informationExtracted: informationExtracted ?? 1.0,
                            strength: strength ?? 0.6
                        }
                    ]
                }))
            },

            updateVibeImage: (id, updates) => set((state) => ({
                vibeImages: state.vibeImages.map(img =>
                    img.id === id ? { ...img, ...updates } : img
                )
            })),

            removeVibeImage: (id) => set((state) => ({
                vibeImages: state.vibeImages.filter(img => img.id !== id)
            })),

            clearAll: () => set({ characterImages: [], vibeImages: [] })
        }),
        {
            name: 'nais2-character-store',
            storage: createJSONStorage(() => indexedDBStorage),
            partialize: (state) => ({
                characterImages: state.characterImages,
                vibeImages: state.vibeImages
            })
        }
    )
)

attachStoreBackup(useCharacterStore as any, 'character-store')
