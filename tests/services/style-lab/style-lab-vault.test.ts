import { describe, expect, it } from 'vitest'
import { commitStyleImportDrafts, type StyleImportDraft } from '@/services/style-lab/metadata-importer'
import { IndexedDbStyleLabRepository } from '@/services/style-lab/indexeddb-style-lab-repository'
import { MemoryStyleLabVault } from '@/services/style-lab/style-lab-vault'
import { hashQueueResourceBytes } from '@/services/queue/queue-resource-materializer'
import type { StateStorage } from 'zustand/middleware'

function memoryStorage(): StateStorage {
    const values = new Map<string, string>()
    return {
        getItem: async key => values.get(key) ?? null,
        setItem: async (key, value) => { values.set(key, value) },
        removeItem: async key => { values.delete(key) },
    }
}

describe('Style-Lab Asset Vault import', () => {
    it('preserves original bytes and keeps each imported image source-only', async () => {
        const vault = new MemoryStyleLabVault()
        const repository = new IndexedDbStyleLabRepository(memoryStorage(), 'vault-import')
        const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
        const sha256 = await hashQueueResourceBytes(bytes)
        const draft: StyleImportDraft = {
            id: 'draft-a',
            fileName: 'source.png',
            mimeType: 'image/png',
            sha256,
            bytes,
            tags: [{ tag: 'artist-a', artist: 'artist-a', kind: 'artist', weight: 1 }],
            includedTagKeys: ['artist:artist-a'],
            rawMetadata: { prompt: 'artist:artist-a' },
            normalizedMetadata: { seed: 7 },
            duplicateAssetIds: [],
        }

        const result = await commitStyleImportDrafts({
            drafts: [draft],
            repository,
            vault,
            resolveCombination: () => 'combo-a',
            now: () => 10,
        })

        expect(result.imported).toHaveLength(1)
        expect(result.imported[0]).toMatchObject({
            comboId: 'combo-a',
            source: 'imported',
            verificationState: 'source-only',
            contextId: null,
            seed: null,
        })
        expect(await vault.readOriginal(result.imported[0].vaultRef)).toEqual(bytes)
        expect(await repository.listPreviewAssets('combo-a')).toEqual(result.imported)
    })

    it('does not merge separate images into a shared combination implicitly', async () => {
        const vault = new MemoryStyleLabVault()
        const repository = new IndexedDbStyleLabRepository(memoryStorage(), 'vault-separate')
        const draft = async (id: string, byte: number): Promise<StyleImportDraft> => ({
            id,
            fileName: `${id}.png`,
            mimeType: 'image/png',
            sha256: await hashQueueResourceBytes(new Uint8Array([byte])),
            bytes: new Uint8Array([byte]),
            tags: [{ tag: id, artist: id, kind: 'artist', weight: 1 }],
            includedTagKeys: [`artist:${id}`],
            rawMetadata: null,
            normalizedMetadata: null,
            duplicateAssetIds: [],
        })
        const result = await commitStyleImportDrafts({
            drafts: await Promise.all([draft('one', 1), draft('two', 2)]),
            repository,
            vault,
            resolveCombination: (_tags, item) => `combo-${item.id}`,
            now: () => 1,
        })

        expect(result.imported.map(asset => asset.comboId)).toEqual(['combo-one', 'combo-two'])
    })
})
