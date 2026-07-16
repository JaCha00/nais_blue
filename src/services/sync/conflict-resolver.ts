import { canonicalSerialize, hashCanonicalValue } from '@/domain/composition/canonical-serialize'
import { compareSyncText, type SyncEntityType, type SyncEnvelope } from '@/domain/sync'

export type SyncConflictKind =
    | 'duplicate'
    | 'equivalent'
    | 'causal'
    | 'lww'
    | 'conflict-copy'
    | 'manual-resolution'
    | 'tombstone'

export interface SyncConflictResolution {
    readonly kind: SyncConflictKind
    readonly winner: SyncEnvelope | null
    readonly loser: SyncEnvelope | null
    readonly candidates: readonly SyncEnvelope[]
    readonly conflictCopyId: string | null
}

export interface SyncOperationProjection {
    readonly primary: SyncEnvelope
    readonly effectiveRevision: number
    readonly conflictCopies: readonly Readonly<{
        envelope: SyncEnvelope
        conflictCopyId: string
    }>[]
    readonly statusByOpId: ReadonlyMap<string, Readonly<{
        status: 'deferred' | 'applied' | 'equivalent' | 'conflict-copy' | 'tombstone' | 'ignored'
        conflictCopyId: string | null
    }>>
}

export class SyncConflictError extends Error {
    readonly code = 'E_SYNC_CONFLICT_INVALID' as const

    constructor(message: string) {
        super(message)
        this.name = 'SyncConflictError'
    }
}

/** Simple visual preferences are the only documented Phase 11 LWW entity. */
export function isDocumentedLwwEntityType(entityType: SyncEntityType): boolean {
    return entityType === 'ui.preference'
}

export function compareSyncEnvelopeOrder(left: SyncEnvelope, right: SyncEnvelope): number {
    return left.revision - right.revision
        || compareSyncText(left.createdAt, right.createdAt)
        || compareSyncText(left.deviceId, right.deviceId)
        || compareSyncText(left.opId, right.opId)
}

export function compareSyncLwwOrder(left: SyncEnvelope, right: SyncEnvelope): number {
    return compareSyncText(left.createdAt, right.createdAt)
        || compareSyncText(left.deviceId, right.deviceId)
        || compareSyncText(left.opId, right.opId)
}

function ordered(left: SyncEnvelope, right: SyncEnvelope): readonly [SyncEnvelope, SyncEnvelope] {
    return compareSyncEnvelopeOrder(left, right) <= 0 ? [left, right] : [right, left]
}

function winnerAndLoser(left: SyncEnvelope, right: SyncEnvelope): {
    winner: SyncEnvelope
    loser: SyncEnvelope
} {
    return compareSyncEnvelopeOrder(left, right) >= 0
        ? { winner: left, loser: right }
        : { winner: right, loser: left }
}

export function syncConflictCopyId(envelope: SyncEnvelope): string {
    const digest = hashCanonicalValue({
        entityType: envelope.entityType,
        entityId: envelope.entityId,
        opId: envelope.opId,
        deviceId: envelope.deviceId,
    }).slice(0, 16)
    const boundedEntity = envelope.entityId.length <= 128
        ? envelope.entityId
        : `entity-${hashCanonicalValue(envelope.entityId).slice(0, 16)}`
    return `${boundedEntity}~conflict~${digest}`
}

function result(
    kind: SyncConflictKind,
    winner: SyncEnvelope | null,
    loser: SyncEnvelope | null,
    conflictId: string | null = null,
): SyncConflictResolution {
    return {
        kind,
        winner,
        loser,
        candidates: winner === null ? [] : loser === null ? [winner] : ordered(winner, loser),
        conflictCopyId: conflictId,
    }
}

function sameEnvelope(left: SyncEnvelope, right: SyncEnvelope): boolean {
    return canonicalSerialize(left) === canonicalSerialize(right)
}

export function equivalentSyncOperation(left: SyncEnvelope, right: SyncEnvelope): boolean {
    return left.op === right.op && canonicalSerialize(left.payload) === canonicalSerialize(right.payload)
}

function assertSameEntity(left: SyncEnvelope, right: SyncEnvelope): void {
    if (left.entityType !== right.entityType
        || left.entityId !== right.entityId
        || left.userId !== right.userId) {
        throw new SyncConflictError('Conflict candidates must address the same user entity.')
    }
}

function descendant(candidate: SyncEnvelope, ancestor: SyncEnvelope): boolean {
    return candidate.baseOpId === ancestor.opId
        && candidate.baseRevision >= ancestor.revision
        && candidate.revision === candidate.baseRevision + 1
}

/**
 * Symmetric deterministic resolver. Complex entities never silently merge;
 * they retain a winner and an immutable conflict copy for user inspection.
 */
