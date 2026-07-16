import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('durable Main sequential-fragment execution contract', () => {
    it('reserves the immutable proposal before provider transport and never retries a conflict', async () => {
        const source = await readFile(
            resolve(process.cwd(), 'src/services/queue/main-queue-adapter.ts'),
            'utf8',
        )
        const reserve = source.indexOf('reserveWildcardSequenceProposal(payload.mainWorkflow.sequenceCommitProposal)')
        const transport = source.indexOf('await generateImageStream')

        expect(reserve).toBeGreaterThan(-1)
        expect(transport).toBeGreaterThan(reserve)
        expect(source).toContain("new QueueExecutionError('fatal', 'Fragment sequence snapshot is stale before Main transport')")
        expect(source).toContain('sequenceLease.commit()')
        expect(source).not.toContain("new QueueExecutionError('transient', 'Fragment sequence changed before Main commit')")
    })

    it('exposes only staged proposals and rejects an incomplete planned batch', async () => {
        const [adapter, generationStore] = await Promise.all([
            readFile(resolve(process.cwd(), 'src/services/queue/main-queue-adapter.ts'), 'utf8'),
            readFile(resolve(process.cwd(), 'src/stores/generation-store.ts'), 'utf8'),
        ])
        const stage = generationStore.indexOf('if (!batchSequencePlanner?.stage(generationSequenceProposal))')
        const capture = generationStore.indexOf('await options.capturePrepared({')

        expect(stage).toBeGreaterThan(-1)
        expect(capture).toBeGreaterThan(stage)
        expect(adapter).toContain('const expectedItemCount = generation.batchCount')
        expect(adapter).toContain('prepared.length !== expectedItemCount || prepared.length === 0')
        expect(adapter).toMatch(/completeEnqueueOperation\('main', operationId\)[\s\S]*?return null/)
    })
})
