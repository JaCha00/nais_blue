import { describe, expect, it, vi } from 'vitest'
import type { StateStorage } from 'zustand/middleware'

import {
    createWildcardResolutionSession,
    prepareWildcardResolution,
    processWildcards,
} from '@/lib/fragment-processor'
import {
    FRAGMENT_FILE_SCHEMA_VERSION,
    FRAGMENT_SEQUENCE_SCHEMA_VERSION,
    FRAGMENT_STORE_SCHEMA_VERSION,
    FragmentSequenceMutationLockedError,
    createFragmentStore,
    migrateFragmentPersistedState,
    type FragmentContentRepository,
} from '@/stores/fragment-store'

class MemoryFragmentContentRepository implements FragmentContentRepository {
    readonly records = new Map<string, string[]>()

    async read(contentKey: string): Promise<string[] | null> {
        const content = this.records.get(contentKey)
        return content === undefined ? null : [...content]
    }

    async write(contentKey: string, content: readonly string[]): Promise<void> {
        this.records.set(contentKey, [...content])
    }

    async remove(contentKey: string): Promise<void> {
        this.records.delete(contentKey)
    }

    async clear(): Promise<void> {
        this.records.clear()
    }
}

function createMemoryMetadataStorage(): StateStorage {
    const records = new Map<string, string>()
    return {
        getItem: name => records.get(name) ?? null,
        setItem: (name, value) => {
            records.set(name, value)
        },
        removeItem: name => {
            records.delete(name)
        },
    }
}

let testStoreOrdinal = 0

function createTestStore() {
    const contentRepository = new MemoryFragmentContentRepository()
    const store = createFragmentStore({
        contentRepository,
        metadataStorage: createMemoryMetadataStorage(),
        skipHydration: true,
        storageName: `fragment-test-${testStoreOrdinal}`,
    })
    testStoreOrdinal += 1
    return { contentRepository, store }
}

type RehydratableFragmentStore = ReturnType<typeof createFragmentStore> & {
    persist: { rehydrate(): Promise<void> }
}