export function resolveSyncConflict(left: SyncEnvelope, right: SyncEnvelope): SyncConflictResolution {
    assertSameEntity(left, right)
    if (left.opId === right.opId) {
        if (!sameEnvelope(left, right)) throw new SyncConflictError('The same opId cannot identify different envelopes.')
        return result('duplicate', left, null)
    }
    if (equivalentSyncOperation(left, right)) {
        const selected = winnerAndLoser(left, right)
        return result('equivalent', selected.winner, selected.loser)
    }

    const leftDescendsRight = descendant(left, right)
    const rightDescendsLeft = descendant(right, left)
    if (leftDescendsRight && left.op === 'delete') return result('tombstone', left, right)
    if (rightDescendsLeft && right.op === 'delete') return result('tombstone', right, left)

    if (left.op === 'delete' || right.op === 'delete') {
        const deletion = left.op === 'delete' && right.op === 'delete'
            ? winnerAndLoser(left, right)
            : left.op === 'delete'
                ? { winner: left, loser: right }
                : { winner: right, loser: left }
        return result(
            'tombstone',
            deletion.winner,
            deletion.loser,
            deletion.loser.op === 'upsert' && !isDocumentedLwwEntityType(deletion.loser.entityType)
                ? syncConflictCopyId(deletion.loser)
                : null,
        )
    }

    if (leftDescendsRight) return result('causal', left, right)
    if (rightDescendsLeft) return result('causal', right, left)

    if (left.entityType === 'generation.job-snapshot') {
        return {
            kind: 'manual-resolution',
            winner: null,
            loser: null,
            candidates: ordered(left, right),
            conflictCopyId: null,
        }
    }

    const selected = winnerAndLoser(left, right)
    if (isDocumentedLwwEntityType(left.entityType)) {
        const lww = compareSyncLwwOrder(left, right) >= 0
            ? { winner: left, loser: right }
            : { winner: right, loser: left }
        return result('lww', lww.winner, lww.loser)
    }
    return result('conflict-copy', selected.winner, selected.loser, syncConflictCopyId(selected.loser))
}

function semanticOperationKey(envelope: SyncEnvelope): string {
    return canonicalSerialize({ op: envelope.op, payload: envelope.payload })
}

function operationMap(envelopes: readonly SyncEnvelope[]): Map<string, SyncEnvelope> {
    const operations = new Map<string, SyncEnvelope>()
    let first: SyncEnvelope | null = null
    for (const envelope of envelopes) {
        if (first === null) first = envelope
        else assertSameEntity(first, envelope)
        const existing = operations.get(envelope.opId)
        if (existing !== undefined && !sameEnvelope(existing, envelope)) {
            throw new SyncConflictError('The same opId cannot identify different envelopes.')
        }
        operations.set(envelope.opId, envelope)
        if (operations.size > 2_048) {
            throw new SyncConflictError('Sync entity operation history exceeds the bounded projection limit.')
        }
    }
    return operations
}

function ancestorsOf(
    candidate: SyncEnvelope,
    operations: ReadonlyMap<string, SyncEnvelope>,
    cache: Map<string, ReadonlySet<string>>,
): ReadonlySet<string> {
    const cached = cache.get(candidate.opId)
    if (cached !== undefined) return cached
    const visited = new Set<string>()
    let parentId = candidate.baseOpId
    while (parentId !== null) {
        if (visited.has(parentId)) throw new SyncConflictError('Sync operation lineage contains a cycle.')
        visited.add(parentId)
        const parent = operations.get(parentId)
        if (parent === undefined) break
        parentId = parent.baseOpId
    }
    cache.set(candidate.opId, visited)
    return visited
}

function readyOperationIds(operations: ReadonlyMap<string, SyncEnvelope>): Set<string> {
    const ready = new Set<string>()
    let advanced = true
    while (advanced) {
        advanced = false
        for (const envelope of operations.values()) {
            if (ready.has(envelope.opId)) continue
            if (envelope.baseOpId === null) {
                // Current schema accepts this only for a root. Migrated v0 records
                // carry null with a higher base and are conservative independent roots.
                ready.add(envelope.opId)
                advanced = true
                continue
            }
            const parent = operations.get(envelope.baseOpId)
            if (parent === undefined) {
                if (envelope.op === 'delete') {
                    ready.add(envelope.opId)
                    advanced = true
                }
                continue
            }
            if (parent.revision > envelope.baseRevision) {
                throw new SyncConflictError('Sync operation predecessor exceeds its observed base revision.')
            }
            if (ready.has(parent.opId)) {
                ready.add(envelope.opId)
                advanced = true
            }
        }
    }
    return ready
}

function maximalOperations(
    candidates: readonly SyncEnvelope[],
    operations: ReadonlyMap<string, SyncEnvelope>,
    ancestorCache: Map<string, ReadonlySet<string>>,
    supersedingCandidates: readonly SyncEnvelope[] = candidates,
): SyncEnvelope[] {
    return candidates.filter(candidate => !supersedingCandidates.some(other => (
        other.opId !== candidate.opId && ancestorsOf(other, operations, ancestorCache).has(candidate.opId)
    )))
}

