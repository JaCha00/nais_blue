export const DEFAULT_DETERMINISTIC_DATE = '2000-01-01T00:00:00.000Z'

export type DeterministicDateInput = Date | number | string

export interface DeterministicClock {
    now(): number
    date(): Date
    iso(): string
    set(value: DeterministicDateInput): void
    advance(milliseconds: number): void
}

function timestampFrom(value: DeterministicDateInput): number {
    const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime()
    if (!Number.isFinite(timestamp)) {
        throw new RangeError(`Invalid deterministic date: ${String(value)}`)
    }
    return timestamp
}

export function deterministicDate(
    value: DeterministicDateInput = DEFAULT_DETERMINISTIC_DATE,
): Date {
    return new Date(timestampFrom(value))
}

export function deterministicIsoDate(
    value: DeterministicDateInput = DEFAULT_DETERMINISTIC_DATE,
): string {
    return deterministicDate(value).toISOString()
}

/** A mutable, explicitly injected clock; it never changes unless set or advanced. */
export function createDeterministicClock(
    initialValue: DeterministicDateInput = DEFAULT_DETERMINISTIC_DATE,
): DeterministicClock {
    let timestamp = timestampFrom(initialValue)

    return {
        now: () => timestamp,
        date: () => new Date(timestamp),
        iso: () => new Date(timestamp).toISOString(),
        set: (value) => {
            timestamp = timestampFrom(value)
        },
        advance: (milliseconds) => {
            if (!Number.isFinite(milliseconds)) {
                throw new RangeError(`Invalid clock advance: ${String(milliseconds)}`)
            }
            timestamp += milliseconds
        },
    }
}