describe('Fragment store v2 migration', () => {
    it('preserves valid legacy IDs and deterministically repairs missing or duplicate IDs', () => {
        const legacy = {
            files: [
                {
                    id: 'legacy-hair',
                    name: 'hair',
                    folder: '',
                    content: ['silver hair'],
                    createdAt: 10,
                    updatedAt: 20,
                },
                {
                    id: 'legacy-hair',
                    name: 'hair-copy',
                    folder: 'copies',
                    lineCount: 1,
                    createdAt: 30,
                    updatedAt: 40,
                },
                {
                    name: 'outfit',
                    folder: 'wardrobe',
                    content: ['coat', 'dress'],
                },
            ],
            sequentialCounters: {
                hair: 2,
                'wardrobe/outfit': 1,
                invalid: -1,
            },
        }

        const first = migrateFragmentPersistedState(legacy)
        const second = migrateFragmentPersistedState(legacy)

        expect(second).toEqual(first)
        expect(first.schemaVersion).toBe(FRAGMENT_STORE_SCHEMA_VERSION)
        expect(first.files[0]).toMatchObject({
            schemaVersion: FRAGMENT_FILE_SCHEMA_VERSION,
            id: 'legacy-hair',
            contentKey: 'legacy-hair',
        })
        expect(first.files[1].id).toMatch(/^legacy-hair~/)
        expect(first.files[1].contentKey).toBe('legacy-hair')
        expect(first.files[2].id).toMatch(/^fragment:/)
        expect(new Set(first.files.map(file => file.id)).size).toBe(3)
        expect(first.sequenceState).toMatchObject({
            schemaVersion: FRAGMENT_SEQUENCE_SCHEMA_VERSION,
            counters: {
                'legacy-hair': 2,
                [first.files[2].id]: 1,
            },
        })
        expect(first.sequentialCounters).not.toHaveProperty('invalid')
        expect(first._migrated).toBe(false)
    })

    it('assigns an ambiguous legacy basename counter to only the legacy first-match file', () => {
        const migrated = migrateFragmentPersistedState({
            files: [
                { id: 'fragment:first', name: 'outfit', folder: 'wardrobe' },
                { id: 'fragment:second', name: 'outfit', folder: 'uniforms' },
            ],
            sequentialCounters: { outfit: 5 },
        })

        expect(migrated.sequenceState.counters).toEqual({
            'fragment:first': 5,
        })
    })

    it('round-trips stable IDs, metadata, and separately stored content', async () => {
        const source = createTestStore().store
        const hair = await source.getState().addFile('hair', '', ['silver', 'blue'])
        const outfit = await source.getState().addFile('outfit', 'wardrobe', ['coat'])
        const exported = await source.getState().exportAll()

        expect(exported.schemaVersion).toBe(FRAGMENT_STORE_SCHEMA_VERSION)
        expect(exported.meta.map(file => file.id)).toEqual([hair.id, outfit.id])
        expect(exported.contents).toEqual({
            [hair.id]: ['silver', 'blue'],
            [outfit.id]: ['coat'],
        })

        const restored = createTestStore().store
        expect(await restored.getState().importAll(exported)).toBe(2)
        expect(restored.getState().files.map(file => file.id)).toEqual([hair.id, outfit.id])
        expect(await restored.getState().loadFileContent(hair.id)).toEqual(['silver', 'blue'])
        expect(await restored.getState().loadFileContent(outfit.id)).toEqual(['coat'])
    })

    it('hydrates legacy metadata against the existing separate content key', async () => {
        const storageName = 'legacy-fragment-hydration'
        const metadataStorage = createMemoryMetadataStorage()
        const contentRepository = new MemoryFragmentContentRepository()
        contentRepository.records.set('1700000000000', ['legacy silver', 'legacy blue'])
        await metadataStorage.setItem(storageName, JSON.stringify({
            version: 0,
            state: {
                files: [{
                    id: '1700000000000',
                    name: 'hair',
                    folder: 'people',
                    lineCount: 2,
                    createdAt: 1,
                    updatedAt: 2,
                }],
                sequentialCounters: { 'people/hair': 1 },
                _migrated: true,
            },
        }))
        const store = createFragmentStore({
            contentRepository,
            metadataStorage,
            skipHydration: true,
            storageName,
        }) as RehydratableFragmentStore

        await store.persist.rehydrate()

        expect(store.getState().files).toEqual([
            expect.objectContaining({
                schemaVersion: FRAGMENT_FILE_SCHEMA_VERSION,
                id: '1700000000000',
                contentKey: '1700000000000',
            }),
        ])
        expect(await store.getState().loadFileContent('1700000000000')).toEqual([
            'legacy silver',
            'legacy blue',
        ])
        expect(store.getState().getSequenceSnapshot().counters['1700000000000']).toBe(1)
        expect(store.getState()._initialized).toBe(true)
    })

    it('keeps existing separate content authoritative over a stale embedded legacy copy', async () => {
        const storageName = 'mixed-legacy-fragment-hydration'
        const metadataStorage = createMemoryMetadataStorage()
        const contentRepository = new MemoryFragmentContentRepository()
        contentRepository.records.set('mixed-fragment', ['separate current'])
        await metadataStorage.setItem(storageName, JSON.stringify({
            version: 0,
            state: {
                files: [{
                    id: 'mixed-fragment',
                    name: 'mixed',
                    folder: '',
                    content: ['embedded stale'],
                    lineCount: 1,
                    createdAt: 1,
                    updatedAt: 2,
                }],
                sequentialCounters: {},
                _migrated: false,
            },
        }))
        const store = createFragmentStore({
            contentRepository,
            metadataStorage,
            skipHydration: true,
            storageName,
        }) as RehydratableFragmentStore

        await store.persist.rehydrate()

        expect(await store.getState().loadFileContent('mixed-fragment')).toEqual(['separate current'])
        expect(contentRepository.records.get('mixed-fragment')).toEqual(['separate current'])
        expect(store.getState().files[0]).not.toHaveProperty('content')
    })
})

