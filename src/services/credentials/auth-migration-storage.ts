import {
    getIndexedDBItemStrict,
    setIndexedDBItemStrict,
} from '@/lib/indexed-db'
import {
    AUTH_STORE_KEY,
    type AuthMigrationStorage,
} from '@/services/credentials/auth-vault-migration'

export class RuntimeAuthMigrationStorage implements AuthMigrationStorage {
    getStrict(key: string): Promise<string | null> {
        return getIndexedDBItemStrict(key)
    }

    setStrict(key: string, value: string): Promise<void> {
        return setIndexedDBItemStrict(key, value)
    }

    getLegacyLocalAuth(): string | null {
        if (typeof localStorage === 'undefined') return null
        return localStorage.getItem(AUTH_STORE_KEY)
    }

    setLegacyLocalAuth(value: string): void {
        if (typeof localStorage === 'undefined') return
        localStorage.setItem(AUTH_STORE_KEY, value)
        if (localStorage.getItem(AUTH_STORE_KEY) !== value) {
            throw new Error('AuthState v3 local storage readback did not match.')
        }
    }
}

let runtimeStorage: AuthMigrationStorage | null = null

export function getRuntimeAuthMigrationStorage(): AuthMigrationStorage {
    runtimeStorage ??= new RuntimeAuthMigrationStorage()
    return runtimeStorage
}
