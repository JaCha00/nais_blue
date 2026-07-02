import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'

// 단축키 액션 타입
export type ShortcutAction =
    | 'navigate:main'
    | 'navigate:scenes'
    | 'navigate:tools'
    | 'navigate:web'
    | 'navigate:library'
    | 'navigate:settings'
    | 'navigate:next'
    | 'navigate:prev'
    | 'open:promptGenerator'
    | 'open:fragmentDialog'
    | 'open:parameterSettings'
    | 'open:imageReference'
    | 'open:characterPrompt'
    | 'open:presetDialog'
    | 'action:generate'
    | 'action:resetFragmentCounters'

// 단축키 바인딩 인터페이스
export interface KeyBinding {
    key: string           // 실제 키 (예: '1', 'g', 'Enter')
    ctrl?: boolean        // Ctrl/Cmd 키
    shift?: boolean       // Shift 키
    alt?: boolean         // Alt 키
    label: string         // 표시 이름
    description: string   // 설명
}

// 기본 단축키 설정
const DEFAULT_BINDINGS: Record<ShortcutAction, KeyBinding> = {
    'navigate:main': { key: '1', ctrl: true, label: 'Ctrl+1', description: 'shortcuts.actions.navigateMain' },
    'navigate:scenes': { key: '2', ctrl: true, label: 'Ctrl+2', description: 'shortcuts.actions.navigateScenes' },
    'navigate:tools': { key: '3', ctrl: true, label: 'Ctrl+3', description: 'shortcuts.actions.navigateTools' },
    'navigate:web': { key: '4', ctrl: true, label: 'Ctrl+4', description: 'shortcuts.actions.navigateWeb' },
    'navigate:library': { key: '5', ctrl: true, label: 'Ctrl+5', description: 'shortcuts.actions.navigateLibrary' },
    'navigate:settings': { key: '6', ctrl: true, label: 'Ctrl+6', description: 'shortcuts.actions.navigateSettings' },
    'navigate:next': { key: 'Tab', label: 'Tab', description: 'shortcuts.actions.navigateNext' },
    'navigate:prev': { key: 'Tab', shift: true, label: 'Shift+Tab', description: 'shortcuts.actions.navigatePrev' },
    'open:promptGenerator': { key: 'g', ctrl: true, label: 'Ctrl+G', description: 'shortcuts.actions.promptGenerator' },
    'open:fragmentDialog': { key: 'f', ctrl: true, label: 'Ctrl+F', description: 'shortcuts.actions.fragmentDialog' },
    'open:parameterSettings': { key: 'p', ctrl: true, label: 'Ctrl+P', description: 'shortcuts.actions.parameterSettings' },
    'open:imageReference': { key: 'i', ctrl: true, label: 'Ctrl+I', description: 'shortcuts.actions.imageReference' },
    'open:characterPrompt': { key: 'd', ctrl: true, label: 'Ctrl+D', description: 'shortcuts.actions.characterPrompt' },
    'open:presetDialog': { key: '`', ctrl: true, label: 'Ctrl+`', description: 'shortcuts.actions.presetDialog' },
    'action:generate': { key: 'Enter', ctrl: true, label: 'Ctrl+Enter', description: 'shortcuts.actions.generate' },
    'action:resetFragmentCounters': { key: 'r', ctrl: true, shift: true, label: 'Ctrl+Shift+R', description: 'shortcuts.actions.resetFragmentCounters' },
}

interface ShortcutState {
    bindings: Record<ShortcutAction, KeyBinding>
    enabled: boolean  // 전역 단축키 활성화/비활성화

    // Actions
    setBinding: (action: ShortcutAction, binding: KeyBinding) => void
    resetBinding: (action: ShortcutAction) => void
    resetAllBindings: () => void
    setEnabled: (enabled: boolean) => void
    getBindingLabel: (action: ShortcutAction) => string
}

