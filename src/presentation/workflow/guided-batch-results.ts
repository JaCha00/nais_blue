import type { GenerationJob } from '@/domain/queue/types'
import { getRuntimeQueueRepository } from '@/services/queue/indexeddb-queue-repository'

type GuidedBatchResultJobRepository = Pick<ReturnType<typeof getRuntimeQueueRepository>, 'listJobs'>

/** Reads only the result range the user has explicitly asked to preview. */
export async function listGuidedBatchResultJobs(
    batchId: string,
    requested: number,
    repository: GuidedBatchResultJobRepository = getRuntimeQueueRepository(),
): Promise<{
    readonly items: readonly GenerationJob[]
    readonly hasMore: boolean
}> {
    if (!Number.isSafeInteger(requested) || requested < 1) {
        throw new TypeError('Guided batch result window must be a positive integer')
    }
    const items: GenerationJob[] = []
    let cursor: string | null = null
    do {
        const page = await repository.listJobs({
            batchId,
            states: ['succeeded'],
            cursor,
            limit: Math.min(250, requested - items.length),
        })
        items.push(...page.items)
        cursor = page.nextCursor
    } while (cursor !== null && items.length < requested)
    return { items, hasMore: cursor !== null }
}
