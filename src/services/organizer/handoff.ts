const ORGANIZER_HANDOFF_KEY = 'nais2:organizer-handoff'

export interface OrganizerHandoff {
    path: string
    fileName: string
}

/**
 * History writes only a short-lived navigation hint. Organizer consumes it and
 * registers the containing folder through its platform adapter, keeping absolute
 * paths out of persisted artifact authority data.
 */
export function queueOrganizerHandoff(handoff: OrganizerHandoff): void {
    sessionStorage.setItem(ORGANIZER_HANDOFF_KEY, JSON.stringify(handoff))
}

export function consumeOrganizerHandoff(): OrganizerHandoff | null {
    const value = sessionStorage.getItem(ORGANIZER_HANDOFF_KEY)
    sessionStorage.removeItem(ORGANIZER_HANDOFF_KEY)
    if (value === null) return null
    try {
        const parsed = JSON.parse(value) as Partial<OrganizerHandoff>
        return typeof parsed.path === 'string' && typeof parsed.fileName === 'string'
            ? { path: parsed.path, fileName: parsed.fileName }
            : null
    } catch {
        return null
    }
}
