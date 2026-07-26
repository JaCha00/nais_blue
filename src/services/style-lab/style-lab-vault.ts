import {
    BaseDirectory,
    exists,
    mkdir,
    readFile,
    remove,
    rename,
    writeFile,
} from '@tauri-apps/plugin-fs'
import { hashQueueResourceBytes } from '@/services/queue/queue-resource-materializer'

const VAULT_DIRECTORY = 'style-lab-vault/originals'

export interface StyleLabVaultRecord {
    sha256: string
    vaultRef: string
    mimeType: 'image/png' | 'image/webp'
    byteSize: number
}

export interface StyleLabVault {
    putOriginal(bytes: Uint8Array, mimeType: StyleLabVaultRecord['mimeType']): Promise<StyleLabVaultRecord>
    readOriginal(vaultRef: string): Promise<Uint8Array>
}

function extensionFor(mimeType: StyleLabVaultRecord['mimeType']): 'png' | 'webp' {
    return mimeType === 'image/webp' ? 'webp' : 'png'
}

function assertVaultRef(vaultRef: string): void {
    if (!/^style-lab-vault\/originals\/sha256-[a-f0-9]{64}\.(png|webp)$/i.test(vaultRef)) {
        throw new TypeError('Invalid Style-Lab Vault reference')
    }
}

/**
 * The Vault depends only on Tauri AppData file operations. It writes raw input
 * bytes to a content-addressed temp file and renames it, so imports and Queue
 * outputs share immutable originals without image re-encoding.
 */
export class TauriStyleLabVault implements StyleLabVault {
    async putOriginal(
        inputBytes: Uint8Array,
        mimeType: StyleLabVaultRecord['mimeType'],
    ): Promise<StyleLabVaultRecord> {
        const bytes = new Uint8Array(inputBytes)
        const sha256 = await hashQueueResourceBytes(bytes)
        const vaultRef = `${VAULT_DIRECTORY}/sha256-${sha256.slice('sha256:'.length)}.${extensionFor(mimeType)}`
        await mkdir(VAULT_DIRECTORY, { baseDir: BaseDirectory.AppData, recursive: true })
        if (!await exists(vaultRef, { baseDir: BaseDirectory.AppData })) {
            const temporaryRef = `${vaultRef}.tmp-${globalThis.crypto.randomUUID()}`
            try {
                await writeFile(temporaryRef, bytes, { baseDir: BaseDirectory.AppData })
                try {
                    await rename(temporaryRef, vaultRef, {
                        oldPathBaseDir: BaseDirectory.AppData,
                        newPathBaseDir: BaseDirectory.AppData,
                    })
                } catch (error) {
                    // Concurrent imports may win the same digest path. Accept the
                    // winner only after the common digest verification below.
                    if (!await exists(vaultRef, { baseDir: BaseDirectory.AppData })) throw error
                    await remove(temporaryRef, { baseDir: BaseDirectory.AppData }).catch(() => undefined)
                }
            } catch (error) {
                await remove(temporaryRef, { baseDir: BaseDirectory.AppData }).catch(() => undefined)
                throw error
            }
        }
        const persisted = await readFile(vaultRef, { baseDir: BaseDirectory.AppData })
        if (await hashQueueResourceBytes(persisted) !== sha256) {
            throw new Error('Style-Lab Vault digest verification failed')
        }
        return { sha256, vaultRef, mimeType, byteSize: bytes.byteLength }
    }

    async readOriginal(vaultRef: string): Promise<Uint8Array> {
        assertVaultRef(vaultRef)
        return readFile(vaultRef, { baseDir: BaseDirectory.AppData })
    }
}

/** In-memory adapter keeps import and Queue tests independent from the Tauri runtime. */
export class MemoryStyleLabVault implements StyleLabVault {
    private readonly records = new Map<string, Uint8Array>()

    async putOriginal(
        inputBytes: Uint8Array,
        mimeType: StyleLabVaultRecord['mimeType'],
    ): Promise<StyleLabVaultRecord> {
        const bytes = new Uint8Array(inputBytes)
        const sha256 = await hashQueueResourceBytes(bytes)
        const vaultRef = `${VAULT_DIRECTORY}/sha256-${sha256.slice('sha256:'.length)}.${extensionFor(mimeType)}`
        const existing = this.records.get(vaultRef)
        if (existing !== undefined && await hashQueueResourceBytes(existing) !== sha256) {
            throw new Error('Style-Lab memory Vault digest collision')
        }
        if (existing === undefined) this.records.set(vaultRef, bytes)
        return { sha256, vaultRef, mimeType, byteSize: bytes.byteLength }
    }

    async readOriginal(vaultRef: string): Promise<Uint8Array> {
        assertVaultRef(vaultRef)
        const bytes = this.records.get(vaultRef)
        if (bytes === undefined) throw new Error(`Style-Lab Vault asset is missing: ${vaultRef}`)
        return new Uint8Array(bytes)
    }
}

let runtimeVault: StyleLabVault | null = null

export function getStyleLabVault(): StyleLabVault {
    runtimeVault ??= new TauriStyleLabVault()
    return runtimeVault
}

export function setStyleLabVaultForTests(vault: StyleLabVault | null): void {
    runtimeVault = vault
}
