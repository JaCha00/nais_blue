/**
 * Queue execution depends on opaque credential slots, while coordinators only
 * need a stable slot identity and the execution-time secret. Composition roots
 * implement this port so application/runtime code never imports a UI store.
 */
export interface QueueTokenSlot {
    readonly slotId: string
    readonly token: string
}

export interface QueueTokenProvider {
    getActiveTokenSlots(): readonly QueueTokenSlot[]
}
