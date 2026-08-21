import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import en from '@/i18n/locales/en.json'
import ja from '@/i18n/locales/ja.json'
import ko from '@/i18n/locales/ko.json'
import { getNovelAiModelProfile } from '@/services/nai/model-catalog'

const source = (path: string) => readFile(resolve(process.cwd(), path), 'utf8')

describe('V5 character editor limit contract', () => {
    it('uses the model catalog cap in Main without limiting V4 or destructive edits', async () => {
        const [panel, owner] = await Promise.all([
            source('src/components/character/CharacterPromptPanel.tsx'),
            source('src/components/layout/PromptPanel.tsx'),
        ])

        expect(getNovelAiModelProfile('nai-diffusion-5-full')?.capabilities.maxCharacters).toBe(32)
        expect(getNovelAiModelProfile('nai-diffusion-5-curated')?.capabilities.maxCharacters).toBe(32)
        expect(getNovelAiModelProfile('nai-diffusion-4-5-full')?.capabilities.maxCharacters).toBeUndefined()
        expect(owner).toContain('maxCharacters={modelProfile?.capabilities.maxCharacters}')
        expect(panel).toContain('characters.length >= maxCharacters')
        expect(panel).toContain('disabled={characterLimitReached}')
        expect(panel).toContain('duplicateDisabled={characterLimitReached}')
        expect(panel).toContain('removeCharacter(char.id)')
    })

    it('clips Guided imports to remaining V5 slots while preserving edit and delete actions', async () => {
        const [sheet, single, batch] = await Promise.all([
            source('src/presentation/workflow/GuidedCharacterPromptSheet.tsx'),
            source('src/presentation/workflow/GuidedSingleImage.tsx'),
            source('src/presentation/workflow/GuidedBatchImages.tsx'),
        ])

        expect(single).toContain('maxCharacters={maxCharacters}')
        expect(batch).toContain('maxCharacters={maxCharacters}')
        expect(single).toContain('imported.characters?.slice(0, acceptedCharacterCount)')
        expect(batch).toContain('imported.characters?.slice(0, acceptedCharacterCount)')
        expect(sheet).toContain('Math.max(0, maxCharacters - value.items.length)')
        expect(sheet).toContain('imported.characters.slice(0, availableSlots)')
        expect(sheet).toContain("t('guided.characters.importedLimited'")
        expect(sheet).toContain('items: value.items.map(character =>')
        expect(sheet).toContain('items: value.items.filter(character => character.id !== id)')
    })

    it('keeps the new limit feedback aligned in all locales', () => {
        for (const locale of [ko, en, ja]) {
            expect(locale.guided.characters.limitReached).toContain('{{max}}')
            expect(locale.guided.characters.importedLimited).toContain('{{count}}')
            expect(locale.guided.characters.importedLimited).toContain('{{max}}')
            expect(locale.characterPanel.limitReached).toContain('{{max}}')
        }
    })
})
