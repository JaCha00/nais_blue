export const CREDENTIAL_PROVIDERS = ['novelai', 'cloudflare-r2'] as const
export type CredentialProvider = typeof CREDENTIAL_PROVIDERS[number]

export const CREDENTIAL_LIFECYCLES = [
    'unverified',
    'ready',
    'needs-attention',
    'disabled',
] as const
export type CredentialLifecycle = typeof CREDENTIAL_LIFECYCLES[number]

export type NovelAiSubscriptionTier = 'paper' | 'tablet' | 'scroll' | 'opus'

interface CredentialRecordBase {
    readonly id: string
    readonly label: string
    readonly enabled: boolean
    readonly secretRef: string
    readonly lastFour: string
    readonly lifecycle: CredentialLifecycle
    readonly verifiedAt: string | null
    readonly lastErrorCode: string | null
}

export interface NovelAiCredentialRecord extends CredentialRecordBase {
    readonly provider: 'novelai'
    readonly novelAi: {
        readonly tier: NovelAiSubscriptionTier | null
        readonly anlas: number | null
    }
    readonly r2?: never
}

export interface CloudflareR2CredentialRecord extends CredentialRecordBase {
    readonly provider: 'cloudflare-r2'
    readonly novelAi?: never
    readonly r2: {
        readonly accountId: string
        readonly bucket: string
        readonly jurisdiction: string | null
    }
}

/** Persistable public metadata; raw provider secrets are represented only by secretRef. */
export type CredentialRecord = NovelAiCredentialRecord | CloudflareR2CredentialRecord
