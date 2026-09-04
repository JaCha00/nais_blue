import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    initialize: vi.fn(),
    listJobs: vi.fn(),
    listAttempts: vi.fn(),
    reconcileAttempt: vi.fn(),
    recoverLinked: vi.fn(),
    recoverPending: vi.fn(),
    recoverLeases: vi.fn(),
    reconcileStyleLab: vi.fn(),
    reconcileSceneLinks: vi.fn(),
}))

vi.mock('@/services/queue/indexeddb-queue-repository', () => ({
    getRuntimeQueueRepository: () => ({
        initialize: mocks.initialize,
        listJobs: mocks.listJobs,
        listAttempts: mocks.listAttempts,
        reconcileProviderAttemptAfterRestart: mocks.reconcileAttempt,
    }),
}))
vi.mock('@/services/output/output-writer', () => ({
    getRuntimeOutputWriter: () => ({ recoverPending: mocks.recoverPending }),
}))
vi.mock('@/services/queue/queue-output-recovery', () => ({
    recoverQueueLinkedOutputs: mocks.recoverLinked,
}))
vi.mock('@/services/queue/recovery', () => ({ recoverQueueAfterRestart: mocks.recoverLeases }))
vi.mock('@/services/style-lab/style-lab-queue-adapter', () => ({
    reconcileStyleLabRenderReservations: mocks.reconcileStyleLab,
}))
vi.mock('@/application/scene/link-scene-artifact', () => ({
    reconcileSceneArtifactLinks: mocks.reconcileSceneLinks,
}))
vi.mock('@/lib/scene-migration-startup', () => ({ getRuntimeSceneRepository: () => ({}) }))
vi.mock('@/services/organizer/runtime', () => ({ getRuntimeArtifactRepository: () => ({}) }))
vi.mock('@/services/diagnostics/error-registry', () => ({ reportDiagnostic: vi.fn() }))

import {
    initializeQueueAfterRestart,
    resetQueueStartupForTests,
} from '@/services/queue/queue-startup'

const complete = {
    dispatchState: 'response-complete' as const,
    providerOutcome: 'succeeded' as const,
    billingRisk: 'confirmed' as const,
    responseDigest: null,
    spoolReceipt: null,
}
const receipt = {
    schemaVersion: 1 as const,
    spoolId: 'provider-spool',
    attemptId: 'job:1:1',
    contentType: 'image/png',
    byteLength: 3,
    sha256: `sha256:${'a'.repeat(64)}` as const,
    committedAt: '2026-09-03T00:00:00.000Z',
}

function spool(receipts: readonly typeof receipt[]) {
    return {
        commit: vi.fn(), verify: vi.fn(), read: vi.fn(), removeIfEligible: vi.fn(), list: vi.fn(),
        reconcile: vi.fn(async () => ({
            receipts,
            promotedSpoolIds: [], removedTemporarySpoolIds: [],
            removedOrphanSpoolIds: [], corruptSpoolIds: [],
        })),
    }
}

describe('Queue startup Provider reconciliation', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        resetQueueStartupForTests()
        mocks.listJobs.mockResolvedValue({
            items: [{ id: 'job:1', state: 'running', attemptCount: 1 }],
            nextCursor: null,
        })
        mocks.listAttempts.mockResolvedValue([{
            id: 'job:1:1', jobId: 'job:1', attemptNumber: 1, providerEvidence: complete,
        }])
        mocks.reconcileAttempt.mockResolvedValue({ state: 'queued', attemptCount: 1 })
        mocks.recoverLinked.mockResolvedValue([])
        mocks.recoverPending.mockResolvedValue([])
        mocks.recoverLeases.mockResolvedValue({ recovering: 0, queued: 0, blocked: 0, failed: 0 })
        mocks.reconcileStyleLab.mockResolvedValue({ spent: 0, released: 0 })
        mocks.reconcileSceneLinks.mockResolvedValue([])
    })

    it('promotes response-complete plus a committed receipt to the same queued attempt', async () => {
        await initializeQueueAfterRestart({ providerResultSpool: spool([receipt]) })

        expect(mocks.reconcileAttempt).toHaveBeenCalledWith(expect.objectContaining({
            jobId: 'job:1', attemptNumber: 1,
            expectedEvidence: complete,
            nextEvidence: {
                ...complete,
                dispatchState: 'result-spooled',
                responseDigest: receipt.sha256,
                spoolReceipt: receipt,
            },
            disposition: 'queued-spooled',
        }))
        expect(mocks.recoverLinked.mock.invocationCallOrder[0])
            .toBeGreaterThan(mocks.reconcileAttempt.mock.invocationCallOrder[0])
        expect(mocks.recoverLeases.mock.invocationCallOrder[0])
            .toBeGreaterThan(mocks.recoverLinked.mock.invocationCallOrder[0])
        expect(mocks.reconcileSceneLinks.mock.invocationCallOrder[0])
            .toBeLessThan(mocks.recoverLeases.mock.invocationCallOrder[0])
    })

    it('blocks response-complete as result-lost when no committed receipt exists', async () => {
        mocks.reconcileAttempt.mockResolvedValue({ state: 'blocked', attemptCount: 1 })
        await initializeQueueAfterRestart({ providerResultSpool: spool([]) })

        expect(mocks.reconcileAttempt).toHaveBeenCalledWith(expect.objectContaining({
            jobId: 'job:1', attemptNumber: 1,
            nextEvidence: { ...complete, dispatchState: 'result-lost' },
            disposition: 'blocked',
            blockReason: 'provider-result-lost',
        }))
    })
})
