import type {
    CredentialProvider,
    CredentialRecord,
} from '@/domain/credentials/record'

/** Application use cases depend on this port without owning a concrete persistence adapter. */
export interface CredentialRepositoryPort {
    get(id: string): Promise<CredentialRecord | null>
    list(provider?: CredentialProvider): Promise<readonly CredentialRecord[]>
    put(record: CredentialRecord): Promise<void>
    delete(id: string): Promise<void>
}
