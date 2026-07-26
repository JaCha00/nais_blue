import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
    generation: { steps: 28, generate: vi.fn(async () => undefined) },
    queue: { executionAuthority: 'durable' as 'durable' | 'legacy' },
    enqueue: vi.fn(async () => ({ batch: { id: 'batch:main' } })),
    drain: vi.fn(async () => undefined),
}))

vi.mock('@/stores/generation-store', () => ({
    useGenerationStore: { getState: () => runtime.generation },
}))
vi.mock('@/stores/queue-store', () => ({
    useQueueStore: { getState: () => runtime.queue },
}))
vi.mock('@/services/queue/main-queue-adapter', () => ({ enqueueCurrentMainBatch: runtime.enqueue }))
vi.mock('@/services/queue/runtime', () => ({
    getRuntimeDurableQueueCoordinator: () => ({ drain: runtime.drain, cancelWorkflow: vi.fn() }),
}))

import { startMainGenerationCommand } from '@/services/generation/generation-command'

describe('Main generation command quality boundary', () => {
    beforeEach(() => {
        runtime.generation.steps = 28
        runtime.queue.executionAuthority = 'durable'
        vi.clearAllMocks()
    })

    it('rejects preview-grade steps before either execution authority starts', async () => {
        runtime.generation.steps = 1

        await expect(startMainGenerationCommand()).resolves.toBe('low-quality-steps')
        expect(runtime.enqueue).not.toHaveBeenCalled()
        expect(runtime.generation.generate).not.toHaveBeenCalled()
    })

    it('preserves durable and legacy execution after the quality check', async () => {
        await expect(startMainGenerationCommand()).resolves.toBe('started')
        expect(runtime.enqueue).toHaveBeenCalledOnce()
        expect(runtime.drain).toHaveBeenCalledOnce()

        vi.clearAllMocks()
        runtime.queue.executionAuthority = 'legacy'
        await expect(startMainGenerationCommand()).resolves.toBe('started')
        expect(runtime.generation.generate).toHaveBeenCalledOnce()
        expect(runtime.enqueue).not.toHaveBeenCalled()
    })
})
