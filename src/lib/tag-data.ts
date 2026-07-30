export interface Tag {
    label: string
    value: string
    count: number
    type: string
    searchAliases?: string[]
}

export interface IndexedTag extends Tag {
    _lower: string
    _searchTerms: string[]
}

interface AutocompleteTagIndex {
    all: IndexedTag[]
    byFirstChar: Record<string, IndexedTag[]>
}

let tagsPromise: Promise<Tag[]> | null = null
let autocompleteIndexPromise: Promise<AutocompleteTagIndex> | null = null

// Source: https://docs.novelai.net/en/image/tags/#renamed-tags
export const NAI_RENAMED_TAGS: Readonly<Record<string, string>> = {
    v: 'peace sign',
    double_v: 'double peace',
    '|_|': 'bar eyes',
    '\\||/': 'open \\m/',
    ':|': 'neutral face',
    ';|': 'neutral face',
    '<|>_<|>': 'neco-arc eyes',
    eyepatch_bikini: 'square bikini',
    'tachi-e': 'character image',
}

function renamedTagKey(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, '_').replace(/_+/g, '_')
}

function recommendedTag(value: string): string | undefined {
    return NAI_RENAMED_TAGS[renamedTagKey(value)]
}

/** Canonicalize NovelAI-incompatible Danbooru names without mutating tag data. */
export function applyNovelAiTagRenames(tags: readonly Tag[]): Tag[] {
    const merged = new Map<string, Tag>()

    for (const tag of tags) {
        const replacement = recommendedTag(tag.label) ?? recommendedTag(tag.value)
        const candidate: Tag = {
            ...tag,
            label: replacement ?? tag.label,
            value: replacement ?? tag.value,
            ...(replacement === undefined
                ? {}
                : { searchAliases: [...new Set([...(tag.searchAliases ?? []), tag.label, tag.value])] }),
        }
        const key = `${candidate.value}\0${candidate.type}`
        const existing = merged.get(key)
        if (!existing) {
            merged.set(key, candidate)
            continue
        }

        const preferred = candidate.count > existing.count ? candidate : existing
        const aliases = [...new Set([
            ...(existing.searchAliases ?? []),
            ...(candidate.searchAliases ?? []),
        ])].filter(alias => alias !== preferred.label && alias !== preferred.value)
        merged.set(key, {
            ...preferred,
            ...(aliases.length === 0 ? {} : { searchAliases: aliases }),
        })
    }

    return [...merged.values()]
}

// Shared by AutocompleteTextarea and tag-matcher so the large tags JSON stays out of
// the startup bundle and is fetched only after a tag feature is actually used.
export function loadTags(): Promise<Tag[]> {
    if (!tagsPromise) {
        tagsPromise = import('@/assets/tags.json')
            .then(module => applyNovelAiTagRenames(module.default as Tag[]))
    }

    return tagsPromise
}

export function loadAutocompleteTagIndex(): Promise<AutocompleteTagIndex> {
    if (!autocompleteIndexPromise) {
        autocompleteIndexPromise = loadTags().then(tags => {
            const all = tags.map(tag => ({
                ...tag,
                _lower: tag.label.toLowerCase(),
                _searchTerms: [tag.label, ...(tag.searchAliases ?? [])]
                    .map(term => term.toLowerCase()),
            }))

            const byFirstChar: Record<string, IndexedTag[]> = {}
            for (const tag of all) {
                for (const firstChar of new Set(tag._searchTerms.map(term => term[0] || '_'))) {
                    if (!byFirstChar[firstChar]) byFirstChar[firstChar] = []
                    byFirstChar[firstChar].push(tag)
                }
            }

            return { all, byFirstChar }
        })
    }

    return autocompleteIndexPromise
}
