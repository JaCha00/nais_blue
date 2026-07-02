import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'

export interface CharacterPrompt {
    id: string
    name?: string         // Character name (optional)
    prompt: string        // Character-specific tags
    negative: string      // Character-specific negative tags
    enabled: boolean
    position: { x: number, y: number }  // 0-1 coordinates (0,0 = top-left, 1,1 = bottom-right)
}

interface CharacterPromptState {
    characters: CharacterPrompt[]
    addCharacter: (initialData?: Partial<CharacterPrompt>) => void
    updateCharacter: (id: string, data: Partial<CharacterPrompt>) => void
    removeCharacter: (id: string) => void
    setPosition: (id: string, x: number, y: number) => void
    toggleEnabled: (id: string) => void
    clearAll: () => void
}

// Color palette for character markers (up to 6 characters)
export const CHARACTER_COLORS = [
    '#22c55e', // Green
    '#ef4444', // Red
    '#3b82f6', // Blue
    '#f59e0b', // Amber
    '#a855f7', // Purple
    '#06b6d4', // Cyan
]

// Folder color palette
export const FOLDER_COLORS = [
    { name: 'amber', icon: 'text-amber-500', border: 'border-amber-500/40', bg: 'bg-amber-500/10' },
    { name: 'blue', icon: 'text-blue-500', border: 'border-blue-500/40', bg: 'bg-blue-500/10' },
    { name: 'green', icon: 'text-green-500', border: 'border-green-500/40', bg: 'bg-green-500/10' },
    { name: 'purple', icon: 'text-purple-500', border: 'border-purple-500/40', bg: 'bg-purple-500/10' },
    { name: 'pink', icon: 'text-pink-500', border: 'border-pink-500/40', bg: 'bg-pink-500/10' },
    { name: 'cyan', icon: 'text-cyan-500', border: 'border-cyan-500/40', bg: 'bg-cyan-500/10' },
    { name: 'red', icon: 'text-red-500', border: 'border-red-500/40', bg: 'bg-red-500/10' },
]

export interface CharacterPreset {
    id: string
    name: string
    prompt: string
    negative: string
    image?: string // Base64 or URL
    groupId?: string // Group/folder ID
}

export interface CharacterGroup {
    id: string
    name: string
    collapsed: boolean // 폴더 접기 상태
    colorIndex: number // 폴더 색상 인덱스 (FOLDER_COLORS)
}

export interface CharacterPrompt {
    id: string
    name?: string         // Character name (optional)
    presetId?: string // Link to origin preset
    groupId?: string  // Folder groupId for stage organization
    prompt: string        // Character-specific tags
    negative: string      // Character-specific negative tags
    enabled: boolean
    position: { x: number, y: number }  // 0-1 coordinates (0,0 = top-left, 1,1 = bottom-right)
}

interface CharacterPromptState {
    characters: CharacterPrompt[]
    presets: CharacterPreset[]
    groups: CharacterGroup[]
    positionEnabled: boolean // 위치 기능 활성화 여부

    // Active Characters (Stage)
    addCharacter: (initialData?: Partial<CharacterPrompt>) => void
    updateCharacter: (id: string, data: Partial<CharacterPrompt>) => void
    removeCharacter: (id: string) => void
    setPosition: (id: string, x: number, y: number) => void
    toggleEnabled: (id: string) => void
    clearAll: () => void
    setPositionEnabled: (enabled: boolean) => void
    reorderCharacters: (oldIndex: number, newIndex: number) => void
    reorderCharactersInGroup: (activeId: string, overId: string, groupId: string | undefined) => void

    // Presets (Library)
    addPreset: (data: Partial<CharacterPreset> & Omit<CharacterPreset, 'id'>) => void
    updatePreset: (id: string, data: Partial<CharacterPreset>) => void
    deletePreset: (id: string) => void
    importFromStart: (presetId: string) => void // Add preset to stage

    // Groups (Folders)
    addGroup: (name: string) => void
    updateGroup: (id: string, data: Partial<CharacterGroup>) => void
    deleteGroup: (id: string) => void
    toggleGroupCollapsed: (id: string) => void
    toggleGroupEnabled: (groupId: string) => void // 그룹 내 모든 캐릭터 활성화/비활성화
    moveCharacterToGroup: (characterId: string, groupId: string | undefined) => void
    saveCharacterAsPreset: (characterId: string) => void
}

