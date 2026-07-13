import { inspect, isDeepStrictEqual } from 'node:util'

export type DeepDifferenceKind = 'array-length' | 'missing' | 'type' | 'unexpected' | 'value'

export interface DeepDifference {
    path: string
    kind: DeepDifferenceKind
    actual?: unknown
    expected?: unknown
}

export interface DeepDiffOptions {
    maxDifferences?: number
}

function childPath(parent: string, key: string): string {
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) return `${parent}.${key}`
    return `${parent}[${JSON.stringify(key)}]`
}

function valueType(value: unknown): string {
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'array'
    if (value instanceof Date) return 'date'
    return typeof value
}

function markVisitedPair(
    actual: object,
    expected: object,
    visited: WeakMap<object, WeakSet<object>>,
): boolean {
    const expectedValues = visited.get(actual)
    if (expectedValues?.has(expected)) return true
    if (expectedValues) {
        expectedValues.add(expected)
    } else {
        visited.set(actual, new WeakSet([expected]))
    }
    return false
}

/** Returns path-oriented differences, ordered deterministically for readable failures. */
export function deepDiff(
    actual: unknown,
    expected: unknown,
    options: DeepDiffOptions = {},
): DeepDifference[] {
    const maxDifferences = options.maxDifferences ?? 50
    if (!Number.isInteger(maxDifferences) || maxDifferences < 1) {
        throw new RangeError('maxDifferences must be a positive integer')
    }

    const differences: DeepDifference[] = []
    const visited = new WeakMap<object, WeakSet<object>>()

    const compare = (actualValue: unknown, expectedValue: unknown, path: string): void => {
        if (differences.length >= maxDifferences || Object.is(actualValue, expectedValue)) return

        const actualType = valueType(actualValue)
        const expectedType = valueType(expectedValue)
        if (actualType !== expectedType) {
            differences.push({ path, kind: 'type', actual: actualValue, expected: expectedValue })
            return
        }

        if (
            actualValue === null
            || expectedValue === null
            || typeof actualValue !== 'object'
            || typeof expectedValue !== 'object'
        ) {
            differences.push({ path, kind: 'value', actual: actualValue, expected: expectedValue })
            return
        }

        if (actualValue instanceof Date && expectedValue instanceof Date) {
            if (actualValue.getTime() !== expectedValue.getTime()) {
                differences.push({ path, kind: 'value', actual: actualValue, expected: expectedValue })
            }
            return
        }

        if (markVisitedPair(actualValue, expectedValue, visited)) return

        if (Array.isArray(actualValue) && Array.isArray(expectedValue)) {
            if (actualValue.length !== expectedValue.length) {
                differences.push({
                    path,
                    kind: 'array-length',
                    actual: actualValue.length,
                    expected: expectedValue.length,
                })
            }
            const sharedLength = Math.min(actualValue.length, expectedValue.length)
            for (let index = 0; index < sharedLength; index += 1) {
                compare(actualValue[index], expectedValue[index], `${path}[${index}]`)
            }
            for (let index = sharedLength; index < expectedValue.length && differences.length < maxDifferences; index += 1) {
                differences.push({ path: `${path}[${index}]`, kind: 'missing', expected: expectedValue[index] })
            }
            for (let index = sharedLength; index < actualValue.length && differences.length < maxDifferences; index += 1) {
                differences.push({ path: `${path}[${index}]`, kind: 'unexpected', actual: actualValue[index] })
            }
            return
        }

        const actualPrototype = Object.getPrototypeOf(actualValue)
        const expectedPrototype = Object.getPrototypeOf(expectedValue)
        const bothPlain = (actualPrototype === Object.prototype || actualPrototype === null)
            && (expectedPrototype === Object.prototype || expectedPrototype === null)
        if (!bothPlain) {
            if (!isDeepStrictEqual(actualValue, expectedValue)) {
                differences.push({ path, kind: 'value', actual: actualValue, expected: expectedValue })
            }
            return
        }

        const actualRecord = actualValue as Record<string, unknown>
        const expectedRecord = expectedValue as Record<string, unknown>
        const keys = [...new Set([...Object.keys(actualRecord), ...Object.keys(expectedRecord)])].sort()
        for (const key of keys) {
            if (differences.length >= maxDifferences) break
            const hasActual = Object.prototype.hasOwnProperty.call(actualRecord, key)
            const hasExpected = Object.prototype.hasOwnProperty.call(expectedRecord, key)
            const pathForKey = childPath(path, key)
            if (!hasActual) {
                differences.push({ path: pathForKey, kind: 'missing', expected: expectedRecord[key] })
            } else if (!hasExpected) {
                differences.push({ path: pathForKey, kind: 'unexpected', actual: actualRecord[key] })
            } else {
                compare(actualRecord[key], expectedRecord[key], pathForKey)
            }
        }
    }

    compare(actual, expected, '$')
    return differences
}

function inspectValue(value: unknown): string {
    return inspect(value, {
        breakLength: 100,
        colors: false,
        compact: true,
        depth: 6,
        maxArrayLength: 20,
        maxStringLength: 300,
        sorted: true,
    })
}

export function formatDeepDiff(differences: readonly DeepDifference[]): string {
    if (differences.length === 0) return 'No differences'

    const lines = [`${differences.length} deep difference${differences.length === 1 ? '' : 's'}:`]
    for (const difference of differences) {
        lines.push(`- ${difference.path}: ${difference.kind}`)
        if (difference.kind !== 'unexpected') {
            lines.push(`  expected: ${inspectValue(difference.expected)}`)
        }
        if (difference.kind !== 'missing') {
            lines.push(`  actual:   ${inspectValue(difference.actual)}`)
        }
    }
    return lines.join('\n')
}

export class DeepDiffAssertionError extends Error {
    readonly differences: readonly DeepDifference[]

    constructor(differences: readonly DeepDifference[], message = 'Deep equality assertion failed') {
        super(`${message}\n${formatDeepDiff(differences)}`)
        this.name = 'DeepDiffAssertionError'
        this.differences = differences
    }
}

export function assertDeepEqual(
    actual: unknown,
    expected: unknown,
    message?: string,
): asserts actual {
    if (isDeepStrictEqual(actual, expected)) return
    throw new DeepDiffAssertionError(deepDiff(actual, expected), message)
}
