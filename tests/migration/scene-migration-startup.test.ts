import { describe, expect, it } from 'vitest'
import { migrateSceneDocuments } from '@/application/scene/migrate-scene-documents'
import type {
    CommitResult,
    SceneDocument,
    SceneRepositoryPort,
    SceneV1CompatibilityProjection,
} from '@/application/scene/scene-repository'
import {
    rollbackSceneAuthority,
    runSceneMigrationStartup,
    type SceneAuthorityMarker,
} from '@/lib/scene-migration-startup'

const NOW = '2026-09-04T00:00:00.000Z'
const PREIMAGE = '{"version":0,"state":{"presets":[]},"spacing":" preserved "}'

function legacy(): SceneV1CompatibilityProjection {
    return {
        presets: [{
            id: 'preset-a',
            name: 'Preset',
            createdAt: 1,
            scenes: [{
                id: 'scene-a',
                name: 'Scene',
                scenePrompt: 'prompt',
                prompts: { base: 'base' },
                generation: { steps: 28 },
                images: [{ id: 'legacy', url: 'data:image/png;base64,raw', timestamp: 1, isFavorite: true }],
                createdAt: 2,
            }],
        }],
    }
}

class MemoryRepository implements SceneRepositoryPort {
    readonly documents = new Map<string, SceneDocument>()
    failCommit = false
    async readLegacyProjection() { return legacy() }
    async getDocument(presetId: string) { return structuredClone(this.documents.get(presetId) ?? null) }
    async listDocuments() {
        return [...this.documents.values()].map(document => ({
            presetId: document.presetId,
            revision: document.revision,
            sceneCount: document.scenes.length,
            updatedAt: document.updatedAt,
        }))
    }
    async commit(next: SceneDocument, expectedRevision: number): Promise<CommitResult> {
        if (this.failCommit) return { status: 'STORAGE_CONFLICT' }
        const current = this.documents.get(next.presetId)
        if ((current?.revision ?? 0) !== expectedRevision) {
            return { status: 'REVISION_CONFLICT', current: current ?? null }
        }
        this.documents.set(next.presetId, structuredClone(next))
        return { status: 'COMMITTED', document: structuredClone(next) }
    }
}

describe('Scene V1 materialization and authority', () => {
    it('projects authoring only without mutating or copying legacy image bytes', () => {
        const source = legacy()
        const before = JSON.stringify(source)
        const documents = migrateSceneDocuments(source, NOW)
        expect(JSON.stringify(source)).toBe(before)
        expect(documents[0]).toMatchObject({ presetId: 'preset-a', revision: 1, updatedAt: NOW })
        expect(documents[0].scenes[0]).toMatchObject({ id: 'scene-a', artifactRefs: [] })
        expect(JSON.stringify(documents)).not.toContain('base64')
        expect(JSON.stringify(documents)).not.toContain('images')
    })

    it('preserves exact preimage bytes and activates V2 only after readback', async () => {
        const repository = new MemoryRepository()
        let marker: SceneAuthorityMarker | null = null
        const result = await runSceneMigrationStartup({
            repository,
            legacyPreimage: { readSerialized: async () => PREIMAGE },
            marker: { read: async () => marker, write: async next => { marker = next } },
            now: () => NOW,
        })
        expect(result.status).toBe('V2_ACTIVE')
        expect(marker).toEqual({ reader: 'v2', v1Preimage: PREIMAGE, verifiedAt: NOW })

        const v2BeforeRollback = structuredClone(repository.documents.get('preset-a'))
        await rollbackSceneAuthority({ read: async () => marker, write: async next => { marker = next } })
        expect(marker).toEqual({ reader: 'v1', v1Preimage: PREIMAGE })
        expect(repository.documents.get('preset-a')).toEqual(v2BeforeRollback)
    })

    it('keeps the marker and exact V1 bytes untouched at a commit failure', async () => {
        const repository = new MemoryRepository()
        repository.failCommit = true
        let writes = 0
        const result = await runSceneMigrationStartup({
            repository,
            legacyPreimage: { readSerialized: async () => PREIMAGE },
            marker: { read: async () => null, write: async () => { writes += 1 } },
            now: () => NOW,
        })
        expect(result).toEqual({ status: 'V1_FALLBACK', reason: 'COMMIT_FAILED' })
        expect(writes).toBe(0)
        expect(PREIMAGE).toBe('{"version":0,"state":{"presets":[]},"spacing":" preserved "}')
    })

    it('keeps a patched revision 2 document authoritative on reopen', async () => {
        const repository = new MemoryRepository()
        let marker: SceneAuthorityMarker | null = null
        const dependencies = {
            repository,
            legacyPreimage: { readSerialized: async () => PREIMAGE },
            marker: { read: async () => marker, write: async (next: SceneAuthorityMarker) => { marker = next } },
            now: () => NOW,
        }
        expect((await runSceneMigrationStartup(dependencies)).status).toBe('V2_ACTIVE')
        const revision1 = repository.documents.get('preset-a')!
        repository.documents.set('preset-a', {
            ...revision1,
            revision: 2,
            updatedAt: '2026-09-04T02:00:00.000Z',
            scenes: revision1.scenes.map(scene => ({ ...scene, scenePrompt: 'patched' })),
        })

        const reopened = await runSceneMigrationStartup({
            ...dependencies,
            now: () => '2026-09-05T00:00:00.000Z',
        })
        expect(reopened.status).toBe('V2_ACTIVE')
        if (reopened.status === 'V2_ACTIVE') {
            expect(reopened.documents[0]).toMatchObject({ revision: 2, scenes: [{ scenePrompt: 'patched' }] })
        }
        expect(marker).toEqual({ reader: 'v2', v1Preimage: PREIMAGE, verifiedAt: NOW })
    })
})
