import { create } from 'zustand'
import type { DiagnosticEvent } from '@/domain/diagnostics/types'

const EVENT_LIMIT = 100

interface DiagnosticsStore {
    events: DiagnosticEvent[]
    selectedEventId: string | null
    drawerOpen: boolean
    record: (event: DiagnosticEvent) => void
    openDrawer: (eventId?: string) => void
    closeDrawer: () => void
    selectEvent: (eventId: string | null) => void
    clear: () => void
}

/** In-memory only: diagnostics must never enter a Zustand persistence projection. */
export const useDiagnosticsStore = create<DiagnosticsStore>((set) => ({
    events: [],
    selectedEventId: null,
    drawerOpen: false,
    record: (event) => set(state => ({
        events: [event, ...state.events.filter(existing => existing.eventId !== event.eventId)].slice(0, EVENT_LIMIT),
        selectedEventId: state.selectedEventId ?? event.eventId,
    })),
    openDrawer: (eventId) => set(state => ({
        drawerOpen: true,
        selectedEventId: eventId ?? state.selectedEventId ?? state.events[0]?.eventId ?? null,
    })),
    closeDrawer: () => set({ drawerOpen: false }),
    selectEvent: (eventId) => set({ selectedEventId: eventId }),
    clear: () => set({ events: [], selectedEventId: null }),
}))
