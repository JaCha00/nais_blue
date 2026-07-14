import { describe, expect, it } from 'vitest'

import {
    QueueSnapshotError,
    createGenerationJobSnapshot,
    hashGenerationJobSnapshot,
} from '@/services/queue/job-snapshot'

function resumableSnapshot() {
    return createGenerationJobSnapshot({
        prompt: { positive: 'fixed positive', negative: 'fixed negative' },
        parameters: { seed: 42, steps: 28, sampler: 'k_euler' },
        outputPolicy: { format: 'webp', destination: { kind: 'app-data' } },
        resources: [{
            resourceId: 'resource:source',
            role: 'source',
            persistence: 'managed-app-data',
            digest: 'sha256:source',
            reference: { relativePath: 'queue-resources/sha256-source.bin' },
        }],
        resumability: 'resumable',
    })
}

describe('durable generation job snapshots', () => {
    it('hashes canonical immutable content independent of object key order', () => {
        const first = resumableSnapshot()
        const second = createGenerationJobSnapshot({
            prompt: { negative: 'fixed negative', positive: 'fixed positive' },
            parameters: { sampler: 'k_euler', steps: 28, seed: 42 },
            outputPolicy: { destination: { kind: 'app-data' }, format: 'webp' },
            resources: [{
                role: 'source',
                resourceId: 'resource:source',
                digest: 'sha256:source',
                persistence: 'managed-app-data',
                reference: { relativePath: 'queue-resources/sha256-source.bin' },
            }],
            resumability: 'resumable',
        })

        expect(hashGenerationJobSnapshot(first)).toBe(hashGenerationJobSnapshot(second))
        expect(hashGenerationJobSnapshot(first)).toMatch(/^sha256:[a-f0-9]{64}$/)
        expect(Object.isFrozen(first)).toBe(true)
        expect(Object.isFrozen(first.parameters)).toBe(true)
    })

    it.each([
        { parameters: { token: 'forbidden' }, label: 'token' },
        { parameters: { Authorization: 'forbidden' }, label: 'Authorization' },
        { parameters: { imageBase64: 'forbidden' }, label: 'base64' },
        { parameters: { cacheSecret: 'forbidden' }, label: 'cache secret' },
        { parameters: { source: 'data:image/png;base64,forbidden' }, label: 'data URL' },
    ])('rejects $label material without including its value in the error', ({ parameters }) => {
        let error: unknown
        try {
            createGenerationJobSnapshot({
                prompt: { positive: 'safe', negative: '' },
                parameters,
                outputPolicy: { format: 'png' },
                resources: [],
                resumability: 'resumable',
            })
        } catch (caught) {
            error = caught
        }
        expect(error).toBeInstanceOf(QueueSnapshotError)
        expect(String(error)).not.toContain('forbidden')
    })

    it('requires volatile resources to be explicitly non-resumable', () => {
        expect(() => createGenerationJobSnapshot({
            prompt: { positive: 'safe', negative: '' },
            parameters: { seed: 1 },
            outputPolicy: { format: 'png' },
            resources: [{
                resourceId: 'resource:memory-only',
                role: 'mask',
                persistence: 'volatile',
                digest: 'sha256:volatile',
                reference: { memoryHandle: 'session-only' },
            }],
            resumability: 'resumable',
        })).toThrow(QueueSnapshotError)

        expect(createGenerationJobSnapshot({
            prompt: { positive: 'safe', negative: '' },
            parameters: { seed: 1 },
            outputPolicy: { format: 'png' },
            resources: [{
                resourceId: 'resource:memory-only',
                role: 'mask',
                persistence: 'volatile',
                digest: 'sha256:volatile',
                reference: { memoryHandle: 'session-only' },
            }],
            resumability: 'non-resumable',
            nonResumableReason: 'volatile-resource',
        })).toMatchObject({ resumability: 'non-resumable' })
    })
})
