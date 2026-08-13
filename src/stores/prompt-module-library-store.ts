import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { indexedDBStorage, STRUCTURED_PROMPT_MODULE_STORE_KEY } from '@/lib/indexed-db'

export const PROMPT_MODULE_PART_KINDS = [
    'base',
    'detail',
    'additional',
    'negative',
    'character',
    'character-negative',
] as const

export type PromptModulePartKind = typeof PROMPT_MODULE_PART_KINDS[number]

export interface StructuredPromptModulePart {
    readonly kind: PromptModulePartKind
    readonly content: string
}

export interface StructuredPromptModule {
    readonly id: string
    readonly name: string
    readonly folder: string
    readonly parts: readonly StructuredPromptModulePart[]
    readonly createdAt: number
    readonly updatedAt: number
}

export type PromptModulePartValues = Partial<Record<PromptModulePartKind, string>>

export interface PromptModuleCreateInput {
    readonly name: string
    readonly folder?: string
    readonly parts?: PromptModulePartValues
}

export interface PromptModuleBatchResult {
    readonly createdIds: readonly string[]
    readonly skippedCount: number
}

interface PromptModuleLibraryState {
    readonly schemaVersion: 1
    readonly folders: readonly string[]
    readonly modules: readonly StructuredPromptModule[]
    addFolder(path: string): string | null
    createModule(input: PromptModuleCreateInput): string
    createModules(inputs: readonly PromptModuleCreateInput[]): PromptModuleBatchResult
    replaceModule(module: StructuredPromptModule): void
    deleteModule(id: string): void
    copyPart(sourceModuleId: string, kind: PromptModulePartKind, targetModuleId: string): void
}

function boundedText(value: string, maximum: number): string {
    return value.trim().slice(0, maximum)
}

