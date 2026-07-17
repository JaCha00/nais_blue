import { describe, expect, it, vi } from 'vitest'

import {
    createDiagnosticEvent,
    diagnoseError,
    type DiagnosticCategory,
} from '@/services/diagnostics/error-registry'
import {
    copyDiagnosticEvent,
    createDiagnosticsExportJson,
} from '@/services/diagnostics/exporter'
import { OperationMonitor } from '@/services/diagnostics/operation-monitor'
import {
    redactDiagnosticText,
    redactDiagnosticValue,
} from '@/services/diagnostics/redactor'
import { NovelAIHttpError } from '@/services/novelai-types'
import { OutputWriterError } from '@/services/output/output-writer'

const TOKEN_CANARY = 'fixture-only-nai-token-do-not-log'
const R2_CANARY = 'fixture-only-r2-signature-do-not-log'
const PROMPT_CANARY = 'fixture-only prompt body that must never appear in diagnostics'
const SIGNED_URL_CANARY = `https://bucket.example.test/image.png?X-Amz-Credential=${R2_CANARY}&X-Amz-Signature=${R2_CANARY}`
const HOME_PATH_CANARY = 'C:\\Users\\fixture-user\\AppData\\Roaming\\NAIS blue\\output.png'

function error(message: string, name = 'Error'): Error {
    const value = new Error(message)
    value.name = name
    return value
}

describe('diagnostic error registry', () => {
    it.each<[DiagnosticCategory, Error, Parameters<typeof diagnoseError>[1]]>([
        ['auth', new NovelAIHttpError(401, `Authorization: Bearer ${TOKEN_CANARY}`), { operation: 'nai.generate' }],
        ['network', error('getaddrinfo ENOTFOUND image.novelai.net'), { operation: 'nai.generate' }],
        ['rate_limit', new NovelAIHttpError(429, 'retry later'), { operation: 'nai.generate' }],
        ['novelai_api', new NovelAIHttpError(500, 'provider failure'), { operation: 'nai.generate' }],
        ['response_decode', error('Invalid ZIP archive'), { operation: 'nai.generate' }],
        ['image_processing', error('Canvas decode failed'), { operation: 'image.thumbnail' }],
        ['local_io', error('ENOSPC: disk full'), { operation: 'output.write' }],
        ['persistence', error('IndexedDB transaction aborted'), { operation: 'startup.migration' }],
        ['r2_auth', error('HTTP 403 credential rejected'), { operation: 'r2.deploy' }],
        ['r2_upload', error('upload connection reset'), { operation: 'r2.deploy' }],
        ['r2_conflict', error('HTTP 409 object conflict'), { operation: 'r2.deploy' }],
        ['sync', error('profile disk sync failed'), { operation: 'asset.sync' }],
        ['cancelled', error('request aborted', 'AbortError'), { operation: 'nai.generate' }],
        ['timeout', error('operation deadline exceeded'), { operation: 'nai.generate' }],
        ['stalled', error('no progress heartbeat'), { operation: 'nai.generate' }],
        ['unknown', error('unclassified failure'), { operation: 'other' }],
    ])('maps %s without exposing the source error', (category, source, context) => {
        const event = diagnoseError(source, context)

        expect(event.category).toBe(category)
        expect(event.userSummary).not.toContain(TOKEN_CANARY)
        expect(JSON.stringify(event)).not.toContain(TOKEN_CANARY)
    })

    it('maps OutputWriter phases without changing its transaction contract', () => {
        const event = diagnoseError(
            new OutputWriterError('write-image-temp', `write failed: ${HOME_PATH_CANARY}`),
            { operation: 'output.write' },
        )

        expect(event.category).toBe('local_io')
        expect(event.redactedDeveloperMessage).not.toContain(HOME_PATH_CANARY)
    })

    it('keeps the raw provider body out of the legacy error message contract', () => {
        const providerBody = `Authorization: Bearer ${TOKEN_CANARY}`
        const source = new NovelAIHttpError(500, providerBody)

        expect(source.message).not.toContain(providerBody)
        expect(diagnoseError(source, { operation: 'nai.generate' }).redactedDeveloperMessage).not.toContain(TOKEN_CANARY)
    })
})

