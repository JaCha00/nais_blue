import { homedir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { REDACTION_MARKERS, redactSnapshot, redactSnapshotJson } from './redaction'

describe('snapshot redaction', () => {
    it('removes all credential, session, base64, cache-key and path categories', () => {
        const fixtureOnlyValues = {
            novel: 'fixture-only-novel-value',
            remote: 'fixture-only-remote-value',
            generic: 'fixture-only-generic-token',
            cache: 'fixture-only-cache-value',
            access: 'fixture-only-access-value',
            refresh: 'fixture-only-refresh-value',
            r2Access: 'fixture-only-r2-access',
            r2Secret: 'fixture-only-r2-secret',
        }
        const source = {
            novelAiToken: fixtureOnlyValues.novel,
            remoteAnonKey: fixtureOnlyValues.remote,
            token: fixtureOnlyValues.generic,
            cacheKey: fixtureOnlyValues.cache,
            outputPath: join(homedir(), 'nais2-fixture-only', 'image.png'),
            imageBase64: `data:image/png;base64,${'QUJD'.repeat(50)}`,
            oauthSession: {
                access_token: fixtureOnlyValues.access,
                refresh_token: fixtureOnlyValues.refresh,
                user: { id: 'fixture-user' },
            },
            r2: {
                enabled: true,
                accessKeyId: fixtureOnlyValues.r2Access,
                secretAccessKey: fixtureOnlyValues.r2Secret,
                bucket: 'safe-bucket-name',
            },
            safe: 'preserved',
        }

        const result = redactSnapshot(source) as Record<string, unknown>
        const r2 = result.r2 as Record<string, unknown>

        expect(result).toMatchObject({
            novelAiToken: REDACTION_MARKERS.novelAiToken,
            remoteAnonKey: REDACTION_MARKERS.remoteCredential,
            token: REDACTION_MARKERS.novelAiToken,
            cacheKey: REDACTION_MARKERS.cacheKey,
            outputPath: REDACTION_MARKERS.path,
            imageBase64: REDACTION_MARKERS.base64,
            oauthSession: REDACTION_MARKERS.oauthSession,
            safe: 'preserved',
        })
        expect(r2).toEqual({
            enabled: true,
            accessKeyId: REDACTION_MARKERS.r2Credential,
            secretAccessKey: REDACTION_MARKERS.r2Credential,
            bucket: 'safe-bucket-name',
        })

        const serialized = JSON.stringify(result)
        for (const fixtureOnlyValue of Object.values(fixtureOnlyValues)) {
            expect(serialized).not.toContain(fixtureOnlyValue)
        }
    })

    it('recognizes OAuth-shaped session objects even under a generic session key', () => {
        const result = redactSnapshot({
            session: {
                access_token: 'fixture-only-access',
                refresh_token: 'fixture-only-refresh',
                expires_at: 123,
            },
            generationSessionId: 'safe-generation-session',
        })

        expect(result).toEqual({
            session: REDACTION_MARKERS.oauthSession,
            generationSessionId: 'safe-generation-session',
        })
    })

    it('redacts secrets, bearer tokens, callback tokens, data URIs and home paths embedded in strings', () => {
        const syntheticHome = join(homedir(), 'nais2-fixture-only')
        const result = redactSnapshot({
            env: 'NAI_TOKEN=fixture-only-nai',
            header: 'Bearer fixture-only-bearer-token',
            callback: 'custom-app://callback#access_token=fixture-only-access&refresh_token=fixture-only-refresh',
            preview: `prefix data:image/webp;base64,${'QUJD'.repeat(40)} suffix`,
            log: `saved below ${syntheticHome}`,
        }) as Record<string, string>

        expect(result.env).toContain(REDACTION_MARKERS.novelAiToken)
        expect(result.header).toBe(`Bearer ${REDACTION_MARKERS.token}`)
        expect(result.callback).not.toContain('fixture-only-access')
        expect(result.callback).not.toContain('fixture-only-refresh')
        expect(result.preview).toBe(`prefix ${REDACTION_MARKERS.base64} suffix`)
        expect(result.log).toContain(REDACTION_MARKERS.path)
        expect(JSON.stringify(result)).not.toContain(syntheticHome)
    })

    it('redacts serialized OAuth fields and private R2 signed-URL parameters in logs', () => {
        const result = redactSnapshot({
            oauthLog: '{"access_token":"fixture-only-access","refresh_token":"fixture-only-refresh"}',
            signedUrl: 'https://fixture.invalid/image?X-Amz-Credential=fixture-only-r2-access&X-Amz-Signature=fixture-only-r2-signature',
        }) as Record<string, string>

        expect(result.oauthLog).not.toContain('fixture-only-access')
        expect(result.oauthLog).not.toContain('fixture-only-refresh')
        expect(result.signedUrl).not.toContain('fixture-only-r2-access')
        expect(result.signedUrl).not.toContain('fixture-only-r2-signature')
        expect(result.signedUrl).toContain(REDACTION_MARKERS.r2Credential)
    })

    it('redacts flattened remote/R2 keys and serialized cache credentials', () => {
        const result = redactSnapshot({
            anonKey: 'fixture-only-anon-key',
            serviceRoleKey: 'fixture-only-service-role',
            accountId: 'fixture-only-r2-account',
            cachedReferences: [
                { cache_secret_key: 'fixture-only-nested-cache' },
            ],
            image_cache_secret_key: 'fixture-only-image-cache',
            serialized: '{"cache_secret_key":"fixture-only-cache","accessKeyId":"fixture-only-r2-access"}',
            query: 'https://fixture.invalid/image?image_cache_secret_key=fixture-only-cache-query',
        }) as Record<string, unknown>

        expect(result).toMatchObject({
            anonKey: REDACTION_MARKERS.remoteCredential,
            serviceRoleKey: REDACTION_MARKERS.remoteCredential,
            accountId: REDACTION_MARKERS.r2Credential,
            cachedReferences: [{ cache_secret_key: REDACTION_MARKERS.cacheKey }],
            image_cache_secret_key: REDACTION_MARKERS.cacheKey,
        })
        expect(result.serialized as string).not.toContain('fixture-only-cache')
        expect(result.serialized as string).not.toContain('fixture-only-r2-access')
        expect(result.query as string).not.toContain('fixture-only-cache-query')
        expect(result.serialized as string).toContain(REDACTION_MARKERS.cacheKey)
        expect(result.query as string).toContain(REDACTION_MARKERS.cacheKey)
    })

    it('redacts unlabelled long base64 and binary values while retaining ordinary short text', () => {
        const result = redactSnapshot({
            raw: 'QUJD'.repeat(40),
            short: 'QUJD',
            bytes: new Uint8Array([1, 2, 3]),
        })

        expect(result).toEqual({
            raw: REDACTION_MARKERS.base64,
            short: 'QUJD',
            bytes: REDACTION_MARKERS.binary,
        })
    })

    it('redacts complete line-wrapped data URIs and raw multiline base64', () => {
        const firstLine = 'QUJD'.repeat(24)
        const secondLine = 'REVG'.repeat(24)
        const wrapped = `${firstLine}\n  ${secondLine}`
        const result = redactSnapshot({
            dataUri: `data:image/png;base64,${wrapped}`,
            rawWrapped: wrapped,
        }, { rawBase64MinimumLength: 64 })

        expect(result).toEqual({
            dataUri: REDACTION_MARKERS.base64,
            rawWrapped: REDACTION_MARKERS.base64,
        })
        expect(JSON.stringify(result)).not.toContain(firstLine)
        expect(JSON.stringify(result)).not.toContain(secondLine)
    })

    it('preserves deep-diff JSONPath values while still redacting filesystem paths', () => {
        const absolutePath = join(homedir(), 'nais2-fixture-only', 'payload.json')
        const result = redactSnapshot({
            difference: { path: '$.parameters.image' },
            indexedDifference: { path: '$[0].value' },
            filesystem: { path: absolutePath },
        })

        expect(result).toEqual({
            difference: { path: '$.parameters.image' },
            indexedDifference: { path: '$[0].value' },
            filesystem: { path: REDACTION_MARKERS.path },
        })
    })

    it('does not mutate input and handles circular diagnostic values safely', () => {
        const source: Record<string, unknown> = {
            nested: { token: 'fixture-only-token' },
            capturedAt: new Date('2024-01-02T03:04:05.000Z'),
        }
        source.self = source

        const result = redactSnapshot(source) as Record<string, unknown>

        expect((source.nested as Record<string, unknown>).token).toBe('fixture-only-token')
        expect(result.self).toBe(REDACTION_MARKERS.circular)
        expect(result.capturedAt).toBe('2024-01-02T03:04:05.000Z')
    })

    it('combines redaction with deterministic stable JSON ordering', () => {
        expect(redactSnapshotJson(
            { z: 1, token: 'fixture-only-token', a: { z: 2, a: 3 } },
            {},
            { space: 0 },
        )).toBe(
            `{"a":{"a":3,"z":2},"token":"${REDACTION_MARKERS.novelAiToken}","z":1}`,
        )
    })
})
