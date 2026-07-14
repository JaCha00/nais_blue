import { beforeEach, describe, expect, it, vi } from 'vitest'

const APP_DATA = 'C:/redacted/AppData/Roaming/com.sunakgo.nais2'
const SNAPSHOT_FILE = 'nais2-credentials-v1.hold'

const mocks = vi.hoisted(() => ({
    appDataDir: vi.fn(async () => APP_DATA),
    join: vi.fn(async (...parts: string[]) => parts.join('/')),
    exists: vi.fn(async () => false),
    strongholdLoad: vi.fn(async () => ({
        loadClient: vi.fn(async () => { throw new Error('new vault') }),
        createClient: vi.fn(async () => ({
            getStore: () => ({ get: vi.fn(async () => null) }),
        })),
        save: vi.fn(async () => undefined),
        unload: vi.fn(async () => undefined),
    })),
}))

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }))
vi.mock('@tauri-apps/api/path', () => ({
    BaseDirectory: { AppData: 14 },
    appDataDir: mocks.appDataDir,
    join: mocks.join,
}))
vi.mock('@tauri-apps/plugin-fs', () => ({ exists: mocks.exists }))
vi.mock('@tauri-apps/plugin-stronghold', () => ({
    Stronghold: class {
        static load = mocks.strongholdLoad
    },
}))

describe('credential vault AppData path contract', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('checks the ACL-scoped relative snapshot using the same BaseDirectory.AppData root', async () => {
        const { StrongholdCredentialVault } = await import('@/services/credentials/stronghold-credential-vault')
        const vault = new StrongholdCredentialVault()
        const result = await vault.availability()
        await vault.unlock('session-passphrase')

        expect(result).toEqual({ available: true, exists: false })
        expect(mocks.appDataDir).toHaveBeenCalledOnce()
        expect(mocks.join).toHaveBeenCalledWith(APP_DATA, SNAPSHOT_FILE)
        expect(mocks.exists).toHaveBeenCalledWith(SNAPSHOT_FILE, { baseDir: 14 })
        expect(mocks.exists).not.toHaveBeenCalledWith(expect.stringContaining(APP_DATA))
    })
})