function equivalentRepresentatives(candidates: readonly SyncEnvelope[]): {
    representatives: SyncEnvelope[]
    representativeByOpId: Map<string, SyncEnvelope>
} {
    const cohorts = new Map<string, SyncEnvelope[]>()
    for (const candidate of candidates) {
        const key = semanticOperationKey(candidate)
        const cohort = cohorts.get(key) ?? []
        cohort.push(candidate)
        cohorts.set(key, cohort)
    }
    const representativeByOpId = new Map<string, SyncEnvelope>()
    const representatives = [...cohorts.values()].map(cohort => {
        const orderedCohort = [...cohort].sort(compareSyncEnvelopeOrder)
        const representative = orderedCohort[orderedCohort.length - 1]
        cohort.forEach(envelope => representativeByOpId.set(envelope.opId, representative))
        return representative
    }).sort(compareSyncEnvelopeOrder)
    return { representatives, representativeByOpId }
}

/**
 * Pure, arrival-order-independent projection of the retained operation set.
 * Repository retry/ack/arrival metadata is deliberately not an input.
 */
export function resolveSyncOperationSet(envelopes: readonly SyncEnvelope[]): SyncOperationProjection | null {
    if (envelopes.length === 0) return null
    const operations = operationMap(envelopes)
    const readyIds = readyOperationIds(operations)
    const ready = [...operations.values()].filter(envelope => readyIds.has(envelope.opId))
    if (ready.length === 0) return null
    const ancestorCache = new Map<string, ReadonlySet<string>>()

    const deletions = ready.filter(envelope => envelope.op === 'delete')
    const upserts = ready.filter(envelope => envelope.op === 'upsert')
    const maximalDeletes = maximalOperations(deletions, operations, ancestorCache)
    const upsertHeads = maximalOperations(
        upserts.filter(upsert => !deletions.some(deletion => (
            ancestorsOf(deletion, operations, ancestorCache).has(upsert.opId)
        ))),
        operations,
        ancestorCache,
        upserts,
    )
    const upsertCohorts = equivalentRepresentatives(upsertHeads)
    const deleteCohorts = equivalentRepresentatives(maximalDeletes)
    const first = ready[0]

    let primary: SyncEnvelope
    let conflictRepresentatives: SyncEnvelope[]
    if (deleteCohorts.representatives.length > 0) {
        primary = deleteCohorts.representatives[deleteCohorts.representatives.length - 1]
        conflictRepresentatives = isDocumentedLwwEntityType(first.entityType)
            ? []
            : upsertCohorts.representatives
    } else {
        const representatives = upsertCohorts.representatives
        if (representatives.length === 0) return null
        if (isDocumentedLwwEntityType(first.entityType)) {
            const lwwRepresentatives = [...representatives].sort(compareSyncLwwOrder)
            primary = lwwRepresentatives[lwwRepresentatives.length - 1]
        } else {
            primary = representatives[representatives.length - 1]
        }
        conflictRepresentatives = isDocumentedLwwEntityType(first.entityType)
            ? []
            : representatives.filter(envelope => envelope.opId !== primary.opId)
    }

    const conflictCopies = conflictRepresentatives
        .map(envelope => ({ envelope, conflictCopyId: syncConflictCopyId(envelope) }))
        .sort((left, right) => compareSyncText(left.conflictCopyId, right.conflictCopyId))
    const conflictIdByRepresentative = new Map(
        conflictCopies.map(copy => [copy.envelope.opId, copy.conflictCopyId]),
    )
    const primaryRepresentative = primary.op === 'delete'
        ? deleteCohorts.representativeByOpId
        : upsertCohorts.representativeByOpId
    const statusByOpId = new Map<string, {
        status: 'deferred' | 'applied' | 'equivalent' | 'conflict-copy' | 'tombstone' | 'ignored'
        conflictCopyId: string | null
    }>()
    const orderedOperations = [...operations.values()].sort((left, right) => compareSyncText(left.opId, right.opId))
    for (const envelope of orderedOperations) {
        if (!readyIds.has(envelope.opId)) {
            statusByOpId.set(envelope.opId, { status: 'deferred', conflictCopyId: null })
            continue
        }
        const cohortMap = envelope.op === 'delete'
            ? deleteCohorts.representativeByOpId
            : upsertCohorts.representativeByOpId
        const representative = cohortMap.get(envelope.opId)
        if (representative?.opId === primary.opId) {
            statusByOpId.set(envelope.opId, {
                status: envelope.opId === primary.opId
                    ? (primary.op === 'delete' ? 'tombstone' : 'applied')
                    : 'equivalent',
                conflictCopyId: null,
            })
            continue
        }
        const conflictCopyId = representative === undefined
            ? null
            : conflictIdByRepresentative.get(representative.opId) ?? null
        if (conflictCopyId !== null) {
            statusByOpId.set(envelope.opId, {
                status: envelope.opId === representative?.opId ? 'conflict-copy' : 'equivalent',
                conflictCopyId,
            })
            continue
        }
        const equivalentToPrimary = primaryRepresentative.get(envelope.opId)?.opId === primary.opId
        statusByOpId.set(envelope.opId, {
            status: equivalentToPrimary ? 'equivalent' : 'ignored',
            conflictCopyId: null,
        })
    }

    const effectiveRevision = ready.reduce(
        (maximum, envelope) => Math.max(maximum, envelope.revision),
        0,
    )
    return {
        primary,
        effectiveRevision,
        conflictCopies,
        statusByOpId,
    }
}