export function normalizePromptModuleFolder(value: string): string | null {
    const segments = value
        .replace(/\\/g, '/')
        .split('/')
        .map(segment => segment.trim())
        .filter(Boolean)
    if (segments.length === 0) return ''
    if (segments.length > 12
        || segments.some(segment => segment === '.'
            || segment === '..'
            || segment.length > 80
            || /[<>:"|?*\u0000-\u001f]/.test(segment))) return null
    return segments.join('/')
}

export function mergePromptPartText(current: string, incoming: string): string {
    const left = current.trim()
    const right = incoming.trim()
    if (!left) return right
    if (!right || left === right) return left
    return `${left}${left.endsWith(',') ? ' ' : ', '}${right}`
}

export function movePromptModulePart(
    parts: readonly StructuredPromptModulePart[],
    kind: PromptModulePartKind,
    direction: 'up' | 'down',
): StructuredPromptModulePart[] {
    const index = parts.findIndex(part => part.kind === kind)
    const target = direction === 'up' ? index - 1 : index + 1
    if (index < 0 || target < 0 || target >= parts.length) return [...parts]
    const next = [...parts]
    ;[next[index], next[target]] = [next[target], next[index]]
    return next
}

function partsFromValues(values: PromptModulePartValues = {}): StructuredPromptModulePart[] {
    return PROMPT_MODULE_PART_KINDS
        .filter(kind => values[kind] !== undefined)
        .map(kind => ({ kind, content: String(values[kind] ?? '').slice(0, 100_000) }))
}

function safeModule(module: StructuredPromptModule): StructuredPromptModule {
    const folder = normalizePromptModuleFolder(module.folder)
    if (!module.id || !boundedText(module.name, 120) || folder === null) {
        throw new TypeError('Structured prompt module identity is invalid')
    }
    const seen = new Set<PromptModulePartKind>()
    const parts = module.parts.map(part => {
        if (!PROMPT_MODULE_PART_KINDS.includes(part.kind) || seen.has(part.kind)) {
            throw new TypeError('Structured prompt module parts are invalid')
        }
        seen.add(part.kind)
        return { kind: part.kind, content: part.content.slice(0, 100_000) }
    })
    return {
        ...module,
        name: boundedText(module.name, 120),
        folder,
        parts,
    }
}

export const usePromptModuleLibraryStore = create<PromptModuleLibraryState>()(
    persist(
        (set, get) => ({
            schemaVersion: 1,
            folders: [],
            modules: [],
            addFolder: path => {
                const folder = normalizePromptModuleFolder(path)
                if (!folder) return null
                set(state => ({ folders: [...new Set([...state.folders, folder])].sort() }))
                return folder
            },
            createModule: input => {
                const folder = normalizePromptModuleFolder(input.folder ?? '')
                const name = boundedText(input.name, 120)
                if (!name || folder === null) throw new TypeError('Structured prompt module name or folder is invalid')
                const now = Date.now()
                const id = `prompt-module-${crypto.randomUUID()}`
                const module = safeModule({
                    id,
                    name,
                    folder,
                    parts: partsFromValues(input.parts),
                    createdAt: now,
                    updatedAt: now,
                })
                set(state => ({
                    folders: folder ? [...new Set([...state.folders, folder])].sort() : state.folders,
                    modules: [module, ...state.modules],
                }))
                return id
            },
            createModules: inputs => {
                if (inputs.length > 10_000) throw new RangeError('Prompt module batch is too large')
                let result: PromptModuleBatchResult = { createdIds: [], skippedCount: 0 }
                set(state => {
                    const occupied = new Set(state.modules.map(module => (
                        `${module.folder}\u0000${module.name}`.toLocaleLowerCase()
                    )))
                    const folders = new Set(state.folders)
                    const created: StructuredPromptModule[] = []
                    let skippedCount = 0
                    const now = Date.now()

                    for (const input of inputs) {
                        const folder = normalizePromptModuleFolder(input.folder ?? '')
                        const name = boundedText(input.name, 120)
                        if (!name || folder === null) {
                            throw new TypeError('Structured prompt module name or folder is invalid')
                        }
                        const identity = `${folder}\u0000${name}`.toLocaleLowerCase()
                        if (occupied.has(identity)) {
                            skippedCount += 1
                            continue
                        }
                        occupied.add(identity)
                        if (folder) folders.add(folder)
                        created.push(safeModule({
                            id: `prompt-module-${crypto.randomUUID()}`,
                            name,
                            folder,
                            parts: partsFromValues(input.parts),
                            createdAt: now,
                            updatedAt: now,
                        }))
                    }

                    result = { createdIds: created.map(module => module.id), skippedCount }
                    if (created.length === 0) return state
                    return {
                        folders: [...folders].sort(),
                        modules: [...created, ...state.modules],
                    }
                })
                return result
            },
            replaceModule: module => {
                const safe = safeModule({ ...module, updatedAt: Date.now() })
                set(state => {
                    if (!state.modules.some(candidate => candidate.id === safe.id)) return state
                    return {
                        folders: safe.folder
                            ? [...new Set([...state.folders, safe.folder])].sort()
                            : state.folders,
                        modules: state.modules.map(candidate => candidate.id === safe.id ? safe : candidate),
                    }
                })
            },
            deleteModule: id => set(state => ({ modules: state.modules.filter(module => module.id !== id) })),
            copyPart: (sourceModuleId, kind, targetModuleId) => {
                const source = get().modules.find(module => module.id === sourceModuleId)
                const sourcePart = source?.parts.find(part => part.kind === kind)
                if (!sourcePart) return
                set(state => ({
                    modules: state.modules.map(module => {
                        if (module.id !== targetModuleId) return module
                        const targetIndex = module.parts.findIndex(part => part.kind === kind)
                        const parts = [...module.parts]
                        if (targetIndex === -1) parts.push({ ...sourcePart })
                        else parts[targetIndex] = {
                            kind,
                            content: mergePromptPartText(parts[targetIndex].content, sourcePart.content),
                        }
                        return safeModule({ ...module, parts, updatedAt: Date.now() })
                    }),
                }))
            },
        }),
        {
            name: STRUCTURED_PROMPT_MODULE_STORE_KEY,
            version: 1,
            storage: createJSONStorage(() => indexedDBStorage),
            partialize: state => ({
                schemaVersion: state.schemaVersion,
                folders: state.folders,
                modules: state.modules,
            }),
        },
    ),
)
