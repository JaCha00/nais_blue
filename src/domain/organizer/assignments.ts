export interface OrganizerAssignmentSlot {
    readonly slotId: string
    readonly artifactId: string | null
}

export type OrganizerAssignmentFailure = 'duplicate-assignment' | 'slot-not-found' | 'no-empty-slot'

export type OrganizerAssignmentResult =
    | { ok: true; slots: readonly OrganizerAssignmentSlot[]; assignedSlotId: string }
    | { ok: false; slots: readonly OrganizerAssignmentSlot[]; reason: OrganizerAssignmentFailure }

function cloneSlots(slots: readonly OrganizerAssignmentSlot[]): OrganizerAssignmentSlot[] {
    return slots.map(slot => ({ ...slot }))
}

/** Enter semantics: select the first available slot without replacing work. */
export function assignArtifactToNextEmptySlot(
    slots: readonly OrganizerAssignmentSlot[],
    artifactId: string,
): OrganizerAssignmentResult {
    const next = slots.find(slot => slot.artifactId === null)
    if (next === undefined) return { ok: false, slots: cloneSlots(slots), reason: 'no-empty-slot' }
    return assignArtifactToSlot(slots, artifactId, next.slotId)
}

/** Drag/touch semantics: only the requested slot changes, and no duplicate source can enter a second slot. */
export function assignArtifactToSlot(
    slots: readonly OrganizerAssignmentSlot[],
    artifactId: string,
    slotId: string,
): OrganizerAssignmentResult {
    const targetIndex = slots.findIndex(slot => slot.slotId === slotId)
    if (targetIndex < 0) return { ok: false, slots: cloneSlots(slots), reason: 'slot-not-found' }
    const existing = slots.find(slot => slot.artifactId === artifactId)
    if (existing !== undefined && existing.slotId !== slotId) {
        return { ok: false, slots: cloneSlots(slots), reason: 'duplicate-assignment' }
    }
    const next = cloneSlots(slots)
    next[targetIndex] = { ...next[targetIndex], artifactId }
    return { ok: true, slots: next, assignedSlotId: slotId }
}

export function clearOrganizerAssignment(
    slots: readonly OrganizerAssignmentSlot[],
    slotId: string,
): readonly OrganizerAssignmentSlot[] {
    return slots.map(slot => slot.slotId === slotId ? { ...slot, artifactId: null } : { ...slot })
}
