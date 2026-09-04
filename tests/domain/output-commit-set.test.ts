import { describe, expect, it } from 'vitest'

import {
    createOutputCollisionKey,
    createOutputCommitSet,
    normalizeOutputRelativePath,
} from '@/domain/output-commit-set'

const FINGERPRINT = `sha256:${'a'.repeat(64)}` as const

describe('output commit set', () => {
    it('normalizes according to filesystem collision semantics', () => {
        expect(normalizeOutputRelativePath('Folder/Image.WEBP ', 'windows')).toBe('folder/image.webp')
        expect(normalizeOutputRelativePath('Folder/Image.WEBP', 'linux')).toBe('Folder/Image.WEBP')
        expect(normalizeOutputRelativePath('Cafe\u0301/Image.webp', 'macos')).toBe('cafe\u0301/image.webp')
        expect(() => normalizeOutputRelativePath('CON/image.webp', 'windows')).toThrow(/reserved/)
        expect(() => normalizeOutputRelativePath('../image.webp', 'android')).toThrow(/invalid/)
    })

    it('uses secret-free authority and revision inputs for stable collision keys', () => {
        const base = {
            directoryAuthorityId: 'folder:portraits',
            directoryAuthorityFingerprint: FINGERPRINT,
            filesystemSemantics: 'windows' as const,
            pathNormalizationRevision: 'path-v1',
            relativePath: 'Folder/Image.webp',
        }
        const first = createOutputCollisionKey(base)
        expect(createOutputCollisionKey({ ...base, relativePath: 'folder/IMAGE.webp. ' })).toBe(first)
        expect(createOutputCollisionKey({ ...base, pathNormalizationRevision: 'path-v2' })).not.toBe(first)
        expect(first).toMatch(/^collision:sha256:[a-f0-9]{64}$/)
        expect(first).not.toContain('Folder/Image.webp')
    })

    it('hashes the complete ordered claim set and policy revisions', () => {
        const input = {
            directoryAuthorityId: 'folder:portraits',
            directoryAuthorityFingerprint: FINGERPRINT,
            filesystemSemantics: 'linux' as const,
            filenamePolicyRevision: 'filename-v1',
            pathNormalizationRevision: 'path-v1',
            claims: [
                { claimId: 'image', kind: 'image' as const, relativePath: 'Image.webp' },
                { claimId: 'metadata', kind: 'metadata-sidecar' as const, relativePath: 'Image.webp.json' },
            ],
        }
        const first = createOutputCommitSet(input)
        expect(createOutputCommitSet(input).commitSetHash).toBe(first.commitSetHash)
        expect(createOutputCommitSet({
            ...input,
            claims: [...input.claims.slice(0, 1), { ...input.claims[1], relativePath: 'changed.json' }],
        }).commitSetHash).not.toBe(first.commitSetHash)
        expect(createOutputCommitSet({ ...input, filenamePolicyRevision: 'filename-v2' }).commitSetHash)
            .not.toBe(first.commitSetHash)
    })
})
