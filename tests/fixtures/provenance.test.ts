import { readdir } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
    DEFAULT_FIXTURE_ROOT,
    assertDeepEqual,
    loadFixtureJson,
    loadFixtureText,
    redactSnapshot,
} from '../helpers'

interface FixtureProvenanceEntry {
    path: string
    source: string
    model: string
    captureDate: string
    captureKind: 'local-characterization' | 'synthetic-derived'
    transformed: boolean
    sensitiveDataRemoved: boolean
    transformations?: string[]
}

interface FixtureProvenanceManifest {
    schemaVersion: number
    fixtures: FixtureProvenanceEntry[]
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const FORBIDDEN_RAW_PATTERNS = [
    /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/_=-]{24,}/i,
    /\bBearer\s+(?!\[REDACTED:)[a-z0-9._~+\/-]{12,}/i,
    /\beyJ[a-z0-9_-]{12,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/i,
    /\b(?:NAI_TOKEN|NOVELAI_TOKEN|(?:VITE_)?[A-Z][A-Z0-9_]*(?:ANON_KEY|SERVICE_ROLE_KEY)|R2_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|API_TOKEN))\b\s*[:=]\s*(?!\[REDACTED:)[^\s,;&]+/i,
    /\b[a-z]:[\\/](?:users|documents and settings)[\\/][^\\/\s"'<>]+/i,
    /\/(?:home|users)\/[^/\s"'<>]+/i,
] as const

function fixtureRelativePath(absolutePath: string): string {
    return relative(DEFAULT_FIXTURE_ROOT, absolutePath).replace(/\\/g, '/')
}

async function listJsonFiles(directory = DEFAULT_FIXTURE_ROOT): Promise<string[]> {
    const files: string[] = []
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const entryPath = resolve(directory, entry.name)
        if (entry.isDirectory()) {
            files.push(...await listJsonFiles(entryPath))
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
            files.push(fixtureRelativePath(entryPath))
        }
    }
    return files.sort()
}

describe('fixture provenance', () => {
    it('enumerates every JSON fixture with complete provenance metadata', async () => {
        const manifest = await loadFixtureJson<FixtureProvenanceManifest>('provenance.json')
        const readme = await loadFixtureText('README.md')
        const jsonFiles = (await listJsonFiles()).filter((path) => path !== 'provenance.json')
        const manifestPaths = manifest.fixtures.map((entry) => entry.path).sort()

        expect(manifest.schemaVersion).toBe(1)
        expect(manifest.fixtures.length).toBeGreaterThan(0)
        expect(new Set(manifestPaths).size).toBe(manifestPaths.length)
        expect(manifestPaths).not.toContain('provenance.json')
        assertDeepEqual(manifestPaths, jsonFiles, 'Fixture provenance manifest is out of sync')

        for (const entry of manifest.fixtures) {
            expect(entry.path).not.toMatch(/^(?:[a-z]:[\\/]|[\\/]|\.\.)/i)
            expect(entry.path).not.toContain('\\')
            expect(entry.source.trim().length).toBeGreaterThan(0)
            expect(entry.model.trim().length).toBeGreaterThan(0)
            expect(entry.captureDate).toMatch(DATE_PATTERN)
            expect([
                'local-characterization',
                'synthetic-derived',
            ]).toContain(entry.captureKind)
            expect(typeof entry.transformed).toBe('boolean')
            expect(entry.sensitiveDataRemoved).toBe(true)
            expect(readme).toContain(entry.path)
            for (const transformation of entry.transformations ?? []) {
                expect(transformation.trim().length).toBeGreaterThan(0)
            }
        }
    })

    it('contains no unredacted credential, session, home-path, cache-key or image data', async () => {
        const jsonFiles = (await listJsonFiles()).filter((path) => path !== 'provenance.json')

        for (const fixturePath of jsonFiles) {
            const raw = await loadFixtureText(fixturePath)
            const fixture = await loadFixtureJson(fixturePath)
            const redacted = redactSnapshot(fixture, { rawBase64MinimumLength: 64 })

            assertDeepEqual(
                redacted,
                fixture,
                `${fixturePath} contains data that must be redacted before check-in`,
            )
            for (const forbiddenPattern of FORBIDDEN_RAW_PATTERNS) {
                expect(raw, `${fixturePath} matched ${forbiddenPattern}`).not.toMatch(forbiddenPattern)
            }
        }
    })
})
