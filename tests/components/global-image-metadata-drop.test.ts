import { describe, expect, it } from 'vitest'

import {
    isGlobalMetadataImageCandidate,
    isLocalFileDropTarget,
    resolveGlobalImageDropTarget,
} from '@/components/metadata/GlobalImageMetadataDrop'

describe('Global image metadata drop routing', () => {
    it('returns to the prompt step of the active Guided draft', () => {
        expect(resolveGlobalImageDropTarget('/guided-preview/work/single-1/rights')).toEqual({
            kind: 'single',
            draftId: 'single-1',
        })
        expect(resolveGlobalImageDropTarget('/guided-preview/batch/batch-1/output')).toEqual({
            kind: 'batch',
            draftId: 'batch-1',
        })
        expect(resolveGlobalImageDropTarget('/settings')).toEqual({ kind: 'advanced' })
    })

    it('accepts bounded image files without depending on a reliable MIME type', () => {
        expect(isGlobalMetadataImageCandidate({ name: 'image.webp', type: '', size: 1024 })).toBe(true)
        expect(isGlobalMetadataImageCandidate({ name: 'image.gif', type: 'image/gif', size: 1024 })).toBe(false)
        expect(isGlobalMetadataImageCandidate({ name: 'image.txt', type: 'text/plain', size: 1024 })).toBe(false)
        expect(isGlobalMetadataImageCandidate({ name: 'empty.png', type: 'image/png', size: 0 })).toBe(false)
        expect(isGlobalMetadataImageCandidate({ name: 'huge.png', type: 'image/png', size: 51 * 1024 * 1024 })).toBe(false)
    })

    it('yields nested targets to an explicit local file drop zone', () => {
        const localTarget = {
            closest: (selector: string) => selector === '[data-local-file-drop]' ? {} : null,
        } as unknown as EventTarget
        const ordinaryTarget = { closest: () => null } as unknown as EventTarget

        expect(isLocalFileDropTarget(localTarget)).toBe(true)
        expect(isLocalFileDropTarget(ordinaryTarget)).toBe(false)
        expect(isLocalFileDropTarget(null)).toBe(false)
    })
})
