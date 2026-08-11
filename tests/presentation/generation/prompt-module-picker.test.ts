import { describe, expect, it } from 'vitest'

import {
    appendPromptModuleLine,
    getUsablePromptModuleLines,
} from '@/components/fragments/PromptModulePicker'

describe('PromptModulePicker helpers', () => {
    it('appends a selected line without adding a duplicate comma', () => {
        expect(appendPromptModuleLine('', ' 1girl, blue eyes ')).toBe('1girl, blue eyes')
        expect(appendPromptModuleLine('masterpiece', '1girl')).toBe('masterpiece, 1girl')
        expect(appendPromptModuleLine('masterpiece,', '1girl')).toBe('masterpiece, 1girl')
        expect(appendPromptModuleLine('masterpiece\n# note', '1girl')).toBe('masterpiece\n# note\n1girl')
        expect(appendPromptModuleLine('masterpiece', '   ')).toBe('masterpiece')
    })

    it('exposes only nonblank, non-comment snapshot lines', () => {
        expect(getUsablePromptModuleLines([
            '',
            '  # notes ',
            ' 1girl, blue eyes ',
            'landscape',
        ])).toEqual(['1girl, blue eyes', 'landscape'])
    })
})
