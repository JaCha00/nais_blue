import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'

type ThemeMode = 'light' | 'dark' | 'system'

interface ThemeState {
    theme: ThemeMode
    setTheme: (theme: ThemeMode) => void
}

export const useThemeStore = create<ThemeState>()(
    persist(
        (set) => ({
            theme: 'dark',
            setTheme: (theme) => {
                set({ theme })
                applyTheme(theme)
            },
        }),
        {
            name: 'nais2-theme',
            storage: createJSONStorage(() => indexedDBStorage),
            onRehydrateStorage: () => (state) => {
                if (state) {
                    applyTheme(state.theme)
                }
            },
        }
    )
)

function applyTheme(theme: ThemeMode) {
    const root = document.documentElement
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches

    if (theme === 'system') {
        root.classList.toggle('dark', systemDark)
    } else {
        root.classList.toggle('dark', theme === 'dark')
    }
}

// Listen for system theme changes
if (typeof window !== 'undefined') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        const { theme } = useThemeStore.getState()
        if (theme === 'system') {
            document.documentElement.classList.toggle('dark', e.matches)
        }
    })
}
