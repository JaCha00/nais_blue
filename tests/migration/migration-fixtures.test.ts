import { describe, expect, it } from 'vitest'

import { assertDeepEqual, loadFixtureJson } from '../helpers'

type MigrationRecord = Record<string, unknown> | string | null
type ReadSource = 'legacy' | 'v2' | null
type MigrationOutcome = 'fallback-read' | 'primary-read' | 'recoverable-error'

interface MigrationFixture {
    case: string
    description: string
    input: {
        legacyRecord: MigrationRecord
        v2Record: MigrationRecord
        writeState: 'complete' | 'idle' | 'interrupted' | 'partial'
    }
    expected: {
        readSource: ReadSource
        writeTarget: 'v2'
        legacyRetained: boolean
        outcome: MigrationOutcome
    }
}

const FIXTURE_CASES = [
    'old-only',
    'new-only',
    'both-present',
    'malformed-old',
    'partial-write',
    'interrupted-session',
] as const

function isRecord(value: MigrationRecord): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isValidLegacyRecord(value: MigrationRecord): boolean {
    return isRecord(value)
        && value.schemaVersion === 1
        && Number.isInteger(value.revision)
        && typeof value.profileName === 'string'
        && value.profileName.trim().length > 0
}

function isCommittedV2Record(value: MigrationRecord): boolean {
    return isRecord(value)
        && value.schemaVersion === 2
        && Number.isInteger(value.revision)
        && typeof value.profileName === 'string'
        && value.profileName.trim().length > 0
        && value.commitState === 'committed'
}

function evaluateDualReadSingleWrite(
    input: MigrationFixture['input'],
): MigrationFixture['expected'] {
    const legacyRetained = input.legacyRecord !== null
    if (isCommittedV2Record(input.v2Record)) {
        return {
            readSource: 'v2',
            writeTarget: 'v2',
            legacyRetained,
            outcome: 'primary-read',
        }
    }
    if (isValidLegacyRecord(input.legacyRecord)) {
        return {
            readSource: 'legacy',
            writeTarget: 'v2',
            legacyRetained: true,
            outcome: 'fallback-read',
        }
    }
    return {
        readSource: null,
        writeTarget: 'v2',
        legacyRetained,
        outcome: 'recoverable-error',
    }
}

describe('dual-read/single-write migration fixtures', () => {
    it.each(FIXTURE_CASES)('verifies the %s scenario contract', async (caseName) => {
        const fixture = await loadFixtureJson<MigrationFixture>(`legacy/${caseName}.json`)
        const inputBefore = structuredClone(fixture.input)

        expect(fixture.case).toBe(caseName)
        expect(fixture.description.trim().length).toBeGreaterThan(0)
        assertDeepEqual(
            evaluateDualReadSingleWrite(fixture.input),
            fixture.expected,
            `Migration fixture contract changed for ${caseName}`,
        )
        expect(fixture.expected.writeTarget).toBe('v2')
        expect(fixture.input).toEqual(inputBefore)
    })

    it('rejects incomplete v2 records as authoritative without deleting legacy data', async () => {
        for (const caseName of ['partial-write', 'interrupted-session'] as const) {
            const fixture = await loadFixtureJson<MigrationFixture>(`legacy/${caseName}.json`)
            const v2Record = fixture.input.v2Record

            expect(isCommittedV2Record(v2Record)).toBe(false)
            expect(fixture.expected.readSource).toBe('legacy')
            expect(fixture.expected.legacyRetained).toBe(true)
        }
    })

    it('reports malformed legacy data while retaining the original value for recovery', async () => {
        const fixture = await loadFixtureJson<MigrationFixture>('legacy/malformed-old.json')

        expect(isValidLegacyRecord(fixture.input.legacyRecord)).toBe(false)
        expect(fixture.input.legacyRecord).not.toBeNull()
        expect(fixture.expected).toEqual({
            readSource: null,
            writeTarget: 'v2',
            legacyRetained: true,
            outcome: 'recoverable-error',
        })
    })
})
