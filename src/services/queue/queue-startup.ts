import { getRuntimeOutputWriter, type OutputRecoveryResult } from '@/services/output/output-writer'
import { getRuntimeQueueRepository } from './indexeddb-queue-repository'
import { recoverQueueLinkedOutputs } from './queue-output-recovery'
import { recoverQueueAfterRestart, type QueueRecoveryResult } from './recovery'
import { reconcileStyleLabRenderReservations } from '@/services/style-lab/style-lab-queue-adapter'

export interface QueueStartupRecoveryResult {
    linkedOutputs: OutputRecoveryResult[]
    orphanOutputs: OutputRecoveryResult[]
    leases: QueueRecoveryResult
    styleLabReservations: { spent: number; released: number }
}

let startupPromise: Promise<QueueStartupRecoveryResult> | null = null

/** Queue-linked journals must reconcile before generic rollback and lease expiry. */
export function initializeQueueAfterRestart(): Promise<QueueStartupRecoveryResult> {
    startupPromise ??= (async () => {
        const repository = getRuntimeQueueRepository()
        const writer = getRuntimeOutputWriter()
        await repository.initialize()
        const linkedOutputs = await recoverQueueLinkedOutputs(repository, writer, {
            now: new Date().toISOString(),
        })
        const orphanOutputs = await writer.recoverPending()
        const leases = await recoverQueueAfterRestart(repository, {
            now: new Date().toISOString(),
            // This gate runs once before the process-local coordinator starts.
            // A desktop restart invalidates every lease from the previous process,
            // even when its wall-clock expiry is still in the future.
            includeUnexpiredLeases: true,
        })
        // Lease recovery determines terminal Queue truth before render costs are
        // reconciled; this releases failed/cancelled work after desktop restarts.
        const styleLabReservations = await reconcileStyleLabRenderReservations({ queueRepository: repository })
        return { linkedOutputs, orphanOutputs, leases, styleLabReservations }
    })()
    return startupPromise
}

export function resetQueueStartupForTests(): void {
    startupPromise = null
}
