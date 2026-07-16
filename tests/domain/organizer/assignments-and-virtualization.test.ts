import { describe, expect, it } from 'vitest'

import {
    assignArtifactToNextEmptySlot,
    assignArtifactToSlot,
    clearOrganizerAssignment,
} from '@/domain/organizer/assignments'
import { calculateFixedGridVirtualRange } from '@/lib/virtualization/fixed-range'

const EMPTY_SLOTS = [
    { slotId: 'slot-1', artifactId: null },
    { slotId: 'slot-2', artifactId: null },
    { slotId: 'slot-3', artifactId: null },
] as const

describe('Organizer keyboard, touch, and drag assignment contracts', () => {
    it('uses Enter semantics to fill the next empty slot without replacing an assignment', () => {
        const first = assignArtifactToNextEmptySlot(EMPTY_SLOTS, 'artifact-a')
        expect(first).toMatchObject({ ok: true, assignedSlotId: 'slot-1' })
        if (!first.ok) throw new Error('expected an assignment')

        const second = assignArtifactToNextEmptySlot(first.slots, 'artifact-b')
        expect(second).toMatchObject({ ok: true, assignedSlotId: 'slot-2' })
        expect(second.slots).toEqual([
            { slotId: 'slot-1', artifactId: 'artifact-a' },
            { slotId: 'slot-2', artifactId: 'artifact-b' },
            { slotId: 'slot-3', artifactId: null },
        ])
    })

    it('supports a specific drag/touch slot while blocking a duplicate artifact', () => {
        const drag = assignArtifactToSlot(EMPTY_SLOTS, 'artifact-a', 'slot-3')
        expect(drag).toMatchObject({ ok: true, assignedSlotId: 'slot-3' })
        if (!drag.ok) throw new Error('expected a drag assignment')

        const duplicate = assignArtifactToSlot(drag.slots, 'artifact-a', 'slot-1')
        expect(duplicate).toMatchObject({ ok: false, reason: 'duplicate-assignment' })
        expect(duplicate.slots).toEqual(drag.slots)

        expect(clearOrganizerAssignment(drag.slots, 'slot-3')).toEqual(EMPTY_SLOTS)
    })

    it('reports a full slot set rather than silently replacing an existing assignment', () => {
        const full = EMPTY_SLOTS.map((slot, index) => ({ ...slot, artifactId: `artifact-${index}` }))
        expect(assignArtifactToNextEmptySlot(full, 'artifact-new')).toMatchObject({
            ok: false,
            reason: 'no-empty-slot',
        })
    })
})

describe('Organizer fixed-grid virtualization', () => {
    it('bounds DOM work for a 10,000-image collection while retaining correct row positions', () => {
        const range = calculateFixedGridVirtualRange({
            itemCount: 10_000,
            scrollTop: 19_800,
            viewportHeight: 620,
            viewportWidth: 984,
            itemWidth: 164,
            itemHeight: 206,
            overscanRows: 2,
        })

        expect(range.columnCount).toBe(6)
        expect(range.start).toBeGreaterThan(0)
        expect(range.end).toBeLessThan(10_000)
        expect(range.end - range.start).toBeLessThanOrEqual(60)
        expect(range.rowStart).toBeLessThan(range.rowEnd)
    })

    it('handles narrow viewports and empty collections without invalid indices', () => {
        expect(calculateFixedGridVirtualRange({
            itemCount: 0,
            scrollTop: 0,
            viewportHeight: 200,
            viewportWidth: 0,
            itemWidth: 0,
            itemHeight: 0,
        })).toEqual({ start: 0, end: 0, columnCount: 1, rowStart: 0, rowEnd: 0 })
    })
})
