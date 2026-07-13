import { describe, expect, it } from 'vitest'

import {
    FULL_BACKUP_STORE_KEYS,
    copyStoreKeysRetainingSource,
    exportBackupFromStorage,
    importBackupToStorage,
    type BackupStoragePort,
} from '@/lib/indexed-db'
import { loadFixtureJson } from '../helpers'

class MemoryStorage implements BackupStoragePort {
    readonly values = new Map<string, string>()

    getItem(key: string): string | null {
        return this.values.get(key) ?? null
    }

    setItem(key: string, value: string): void {
        this.values.set(key, value)
    }
}

describe('old store migration and backup round trip', () => {
    it('copies renamed data with exact readback while retaining the legacy source', async () => {
        const storage = new MemoryStorage()
        const legacy = JSON.stringify({ state: { enabled: false, count: 0 }, version: 0 })
        storage.values.set('tools-storage', legacy)

        const result = await copyStoreKeysRetainingSource(
            [['tools-storage', 'nais2-tools']],
            storage,
            storage,
        )

        expect(result).toEqual([{
            sourceKey: 'tools-storage',
            targetKey: 'nais2-tools',
            status: 'copied',
            sourceRetained: true,
        }])
        expect(storage.values.get('tools-storage')).toBe(legacy)
        expect(storage.values.get('nais2-tools')).toBe(legacy)

        const newer = JSON.stringify({ state: { enabled: true, count: 9 }, version: 2 })
        storage.values.set('nais2-tools', newer)
        const alreadyMigrated = await copyStoreKeysRetainingSource(
            [['tools-storage', 'nais2-tools']],
            storage,
            storage,
        )
        expect(alreadyMigrated[0]?.status).toBe('target-present')
        expect(storage.values.get('tools-storage')).toBe(legacy)
        expect(storage.values.get('nais2-tools')).toBe(newer)
    })

    it('imports an old backup, exports canonical plus retained stores, and restores them losslessly', async () => {
        const fixture = await loadFixtureJson<Record<string, unknown>>('legacy/store-backup-roundtrip.json')
        const imported = new MemoryStorage()
        const firstRestore = await importBackupToStorage(imported, fixture, { overwrite: true })

        expect(firstRestore.failed).toEqual([])
        expect(firstRestore.success).toEqual(expect.arrayContaining([
            'nais2-character-rotation',
            'tools-storage',
            'nais2-character-store',
        ]))
        expect(FULL_BACKUP_STORE_KEYS).toContain('tools-storage')

        // Provenance fixtures keep image bytes redacted. Inject synthetic bytes
        // at runtime to verify the storage boundary still preserves them.
        imported.values.set('nais2-character-store', JSON.stringify({
            version: 0,
            state: {
                characterImages: [{
                    id: 'resource:character-image',
                    base64: 'data:image/png;base64,T0xELUJZVEVT',
                    encodedVibe: 'existing-character-cache',
                }],
                vibeImages: [{
                    id: 'resource:vibe-image',
                    base64: 'data:image/png;base64,VklCRS1CWVRFUw==',
                    encodedVibe: 'existing-vibe-cache',
                }],
            },
        }))

        const exported = await exportBackupFromStorage(imported, {
            exportedAt: '2026-07-12T00:00:00.000Z',
        })
        const fileRoundTrip = JSON.parse(JSON.stringify(exported)) as Record<string, unknown>
        const restored = new MemoryStorage()
        const secondRestore = await importBackupToStorage(restored, fileRoundTrip, { overwrite: true })

        expect(secondRestore.failed).toEqual([])
        for (const key of ['nais2-character-rotation', 'tools-storage'] as const) {
            expect(JSON.parse(restored.getItem(key) ?? 'null')).toEqual(fixture[key])
        }

        const characterStore = JSON.parse(restored.getItem('nais2-character-store') ?? 'null') as {
            state: {
                characterImages: Array<Record<string, unknown>>
                vibeImages: Array<Record<string, unknown>>
            }
        }
        expect(characterStore.state.characterImages[0]?.base64).toBe('data:image/png;base64,T0xELUJZVEVT')
        expect(characterStore.state.vibeImages[0]?.base64).toBe('data:image/png;base64,VklCRS1CWVRFUw==')
        expect(characterStore.state.characterImages[0]?.encodedVibe).toBe('existing-character-cache')
        expect(characterStore.state.vibeImages[0]?.encodedVibe).toBe('existing-vibe-cache')
    })

    it('does not report a restore as successful when write readback differs', async () => {
        const storage: BackupStoragePort = {
            getItem: () => null,
            setItem: () => undefined,
        }
        const result = await importBackupToStorage(storage, {
            _exportedAt: '2026-07-12T00:00:00.000Z',
            _version: '2.3',
            'nais2-character-rotation': { state: { restEnabled: false }, version: 2 },
        }, { overwrite: true })

        expect(result.success).toEqual([])
        expect(result.failed).toEqual([
            'nais2-character-rotation',
            'rollback:nais2-character-rotation',
        ])
    })

    it('performs zero writes when a strict pre-restore journal read fails', async () => {
        let writes = 0
        const storage: BackupStoragePort = {
            getItem: () => { throw new Error('strict read failed') },
            setItem: () => { writes += 1 },
            removeItem: () => { writes += 1 },
        }

        const result = await importBackupToStorage(storage, {
            'nais2-scenes': { state: { presets: [] }, version: 1 },
        }, { overwrite: true })

        expect(result.success).toEqual([])
        expect(result.failed).toEqual(['pre-restore-journal'])
        expect(writes).toBe(0)
    })
})
