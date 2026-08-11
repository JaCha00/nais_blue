import { describe, expect, it } from 'vitest'

import type { CredentialRepositoryPort } from '@/application/credentials/credential-repository'
import type {
    CredentialSecretBundle,
    CredentialSecretReference,
    CredentialVaultPort,
} from '@/application/credentials/credential-vault-port'
import type {
    CredentialProvider,
    CredentialRecord,
} from '@/domain/credentials/record'

class MemoryCredentialRepository implements CredentialRepositoryPort {
    private readonly records = new Map<string, CredentialRecord>()

    async get(id: string): Promise<CredentialRecord | null> {
        return this.records.get(id) ?? null
    }

    async list(provider?: CredentialProvider): Promise<readonly CredentialRecord[]> {
        return [...this.records.values()].filter(record => provider === undefined || record.provider === provider)
    }

    async put(record: CredentialRecord): Promise<void> {
        this.records.set(record.id, record)
    }

    async delete(id: string): Promise<void> {
        this.records.delete(id)
    }
}

class MemoryCredentialVault implements CredentialVaultPort {
    private readonly secrets = new Map<string, CredentialSecretBundle>()

    async setSecret(input: {
        credentialId: string
        secret: CredentialSecretBundle
    }): Promise<CredentialSecretReference> {
        const ref = { id: `secret:${input.credentialId}`, kind: input.secret.kind } as const
        this.secrets.set(ref.id, input.secret)
        return ref
    }

    async hasSecret(ref: CredentialSecretReference): Promise<boolean> {
        return this.secrets.has(ref.id)
    }

    async deleteSecret(ref: CredentialSecretReference): Promise<void> {
        this.secrets.delete(ref.id)
    }
}

const NOVELAI_TOKEN = 'fixture-only-novelai-token-1234'

const novelAiRecord: CredentialRecord = {
    id: 'novelai-account-a',
    provider: 'novelai',
    label: 'Account A',
    enabled: true,
    secretRef: 'secret:novelai-account-a',
    lastFour: '1234',
    lifecycle: 'ready',
    verifiedAt: '2026-08-08T00:00:00.000Z',
    lastErrorCode: null,
    novelAi: { tier: 'opus', anlas: 100 },
}

describe('credential foundation contracts', () => {
    it('persists and filters public provider metadata without raw secrets', async () => {
        const repository = new MemoryCredentialRepository()
        await repository.put(novelAiRecord)
        await repository.put({
            id: 'r2-account-a',
            provider: 'cloudflare-r2',
            label: 'R2 Archive',
            enabled: true,
            secretRef: 'secret:r2-account-a',
            lastFour: '5678',
            lifecycle: 'unverified',
            verifiedAt: null,
            lastErrorCode: null,
            r2: { accountId: 'account-id', bucket: 'images', jurisdiction: null },
        })

        expect(await repository.get(novelAiRecord.id)).toEqual(novelAiRecord)
        expect(await repository.list('novelai')).toEqual([novelAiRecord])
        expect(JSON.stringify(await repository.list())).not.toContain(NOVELAI_TOKEN)

        await repository.delete(novelAiRecord.id)
        expect(await repository.get(novelAiRecord.id)).toBeNull()
    })

    it('stores and deletes a secret through an opaque reference', async () => {
        const vault = new MemoryCredentialVault()
        const ref = await vault.setSecret({
            credentialId: novelAiRecord.id,
            secret: { kind: 'novelai-token', token: NOVELAI_TOKEN },
        })

        expect(ref).toEqual({ id: novelAiRecord.secretRef, kind: 'novelai-token' })
        await expect(vault.hasSecret(ref)).resolves.toBe(true)
        await vault.deleteSecret(ref)
        await expect(vault.hasSecret(ref)).resolves.toBe(false)
    })
})