// 키 조합을 문자열로 변환
export function formatKeyBinding(binding: KeyBinding): string {
    const parts: string[] = []
    if (binding.ctrl) parts.push('Ctrl')
    if (binding.shift) parts.push('Shift')
    if (binding.alt) parts.push('Alt')
    
    // 특수 키 처리
    let keyDisplay = binding.key
    if (binding.key === 'Enter') keyDisplay = 'Enter'
    else if (binding.key === ' ') keyDisplay = 'Space'
    else if (binding.key === 'Escape') keyDisplay = 'Esc'
    else if (binding.shift && /^[!@#$%^&*()]$/.test(binding.key)) {
        // Shift+숫자 조합
        const shiftMap: Record<string, string> = {
            '!': '1', '@': '2', '#': '3', '$': '4', '%': '5',
            '^': '6', '&': '7', '*': '8', '(': '9', ')': '0'
        }
        keyDisplay = shiftMap[binding.key] || binding.key
    } else {
        keyDisplay = binding.key.toUpperCase()
    }
    
    parts.push(keyDisplay)
    return parts.join('+')
}

// 키 이벤트가 바인딩과 일치하는지 확인
export function matchesBinding(e: KeyboardEvent, binding: KeyBinding): boolean {
    const ctrlMatch = binding.ctrl ? (e.ctrlKey || e.metaKey) : !(e.ctrlKey || e.metaKey)
    const shiftMatch = binding.shift ? e.shiftKey : !e.shiftKey
    const altMatch = binding.alt ? e.altKey : !e.altKey
    const keyMatch = e.key === binding.key || e.key.toLowerCase() === binding.key.toLowerCase()
    
    return ctrlMatch && shiftMatch && altMatch && keyMatch
}

export const useShortcutStore = create<ShortcutState>()(
    persist(
        (set, get) => ({
            bindings: { ...DEFAULT_BINDINGS },
            enabled: true,

            setBinding: (action, binding) => {
                set((state) => ({
                    bindings: {
                        ...state.bindings,
                        [action]: { ...binding, label: formatKeyBinding(binding) }
                    }
                }))
            },

            resetBinding: (action) => {
                set((state) => ({
                    bindings: {
                        ...state.bindings,
                        [action]: DEFAULT_BINDINGS[action]
                    }
                }))
            },

            resetAllBindings: () => {
                set({ bindings: { ...DEFAULT_BINDINGS } })
            },

            setEnabled: (enabled) => {
                set({ enabled })
            },

            getBindingLabel: (action) => {
                return get().bindings[action]?.label || ''
            },
        }),
        {
            name: 'nais2-shortcuts',
            storage: createJSONStorage(() => indexedDBStorage),
            // 새로운 바인딩이 추가되면 기존 저장된 데이터와 기본값을 병합
            merge: (persistedState, currentState) => {
                const persisted = persistedState as Partial<ShortcutState>
                return {
                    ...currentState,
                    ...persisted,
                    // 저장된 바인딩에 누락된 새 바인딩은 기본값으로 채움
                    bindings: {
                        ...DEFAULT_BINDINGS,
                        ...(persisted.bindings || {}),
                    },
                }
            },
        }
    )
)

// 액션 목록 (설정 UI용)
export const SHORTCUT_ACTIONS: { action: ShortcutAction; category: string }[] = [
    { action: 'navigate:main', category: 'navigation' },
    { action: 'navigate:scenes', category: 'navigation' },
    { action: 'navigate:tools', category: 'navigation' },
    { action: 'navigate:web', category: 'navigation' },
    { action: 'navigate:library', category: 'navigation' },
    { action: 'navigate:settings', category: 'navigation' },
    { action: 'navigate:next', category: 'navigation' },
    { action: 'navigate:prev', category: 'navigation' },
    { action: 'open:promptGenerator', category: 'dialog' },
    { action: 'open:fragmentDialog', category: 'dialog' },
    { action: 'open:parameterSettings', category: 'dialog' },
    { action: 'open:imageReference', category: 'dialog' },
    { action: 'open:characterPrompt', category: 'dialog' },
    { action: 'open:presetDialog', category: 'dialog' },
    { action: 'action:generate', category: 'action' },
    { action: 'action:resetFragmentCounters', category: 'action' },
]
