import { beforeEach, describe, expect, it, vi } from 'vitest'

const { ensureTaggerServer } = vi.hoisted(() => ({
    ensureTaggerServer: vi.fn(async () => undefined),
}))

vi.mock('@/services/local-tagger-server', () => ({
    ensureTaggerServer,
    LOCAL_TAGGER_BASE_URL: 'http://127.0.0.1:8001',
}))

vi.mock('@/services/diagnostics/error-registry', () => ({
    reportDiagnostic: (_error: unknown) => ({ userSummary: 'R2 operation failed safely.' }),
}))

import { normalizeAssetProfile } from '@/services/asset-profile-file'
import {
    startR2DeployJob,
    type R2DeployMode,
    type R2DeployRequest,
} from '@/services/r2-deploy-service'

const MODES = ['current-session', 'delta', 'full-sync', 'dry-run'] as const satisfies readonly R2DeployMode[]

describe('legacy Wrangler R2 deploy characterization', () => {
    beforeEach(() => {
        ensureTaggerServer.mockClear()
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            job_id: 'fixture-job',
            status: 'queued',
            message: 'queued',
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })))
    })

    it.each(MODES)('keeps %s as an exact sidecar mode without adding credentials', async (mode) => {
        const request: R2DeployRequest = {
            mode,
            bucket: 'fixture-bucket',
            key_prefix: 'exports/session',
            local_root: 'fixture-output',
            uploader: 'wrangler',
        }

        await startR2DeployJob(request)

        expect(ensureTaggerServer).toHaveBeenCalledTimes(1)
        const [, init] = vi.mocked(fetch).mock.calls[0]
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        expect(body).toEqual(request)
        expect(JSON.stringify(body)).not.toMatch(/access.?key|secret|authorization|credential/i)
    })

    it('preserves only the established non-secret Asset Profile R2 projection', () => {
        const profile = normalizeAssetProfile({
            revision: 4,
            updatedBy: 'gui',
            updatedAt: '2026-07-14T00:00:00.000Z',
            settings: {},
            output: {},
            r2: {
                enabled: true,
                accountId: 'fixture-account-metadata',
                bucket: 'fixture-bucket',
                keyPrefix: 'exports/',
                publicBaseUrl: 'https://cdn.example.test',
            },
            modules: {},
            recipes: [],
        })

        expect(profile.r2).toEqual({
            enabled: true,
            accountId: 'fixture-account-metadata',
            bucket: 'fixture-bucket',
            keyPrefix: 'exports/',
            publicBaseUrl: 'https://cdn.example.test',
            metadata: undefined,
        })
    })
})
