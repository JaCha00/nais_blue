import { describe, expect, it, vi } from 'vitest'

import type { CredentialRef } from '@/domain/credentials/types'
import {
    NativeNovelAiCredentialVault,
    type NovelAiCredentialVaultBindings,
} from '@/services/credentials/native-novelai-credential-vault'

const SECRET = 'fixture-only-novelai-token-1234'
const NOW = new Date('2026-08-10T00:00:00.000Z')

function ref(overrides: Partial<CredentialRef> = {}): CredentialRef {
    return {
        id: 'novelai-slot-1',
        kind: 'novelai-token',
        lastFour: '1234',
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
        ...overrides,
    }
}

function browserBindings(): NovelAiCredentialVaultBindings {
    return {
        isNative: () => false,
        invoke: async () => { throw new Error('browser fallback must not invoke native commands') },
    }
}

function nativeBindings() {
    const secrets = new Map<string, string>()
    const calls: string[] = []
    const bindings: NovelAiCredentialVaultBindings = {
        isNative: () => true,
        invoke: async <T>(command: string, args: Record<string, unknown>): Promise<T> => {
            calls.push(command)
            const credentialRef = String(args.credentialRef)
            if (command === 'novelai_credential_status') {
                return { credentialRef, available: secrets.has(credentialRef) } as T
            }
            if (command === 'novelai_store_credential') {
                secrets.set(credentialRef, String(args.token))
                return { credentialRef, available: true } as T
            }
            if (command === 'novelai_load_credential') {
                return (secrets.get(credentialRef) ?? null) as T
            }
            if (command === 'novelai_delete_credential') {
                secrets.delete(credentialRef)
                return undefined as T
            }
            throw new Error(`unexpected command: ${command}`)
        },
    }
    return { bindings, calls, secrets }
}

describe('NativeNovelAiCredentialVault', () => {
    it('keeps the browser fallback in memory only and clears it when locked', async () => {
        const vault = new NativeNovelAiCredentialVault(browserBindings(), () => NOW)
        await expect(vault.set('novelai-token', SECRET, { id: 'novelai-slot-1' }))
            .rejects.toMatchObject({ code: 'locked' })

        expect(await vault.unlock('')).toEqual({ created: true, metadata: [] })
        const storedRef = await vault.set('novelai-token', SECRET, { id: 'novelai-slot-1' })
        expect(storedRef).toMatchObject({ lastFour: '1234', createdAt: NOW.toISOString() })
        expect(await vault.get(storedRef)).toBe(SECRET)
        expect(await vault.listMetadata()).toEqual([storedRef])

        await vault.lock()
        expect((await vault.unlock('')).created).toBe(true)
        expect(await vault.get(storedRef)).toBeNull()
    })

    it('uses only the four fixed native commands and never persists renderer plaintext', async () => {
        const native = nativeBindings()
        const vault = new NativeNovelAiCredentialVault(native.bindings, () => NOW)
        await vault.unlock('ignored-native-passphrase')
        const storedRef = await vault.set('novelai-token', SECRET, { id: 'novelai-slot-1' })

        expect(await vault.get(storedRef)).toBe(SECRET)
        await vault.delete(storedRef)
        expect(await vault.get(storedRef)).toBeNull()
        expect(native.secrets.size).toBe(0)
        expect(new Set(native.calls)).toEqual(new Set([
            'novelai_credential_status',
            'novelai_store_credential',
            'novelai_load_credential',
            'novelai_delete_credential',
        ]))
    })

    it('rejects cross-domain and arbitrary references before invoking native code', async () => {
        const native = nativeBindings()
        const vault = new NativeNovelAiCredentialVault(native.bindings, () => NOW)
        await vault.unlock('')
        native.calls.length = 0

        await expect(vault.get(ref({ kind: 'r2-secret-key' }))).rejects.toMatchObject({ code: 'invalid-secret' })
        await expect(vault.get(ref({ id: 'novelai-slot-3' }))).rejects.toMatchObject({ code: 'invalid-secret' })
        await expect(vault.set('r2-secret-key', SECRET, { id: 'novelai-slot-1' }))
            .rejects.toMatchObject({ code: 'invalid-secret' })
        expect(native.calls).toEqual([])
    })

    it('redacts native error details that could contain a submitted token', async () => {
        const bindings: NovelAiCredentialVaultBindings = {
            isNative: () => true,
            invoke: vi.fn(async <T>(command: string): Promise<T> => {
                if (command === 'novelai_credential_status') {
                    return { credentialRef: 'novelai-slot-1', available: false } as T
                }
                throw { code: 'E_NOVELAI_VAULT_WRITE', message: `failed for ${SECRET}` }
            }),
        }
        const vault = new NativeNovelAiCredentialVault(bindings, () => NOW)
        await vault.unlock('')

        await expect(vault.set('novelai-token', SECRET, { id: 'novelai-slot-1' }))
            .rejects.not.toThrow(SECRET)
        await expect(vault.set('novelai-token', SECRET, { id: 'novelai-slot-1' }))
            .rejects.toMatchObject({ code: 'operation-failed' })
    })
})
