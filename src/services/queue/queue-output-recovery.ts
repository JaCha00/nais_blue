import type { OutputRecoveryResult, OutputWriter } from '@/services/output/output-writer'
import { publishGeneratedArtifact } from '@/stores/artifact-lifecycle-store'
import type { IndexedDBQueueRepository } from './indexeddb-queue-repository'
import {
    registerQueueArtifact,
    rollbackQueueArtifactRegistration,
    type QueueArtifactRepository,
} from './queue-artifact-lineage'

export type TargetedQueueOutputRetryResult =
    | { readonly status: 'ready' }
    | { readonly status: 'missing-job' }
    | { readonly status: 'unbound-job' }
    | { readonly status: 'missing-journal' }
    | { readonly status: 'ineligible'; readonly reason: 'source-job-mismatch' | 'phase-not-files-committed' }
    | { readonly status: 'failed'; readonly message: string }

type QueueOutputRecoveryRepository = Pick<
    IndexedDBQueueRepository,
    'initialize' | 'getJob' | 'recoverFilesCommittedSuccess'
>

/** Retries one explicitly bound Queue journal without scanning or draining other work. */
export async function retryQueueLinkedOutput(
    repository: QueueOutputRecoveryRepository,
    writer: OutputWriter,
    options: { jobId: string; now: string; artifactRepository?: QueueArtifactRepository },
): Promise<TargetedQueueOutputRetryResult> {
    await repository.initialize()
    const job = await repository.getJob(options.jobId)
    if (job === null) return { status: 'missing-job' }
    if (job.outputTransactionId === null || job.artifactReference === null) return { status: 'unbound-job' }

    const outputTransactionId = job.outputTransactionId
    const artifactReference = job.artifactReference
    const recovery = await writer.retryFilesCommittedWorkflow(
        outputTransactionId,
        job.id,
        async output => {
            const registration = await registerQueueArtifact(
                job,
                artifactReference,
                output,
                options.artifactRepository,
            )
            try {
                await repository.recoverFilesCommittedSuccess({
                    jobId: job.id,
                    now: options.now,
                    outputTransactionId,
                    artifactReference,
                })
            } catch (error) {
                await rollbackQueueArtifactRegistration(registration, options.artifactRepository)
                throw error
            }
            publishGeneratedArtifact({
                path: output.path,
                ...(registration === null
                    ? {}
                    : {
                        artifactId: registration.record.artifactId,
                        sourceJobId: job.id,
                        ...(job.sceneId === null ? {} : { sourceSceneId: job.sceneId }),
                    }),
            })
        },
    )
    if (recovery.action === 'retried') return { status: 'ready' }
    if (recovery.action === 'missing') return { status: 'missing-journal' }
    if (recovery.action === 'ineligible') {
        return { status: 'ineligible', reason: recovery.ineligibility ?? 'phase-not-files-committed' }
    }
    return { status: 'failed', message: recovery.error ?? 'Output storage retry did not complete.' }
}

/**
 * Reconciles queue-owned OutputWriter journals before generic journal rollback
 * and before expired-lease recovery. Ownership comes only from the journal's
 * sourceJobId plus the job's pre-bound transaction/artifact pair; an output
 * path is never treated as proof of success.
 */
export async function recoverQueueLinkedOutputs(
    repository: IndexedDBQueueRepository,
    writer: OutputWriter,
    options: { now: string; artifactRepository?: QueueArtifactRepository },
): Promise<OutputRecoveryResult[]> {
    await repository.initialize()
    const links = await writer.inspectPendingQueueTransactions()
    const results: OutputRecoveryResult[] = []
    for (const link of links) {
        const job = await repository.getJob(link.sourceJobId)
        const ownsTransaction = job !== null
            && job.outputTransactionId === link.transactionId
            && job.artifactReference !== null
        const mayCommit = ownsTransaction
            && job.cancelRequestedAt === null
            && (job.state === 'running'
                || job.state === 'leased'
                || job.state === 'recovering'
                || job.state === 'succeeded')
        if (link.phase === 'files-committed' && mayCommit) {
            const artifactReference = job.artifactReference
            results.push(await writer.retryFilesCommittedWorkflow(
                link.transactionId,
                job.id,
                async output => {
                    // A files-committed journal may survive a process restart. Register
                    // the same immutable artifact before terminalizing the Job so recovery
                    // cannot create an artifact-less Queue success.
                    const registration = await registerQueueArtifact(
                        job,
                        artifactReference,
                        output,
                        options.artifactRepository,
                    )
                    try {
                        await repository.recoverFilesCommittedSuccess({
                            jobId: job.id,
                            now: options.now,
                            outputTransactionId: link.transactionId,
                            artifactReference,
                        })
                    } catch (error) {
                        await rollbackQueueArtifactRegistration(registration, options.artifactRepository)
                        throw error
                    }
                    publishGeneratedArtifact({
                        path: output.path,
                        ...(registration === null
                            ? {}
                            : {
                                artifactId: registration.record.artifactId,
                                sourceJobId: job.id,
                                ...(job.sceneId === null ? {} : { sourceSceneId: job.sceneId }),
                            }),
                    })
                },
            ))
            continue
        }
        results.push(await writer.recoverTransaction(link.transactionId, { mode: 'rollback' }))
    }
    return results
}
