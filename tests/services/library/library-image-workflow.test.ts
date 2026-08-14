import { describe, expect, it } from 'vitest'

import {
    libraryOutputFileName,
    resolveLibraryTargetFormat,
} from '@/services/library/library-image-workflow'
import { parseExternalMetadataJson } from '@/lib/metadata-parser'

describe('Library image workflow policy', () => {
    it('keeps PNG and WebP formats while upgrading JPEG keep requests to PNG', () => {
        expect(resolveLibraryTargetFormat('png', 'keep')).toBe('png')
        expect(resolveLibraryTargetFormat('webp', 'keep')).toBe('webp')
        expect(resolveLibraryTargetFormat('jpeg', 'keep')).toBe('png')
        expect(resolveLibraryTargetFormat('png', 'webp')).toBe('webp')
        expect(resolveLibraryTargetFormat('webp', 'png')).toBe('png')
    })

    it('uses a visible clean suffix only when a same-format sanitized copy could be confused with its source', () => {
        expect(libraryOutputFileName('portrait.png', 'png', 'png', true)).toBe('portrait-clean.png')
        expect(libraryOutputFileName('portrait.png', 'png', 'webp', true)).toBe('portrait.webp')
        expect(libraryOutputFileName('C:\\images\\portrait.webp', 'webp', 'webp', false)).toBe('portrait.webp')
    })

    it('keeps the preservation sidecar readable by the normal metadata import path', () => {
        const parsed = parseExternalMetadataJson(JSON.stringify({
            format: 'nai-blue-library-image-release',
            version: 1,
            source: { metadata: { prompt: '1girl, portrait', uc: 'lowres', seed: 42 } },
        }))

        expect(parsed).toMatchObject({ prompt: '1girl, portrait', negativePrompt: 'lowres', seed: 42 })
    })
})
