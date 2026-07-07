export interface DedupePromptOptions {
    separator?: string
}

interface PromptDepth {
    curly: number
    square: number
    round: number
}

const DEFAULT_SEPARATOR = ', '

function isTopLevel(depth: PromptDepth): boolean {
    return depth.curly === 0 && depth.square === 0 && depth.round === 0
}

function updateDepth(char: string, depth: PromptDepth): void {
    if (char === '{') depth.curly += 1
    if (char === '}') depth.curly = Math.max(0, depth.curly - 1)
    if (char === '[') depth.square += 1
    if (char === ']') depth.square = Math.max(0, depth.square - 1)
    if (char === '(') depth.round += 1
    if (char === ')') depth.round = Math.max(0, depth.round - 1)
}

function stripInlineComment(line: string): string {
    if (line.trimStart().startsWith('#')) return ''

    const depth: PromptDepth = { curly: 0, square: 0, round: 0 }

    for (let index = 0; index < line.length; index += 1) {
        const char = line[index]

        if (char === '#' && isTopLevel(depth)) {
            return line.slice(0, index).trimEnd()
        }

        updateDepth(char, depth)
    }

    return line
}

export function removePromptComments(prompt: string): string {
    if (!prompt) return ''

    return prompt
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map(stripInlineComment)
        .filter(line => line.trim().length > 0)
        .join('\n')
}

export function splitPromptTokens(prompt: string): string[] {
    const tokens: string[] = []
    const depth: PromptDepth = { curly: 0, square: 0, round: 0 }
    let current = ''

    for (const char of prompt) {
        if ((char === ',' || char === '\n') && isTopLevel(depth)) {
            const token = current.trim()
            if (token) tokens.push(token)
            current = ''
            continue
        }

        current += char
        updateDepth(char, depth)
    }

    const trailing = current.trim()
    if (trailing) tokens.push(trailing)

    return tokens
}

function unwrapWeightBrackets(token: string): string {
    let value = token.trim()
    let changed = true

    while (changed && value.length >= 2) {
        changed = false

        if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))) {
            value = value.slice(1, -1).trim()
            changed = true
        }
    }

    return value
}

function normalizeDedupeKey(token: string): string {
    const unwrapped = unwrapWeightBrackets(token)
    const naiWeightMatch = unwrapped.match(/^\s*\d+(?:\.\d+)?::(.+)::\s*$/)
    const value = naiWeightMatch ? naiWeightMatch[1] : unwrapped

    return value
        .replace(/\s+/g, ' ')
        .trim()
        .toLocaleLowerCase()
}

export function dedupePromptTokens(prompt: string, options: DedupePromptOptions = {}): string {
    const cleaned = removePromptComments(prompt)
    if (!cleaned) return ''

    const seen = new Set<string>()
    const deduped: string[] = []

    for (const token of splitPromptTokens(cleaned)) {
        const key = normalizeDedupeKey(token)
        if (!key || seen.has(key)) continue

        seen.add(key)
        deduped.push(token)
    }

    return deduped.join(options.separator ?? DEFAULT_SEPARATOR)
}
