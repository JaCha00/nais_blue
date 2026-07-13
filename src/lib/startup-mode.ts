import {
    toPersistenceFault,
    type PersistenceFault,
} from '@/domain/persistence/fault'

export type StartupMode = 'normal' | 'rescue'

export type StartupGateResult =
    | {
        mode: 'rescue'
        databaseFault: PersistenceFault
        migrationError?: never
    }
    | {
        mode: 'normal'
        databaseFault?: never
        migrationError?: unknown
    }

export interface StartupGateDependencies {
    initializeDatabase: () => Promise<void>
    runMigrations: () => Promise<void>
}

/** Database availability owns the startup mode; migration failures retain legacy authority in normal mode. */
export async function runStartupGate(
    dependencies: StartupGateDependencies,
): Promise<StartupGateResult> {
    try {
        await dependencies.initializeDatabase()
    } catch (error) {
        return {
            mode: 'rescue',
            databaseFault: toPersistenceFault(error, {
                operation: 'startup.indexeddb',
                criticality: 'critical',
                kind: 'database-unavailable',
            }),
        }
    }

    try {
        await dependencies.runMigrations()
        return { mode: 'normal' }
    } catch (migrationError) {
        return { mode: 'normal', migrationError }
    }
}
