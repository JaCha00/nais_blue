import { describe, expect, it, vi } from 'vitest'
import type { ResourceRef } from '@/domain/composition/types'
import type { CompositionEnginePlan } from '@/domain/composition/engine'
import { materializeCharacterResourcesForNai } from '@/lib/composition/character-resource-adapter'
import { createRuntimeCapabilities } from '@/platform/capabilities'
import {
    assessPortablePath,
    assessPortableCompositionPlan,
    assessPortableResourcesForGeneration,
    InMemoryPlatformTokenRegistry,
    PORTABLE_TOKEN_SYNC_POLICY,
} from '@/platform/portable-resources'

const revision = {
    revision: 1,
    createdAt: '2026-07-13T00:00:00.000Z',
    createdBy: { kind: 'user' as const, id: 'test' },
    updatedAt: '2026-07-13T00:00:00.000Z',
    updatedBy: { kind: 'user' as const, id: 'test' },
}

function pathResource(): Extract<ResourceRef, { kind: 'path' }> {
    return {
        ...revision,
        id: 'resource:path:one',
        orderKey: '1',
        enabled: true,
        role: 'character-reference',
        kind: 'path',
        path: { kind: 'bookmark', bookmarkId: 'selected:one', segments: [] },
    }
}

describe('portable resource materialization boundary', () => {
    it('keeps a desktop recipe loadable on Android but blocks generation with repair', () => {
        const registry = new InMemoryPlatformTokenRegistry()
        registry.register({
            logicalId: 'selected:one',
            platform: 'windows',
            kind: 'file',
            opaqueToken: 'D:\\private\\reference.png',
            displayPath: 'Reference/reference.png',
        })

        const result = assessPortableResourcesForGeneration(
            [pathResource()],
            createRuntimeCapabilities('android'),
            registry,
        )

        expect(result.loadable).toBe(true)
        expect(result.readyForGeneration).toBe(false)
        expect(result.issues[0]).toMatchObject({
            code: 'E_PORTABLE_PATH_PLATFORM_MISMATCH',
            blocking: true,
            repairAction: { kind: 'select-file', bookmarkId: 'selected:one' },
        })
        expect(JSON.stringify(pathResource())).not.toContain('D:\\private')
    })

    it('resolves a platform token only at the platform edge', () => {
        const registry = new InMemoryPlatformTokenRegistry()
        registry.register({
            logicalId: 'selected:one',
            platform: 'windows',
            kind: 'file',
            opaqueToken: 'D:\\private\\reference.png',
            displayPath: 'Reference/reference.png',
        })

        const result = assessPortablePath(
            pathResource().path,
            createRuntimeCapabilities('windows'),
            registry,
        )

        expect(result.status).toBe('resolved')
        if (result.status === 'resolved') {
            expect(result.materialized.opaqueToken).toBe('D:\\private\\reference.png')
            expect(result.materialized.displayPath).toBe('Reference/reference.png')
        }
        expect(PORTABLE_TOKEN_SYNC_POLICY.exportIncludesOpaqueTokens).toBe(false)
        expect(PORTABLE_TOKEN_SYNC_POLICY.syncIncludesOpaqueTokens).toBe(false)
    })

    it('blocks the NAI materialization guard before arbitrary path access', async () => {
        const reader = { read: vi.fn(async () => new Uint8Array([1])) }
        const result = await materializeCharacterResourcesForNai({
            resources: [pathResource()],
            bindings: [{
                resourceId: pathResource().id,
                enabled: true,
                referenceType: 'character',
                strength: 0.6,
            }],
            repository: {
                ensureAvailable: vi.fn(async () => undefined),
                getByResourceId: vi.fn(() => undefined),
            },
            capabilities: createRuntimeCapabilities('android'),
            tokenRegistry: new InMemoryPlatformTokenRegistry(),
            portableReader: reader,
        })

        expect(result.success).toBe(false)
        if (!result.success) {
            expect(result.errors[0]).toMatchObject({
                code: 'E_PORTABLE_PATH_TOKEN_MISSING',
                blocking: true,
                repairAction: { kind: 'select-file' },
            })
        }
        expect(reader.read).not.toHaveBeenCalled()
    })

    it('rejects traversal and absolute-looking segments', () => {
        const result = assessPortablePath(
            { kind: 'standard', root: 'app-data', segments: ['safe', '..', 'bad'] },
            createRuntimeCapabilities('android'),
        )
        expect(result.status).toBe('unresolved')
        if (result.status === 'unresolved') {
            expect(result.issues[0].code).toBe('E_PORTABLE_PATH_INVALID')
        }
    })

    it('preflights resources and the output destination before generation', () => {
        const plan = {
            resources: [pathResource()],
            outputPolicy: {
                destination: {
                    kind: 'filesystem',
                    directory: {
                        kind: 'standard',
                        root: 'pictures',
                        segments: ['NAIS_Output'],
                    },
                },
            },
        } as unknown as CompositionEnginePlan

        const result = assessPortableCompositionPlan(
            plan,
            createRuntimeCapabilities('android'),
            new InMemoryPlatformTokenRegistry(),
        )

        expect(result.loadable).toBe(true)
        expect(result.readyForGeneration).toBe(false)
        expect(result.issues.map(issue => issue.code)).toEqual([
            'E_PORTABLE_PATH_TOKEN_MISSING',
            'E_PORTABLE_PATH_ROOT_UNSUPPORTED',
        ])
        expect(result.issues[1]).toMatchObject({
            resourceId: 'output-destination',
            repairAction: { kind: 'copy-to-app-data' },
        })
    })
})
