export interface PromptTagFrequency {
    postCount: number | null
    exactMatch: boolean
}

export interface PromptFrequencySortResult {
    text: string
    changed: boolean
    movedCount: number
    sortableCount: number
    unresolvedCount: number
    diagnostics: readonly string[]
}

interface LeafNode {
    kind: 'leaf'
    raw: string
    sourceIndex: number
    frequency?: PromptTagFrequency
}

interface GroupNode {
    kind: 'group'
    prefix: string
    scope: Scope
    suffix: string
}

interface Slot {
    leading: string
    trailing: string
    node: LeafNode | GroupNode | null
}

interface Scope {
    slots: Slot[]
}

interface ParsedLine {
    ending: string
    raw?: string
    scope?: Scope
}

interface ParseState {
    diagnostics: string[]
    leaves: LeafNode[]
}

const WEIGHT_PREFIX = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(:+)/
const WEIGHT_GROUP = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)::)([\s\S]*)(::)$/

/**
 * Parses only syntax needed by the sorter. Raw slots own whitespace and delimiters,
 * while leaf nodes move between slots so formatting and prompt spelling survive.
 */
function parseScope(source: string, state: ParseState, lineNumber: number): Scope | null {
    const ranges: Array<[number, number]> = []
    let start = 0
    let curlyDepth = 0
    let squareDepth = 0

    for (let index = 0; index < source.length; index += 1) {
        const atSlotStart = source.slice(start, index).trim().length === 0
        if (atSlotStart) {
            const weight = WEIGHT_PREFIX.exec(source.slice(index))
            if (weight) {
                if (weight[1] !== '::') {
                    state.diagnostics.push(`line ${lineNumber}: malformed numeric weight group`)
                    return null
                }
                const contentStart = index + weight[0].length
                const close = source.indexOf('::', contentStart)
                if (close < 0) {
                    state.diagnostics.push(`line ${lineNumber}: unclosed numeric weight group`)
                    return null
                }
                index = close + 1
                continue
            }
        }

        const character = source[index]
        if (character === '{') curlyDepth += 1
        else if (character === '}') curlyDepth = Math.max(0, curlyDepth - 1)
        else if (character === '[') squareDepth += 1
        else if (character === ']') squareDepth = Math.max(0, squareDepth - 1)
        else if (character === ',' && curlyDepth === 0 && squareDepth === 0) {
            ranges.push([start, index])
            start = index + 1
        }
    }
    ranges.push([start, source.length])

    const slots: Slot[] = []
    for (const [from, to] of ranges) {
        const raw = source.slice(from, to)
        if (!raw.trim()) {
            slots.push({ leading: raw, trailing: '', node: null })
            continue
        }
        const leading = raw.match(/^\s*/)?.[0] ?? ''
        const trailing = raw.match(/\s*$/)?.[0] ?? ''
        const core = raw.slice(leading.length, raw.length - trailing.length)

        const group = WEIGHT_GROUP.exec(core)
        if (group) {
            const inner = parseScope(group[2], state, lineNumber)
            if (!inner) return null
            slots.push({
                leading,
                trailing,
                node: { kind: 'group', prefix: group[1], scope: inner, suffix: group[3] },
            })
            continue
        }
        if (WEIGHT_PREFIX.test(core)) {
            state.diagnostics.push(`line ${lineNumber}: malformed numeric weight group`)
            return null
        }

        const leaf: LeafNode = { kind: 'leaf', raw: core, sourceIndex: state.leaves.length }
        state.leaves.push(leaf)
        slots.push({ leading, trailing, node: leaf })
    }
    return { slots }
}

