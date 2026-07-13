import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import { runStartupGate } from '@/lib/startup-mode'

describe('startup persistence gate', () => {
    it('enters rescue mode and never runs migrations when the database is unavailable', async () => {
        const runMigrations = vi.fn(async () => undefined)

        const result = await runStartupGate({
            initializeDatabase: async () => { throw new Error('IndexedDB unavailable') },
            runMigrations,
        })

        expect(result.mode).toBe('rescue')
        expect(result.databaseFault).toMatchObject({
            name: 'PersistenceFault',
            code: 'PERSISTENCE_DATABASE_UNAVAILABLE',
        })
        expect(runMigrations).not.toHaveBeenCalled()
    })

    it('keeps normal mode on legacy authority when migration fails against a healthy database', async () => {
        const result = await runStartupGate({
            initializeDatabase: async () => undefined,
            runMigrations: async () => { throw new Error('Synthetic migration failure') },
        })

        expect(result.mode).toBe('normal')
        expect(result.migrationError).toBeInstanceOf(Error)
        expect(result.databaseFault).toBeUndefined()
    })

    it('branches to the rescue renderer before the normal App module can mount', () => {
        const mainSource = readFileSync(new URL('../../src/main.tsx', import.meta.url), 'utf8')
        const rescueBranch = mainSource.indexOf("startup.mode === 'rescue'")
        const rescueRender = mainSource.indexOf('await renderRescueMode(', rescueBranch)
        const branchReturn = mainSource.indexOf('return', rescueRender)
        const normalRender = mainSource.indexOf('await renderApp()', rescueBranch)

        expect(rescueBranch).toBeGreaterThan(-1)
        expect(rescueRender).toBeGreaterThan(rescueBranch)
        expect(branchReturn).toBeGreaterThan(rescueRender)
        expect(normalRender).toBeGreaterThan(branchReturn)
    })
})