describe('Fragment compatibility facade lifecycle', () => {
    it('preserves one legacy Math.random draw for every resolved choice', async () => {
        const { store } = createTestStore()
        const random = vi.spyOn(Math, 'random').mockReturnValue(0.75)

        await expect(processWildcards(
            '<red|blue>, (day/night), warm/cool',
            { repository: store.getState().getLookupRepository() },
        )).resolves.toBe('blue, night, cool')
        expect(random).toHaveBeenCalledTimes(3)
    })

    it('routes all legacy syntax through the deterministic resolver when a seed is supplied', async () => {
        const { store } = createTestStore()
        const repository = store.getState().getLookupRepository()
        const random = vi.spyOn(Math, 'random').mockImplementation(() => {
            throw new Error('explicit deterministic seed must not consult ambient randomness')
        })
        const input = '<red|blue>, (day/night), warm/cool, https://example.com/a/b'

        const first = await processWildcards(input, { seed: 1234, repository })
        const second = await processWildcards(input, { seed: 1234, repository })

        expect(second).toBe(first)
        expect(first).toContain('https://example.com/a/b')
        expect(random).not.toHaveBeenCalled()
    })

    it('does not consume preview or cancelled/failed generation proposals', async () => {
        const { store } = createTestStore()
        const file = await store.getState().addFile(
            'outfit',
            'wardrobe',
            ['coat', 'dress', 'uniform'],
        )
        const repository = store.getState().getLookupRepository()
        const initialRevision = store.getState().getSequenceSnapshot().revision

        const preview = await prepareWildcardResolution('<*outfit>, <*wardrobe/outfit>', {
            seed: 7,
            mode: 'preview',
            repository,
        })
        expect(preview.resolvedText).toBe('coat, coat')
        expect(preview.result.sequenceCommitProposal).toBeNull()
        expect(preview.commitSequence()).toBe(false)
        expect(store.getState().getSequenceSnapshot()).toMatchObject({
            revision: initialRevision,
            counters: { [file.id]: 0 },
        })

        const cancelled = await prepareWildcardResolution('<*outfit>', {
            seed: 7,
            mode: 'generate',
            repository,
        })
        expect(cancelled.resolvedText).toBe('coat')
        expect(cancelled.result.sequenceCommitProposal).not.toBeNull()
        cancelled.discard()
        expect(cancelled.status).toBe('discarded')
        expect(cancelled.commitSequence()).toBe(false)
        expect(store.getState().getSequenceSnapshot().counters[file.id]).toBe(0)

        const failed = await prepareWildcardResolution('<*outfit>, <missing>', {
            seed: 7,
            mode: 'generate',
            strictness: 'strict',
            repository,
        })
        expect(failed.result.success).toBe(false)
        expect(failed.result.sequenceCommitProposal).toBeNull()
        expect(failed.commitSequence()).toBe(false)
        expect(store.getState().getSequenceSnapshot().counters[file.id]).toBe(0)
    })

    it('stages sequential choices across concurrent legacy prompt fields and commits them atomically', async () => {
        const { store } = createTestStore()
        const file = await store.getState().addFile(
            'outfit',
            'wardrobe',
            ['coat', 'dress', 'uniform'],
        )
        const session = createWildcardResolutionSession({
            repository: store.getState().getLookupRepository(),
        })

        const [first, second] = await Promise.all([
            session.process('<*wardrobe/outfit>'),
            session.process('<*outfit>'),
        ])

        expect([first, second]).toEqual(['coat', 'dress'])
        expect(store.getState().getSequenceSnapshot().counters[file.id]).toBe(0)
        expect(session.sequenceCommitProposal).toEqual({
            expectedRevision: expect.any(Number),
            changes: [{
                fragmentId: file.id,
                fragmentPath: 'wardrobe/outfit',
                expectedCounter: 0,
                nextCounter: 2,
            }],
        })

        expect(await session.commitSequence()).toBe(true)
        expect(session.status).toBe('committed')
        expect(store.getState().getSequenceSnapshot().counters[file.id]).toBe(2)
    })

    it('leases a proposal without consuming it and excludes a concurrent stale worker', async () => {
        const { store } = createTestStore()
        const file = await store.getState().addFile('sequence', '', ['first', 'second'])
        const repository = store.getState().getLookupRepository()
        const first = createWildcardResolutionSession({ repository })
        const second = createWildcardResolutionSession({ repository })
        await Promise.all([first.process('<*sequence>'), second.process('<*sequence>')])

        const firstProposal = first.sequenceCommitProposal
        const secondProposal = second.sequenceCommitProposal
        expect(firstProposal).not.toBeNull()
        expect(secondProposal).not.toBeNull()
        const lease = store.getState().reserveSequenceProposal(firstProposal === null
            ? null
            : {
                expectedRevision: firstProposal.expectedRevision,
                changes: firstProposal.changes.map(change => ({ ...change })),
            })

        expect(lease).not.toBeNull()
        expect(store.getState().getSequenceSnapshot().counters[file.id]).toBe(0)
        expect(store.getState().commitSequenceProposal(firstProposal === null
            ? null
            : {
                expectedRevision: firstProposal.expectedRevision,
                changes: firstProposal.changes.map(change => ({ ...change })),
            })).toBe(false)
        expect(store.getState().reserveSequenceProposal(secondProposal === null
            ? null
            : {
                expectedRevision: secondProposal.expectedRevision,
                changes: secondProposal.changes.map(change => ({ ...change })),
            })).toBeNull()
        lease?.release()
        expect(store.getState().getSequenceSnapshot().counters[file.id]).toBe(0)
        const replacementLease = store.getState().reserveSequenceProposal(secondProposal === null
            ? null
            : {
                expectedRevision: secondProposal.expectedRevision,
                changes: secondProposal.changes.map(change => ({ ...change })),
            })
        expect(replacementLease?.commit()).toBe(true)
        expect(store.getState().getSequenceSnapshot().counters[file.id]).toBe(1)
    })

    it('keeps content and revision unchanged when a sequence lease rejects mutations', async () => {
        const { store } = createTestStore()
        const file = await store.getState().addFile('sequence', '', ['first', 'second'])
        const generated = await prepareWildcardResolution('<*sequence>', {
            seed: 17,
            mode: 'generate',
            repository: store.getState().getLookupRepository(),
        })
        const proposal = generated.result.sequenceCommitProposal
        if (proposal === null) throw new Error('expected a sequential proposal')

        const lease = store.getState().reserveSequenceProposal({
            expectedRevision: proposal.expectedRevision,
            changes: proposal.changes.map(change => ({ ...change })),
        })
        const snapshotBefore = store.getState().getSequenceSnapshot()
        const contentBefore = await store.getState().loadFileContent(file.id)

        await expect(store.getState().updateFile(file.id, {
            content: ['changed'],
        })).rejects.toBeInstanceOf(FragmentSequenceMutationLockedError)
        expect(() => store.getState().resetSequentialCounter('sequence'))
            .toThrow(FragmentSequenceMutationLockedError)
        expect(() => store.getState().reorderFiles([...store.getState().files].reverse()))
            .toThrow(FragmentSequenceMutationLockedError)
        expect(await store.getState().loadFileContent(file.id)).toEqual(contentBefore)
        expect(store.getState().getSequenceSnapshot()).toEqual(snapshotBefore)

        // Rejected mutations do not poison the owner: its synchronous CAS
        // commit still advances exactly the proposal held by the lease.
        expect(lease?.commit()).toBe(true)
        expect(store.getState().getSequenceSnapshot().counters[file.id]).toBe(1)
    })

    it('defers lease acquisition while an async fragment mutation is awaiting repository IO', async () => {
        const { contentRepository, store } = createTestStore()
        const file = await store.getState().addFile('sequence', '', ['first', 'second'])
        const generated = await prepareWildcardResolution('<*sequence>', {
            seed: 23,
            mode: 'generate',
            repository: store.getState().getLookupRepository(),
        })
        const proposal = generated.result.sequenceCommitProposal
        if (proposal === null) throw new Error('expected a sequential proposal')

        let markWriteStarted: (() => void) | undefined
        const writeStarted = new Promise<void>(resolve => {
            markWriteStarted = resolve
        })
        let releaseWrite: (() => void) | undefined
        const writeGate = new Promise<void>(resolve => {
            releaseWrite = resolve
        })
        vi.spyOn(contentRepository, 'write').mockImplementationOnce(async (contentKey, content) => {
            markWriteStarted?.()
            await writeGate
            contentRepository.records.set(contentKey, [...content])
        })

        const mutation = store.getState().updateFile(file.id, { content: ['changed'] })
        await writeStarted

        expect(store.getState().reserveSequenceProposal({
            expectedRevision: proposal.expectedRevision,
            changes: proposal.changes.map(change => ({ ...change })),
        })).toBeNull()
        const noOpLease = store.getState().reserveSequenceProposal(null)
        expect(noOpLease).not.toBeNull()
        expect(noOpLease?.commit()).toBe(true)

        releaseWrite?.()
        await mutation
        expect(await store.getState().loadFileContent(file.id)).toEqual(['changed'])

        const refreshed = await prepareWildcardResolution('<*sequence>', {
            seed: 23,
            mode: 'generate',
            repository: store.getState().getLookupRepository(),
        })
        const refreshedProposal = refreshed.result.sequenceCommitProposal
        if (refreshedProposal === null) throw new Error('expected a refreshed proposal')
        const lease = store.getState().reserveSequenceProposal({
            expectedRevision: refreshedProposal.expectedRevision,
            changes: refreshedProposal.changes.map(change => ({ ...change })),
        })
        expect(lease).not.toBeNull()
        lease?.release()
    })

    it('commits once after success and keeps the counter attached to the stable ID after rename', async () => {
        const { store } = createTestStore()
        const file = await store.getState().addFile(
            'outfit',
            'wardrobe',
            ['coat', 'dress', 'uniform'],
        )
        const repository = store.getState().getLookupRepository()
        const generated = await prepareWildcardResolution('<*outfit>', {
            seed: 9,
            mode: 'generate',
            repository,
        })

        expect(generated.resolvedText).toBe('coat')
        expect(generated.commitSequence()).toBe(true)
        expect(generated.status).toBe('committed')
        expect(generated.commitSequence()).toBe(false)
        expect(store.getState().getSequenceSnapshot().counters[file.id]).toBe(1)

        await store.getState().updateFile(file.id, { folder: 'closet' })
        const renamed = await prepareWildcardResolution('<*closet/outfit>', {
            seed: 9,
            mode: 'generate',
            repository,
        })
        expect(renamed.resolvedText).toBe('dress')
        expect(renamed.commitSequence()).toBe(true)
        expect(store.getState().getSequenceSnapshot().counters[file.id]).toBe(2)
        expect(store.getState().sequentialCounters['closet/outfit']).toBe(2)
        expect(store.getState().sequentialCounters).not.toHaveProperty('outfit')
        expect(store.getState().sequentialCounters).not.toHaveProperty('wardrobe/outfit')

        const replacement = await store.getState().addFile('outfit', 'wardrobe', ['new coat'])
        expect(store.getState().getSequenceSnapshot().counters[replacement.id]).toBe(0)
    })
})