function parse(source: string): { lines: ParsedLine[]; state: ParseState } {
    const state: ParseState = { diagnostics: [], leaves: [] }
    const lines: ParsedLine[] = []
    const matches = source.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)

    for (const match of matches) {
        if (!match[0]) continue
        const [, body, ending] = match
        const lineNumber = lines.length + 1
        if (/^\s*(?:#|\/\/)/.test(body)) {
            state.diagnostics.push(`line ${lineNumber}: comment skipped`)
            lines.push({ raw: body, ending })
        } else if (/<[^>\r\n]+>/.test(body)) {
            state.diagnostics.push(`line ${lineNumber}: fragment skipped`)
            lines.push({ raw: body, ending })
        } else {
            const leafStart = state.leaves.length
            const scope = parseScope(body, state, lineNumber)
            if (scope) lines.push({ scope, ending })
            else {
                state.leaves.length = leafStart
                lines.push({ raw: body, ending })
            }
        }
    }
    return { lines, state }
}

/** Removes only balanced outer emphasis wrappers; the original spelling stays in the AST. */
function lookupText(raw: string): string {
    let text = raw.trim()
    while (
        text.length >= 2
        && ((text.startsWith('{') && text.endsWith('}'))
            || (text.startsWith('[') && text.endsWith(']')))
    ) {
        text = text.slice(1, -1).trim()
    }
    return text
}

function renderScope(scope: Scope): string {
    return scope.slots.map((slot) => {
        const content = slot.node?.kind === 'group'
            ? `${slot.node.prefix}${renderScope(slot.node.scope)}${slot.node.suffix}`
            : slot.node?.raw ?? ''
        return `${slot.leading}${content}${slot.trailing}`
    }).join(',')
}

function isSortable(leaf: LeafNode): boolean {
    return leaf.frequency?.exactMatch === true && leaf.frequency.postCount !== null
}

/** Sorts leaf runs around fixed weighted groups and empty slots, preserving stable ties. */
function sortScope(scope: Scope): number {
    let moved = 0
    let runStart = 0

    const sortRun = (end: number) => {
        const slots = scope.slots.slice(runStart, end)
        const leaves = slots.map((slot) => slot.node).filter((node): node is LeafNode => node?.kind === 'leaf')
        const sorted = [...leaves].sort((left, right) => {
            const leftSortable = isSortable(left)
            const rightSortable = isSortable(right)
            if (leftSortable !== rightSortable) return leftSortable ? -1 : 1
            if (leftSortable && rightSortable) {
                const countDifference = left.frequency!.postCount! - right.frequency!.postCount!
                if (countDifference !== 0) return countDifference
            }
            return left.sourceIndex - right.sourceIndex
        })
        sorted.forEach((leaf, index) => {
            if (leaf !== leaves[index]) moved += 1
            slots[index].node = leaf
        })
    }

    scope.slots.forEach((slot, index) => {
        if (slot.node?.kind === 'group' || slot.node === null) {
            sortRun(index)
            if (slot.node?.kind === 'group') moved += sortScope(slot.node.scope)
            runStart = index + 1
        }
    })
    sortRun(scope.slots.length)
    return moved
}

export function collectPromptFrequencySortTokens(source: string): string[] {
    const { state } = parse(source)
    return state.leaves.map((leaf) => lookupText(leaf.raw))
}

export function sortPromptByFrequency(
    source: string,
    frequencies: readonly PromptTagFrequency[],
): PromptFrequencySortResult {
    const { lines, state } = parse(source)
    state.leaves.forEach((leaf, index) => {
        leaf.frequency = frequencies[index]
    })
    if (frequencies.length !== state.leaves.length) {
        state.diagnostics.push(`frequency count mismatch: expected ${state.leaves.length}, received ${frequencies.length}`)
    }

    const movedCount = lines.reduce(
        (total, line) => total + (line.scope ? sortScope(line.scope) : 0),
        0,
    )
    const text = lines.map((line) => `${line.scope ? renderScope(line.scope) : line.raw ?? ''}${line.ending}`).join('')
    const sortableCount = state.leaves.filter(isSortable).length

    return {
        text,
        changed: text !== source,
        movedCount,
        sortableCount,
        unresolvedCount: state.leaves.length - sortableCount,
        diagnostics: state.diagnostics,
    }
}
