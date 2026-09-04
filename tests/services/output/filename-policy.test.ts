import { describe, expect, it } from 'vitest'

import {
    ensureImageFileExtension,
    renderFilenameTemplate,
    resolveCollisionFileName,
    planExactOutputFileName,
    toDiagnosticSidecarPath,
    toSidecarFileName,
    withDuplicateSuffix,
} from '@/services/output/filename-policy'

describe('filename policy', () => {
    it('renders templates deterministically and sanitizes path separators', () => {
        const now = new Date(2026, 6, 13, 1, 2, 3, 4)

        expect(renderFilenameTemplate({
            template: '{recipe.label}_{seed}_{datetime:YYYYMMDD-HHmmss}',
            context: {
                recipe: { label: 'hero/portrait' },
                seed: 42,
            },
            now,
        })).toBe('hero_portrait_42_20260713-010203')
    })

    it('provides the legacy timestamp token without caller-specific context', () => {
        const now = new Date('2026-07-13T01:02:03.004Z')

        expect(renderFilenameTemplate({
            template: 'NAI_Blue_{timestamp}',
            now,
        })).toBe(`NAI_Blue_${now.getTime()}`)
    })

    it('owns extension replacement without creating stacked image extensions', () => {
        expect(ensureImageFileExtension('portrait.webp', 'png')).toBe('portrait.png')
        expect(ensureImageFileExtension('portrait.png', 'webp')).toBe('portrait.webp')
        expect(ensureImageFileExtension(' portrait ', '.webp')).toBe('portrait.webp')
        expect(ensureImageFileExtension(null, 'png')).toBeNull()
    })

    it('derives metadata sidecars from the final image name', () => {
        expect(toSidecarFileName('portrait.png')).toBe('portrait.nai-blue.json')
        expect(toDiagnosticSidecarPath('portrait.webp')).toBe('portrait.nai-blue.diagnostic.json')
    })

    it('allocates deterministic unique names and supports error collisions', async () => {
        const occupied = new Set(['portrait.png', 'portrait-2.png'])

        await expect(resolveCollisionFileName(
            'portrait.png',
            'unique',
            candidate => occupied.has(candidate),
        )).resolves.toBe('portrait-3.png')
        await expect(resolveCollisionFileName('portrait.png', 'error', () => true))
            .rejects.toThrow('Output already exists')
        expect(withDuplicateSuffix('portrait.png', 1)).toBe('portrait-2.png')
    })

    it('plans one exact reviewed filename for fail and deterministic suffix policies', async () => {
        const occupied = new Set(['portrait.png', 'portrait-2.png'])

        await expect(planExactOutputFileName({
            requestedFileName: 'portrait.webp',
            extension: 'png',
            collisionPolicy: 'suffix',
            exists: candidate => occupied.has(candidate),
        })).resolves.toBe('portrait-3.png')
        await expect(planExactOutputFileName({
            requestedFileName: 'portrait.png',
            extension: 'png',
            collisionPolicy: 'fail',
            exists: candidate => occupied.has(candidate),
        })).rejects.toThrow('Output already exists')
    })
})
