export interface TextAssemblyCenter {
    readonly x: number
    readonly y: number
}

export interface TextAssemblyCharacter {
    readonly prompt: string
    readonly enabled?: boolean
    readonly center?: TextAssemblyCenter
}

export interface TextAssemblyInput {
    readonly model: string
    readonly basePrompt: string
    readonly characterPrompts: readonly TextAssemblyCharacter[]
    readonly useCoords: boolean
}

const MANUAL_TEXT_MARKER = /(^|[^\p{L}\p{N}_])text\s*:/iu
const CJK_WITHOUT_HANGUL = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u

const QUOTE_PAIRS = [
    { open: '"', close: '"', boundarySafe: false },
    { open: '\u201c', close: '\u201d', boundarySafe: false },
    { open: '\u300c', close: '\u300d', boundarySafe: false },
    { open: "'", close: "'", boundarySafe: true },
    { open: '\u2018', close: '\u2019', boundarySafe: true },
] as const

export function hasManualTextMarker(prompt: string): boolean {
    return MANUAL_TEXT_MARKER.test(prompt)
}

export function splitManualTextPrompt(prompt: string): {
    readonly beforeMarker: string
    readonly manualText: string
} | null {
    const match = MANUAL_TEXT_MARKER.exec(prompt)
    if (match === null) return null
    const markerStart = match.index + match[1].length
    return {
        beforeMarker: prompt.slice(0, markerStart).replace(/[\s,]+$/u, ''),
        manualText: prompt.slice(markerStart).trimStart(),
    }
}

function isV5Model(model: string): boolean {
    return model.startsWith('nai-diffusion-5-')
}

function isWordCharacter(char: string | undefined): boolean {
    return char === undefined ? false : /[\p{L}\p{N}_]/u.test(char)
}

function isBoundaryQuote(text: string, index: number): boolean {
    return !(isWordCharacter(text[index - 1]) && isWordCharacter(text[index + 1]))
}

function findClosingQuote(text: string, start: number, close: string, boundarySafe: boolean): number {
    for (let index = start + 1; index < text.length; index += 1) {
        if (text[index] !== close) continue
        if (boundarySafe && !isBoundaryQuote(text, index)) continue
        return index
    }
    return -1
}

function cleanSnippet(snippet: string): string {
    return snippet.trim()
}

function extractQuoteSnippets(prompt: string): string[] {
    const snippets: string[] = []
    let index = 0
    while (index < prompt.length) {
        const pair = QUOTE_PAIRS.find(candidate => candidate.open === prompt[index])
        if (pair === undefined || (pair.boundarySafe && !isBoundaryQuote(prompt, index))) {
            index += 1
            continue
        }

        const closeIndex = findClosingQuote(prompt, index, pair.close, pair.boundarySafe)
        if (closeIndex < 0) {
            index += 1
            continue
        }

        const snippet = cleanSnippet(prompt.slice(index + pair.open.length, closeIndex))
        if (snippet) snippets.push(snippet)
        index = closeIndex + pair.close.length
    }

    return snippets
}

function centerFor(character: TextAssemblyCharacter): TextAssemblyCenter {
    return character.center ?? { x: 0.5, y: 0.5 }
}

function splitCoordinateRows(sortedByY: readonly TextAssemblyCharacter[]): TextAssemblyCharacter[][] {
    if (sortedByY.length <= 1) return [Array.from(sortedByY)]

    const span = centerFor(sortedByY[sortedByY.length - 1]).y - centerFor(sortedByY[0]).y
    let largestGap = -1
    let splitIndex = 1
    for (let index = 1; index < sortedByY.length; index += 1) {
        const gap = centerFor(sortedByY[index]).y - centerFor(sortedByY[index - 1]).y
        // Strict comparison matches the provider's stable first-gap tie break.
        if (gap > largestGap) {
            largestGap = gap
            splitIndex = index
        }
    }

    if (span <= 0.15 && largestGap <= 0.10) return [Array.from(sortedByY)]
    return [
        ...splitCoordinateRows(sortedByY.slice(0, splitIndex)),
        ...splitCoordinateRows(sortedByY.slice(splitIndex)),
    ]
}

function orderedCharacters(characters: readonly TextAssemblyCharacter[], useCoords: boolean): TextAssemblyCharacter[] {
    const active = characters.filter(character => character.enabled !== false && character.prompt.length > 0)
    if (!useCoords) return active

    const sortedByY = [...active].sort((left, right) => centerFor(left).y - centerFor(right).y)
    return splitCoordinateRows(sortedByY)
        .flatMap(row => row.sort((left, right) => centerFor(left).x - centerFor(right).x))
}

export function assembleV5TextPrompt(input: TextAssemblyInput): string {
    if (!isV5Model(input.model)) return input.basePrompt

    const characters = orderedCharacters(input.characterPrompts, input.useCoords)
    if ([input.basePrompt, ...characters.map(character => character.prompt)].some(hasManualTextMarker)) {
        return input.basePrompt
    }

    const promptVariants = input.basePrompt.split('|')
    const groups = [
        extractQuoteSnippets(promptVariants[0] ?? ''),
        ...characters.map(character => extractQuoteSnippets(character.prompt)),
    ]
    const joined = groups.flat().join('')
    if (joined.length > 0) {
        const cjkCharacters = [...joined].filter(char => CJK_WITHOUT_HANGUL.test(char)).length
        if (cjkCharacters / [...joined].length > 0.3) groups.forEach(group => group.reverse())
    }
    const snippets = groups.flat()
    if (snippets.length === 0) return input.basePrompt

    const body = (promptVariants[0] ?? '').replace(/[\s,]+$/u, '')
    const textBlock = `teXt: ${snippets.join('\n\n')}`
    promptVariants[0] = body.length > 0 ? `${body}, ${textBlock}` : textBlock
    return promptVariants.join('|')
}
