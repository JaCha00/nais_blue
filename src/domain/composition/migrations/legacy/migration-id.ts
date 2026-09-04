function canonicalize(value: unknown): string {
    if (value === null) return 'null'

    switch (typeof value) {
        case 'string':
            return JSON.stringify(value)
        case 'number':
            return Number.isFinite(value) ? String(value) : JSON.stringify(String(value))
        case 'boolean':
            return value ? 'true' : 'false'
        case 'undefined':
            return 'undefined'
        case 'object':
            if (Array.isArray(value)) {
                return `[${value.map(canonicalize).join(',')}]`
            }
            return `{${Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
                .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
                .join(',')}}`
        default:
            return JSON.stringify(String(value))
    }
}

function fnv1a(value: string, seed: number): number {
    let hash = seed >>> 0
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index)
        hash = Math.imul(hash, 0x01000193)
    }
    return hash >>> 0
}

/**
 * Produces a deterministic, JSON-only migration identifier without relying on
 * runtime randomness or platform-specific crypto support.
 */
export function deterministicMigrationId(
    namespace: string,
    value: unknown,
    discriminator = '',
): string {
    const canonical = `${namespace}\u0000${canonicalize(value)}\u0000${discriminator}`
    const high = fnv1a(canonical, 0x811c9dc5).toString(16).padStart(8, '0')
    const low = fnv1a(canonical, 0x9e3779b9).toString(16).padStart(8, '0')
    return `${namespace}:migrated:${high}${low}`
}
