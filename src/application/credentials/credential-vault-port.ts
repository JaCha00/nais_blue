export type CredentialSecretBundle =
    | {
        readonly kind: 'novelai-token'
        readonly token: string
    }
    | {
        readonly kind: 'r2-access-key-pair'
        readonly accessKeyId: string
        readonly secretAccessKey: string
    }

export interface CredentialSecretReference {
    readonly id: string
    readonly kind: CredentialSecretBundle['kind']
}

/** Registration and deletion remain one-way so presentation state never reads raw secrets. */
export interface CredentialVaultPort {
    setSecret(input: {
        credentialId: string
        secret: CredentialSecretBundle
    }): Promise<CredentialSecretReference>
    hasSecret(ref: CredentialSecretReference): Promise<boolean>
    deleteSecret(ref: CredentialSecretReference): Promise<void>
}
