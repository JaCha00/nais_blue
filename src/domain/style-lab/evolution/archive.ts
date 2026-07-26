import { hashCanonicalValue } from '@/domain/composition/canonical-serialize'
import {
    STYLE_EVOLUTION_ARCHIVE_SCHEMA_VERSION,
    type StyleArchiveMember,
    type StyleEvolutionArchiveCell,
    type StyleEvolutionCellAxes,
    type StyleEvolutionTag,
    type StyleTagCountBin,
    type StyleWeightShape,
} from './types'

function finite(value: number, fallback = 0): number {
    return Number.isFinite(value) ? value : fallback
}

export function classifyStyleEvolutionAxes(tags: readonly StyleEvolutionTag[]): StyleEvolutionCellAxes {
    const tagCount: StyleTagCountBin = tags.length <= 4
        ? 'compact'
        : tags.length <= 8 ? 'balanced' : 'dense'
    const weights = tags.map(tag => finite(tag.weight, 1))
    const spread = weights.length === 0 ? 0 : Math.max(...weights) - Math.min(...weights)
    const mean = weights.length === 0 ? 1 : weights.reduce((sum, value) => sum + value, 0) / weights.length
    const deviation = weights.length === 0
        ? 0
        : Math.sqrt(weights.reduce((sum, value) => sum + (value - mean) ** 2, 0) / weights.length)
    const weightShape: StyleWeightShape = deviation < 0.12
        ? 'flat'
        : spread >= 0.7 ? 'focused' : 'mixed'
    return { tagCount, weightShape }
}

/** A short MinHash-like signature supplies auxiliary tag-set grouping without multiplying cells. */
export function styleEvolutionNiche(tags: readonly StyleEvolutionTag[]): string {
    const keys = [...new Set(tags.map(tag => `${tag.kind}:${tag.tag.trim().toLowerCase()}`).filter(key => !key.endsWith(':')))]
    const anchors = keys
        .map(key => ({ key, hash: hashCanonicalValue(key) }))
        .sort((left, right) => left.hash.localeCompare(right.hash))
        .slice(0, 2)
        .map(item => item.key)
    return `niche:${hashCanonicalValue(anchors).slice(0, 12)}`
}

export function styleEvolutionArchiveKey(boardId: string, axes: StyleEvolutionCellAxes): string {
    return `${boardId}:${axes.tagCount}:${axes.weightShape}`
}

export interface ArchiveCandidate extends StyleArchiveMember {
    tags: readonly StyleEvolutionTag[]
}

function member(candidate: ArchiveCandidate): StyleArchiveMember {
    return {
        comboId: candidate.comboId,
        score: finite(candidate.score),
        uncertainty: Math.max(0, finite(candidate.uncertainty)),
        novelty: Math.max(0, finite(candidate.novelty)),
        niche: candidate.niche || styleEvolutionNiche(candidate.tags),
    }
}

function chooseDistinct(
    candidates: readonly StyleArchiveMember[],
    score: (candidate: StyleArchiveMember) => number,
    excluded: ReadonlySet<string>,
): StyleArchiveMember | null {
    return [...candidates]
        .filter(candidate => !excluded.has(candidate.comboId))
        .sort((left, right) => score(right) - score(left) || left.comboId.localeCompare(right.comboId))[0] ?? null
}

/** Each of nine primary cells retains quality, learning value, and novelty separately. */
export function updateStyleEvolutionArchive(input: {
    boardId: string
    existing: readonly StyleEvolutionArchiveCell[]
    candidates: readonly ArchiveCandidate[]
    updatedAt: number
}): StyleEvolutionArchiveCell[] {
    const grouped = new Map<string, { axes: StyleEvolutionCellAxes; members: StyleArchiveMember[] }>()
    for (const cell of input.existing.filter(cell => cell.boardId === input.boardId)) {
        grouped.set(cell.key, {
            axes: cell.axes,
            members: [cell.elite, cell.challenger, cell.novel].filter(
                (value): value is StyleArchiveMember => value !== null,
            ),
        })
    }
    for (const candidate of input.candidates) {
        const axes = classifyStyleEvolutionAxes(candidate.tags)
        const key = styleEvolutionArchiveKey(input.boardId, axes)
        const group = grouped.get(key) ?? { axes, members: [] }
        const next = member(candidate)
        const index = group.members.findIndex(item => item.comboId === next.comboId)
        if (index === -1) group.members.push(next)
        else group.members[index] = next
        grouped.set(key, group)
    }

    const retained = input.existing.filter(cell => cell.boardId !== input.boardId)
    const updated = [...grouped.entries()].map(([key, group]): StyleEvolutionArchiveCell => {
        const elite = chooseDistinct(group.members, candidate => candidate.score, new Set())
        const challenger = chooseDistinct(
            group.members,
            candidate => candidate.score + candidate.uncertainty * 0.5,
            new Set(elite === null ? [] : [elite.comboId]),
        )
        const novel = chooseDistinct(
            group.members,
            candidate => candidate.novelty + (candidate.niche === elite?.niche ? -0.2 : 0),
            new Set([elite?.comboId, challenger?.comboId].filter((id): id is string => id !== undefined)),
        )
        return {
            schemaVersion: STYLE_EVOLUTION_ARCHIVE_SCHEMA_VERSION,
            id: `style-archive:${hashCanonicalValue({ boardId: input.boardId, key })}`,
            boardId: input.boardId,
            key,
            axes: group.axes,
            elite,
            challenger,
            novel,
            updatedAt: input.updatedAt,
        }
    })
    return [...retained, ...updated].sort((left, right) => left.key.localeCompare(right.key))
}

export function isStyleEvolutionArchiveCell(value: unknown): value is StyleEvolutionArchiveCell {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const cell = value as Partial<StyleEvolutionArchiveCell>
    const validMember = (candidate: unknown): candidate is StyleArchiveMember => {
        if (candidate === null) return true
        if (typeof candidate !== 'object' || Array.isArray(candidate)) return false
        const item = candidate as Partial<StyleArchiveMember>
        return typeof item.comboId === 'string' && item.comboId.length > 0
            && typeof item.score === 'number' && Number.isFinite(item.score)
            && typeof item.uncertainty === 'number' && item.uncertainty >= 0
            && typeof item.novelty === 'number' && item.novelty >= 0
            && typeof item.niche === 'string'
    }
    return cell.schemaVersion === STYLE_EVOLUTION_ARCHIVE_SCHEMA_VERSION
        && typeof cell.id === 'string' && cell.id.length > 0
        && typeof cell.boardId === 'string' && cell.boardId.length > 0
        && typeof cell.key === 'string' && cell.key.length > 0
        && (cell.axes?.tagCount === 'compact' || cell.axes?.tagCount === 'balanced' || cell.axes?.tagCount === 'dense')
        && (cell.axes?.weightShape === 'flat' || cell.axes?.weightShape === 'mixed' || cell.axes?.weightShape === 'focused')
        && validMember(cell.elite) && validMember(cell.challenger) && validMember(cell.novel)
        && Number.isSafeInteger(cell.updatedAt) && (cell.updatedAt as number) >= 0
}
