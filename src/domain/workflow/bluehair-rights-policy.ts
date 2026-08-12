export const DEFAULT_RIGHTS_OWNER = 'bluehair.blue' as const
export const MAX_RIGHTS_OWNER_LENGTH = 128 as const

export interface RightsXmpRequest {
    readonly owner: string
    readonly effectiveDate: string
    readonly metadataDate: string
}

function isLeapYear(year: number): boolean {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

/** A calendar date the user explicitly supplied; timestamps and inferred dates are rejected. */
export function isRightsEffectiveDate(value: unknown): value is string {
    if (typeof value !== 'string') return false
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (match === null) return false
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    if (year < 1 || month < 1 || month > 12 || day < 1) return false
    const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    return day <= days[month - 1]
}

export function isRightsOwner(value: unknown): value is string {
    return typeof value === 'string'
        && value === value.trim()
        && value.length > 0
        && value.length <= MAX_RIGHTS_OWNER_LENGTH
        && !/[\u0000-\u001f\u007f\u2028\u2029]/.test(value)
}

export function isRightsXmpRequest(value: unknown): value is RightsXmpRequest {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
    const record = value as Record<string, unknown>
    return Object.keys(record).every(key => key === 'owner' || key === 'effectiveDate' || key === 'metadataDate')
        && isRightsOwner(record.owner)
        && isRightsEffectiveDate(record.effectiveDate)
        && typeof record.metadataDate === 'string'
        && Number.isFinite(Date.parse(record.metadataDate))
}
