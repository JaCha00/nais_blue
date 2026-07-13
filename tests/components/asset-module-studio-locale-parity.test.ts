import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import en from '@/i18n/locales/en.json'
import ja from '@/i18n/locales/ja.json'
import ko from '@/i18n/locales/ko.json'

type LocaleTree = Record<string, unknown>

const locales = { en, ko, ja } as const

function leafKeys(value: unknown, prefix = ''): string[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix]
    return Object.entries(value as LocaleTree)
        .flatMap(([key, child]) => leafKeys(child, prefix ? `${prefix}.${key}` : key))
        .sort()
}

function getPath(value: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((current, segment) => {
        if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
        return (current as LocaleTree)[segment]
    }, value)
}

describe('Asset Module Studio v2 locale parity', () => {
    it('keeps the English, Korean, and Japanese namespace leaf keys identical', () => {
        const englishKeys = leafKeys(en.assetModuleStudioV2)

        expect(leafKeys(ko.assetModuleStudioV2)).toEqual(englishKeys)
        expect(leafKeys(ja.assetModuleStudioV2)).toEqual(englishKeys)
        expect(englishKeys.length).toBeGreaterThan(75)
    })

    it('provides a non-empty translation for every key used by the canonical studio and wrapper', () => {
        const source = [
            'src/components/asset-module-studio/CompositionStudioV2.tsx',
            'src/pages/AssetModuleStudio.tsx',
        ].map(file => readFileSync(resolve(process.cwd(), file), 'utf8')).join('\n')
        const referencedKeys = [...source.matchAll(/t\(['"](assetModuleStudioV2\.[^'"]+)['"]/g)]
            .map(match => match[1])

        expect(referencedKeys.length).toBeGreaterThan(50)
        for (const [locale, messages] of Object.entries(locales)) {
            for (const key of referencedKeys) {
                const value = getPath(messages, key)
                expect(value, `${locale} is missing ${key}`).toEqual(expect.any(String))
                expect((value as string).trim(), `${locale} has an empty ${key}`).not.toBe('')
            }
        }
    })
})
