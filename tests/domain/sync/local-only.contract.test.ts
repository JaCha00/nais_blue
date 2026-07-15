import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SOURCE_FILES = [
    'src/domain/sync/types.ts',
    'src/domain/sync/envelope.ts',
    'src/domain/sync/payload-safety.ts',
    'src/domain/sync/index.ts',
    'src/services/sync/sanitizer.ts',
    'src/services/sync/conflict-resolver.ts',
    'src/services/sync/outbox-repository.ts',
]

function source(file: string): string {
    return readFileSync(path.resolve(process.cwd(), file), 'utf8')
}

describe('Phase 11 local-only boundary', () => {
    it('contains no network transport or user-facing sync toggle', () => {
        const combined = SOURCE_FILES.map(source).join('\n')
        expect(combined).not.toMatch(/\bfetch\s*\(/)
        expect(combined).not.toMatch(/\bWebSocket\b|\bEventSource\b|plugin-http|networkSync|syncEnabled/)
        expect(combined).not.toMatch(/localeCompare/)
    })

    it('does not import or replace generation, payload, OutputWriter, queue-worker, or migration authority', () => {
        const combined = SOURCE_FILES.map(source).join('\n')
        expect(combined).not.toMatch(/services\/nai\/payload|OutputWriter|scene-generation|durable-queue-coordinator/)
        expect(combined).not.toMatch(/domain\/composition\/(?:engine|repository|migrations)/)
    })
})
