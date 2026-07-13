import { describe, expect, it } from 'vitest'

import {
    inspectPortableFileResourceAvailability,
    projectPortablePathForExport,
    projectResourceRefForExport,
} from '@/domain/composition/portable-resources'
import { parseCompositionDocument, safeParseCompositionDocument } from '@/domain/composition/schema'
import type { PathResourceRef, PortablePathRef } from '@/domain/composition/types'
import { typeFixtureDocument, typeFixtureRevision } from '@/domain/composition/types.typecheck'

function cloneDocument() {
    return JSON.parse(JSON.stringify(typeFixtureDocument))
}

function desktopPathResource(path: PortablePathRef): PathResourceRef {
    return {
        ...typeFixtureRevision,
        id: 'resource:file:hero',
        orderKey: 'resource-file-hero',
        kind: 'path',
        enabled: true,
        role: 'character-reference',
        mimeType: 'image/png',
        contentHash: {
            algorithm: 'sha256',
            value: 'a'.repeat(64),
        },
        path,
    }
}

describe('portable composition resources', () => {
    it('separates roots, relative segments, logical selection ids, and display hints', () => {
        const pictures: PortablePathRef = {
            kind: 'standard',
            root: 'pictures',
            segments: ['NAIS', 'references', 'hero.png'],
            displayPath: 'C:\\Users\\desktop\\Pictures\\NAIS\\references\\hero.png',
        }
        const appData: PortablePathRef = {
            kind: 'standard',
            root: 'app-data',
            segments: ['library', 'hero.png'],
            displayPath: '/data/user/0/example/files/library/hero.png',
        }
        const selected: PortablePathRef = {
            kind: 'bookmark',
            bookmarkId: 'user-selection:hero-image',
            segments: ['hero.png'],
            displayPath: 'content://desktop-only/hero.png',
        }

        expect(projectPortablePathForExport(pictures)).toEqual({
            kind: 'standard',
            root: 'pictures',
            segments: ['NAIS', 'references', 'hero.png'],
        })
        expect(projectPortablePathForExport(appData)).toEqual({
            kind: 'standard',
            root: 'app-data',
            segments: ['library', 'hero.png'],
        })
        expect(projectPortablePathForExport(selected)).toEqual({
            kind: 'bookmark',
            bookmarkId: 'user-selection:hero-image',
            segments: ['hero.png'],
        })
    })

    it('never exports display paths or accidental opaque token material', () => {
        const runtimePath = {
            kind: 'bookmark',
            bookmarkId: 'user-selection:hero-image',
            segments: [],
            displayPath: 'C:\\secret\\hero.png',
            platformOpaqueToken: 'desktop-bookmark-secret',
            androidContentUri: 'content://opaque/grant',
        } as PortablePathRef

        const exported = projectPortablePathForExport(runtimePath)
        expect(exported).toEqual({
            kind: 'bookmark',
            bookmarkId: 'user-selection:hero-image',
            segments: [],
        })
        expect(JSON.stringify(exported)).not.toContain('secret')
        expect(JSON.stringify(exported)).not.toContain('content://')
    })

    it('keeps a desktop-authored recipe readable on Android but marks its grant repairable', () => {
        const document = cloneDocument()
        const resource = desktopPathResource({
            kind: 'bookmark',
            bookmarkId: 'user-selection:desktop-hero',
            segments: ['hero.png'],
            displayPath: 'D:\\Library\\hero.png',
        })
        document.resources = [resource]

        const parsed = parseCompositionDocument(document)
        expect(parsed.recipes[0].id).toBe(typeFixtureDocument.recipes[0].id)
        expect(inspectPortableFileResourceAvailability(resource, {
            platform: 'android',
            supportedRoots: ['app-data', 'pictures', 'downloads', 'media', 'cache'],
            availableUserSelectionIds: [],
        })).toEqual({
            status: 'unresolved',
            platform: 'android',
            reason: 'user-selection-unavailable',
            repairAction: 'reselect-user-resource',
            logicalTokenId: 'user-selection:desktop-hero',
        })
    })

    it('stores stable library identity and structured hash without materialized bytes', () => {
        const document = cloneDocument()
        document.resources = [{
            ...typeFixtureRevision,
            id: 'resource:library-hero',
            orderKey: 'resource-library-hero',
            kind: 'library-image',
            enabled: true,
            role: 'source-image',
            mimeType: 'image/png',
            libraryImageId: 'library-image:hero-v2',
            contentHash: {
                algorithm: 'sha256',
                value: 'b'.repeat(64),
            },
        }]

        const parsed = parseCompositionDocument(document)
        expect(parsed.resources[0]).toMatchObject({
            kind: 'library-image',
            libraryImageId: 'library-image:hero-v2',
            contentHash: { algorithm: 'sha256', value: 'b'.repeat(64) },
        })
        expect(parsed.resources[0]).not.toHaveProperty('bytes')

        const runtimeResource = {
            ...parsed.resources[0],
            bytes: new Uint8Array([1, 2, 3]),
            materializedPath: 'C:\\private\\hero.png',
        }
        const exported = projectResourceRefForExport(runtimeResource)
        expect(exported).not.toHaveProperty('bytes')
        expect(exported).not.toHaveProperty('materializedPath')

        document.resources[0].bytes = 'base64-materialization-is-not-a-reference'
        expect(safeParseCompositionDocument(document).success).toBe(false)
    })

    it('rejects absolute-only and opaque-token path variants and invalid structured hashes', () => {
        const absoluteOnly = cloneDocument()
        absoluteOnly.resources = [{
            ...desktopPathResource({ kind: 'standard', root: 'pictures', segments: [] }),
            path: { kind: 'absolute', absolutePath: 'C:\\unsafe\\hero.png' },
        }]
        expect(safeParseCompositionDocument(absoluteOnly).success).toBe(false)

        const platformToken = cloneDocument()
        platformToken.resources = [{
            ...desktopPathResource({ kind: 'bookmark', bookmarkId: 'selection:hero', segments: [] }),
            path: {
                kind: 'bookmark',
                bookmarkId: 'selection:hero',
                segments: [],
                platformOpaqueToken: 'must-not-enter-document',
            },
        }]
        expect(safeParseCompositionDocument(platformToken).success).toBe(false)

        const invalidHash = cloneDocument()
        invalidHash.resources = [{
            ...desktopPathResource({ kind: 'standard', root: 'app-data', segments: ['hero.png'] }),
            contentHash: { algorithm: 'sha256', value: 'ABC123' },
        }]
        expect(safeParseCompositionDocument(invalidHash).success).toBe(false)
    })
})
