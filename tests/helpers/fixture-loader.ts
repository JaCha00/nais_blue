import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, posix, relative, resolve, win32 } from 'node:path'

export const DEFAULT_FIXTURE_ROOT = resolve(process.cwd(), 'tests', 'fixtures')

export interface FixtureLoadOptions {
    root?: string
}

export class FixturePathError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'FixturePathError'
    }
}

export class FixtureLoadError extends Error {
    readonly originalError: unknown

    constructor(message: string, originalError: unknown) {
        super(message)
        this.name = 'FixtureLoadError'
        this.originalError = originalError
    }
}

function isWithinRoot(root: string, candidate: string): boolean {
    const pathFromRoot = relative(root, candidate)
    return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot))
}

function assertRelativeFixturePath(fixturePath: string): void {
    if (fixturePath.length === 0 || fixturePath.trim().length === 0) {
        throw new FixturePathError('Fixture path must not be empty')
    }
    if (fixturePath.includes('\0')) {
        throw new FixturePathError('Fixture path must not contain a null byte')
    }
    if (isAbsolute(fixturePath) || posix.isAbsolute(fixturePath) || win32.isAbsolute(fixturePath)) {
        throw new FixturePathError(`Fixture path must be relative: ${fixturePath}`)
    }

    const segments = fixturePath.replace(/\\/g, '/').split('/')
    if (segments.some((segment) => segment === '..')) {
        throw new FixturePathError(`Fixture path traversal is not allowed: ${fixturePath}`)
    }
}

/** Resolves a fixture path without allowing absolute paths or lexical root escape. */
export function resolveFixturePath(
    fixturePath: string,
    root = DEFAULT_FIXTURE_ROOT,
): string {
    assertRelativeFixturePath(fixturePath)

    const absoluteRoot = resolve(root)
    const candidate = resolve(absoluteRoot, fixturePath)
    if (!isWithinRoot(absoluteRoot, candidate)) {
        throw new FixturePathError(`Fixture path escapes its root: ${fixturePath}`)
    }
    return candidate
}

async function resolveVerifiedFixturePath(fixturePath: string, root: string): Promise<string> {
    const absoluteRoot = resolve(root)
    const candidate = resolveFixturePath(fixturePath, absoluteRoot)

    let canonicalRoot: string
    let canonicalCandidate: string
    try {
        [canonicalRoot, canonicalCandidate] = await Promise.all([
            realpath(absoluteRoot),
            realpath(candidate),
        ])
    } catch (error) {
        throw new FixtureLoadError(`Unable to resolve fixture "${fixturePath}"`, error)
    }

    if (!isWithinRoot(canonicalRoot, canonicalCandidate)) {
        throw new FixturePathError(`Fixture symlink escapes its root: ${fixturePath}`)
    }

    let fixtureStats
    try {
        fixtureStats = await stat(canonicalCandidate)
    } catch (error) {
        throw new FixtureLoadError(`Unable to inspect fixture "${fixturePath}"`, error)
    }
    if (!fixtureStats.isFile()) {
        throw new FixtureLoadError(`Fixture is not a regular file: "${fixturePath}"`, undefined)
    }

    return canonicalCandidate
}

/** Loads a UTF-8 fixture after lexical and realpath containment checks. */
export async function loadFixtureText(
    fixturePath: string,
    options: FixtureLoadOptions = {},
): Promise<string> {
    const root = options.root ?? DEFAULT_FIXTURE_ROOT
    const verifiedPath = await resolveVerifiedFixturePath(fixturePath, root)
    try {
        return await readFile(verifiedPath, 'utf8')
    } catch (error) {
        throw new FixtureLoadError(`Unable to read fixture "${fixturePath}"`, error)
    }
}

/** Loads and parses a UTF-8 JSON fixture, accepting an optional UTF-8 BOM. */
export async function loadFixtureJson<T = unknown>(
    fixturePath: string,
    options: FixtureLoadOptions = {},
): Promise<T> {
    const source = await loadFixtureText(fixturePath, options)
    try {
        return JSON.parse(source.replace(/^\uFEFF/, '')) as T
    } catch (error) {
        throw new FixtureLoadError(`Fixture contains invalid JSON: "${fixturePath}"`, error)
    }
}

export const loadFixture = loadFixtureJson
