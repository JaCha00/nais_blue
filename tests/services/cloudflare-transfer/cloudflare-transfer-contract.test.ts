import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
    MAX_JSON_BYTES,
    PART_BYTES,
    canonicalRequest,
    parseSignedMetadata,
    validateStartTransfer,
} from '../../../cloudflare/nais-transfer-worker/src/protocol'

const ROOT = process.cwd()
const source = (path: string): Promise<string> => readFile(resolve(ROOT, path), 'utf8')

describe('Cloudflare transfer protocol', () => {
    it('canonicalizes bounded signed requests without credential or payload material', () => {
        const headers = new Headers({
            'x-nais-device': 'device-qa-0001',
            'x-nais-sequence': '7',
            'x-nais-nonce': 'abcdefghijklmnopqrstuv',
            'x-nais-timestamp': '1784090000000',
            'x-nais-idempotency': 'op:abc123',
            'x-nais-content-sha256': `sha256:${'a'.repeat(64)}`,
            'x-nais-signature': 'A'.repeat(86),
        })
        const metadata = parseSignedMetadata(headers)
        expect(canonicalRequest('post', '/v1/transfers/job-1/start', metadata)).toBe([
            'POST',
            '/v1/transfers/job-1/start',
            '7',
            'abcdefghijklmnopqrstuv',
            '1784090000000',
            'op:abc123',
            `sha256:${'a'.repeat(64)}`,
        ].join('\n'))
        expect(MAX_JSON_BYTES).toBe(2 * 1024 * 1024)
        expect(PART_BYTES).toBe(5 * 1024 * 1024)
    })

    it('accepts sanitized R2 metadata and rejects JSON byte/path/prompt fallbacks', () => {
        expect(validateStartTransfer({
            transferId: 'transfer:qa-1',
            kind: 'r2-upload',
            contentSha256: `sha256:${'b'.repeat(64)}`,
            sizeBytes: 1024,
        }).transferId).toBe('transfer:qa-1')

        for (const forbidden of [
            { prompt: 'not allowed' },
            { imageBytes: [1, 2, 3] },
            { localPath: 'private/file.png' },
            { signedUrl: 'https://example.invalid/object' },
        ]) {
            expect(() => validateStartTransfer({
                transferId: 'transfer:qa-1',
                kind: 'r2-upload',
                contentSha256: `sha256:${'b'.repeat(64)}`,
                sizeBytes: 1024,
                ...forbidden,
            })).toThrow()
        }
    })

    it('keeps replay, idempotency, tombstone, and no-late-commit state in Durable Object storage', async () => {
        const [worker, wrangler, rotation, executor, credentialStore] = await Promise.all([
            source('cloudflare/nais-transfer-worker/src/index.ts'),
            source('wrangler.toml'),
            source('scripts/rotate-cloudflare-pairing-and-qa.mjs'),
            source('src-tauri/plugins/nais-android-transfer/android/src/main/java/com/bluhair/naisblue/transfer/CloudflareTransferExecutor.kt'),
            source('src-tauri/plugins/nais-android-transfer/android/src/main/java/com/bluhair/naisblue/transfer/CloudflareCredentialStore.kt'),
        ])

        for (const evidence of [
            'highWaterSequence',
            'recentNonces',
            'operation:${metadata.idempotencyKey}',
            'E_TRANSFER_DUPLICATE_CONFLICT',
            'tombstonedAtMs',
            "state: 'committing'",
            'await this.env.PRIME.delete(job.objectKey)',
            "url.pathname === '/v1/revoke'",
        ]) expect(worker).toContain(evidence)
        expect(wrangler).toContain('new_sqlite_classes = ["TransferStateObject"]')
        expect(wrangler).toContain('bucket_name = "prime"')
        expect(wrangler).toContain('R2_PREFIX = "nais"')
        expect(wrangler).toContain('binding = "CF_VERSION_METADATA"')
        expect(worker).toContain("url.pathname === '/v1/ready'")
        expect(worker).toContain('env.CF_VERSION_METADATA.id')
        expect(rotation).toContain("[wranglerCli, 'secret', 'bulk']")
        expect(rotation).toContain('await waitForEdgeVersion(secretVersionId)')
        expect(executor).toContain('reportCheckpoint(checkpoint)')
        expect(credentialStore).toContain('AndroidKeyStore')
        expect(credentialStore).toContain('FIELD_SEQUENCE')
        expect(credentialStore).not.toMatch(/pairingCapability.*putString|token|authorization|signedUrl/i)
    })
})
