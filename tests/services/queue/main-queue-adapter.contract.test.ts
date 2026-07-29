import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('durable Main sequential-fragment execution contract', () => {
    it('reserves the immutable proposal before provider transport and never retries a conflict', async () => {
        const source = await readFile(
            resolve(process.cwd(), 'src/services/queue/main-queue-executor.ts'),
            'utf8',
        )
        const reserve = source.indexOf('reserveWildcardSequenceProposal(payload.mainWorkflow.sequenceCommitProposal)')
        const transport = source.indexOf('await executeNovelAIImageTransport')

        expect(reserve).toBeGreaterThan(-1)
        expect(transport).toBeGreaterThan(reserve)
        expect(source).toContain("new QueueExecutionError('fatal', 'Fragment sequence snapshot is stale before Main transport')")
        expect(source).toContain('sequenceLease.commit()')
        expect(source).not.toContain("new QueueExecutionError('transient', 'Fragment sequence changed before Main commit')")
    })

    it('exposes only staged proposals and rejects an incomplete planned batch', async () => {
        const [adapter, executor, generationStore, plannerAdapter, useCase] = await Promise.all([
            readFile(resolve(process.cwd(), 'src/services/queue/main-queue-adapter.ts'), 'utf8'),
            readFile(resolve(process.cwd(), 'src/services/queue/main-queue-executor.ts'), 'utf8'),
            readFile(resolve(process.cwd(), 'src/stores/generation-store.ts'), 'utf8'),
            readFile(resolve(
                process.cwd(),
                'src/presentation/generation/zustand-main-batch-planner.ts',
            ), 'utf8'),
            readFile(resolve(process.cwd(), 'src/application/generation/plan-main-batch.ts'), 'utf8'),
        ])
        const stage = generationStore.indexOf(
            'if (!batchSequencePlanner?.stage(preparedGeneration.sequenceCommitProposal))',
        )
        const prepared = generationStore.indexOf('run.prepared.push(preparedGeneration)')

        expect(stage).toBeGreaterThan(-1)
        expect(prepared).toBeGreaterThan(stage)
        expect(plannerAdapter).toContain('prepareMainBatch()')
        expect(plannerAdapter).not.toContain('.generate(')
        expect(adapter).toContain('const plan = await planMainBatch({')
        expect(adapter).toContain('encodeMainJobSnapshot(prepared, dehydrated)')
        expect(executor).toContain('decodeMainJobSnapshot(job.snapshot)')
        expect(adapter).not.toContain('createGenerationJobSnapshot(')
        expect(adapter).not.toContain('parseMainQueueParameters')
        expect(adapter).not.toContain('generateImage')
        expect(adapter).not.toContain('getRuntimeOutputWriter')
        expect(executor).not.toContain('planMainBatch')
        expect(executor).not.toContain('createBatchAndEnqueue')
        expect(generationStore).not.toContain('capturePrepared')
        expect(adapter).not.toMatch(/@\/stores\//)
        expect(executor).not.toMatch(/@\/stores\//)
        expect(useCase).toContain('prepared.length !== requestedCount')
        expect(adapter).toMatch(/completeEnqueueOperation\(operationId\)[\s\S]*?return null/)
    })
})
