import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { attachStoreBackup } from '@/lib/auto-backup'

/**
 * Prompt Library — a native re-implementation of the standalone
 * "NovelAI Prompt Editor" HTML tool, embedded directly in NAIS (no iframe).
 *
 *   tabs[]  →  each tab has windows[]  →  each window holds a free TEXT prompt
 *   (comma-separated, edited with autocomplete — same as the main prompt box).
 *
 * (Originally tags were chips/string[]; switched to plain text per user request.
 *  Old chip data is migrated to joined text on load.)
 */

export interface PromptWindow {
    id: string
    title: string
    text: string            // comma-separated prompt text
    excluded: boolean       // excluded from "copy all"
}

export interface PromptTab {
    id: string
    name: string
    windows: PromptWindow[]
}

interface PromptLibraryState {
    tabs: PromptTab[]
    activeLeftId: string | null
    activeRightId: string | null

    // Tabs
    addTab: (name?: string) => string
    renameTab: (id: string, name: string) => void
    deleteTab: (id: string) => void
    setActive: (column: 'left' | 'right', id: string) => void

    // Windows
    addWindow: (tabId: string, title?: string) => void
    deleteWindow: (tabId: string, windowId: string) => void
    renameWindow: (tabId: string, windowId: string, title: string) => void
    toggleExcluded: (tabId: string, windowId: string) => void
    moveWindow: (tabId: string, windowId: string, dir: -1 | 1) => void
    setWindowText: (tabId: string, windowId: string, text: string) => void

