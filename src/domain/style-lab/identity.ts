import { hashCanonicalValue } from '@/domain/composition/canonical-serialize'

export type StyleCombinationLifecycle = 'draft' | 'previewed' | 'eligible' | 'archived'

export interface StyleIdentityTag {
    tag: string
    kind?: string
    weight?: number
}

export interface StyleCombinationIdentity {
    semanticHash: string
    renderHash: string
}

function normalizedTag(tag: StyleIdentityTag) {
    return {
        kind: (tag.kind ?? 'tag').trim().toLowerCase(),
        tag: tag.tag.trim().toLowerCase(),
        weight: Number.isFinite(tag.weight) ? Math.round((tag.weight as number) * 1000) / 1000 : 1,
    }
}

/**
 * Semantic identity ignores ordering and exact weights to group one style family;
 * render identity retains both so Queue idempotency distinguishes visible variants.
 */
export function styleCombinationIdentity(
    tags: readonly StyleIdentityTag[],
): StyleCombinationIdentity {
    const renderTags = tags.map(normalizedTag).filter(tag => tag.tag.length > 0)
    const semanticTags = [...renderTags]
        .map(({ kind, tag }) => ({ kind, tag }))
        .sort((left, right) => left.kind.localeCompare(right.kind) || left.tag.localeCompare(right.tag))
    return {
        semanticHash: `style-semantic:${hashCanonicalValue(semanticTags)}`,
        renderHash: `style-render:${hashCanonicalValue(renderTags)}`,
    }
}
