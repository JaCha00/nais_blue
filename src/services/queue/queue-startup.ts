import { getRuntimeOutputWriter, type OutputRecoveryResult } from '@/services/output/output-writer'
import { getRuntimeQueueRepository } from './indexeddb-queue-repository'
import { recoverQueueLinkedOutputs } from './queue-output-recovery'
import { recoverQueueAfterRestart, type QueueRecoveryResult } from './recovery'

export interface QueueStartupRecoveryResult {
    linkedOutputs: OutputRecoveryResult[]
    orphanOutputs: OutputRecoveryResult[]
    leases: QueueRecoveryResult
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
        return { linkedOutputs, orphanOutputs, leases }
    })()
    return startupPromise
}

export function resetQueueStartupForTests(): void {
    startupPromise = null
}
