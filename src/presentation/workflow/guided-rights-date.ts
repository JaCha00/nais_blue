/** Converts numpad-friendly YYYYMMDD input into the canonical XMP date shape. */
export function formatGuidedRightsDateInput(value: string): string {
    const digits = value.replace(/\D/gu, '').slice(0, 8)
    if (digits.length <= 4) return digits
    if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`
}

/** Uses the user's local calendar date only after the explicit CTA is pressed. */
export function currentLocalRightsDate(now = new Date()): string {
    return [
        String(now.getFullYear()).padStart(4, '0'),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
    ].join('-')
}
