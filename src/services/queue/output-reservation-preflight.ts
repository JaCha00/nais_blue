import { canonicalSerialize } from '@/domain/composition/canonical-serialize'
import type { GenerationJob, OutputReservation } from '@/domain/queue/types'
import {
    getRuntimeOutputWriter,
    OutputWriterError,
    type ExactOutputReservationIdentity,
    type OutputWriterDestination,
} from '@/services/output/output-writer'
import { QueueExecutionError, type QueueExecutorContext } from './durable-queue-coordinator'
import { getRuntimeMainQueueDependencies } from './main-queue-runtime-dependencies'

function reservationSnapshot(value: OutputReservation) {
    return {
        reservationId: value.reservationId,
        folderBinding: value.folderBinding,
        directoryIdentity: value.directoryIdentity,
        relativePath: value.relativePath,
        collisionPolicy: value.collisionPolicy,
        expectedExistingDigest: value.expectedExistingDigest,
    }
}

async function markConflict(
    context: QueueExecutorContext,
    reservation: OutputReservation,
): Promise<void> {
    if (reservation.state !== 'storage-pending' && reservation.state !== 'writing') return
    await context.transitionOutputReservation?.({
        reservationId: reservation.reservationId,
        owner: reservation,
        expectedState: reservation.state,
        state: 'conflict',
    })
}

export async function markReservedQueueOutputConflict(
    job: GenerationJob,
    context: QueueExecutorContext,
): Promise<void> {
    const snapshot = job.snapshot.outputReservation
    if (snapshot === undefined || context.getOutputReservation === undefined) return
    const reservation = await context.getOutputReservation(snapshot.reservationId)
    if (reservation !== null) await markConflict(context, reservation)
}

/** Enforces the immutable destination before any Provider dispatch. */
export async function preflightReservedQueueOutput(
    job: GenerationJob,
    context: QueueExecutorContext,
    destination: OutputWriterDestination,
): Promise<ExactOutputReservationIdentity | null> {
    const snapshot = job.snapshot.outputReservation
    if (snapshot === undefined) return null
    if (context.getOutputReservation === undefined || context.transitionOutputReservation === undefined) {
        throw new QueueExecutionError('fatal', 'Queue reservation authority is unavailable')
    }
    const reservation = await context.getOutputReservation(snapshot.reservationId)
    if (reservation === null
        || reservation.batchId !== job.batchId
        || reservation.jobId !== job.id
        || canonicalSerialize(snapshot) !== canonicalSerialize(reservationSnapshot(reservation))) {
        throw new QueueExecutionError('fatal', 'Queue output reservation ownership changed')
    }
    if (reservation.state !== 'storage-pending' && reservation.state !== 'writing') {
        throw new QueueExecutionError('fatal', `Queue output reservation is ${reservation.state}`)
    }
    const currentFolderBinding = getRuntimeMainQueueDependencies()
        .outputReservations.getCurrentFolderBinding()
    if (currentFolderBinding === null
        || canonicalSerialize(currentFolderBinding) !== canonicalSerialize(snapshot.folderBinding)) {
        await markConflict(context, reservation)
        throw new QueueExecutionError('fatal', 'Generation folder changed before Provider dispatch')
    }

    const identity: ExactOutputReservationIdentity = {
        reservationId: snapshot.reservationId,
        directoryIdentity: snapshot.directoryIdentity,
        relativePath: snapshot.relativePath,
    }
    try {
        await getRuntimeOutputWriter().preflightExactDestination({
            destination,
            fileName: snapshot.relativePath,
            reservation: identity,
            collisionPolicy: 'fail',
            probeWrite: true,
        })
    } catch (error) {
        if (error instanceof OutputWriterError
            && (error.message.includes('occupied')
                || error.message.includes('already exists')
                || error.message.includes('pending transaction')
                || error.message.includes('no longer matches'))) {
            await markConflict(context, reservation)
            throw new QueueExecutionError('fatal', 'Reserved output destination is no longer available')
        }
        throw new QueueExecutionError('local-io', 'Output directory preflight failed')
    }
    if (reservation.state === 'storage-pending') {
        await context.transitionOutputReservation({
            reservationId: reservation.reservationId,
            owner: reservation,
            expectedState: 'storage-pending',
            state: 'writing',
        })
    }
    return identity
}