    // Import / migration
    importFromEditorState: (state: any) => boolean   // replace (used for first-run migration)
    importFile: (json: any) => boolean               // append; supports editor + fragment JSON
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

function makeWindow(title: string, text = '', excluded = false): PromptWindow {
    return { id: uid(), title, text, excluded }
}

// Join raw tag array (old editor format) into a comma-separated prompt string.
const tagsToText = (tags: any): string =>
    Array.isArray(tags) ? tags.map((x: any) => String(x)).join(', ') : ''

// Convert the original HTML editor's saved/exported state into our model.
function convertEditorState(s: any): { tabs: PromptTab[]; activeLeftId: string | null; activeRightId: string | null } | null {
    if (!s || typeof s !== 'object') return null
    const globalTabs = Array.isArray(s.globalTabs) ? s.globalTabs : null
    const tabPanes = s.tabPanes && typeof s.tabPanes === 'object' ? s.tabPanes : null
    if (!globalTabs || !tabPanes) return null

    const tabs: PromptTab[] = globalTabs.map((t: any) => {
        const pane = tabPanes[t.id]
        const windows: PromptWindow[] = Array.isArray(pane?.promptWindows)
            ? pane.promptWindows.map((pw: any) => makeWindow(
                String(pw?.title ?? '제목 없음'),
                tagsToText(pw?.tags),
                !!pw?.isExcluded
            ))
            : []
        return { id: String(t.id), name: String(t.name ?? '이름없는 탭'), windows }
    })

    if (tabs.length === 0) return null
    const has = (id: any) => tabs.some(t => t.id === String(id))
    return {
        tabs,
        activeLeftId: has(s.activeLeftTabId) ? String(s.activeLeftTabId) : tabs[0].id,
        activeRightId: has(s.activeRightTabId) ? String(s.activeRightTabId) : (tabs[1]?.id ?? tabs[0].id),
    }
}

// Convert a fragment-store export ({ meta:[{id,name,folder}], contents:{id:[lines]} })
// into tabs: one tab per folder, one window per fragment file (text = its lines).
function convertFragmentExport(s: any): PromptTab[] | null {
    if (!s || typeof s !== 'object' || !Array.isArray(s.meta) || !s.contents || typeof s.contents !== 'object') return null
    const byFolder = new Map<string, PromptWindow[]>()
    for (const m of s.meta) {
        const folder = (String(m?.folder ?? '').trim()) || '미분류'
        const lines = Array.isArray(s.contents[m?.id]) ? s.contents[m.id].map((x: any) => String(x)) : []
        const win = makeWindow(String(m?.name ?? 'untitled'), lines.join('\n'))
        if (!byFolder.has(folder)) byFolder.set(folder, [])
        byFolder.get(folder)!.push(win)
    }
    const tabs = [...byFolder.entries()].map(([name, windows]) => ({ id: uid(), name: `조각: ${name}`, windows }))
    return tabs.length > 0 ? tabs : null
}

const updateWindow = (tabs: PromptTab[], tabId: string, windowId: string, fn: (w: PromptWindow) => PromptWindow): PromptTab[] =>
    tabs.map(t => t.id !== tabId ? t : { ...t, windows: t.windows.map(w => w.id === windowId ? fn(w) : w) })

export const usePromptLibraryStore = create<PromptLibraryState>()(
    persist(
        (set, get) => ({
            tabs: [],
            activeLeftId: null,
            activeRightId: null,

            addTab: (name) => {
                const tab: PromptTab = { id: uid(), name: name || `프롬프트 탭 ${get().tabs.length + 1}`, windows: [] }
                set(s => ({
                    tabs: [...s.tabs, tab],
                    activeLeftId: s.activeLeftId ?? tab.id,
                    activeRightId: s.activeRightId ?? tab.id,
                }))
                return tab.id
            },
            renameTab: (id, name) => set(s => ({ tabs: s.tabs.map(t => t.id === id ? { ...t, name } : t) })),
            deleteTab: (id) => set(s => {
                const tabs = s.tabs.filter(t => t.id !== id)
                const fallback = tabs[0]?.id ?? null
                return {
                    tabs,
                    activeLeftId: s.activeLeftId === id ? fallback : s.activeLeftId,
                    activeRightId: s.activeRightId === id ? fallback : s.activeRightId,
                }
            }),
            setActive: (column, id) => set(column === 'left' ? { activeLeftId: id } : { activeRightId: id }),

            addWindow: (tabId, title) => set(s => ({
                tabs: s.tabs.map(t => t.id !== tabId ? t : {
                    ...t,
                    windows: [...t.windows, makeWindow(title || `프롬프트 ${t.windows.length + 1}`)],
                }),
            })),
            deleteWindow: (tabId, windowId) => set(s => ({
                tabs: s.tabs.map(t => t.id !== tabId ? t : { ...t, windows: t.windows.filter(w => w.id !== windowId) }),
            })),
            renameWindow: (tabId, windowId, title) => set(s => ({ tabs: updateWindow(s.tabs, tabId, windowId, w => ({ ...w, title })) })),
            toggleExcluded: (tabId, windowId) => set(s => ({ tabs: updateWindow(s.tabs, tabId, windowId, w => ({ ...w, excluded: !w.excluded })) })),
            moveWindow: (tabId, windowId, dir) => set(s => ({
                tabs: s.tabs.map(t => {
                    if (t.id !== tabId) return t
                    const i = t.windows.findIndex(w => w.id === windowId)
                    const j = i + dir
                    if (i < 0 || j < 0 || j >= t.windows.length) return t
                    const ws = [...t.windows]
                    ;[ws[i], ws[j]] = [ws[j], ws[i]]
                    return { ...t, windows: ws }
                }),
            })),
            setWindowText: (tabId, windowId, text) => set(s => ({ tabs: updateWindow(s.tabs, tabId, windowId, w => ({ ...w, text })) })),

            importFromEditorState: (state) => {
                const converted = convertEditorState(state)
                if (!converted) return false
                set(converted)
                return true
            },

            // Append imported tabs (non-destructive). Accepts both the NovelAI
            // Prompt Editor export AND a fragment-store export JSON.
            importFile: (json) => {
                const editor = convertEditorState(json)
                const newTabs: PromptTab[] | null = editor ? editor.tabs : convertFragmentExport(json)
                if (!newTabs || newTabs.length === 0) return false
                set(s => ({
                    tabs: [...s.tabs, ...newTabs],
                    activeLeftId: s.activeLeftId ?? newTabs[0].id,
                    activeRightId: newTabs[0].id,
                }))
                return true
            },
        }),
        {
            name: 'nais2-prompt-library',
            onRehydrateStorage: () => (state) => {
                if (!state) return
                // Migrate old chip data (tags: string[]) → text, in place.
                let migrated = false
                for (const tab of state.tabs) {
                    for (const w of tab.windows as any[]) {
                        if (typeof w.text !== 'string') {
                            w.text = tagsToText(w.tags)
                            delete w.tags
                            migrated = true
                        }
                    }
                }
                if (migrated) console.log('[prompt-library] migrated chip tags → text')

                // First-run migration from the old embedded editor's localStorage.
                if (state.tabs.length > 0) return
                try {
                    const legacy = localStorage.getItem('novelaiPromptEditorState')
                    if (legacy) {
                        const converted = convertEditorState(JSON.parse(legacy))
                        if (converted) {
                            state.tabs = converted.tabs
                            state.activeLeftId = converted.activeLeftId
                            state.activeRightId = converted.activeRightId
                        }
                    }
                } catch (e) {
                    console.warn('[prompt-library] legacy migration failed', e)
                }
            },
        }
    )
)

// Include the prompt library in the disk auto-backup (Pictures/NAIS_Backup),
// so the user's saved prompts survive an IndexedDB/localStorage wipe.
attachStoreBackup(usePromptLibraryStore as any, 'prompt-library')