export const useCharacterPromptStore = create<CharacterPromptState>()(
    persist(
        (set, get) => ({
            characters: [],
            presets: [],
            groups: [],
            positionEnabled: false, // 기본값: 비활성화

            addCharacter: (initialData?: Partial<CharacterPrompt>) => {
                const newId = Date.now().toString() + Math.random().toString(36).substr(2, 9)
                set(state => ({
                    characters: [
                        ...state.characters,
                        {
                            id: newId,
                            prompt: '',
                            negative: '',
                            enabled: true,
                            position: { x: 0.5, y: 0.5 }, // Center by default
                            ...initialData
                        }
                    ]
                }))
            },

            updateCharacter: (id, data) => {
                set(state => ({
                    characters: state.characters.map(char =>
                        char.id === id ? { ...char, ...data } : char
                    )
                }))
            },

            removeCharacter: (id) => {
                set(state => ({
                    characters: state.characters.filter(char => char.id !== id)
                }))
            },

            setPosition: (id, x, y) => {
                // Clamp values to 0-1 range
                const clampedX = Math.max(0, Math.min(1, x))
                const clampedY = Math.max(0, Math.min(1, y))
                set(state => ({
                    characters: state.characters.map(char =>
                        char.id === id ? { ...char, position: { x: clampedX, y: clampedY } } : char
                    )
                }))
            },

            toggleEnabled: (id) => {
                set(state => ({
                    characters: state.characters.map(char =>
                        char.id === id ? { ...char, enabled: !char.enabled } : char
                    )
                }))
            },

            clearAll: () => set({ characters: [] }),

            setPositionEnabled: (enabled) => set({ positionEnabled: enabled }),

            reorderCharacters: (oldIndex, newIndex) => {
                set(state => {
                    const newCharacters = [...state.characters]
                    const [removed] = newCharacters.splice(oldIndex, 1)
                    newCharacters.splice(newIndex, 0, removed)
                    return { characters: newCharacters }
                })
            },

            reorderCharactersInGroup: (activeId, overId, groupId) => {
                set(state => {
                    // 같은 그룹의 캐릭터들만 필터링
                    const groupChars = state.characters.filter(c => 
                        groupId ? c.groupId === groupId : (!c.groupId || !state.groups.some(g => g.id === c.groupId))
                    )
                    
                    const oldIndex = groupChars.findIndex(c => c.id === activeId)
                    const newIndex = groupChars.findIndex(c => c.id === overId)
                    
                    if (oldIndex === -1 || newIndex === -1) return state
                    
                    const [removed] = groupChars.splice(oldIndex, 1)
                    groupChars.splice(newIndex, 0, removed)
                    
                    // 그룹별로 정렬된 새 배열 생성
                    const sortedCharacters: typeof state.characters = []
                    const processedIds = new Set<string>()
                    
                    for (const char of state.characters) {
                        if (processedIds.has(char.id)) continue
                        
                        const inTargetGroup = groupId ? char.groupId === groupId : (!char.groupId || !state.groups.some(g => g.id === char.groupId))
                        
                        if (inTargetGroup && !processedIds.has(groupChars[0]?.id)) {
                            // 이 그룹의 첫 캐릭터 위치에 정렬된 그룹 전체 삽입
                            for (const gc of groupChars) {
                                sortedCharacters.push(gc)
                                processedIds.add(gc.id)
                            }
                        } else if (!inTargetGroup) {
                            sortedCharacters.push(char)
                            processedIds.add(char.id)
                        }
                    }
                    
                    return { characters: sortedCharacters }
                })
            },

            // Preset Actions
            addPreset: (data) => {
                const newId = data.id || (Date.now().toString() + Math.random().toString(36).substr(2, 9))
                set(state => ({
                    presets: [...state.presets, { ...data, id: newId } as CharacterPreset]
                }))
            },

            updatePreset: (id, data) => {
                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === id ? { ...p, ...data } : p
                    )
                }))
            },

            deletePreset: (id) => {
                set(state => ({
                    presets: state.presets.filter(p => p.id !== id)
                }))
            },

            importFromStart: (presetId) => {
                set(state => {
                    const preset = state.presets.find(p => p.id === presetId)
                    if (!preset) return state

                    // Check if already exists? Maybe allow duplicates for twins etc.
                    // For now, allow duplicates.

                    const newId = Date.now().toString() + Math.random().toString(36).substr(2, 9)
                    return {
                        characters: [
                            ...state.characters,
                            {
                                id: newId,
                                presetId: preset.id,
                                prompt: preset.prompt,
                                negative: preset.negative,
                                enabled: true,
                                position: { x: 0.5, y: 0.5 }
                            }
                        ]
                    }
                })
            },

            // Group Actions
            addGroup: (name) => {
                const newId = Date.now().toString() + Math.random().toString(36).substr(2, 9)
                set(state => ({
                    groups: [...state.groups, { id: newId, name, collapsed: false, colorIndex: 0 }]
                }))
            },

            updateGroup: (id, data) => {
                set(state => ({
                    groups: state.groups.map(g =>
                        g.id === id ? { ...g, ...data } : g
                    )
                }))
            },

            deleteGroup: (id) => {
                set(state => ({
                    // Remove group and unassign characters/presets from the group
                    groups: state.groups.filter(g => g.id !== id),
                    characters: state.characters.map(c =>
                        c.groupId === id ? { ...c, groupId: undefined } : c
                    ),
                    presets: state.presets.map(p =>
                        p.groupId === id ? { ...p, groupId: undefined } : p
                    )
                }))
            },

            toggleGroupCollapsed: (id) => {
                set(state => ({
                    groups: state.groups.map(g =>
                        g.id === id ? { ...g, collapsed: !g.collapsed } : g
                    )
                }))
            },

            toggleGroupEnabled: (groupId) => {
                // 그룹 내 캐릭터들의 enabled 토글
                const { characters } = get()
                
                // 그룹 내 캐릭터들 중 하나라도 활성화되어 있으면 전부 비활성화, 아니면 전부 활성화
                const groupCharacters = characters.filter(c => c.groupId === groupId)
                const allEnabled = groupCharacters.length > 0 && groupCharacters.every(c => c.enabled)
                const newEnabled = !allEnabled

                set(state => ({
                    characters: state.characters.map(c =>
                        c.groupId === groupId
                            ? { ...c, enabled: newEnabled }
                            : c
                    )
                }))
            },

            moveCharacterToGroup: (characterId, groupId) => {
                set(state => ({
                    characters: state.characters.map(c =>
                        c.id === characterId ? { ...c, groupId } : c
                    )
                }))
            },

            saveCharacterAsPreset: (characterId) => {
                const { characters } = get()
                const char = characters.find(c => c.id === characterId)
                if (!char) return

                const newId = Date.now().toString() + Math.random().toString(36).substr(2, 9)
                const presetName = char.name || char.prompt.split(',')[0]?.trim() || 'Unnamed'

                set(state => ({
                    presets: [...state.presets, {
                        id: newId,
                        name: presetName,
                        prompt: char.prompt,
                        negative: char.negative,
                    }]
                }))
            }
        }),
        {
            name: 'nais2-character-prompts',
            storage: createJSONStorage(() => indexedDBStorage),
            version: 1,
            // 데이터 보호: hydration 후 검증
            onRehydrateStorage: () => (state, error) => {
                if (error) {
                    console.error('[CharacterPromptStore] Hydration failed:', error)
                    return
                }
                
                if (state) {
                    // 정상 복원 로그
                    const presetCount = state.presets?.length || 0
                    const charCount = state.characters?.length || 0
                    const groupCount = state.groups?.length || 0
                    console.log(`[CharacterPromptStore] Hydrated: ${presetCount} presets, ${charCount} characters, ${groupCount} groups`)
                    
                    // 빈 배열이면 경고 (데이터 손실 가능성)
                    if (presetCount === 0 && charCount === 0) {
                        console.warn('[CharacterPromptStore] Warning: No data after hydration - possible data loss')
                    }
                }
            },
            // 저장할 필드 명시
            partialize: (state) => ({
                characters: state.characters,
                presets: state.presets,
                groups: state.groups,
                positionEnabled: state.positionEnabled,
            }),
        }
    )
)
