import { afterEach, describe, expect, it, vi } from 'vitest'

import {
    backupArtifactContainsRawCredential,
    cleanupLegacyCredentialBackups,
} from '@/services/credentials/legacy-credential-cleanup'

class MemoryLocalStorage {
    private readonly values = new Map<string, string>()

    getItem(key: string): string | null {
        return this.values.get(key) ?? null
    }

    setItem(key: string, value: string): void {
        this.values.set(key, value)
    }
}

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('legacy credential backup detection', () => {
    it('detects raw NovelAI credentials in direct and nested migration backup shapes', () => {
        expect(backupArtifactContainsRawCredential({
            'nais2-auth': {
                version: 2,
                state: { token: 'fixture-only-raw-token' },
            },
        })).toBe(true)
        expect(backupArtifactContainsRawCredential({
            snapshots: [{
                serializedStores: {
                    'nais2-auth': JSON.stringify({
                        version: 2,
                        state: { token2: 'fixture-only-slot-two' },
                    }),
                },
            }],
        })).toBe(true)
    })

    it('detects legacy R2 access and secret key fields without treating non-secret R2 metadata as a credential', () => {
        expect(backupArtifactContainsRawCredential({
            r2: { accessKeyId: 'fixture-only-access', secretAccessKey: 'fixture-only-secret' },
        })).toBe(true)
        expect(backupArtifactContainsRawCredential({
            r2: { accountId: 'account-metadata', bucket: 'images', keyPrefix: 'safe/' },
        })).toBe(false)
    })

    it('does not flag an AuthState v3 reference containing only the allowed last four characters', () => {
        expect(backupArtifactContainsRawCredential({
            'nais2-auth': {
                version: 3,
                state: {
                    slot1CredentialRef: {
                        id: 'novelai-slot-1',
                        kind: 'novelai-token',
                        lastFour: '1234',
                        createdAt: '2026-07-13T00:00:00.000Z',
                        updatedAt: '2026-07-13T00:00:00.000Z',
                    },
                    slot2CredentialRef: null,
                    slot1Enabled: true,
                    slot2Enabled: false,
                    tier: 'opus',
                    tier2: null,
                },
            },
        })).toBe(false)
    })

    it('deletes only unsafe entries from the managed local auto-backup after confirmation', async () => {
        const storage = new MemoryLocalStorage()
        storage.setItem('nais2-auto-backup', JSON.stringify([
            { id: 'unsafe', stores: { 'nais2-auth': { state: { token: 'fixture-only-token' }, version: 2 } } },
            { id: 'safe', stores: { 'nais2-auth': { state: { token: '', tier: 'opus' }, version: 2 } } },
        ]))
        vi.stubGlobal('localStorage', storage)

        const result = await cleanupLegacyCredentialBackups()

        expect(result).toMatchObject({ inspected: 2, unsafe: 1, deleted: 1, failed: 0 })
        expect(JSON.parse(storage.getItem('nais2-auto-backup')!)).toEqual([
            { id: 'safe', stores: { 'nais2-auth': { state: { token: '', tier: 'opus' }, version: 2 } } },
        ])
    })
})
