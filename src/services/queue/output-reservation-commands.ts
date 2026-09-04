import { canonicalSerialize } from '@/domain/composition/canonical-serialize'
import type { ProviderResultSpool } from '@/application/generation/provider-result-spool'
import type { OutputReservation } from '@/domain/queue/types'
import type { IndexedDBQueueRepository } from './indexeddb-queue-repository'
import { QueueRepositoryError } from './indexeddb-queue-repository'

type ReservationCommandRepository = Pick<
    IndexedDBQueueRepository,
    'getJob' | 'getOutputReservation' | 'listAttempts' | 'abandonOutputReservation'
>

/** Deletes the verified Provider result before releasing its durable path claims. */
export async function discardSpooledResultAndAbandonReservation(
    repository: ReservationCommandRepository,
    spool: ProviderResultSpool,
    input: { readonly jobId: string; readonly reservationId: string; readonly now: string },
): Promise<OutputReservation> {
    const [job, reservation, attempts] = await Promise.all([
        repository.getJob(input.jobId),
        repository.getOutputReservation(input.reservationId),
        repository.listAttempts(input.jobId),
    ])
    if (job === null || reservation === null || reservation.jobId !== job.id) {
        throw new QueueRepositoryError('E_QUEUE_NOT_FOUND', 'Spooled reservation owner is missing')
    }
    const attempt = attempts.find(candidate => candidate.attemptNumber === job.attemptCount)
    const receipt = attempt?.providerEvidence?.dispatchState === 'result-spooled'
        ? attempt.providerEvidence.spoolReceipt
        : null
    if (receipt === null) {
        throw new QueueRepositoryError('E_QUEUE_INVALID_TRANSITION', 'Job has no spooled Provider result to discard')
    }
    const verified = await spool.verify(receipt.spoolId)
    if (canonicalSerialize(verified) !== canonicalSerialize(receipt)) {
        throw new QueueRepositoryError('E_QUEUE_WRITE_VERIFY', 'Provider spool receipt changed before discard')
    }
    await spool.discard(receipt)
    return repository.abandonOutputReservation({
        reservationId: reservation.reservationId,
        owner: reservation,
        ...(reservation.reservationSchemaVersion === 1 ? { expectedVersion: reservation.version } : {}),
        now: input.now,
        discardedSpoolReceipt: receipt,
    })
}
