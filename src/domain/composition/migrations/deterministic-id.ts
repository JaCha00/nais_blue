import { hashCanonicalValue } from '../canonical-serialize'

export interface DeterministicMigrationIdInput {
    namespace: string
    locator: readonly (string | number)[]
    identity?: unknown
    salt?: number
}

/**
 * Stable ID contract for migration-created entities. Locators are structural;
 * display labels are deliberately not accepted as a distinct identity source.
 */
export function deterministicCompositionMigrationId(
    input: DeterministicMigrationIdInput,
): string {
    const digest = hashCanonicalValue({
        contract: 'composition-migration-id-v1',
        namespace: input.namespace,
        locator: [...input.locator],
        identity: input.identity ?? null,
        salt: input.salt ?? 0,
    })
    return `${input.namespace}:migrated:${digest.slice(0, 24)}`
}

export interface MigrationIdClaim {
    id: string
    generated: boolean
    duplicate: boolean
    legacyId?: string
}

/** Document-wide allocator because the v2 schema requires globally unique entity IDs. */
export class DeterministicMigrationIdAllocator {
    readonly #used = new Set<string>()

    constructor(reservedIds: readonly string[] = []) {
        reservedIds.forEach(id => {
            if (id.trim()) this.#used.add(id)
        })
    }

    has(id: string): boolean {
        return this.#used.has(id)
    }

    claim(
        preferredId: unknown,
        input: Omit<DeterministicMigrationIdInput, 'salt'>,
    ): MigrationIdClaim {
        const legacyId = typeof preferredId === 'string' && preferredId.trim().length > 0
            ? preferredId.trim()
            : undefined
        if (legacyId !== undefined && !this.#used.has(legacyId)) {
            this.#used.add(legacyId)
            return { id: legacyId, generated: false, duplicate: false, legacyId }
        }

        let salt = 0
        let id = deterministicCompositionMigrationId({ ...input, salt })
        while (this.#used.has(id)) {
            salt += 1
            id = deterministicCompositionMigrationId({ ...input, salt })
        }
        this.#used.add(id)
        return {
            id,
            generated: true,
            duplicate: legacyId !== undefined,
            ...(legacyId === undefined ? {} : { legacyId }),
        }
    }
}
