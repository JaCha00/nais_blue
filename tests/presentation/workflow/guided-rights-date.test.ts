import { describe, expect, it } from 'vitest'

import {
    currentLocalRightsDate,
    formatGuidedRightsDateInput,
} from '@/presentation/workflow/guided-rights-date'

describe('Guided rights date input', () => {
    it('accepts continuous numpad digits and canonicalizes pasted separators', () => {
        expect(formatGuidedRightsDateInput('20260814')).toBe('2026-08-14')
        expect(formatGuidedRightsDateInput('2026-08-14')).toBe('2026-08-14')
        expect(formatGuidedRightsDateInput('20260')).toBe('2026-0')
        expect(formatGuidedRightsDateInput('2026년 08월 14일')).toBe('2026-08-14')
    })

    it('builds the explicit today action from the local calendar', () => {
        expect(currentLocalRightsDate(new Date(2026, 7, 4, 23, 59))).toBe('2026-08-04')
    })
})