describe('diagnostic redaction', () => {
    it('removes credential, cookie, signed URL, home path, prompt, and image canaries', () => {
        const redacted = redactDiagnosticValue({
            Authorization: `Bearer ${TOKEN_CANARY}`,
            Cookie: `session=${TOKEN_CANARY}`,
            signedUrl: SIGNED_URL_CANARY,
            path: HOME_PATH_CANARY,
            prompt: PROMPT_CANARY,
            imageData: `data:image/png;base64,${'A'.repeat(256)}`,
        })
        const serialized = JSON.stringify(redacted)

        for (const canary of [TOKEN_CANARY, R2_CANARY, PROMPT_CANARY, HOME_PATH_CANARY]) {
            expect(serialized).not.toContain(canary)
        }
        expect(serialized).toContain('sha256:')
        expect(serialized).toContain('[REDACTED:IMAGE]')
    })

    it('redacts the same text form used by stacks, causes, and clipboard output', () => {
        const source = `Authorization: Bearer ${TOKEN_CANARY}; ${SIGNED_URL_CANARY}; ${HOME_PATH_CANARY}; prompt=${PROMPT_CANARY}`
        const redacted = redactDiagnosticText(source)

        for (const canary of [TOKEN_CANARY, R2_CANARY, PROMPT_CANARY, HOME_PATH_CANARY]) {
            expect(redacted).not.toContain(canary)
        }
    })
})

describe('operation monitoring', () => {
    it('distinguishes slow, stalled, streaming heartbeat, and hard timeout states', () => {
        let now = 0
        const monitor = new OperationMonitor({
            now: () => now,
            slowThresholdMs: 100,
            stalledThresholdMs: 300,
            hardTimeoutMs: 800,
        })
        const operation = monitor.start({ operation: 'nai.generate', stage: 'request' })

        now = 101
        expect(operation.check().slow).toBe(true)
        expect(operation.check().stalled).toBe(false)

        operation.heartbeat('streaming-progress')
        now = 350
        expect(operation.check().stalled).toBe(false)

        now = 651
        expect(operation.check().stalled).toBe(true)

        operation.heartbeat('streaming-progress')
        now = 801
        expect(operation.check().timeout).toBe(true)
    })

    it('reports the active stage when slow, stalled, and timeout transitions are emitted', () => {
        let now = 0
        const observations: ReturnType<typeof createDiagnosticEvent>[] = []
        const monitor = new OperationMonitor({
            now: () => now,
            slowThresholdMs: 100,
            stalledThresholdMs: 300,
            hardTimeoutMs: 800,
            onObservation: event => observations.push(event),
        })
        const operation = monitor.start({ operation: 'nai.generate', stage: 'prepare' })

        now = 10
        operation.stageStart('request')
        now = 101
        operation.check()

        now = 200
        operation.stageStart('stream')
        now = 500
        operation.check()

        now = 700
        operation.stageStart('decode')
        now = 801
        operation.check()

        expect(observations.map(event => [event.code, event.stage])).toEqual([
            ['OPERATION_SLOW', 'request'],
            ['OPERATION_STALLED', 'stream'],
            ['OPERATION_TIMEOUT', 'decode'],
        ])
    })
})

describe('diagnostic export and clipboard', () => {
    it('applies redaction again when copying and exporting', async () => {
        const event = createDiagnosticEvent({
            category: 'novelai_api',
            code: 'NOVELAI_API_FAILURE',
            severity: 'error',
            operation: 'nai.generate',
            stage: 'request',
            userSummary: '생성 요청을 완료하지 못했습니다.',
            developerMessage: `Authorization: Bearer ${TOKEN_CANARY}; ${SIGNED_URL_CANARY}`,
            prompt: PROMPT_CANARY,
        })
        const clipboard = { writeText: vi.fn(async () => undefined) }

        const copied = await copyDiagnosticEvent(event, 'full', clipboard)
        const exported = createDiagnosticsExportJson([event])

        expect(copied).toContain('NOVELAI_API_FAILURE')
        expect(clipboard.writeText).toHaveBeenCalledWith(copied)
        for (const canary of [TOKEN_CANARY, R2_CANARY, PROMPT_CANARY]) {
            expect(copied).not.toContain(canary)
            expect(exported).not.toContain(canary)
        }
    })
})
