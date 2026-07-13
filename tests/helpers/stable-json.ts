export interface StableJsonOptions {
    /** Matches JSON.stringify's indentation rules. */
    space?: number | string
}

const OMIT = Symbol('omit-from-json')

type NormalizedJson =
    | null
    | boolean
    | number
    | string
    | NormalizedJson[]
    | { [key: string]: NormalizedJson }

function normalizeForJson(
    value: unknown,
    ancestors: Set<object>,
    key: string,
): NormalizedJson | typeof OMIT {
    if (value === null) return null

    switch (typeof value) {
        case 'string':
        case 'boolean':
            return value
        case 'number':
            return Number.isFinite(value) ? value : null
        case 'undefined':
        case 'function':
        case 'symbol':
            return OMIT
        case 'bigint':
            throw new TypeError('Cannot stable-serialize a BigInt value as JSON')
        case 'object':
            break
    }

    if (ancestors.has(value)) {
        throw new TypeError('Cannot stable-serialize a cyclic structure as JSON')
    }

    ancestors.add(value)
    try {
        if (value instanceof Number || value instanceof String || value instanceof Boolean) {
            return normalizeForJson(value.valueOf(), ancestors, key)
        }

        const withToJson = value as { toJSON?: (propertyKey: string) => unknown }
        if (typeof withToJson.toJSON === 'function') {
            return normalizeForJson(withToJson.toJSON(key), ancestors, key)
        }

        if (Array.isArray(value)) {
            return value.map((item, index) => {
                const normalized = normalizeForJson(item, ancestors, String(index))
                return normalized === OMIT ? null : normalized
            })
        }

        const normalized: { [key: string]: NormalizedJson } = {}
        for (const propertyKey of Object.keys(value).sort()) {
            const propertyValue = normalizeForJson(
                (value as Record<string, unknown>)[propertyKey],
                ancestors,
                propertyKey,
            )
            if (propertyValue !== OMIT) normalized[propertyKey] = propertyValue
        }
        return normalized
    } finally {
        ancestors.delete(value)
    }
}

/**
 * Serializes JSON with recursively sorted object keys and native JSON value semantics.
 * Arrays retain their original order. Unsupported root values and cycles fail loudly.
 */
export function stableJsonStringify(value: unknown, options: StableJsonOptions = {}): string {
    const normalized = normalizeForJson(value, new Set<object>(), '')
    if (normalized === OMIT) {
        throw new TypeError('Cannot stable-serialize a non-JSON root value')
    }
    return JSON.stringify(normalized, null, options.space ?? 2)
}

export const stableSerialize = stableJsonStringify
