import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en.json'
import ja from '@/i18n/locales/ja.json'
import ko from '@/i18n/locales/ko.json'

const locales = { en, ko, ja } as const

function leafKeys(value: unknown, prefix = ''): string[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix]
    return Object.entries(value as Record<string, unknown>)
        .flatMap(([key, child]) => leafKeys(child, prefix ? `${prefix}.${key}` : key))
        .sort()
}

function lookup(value: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((current, segment) => (
        current && typeof current === 'object'
            ? (current as Record<string, unknown>)[segment]
            : undefined
    ), value)
}

describe('Composition workspace locale parity', () => {
    it('keeps the canonical composition and Scene composition trees aligned', () => {
        expect(leafKeys(ko.composition)).toEqual(leafKeys(en.composition))
        expect(leafKeys(ja.composition)).toEqual(leafKeys(en.composition))
        expect(leafKeys(ko.scene.composition)).toEqual(leafKeys(en.scene.composition))
        expect(leafKeys(ja.scene.composition)).toEqual(leafKeys(en.scene.composition))
    })

    it('defines every Composition workspace key referenced by Main and Scene', async () => {
        const source = (await Promise.all([
            'src/pages/MainMode.tsx',
            'src/pages/SceneMode.tsx',
            'src/pages/SceneDetail.tsx',
            'src/components/scene/SceneCompositionWorkspace.tsx',
        ].map(path => readFile(resolve(process.cwd(), path), 'utf8')))).join('\n')
        const keys = [...source.matchAll(/t\(['"]((?:composition|scene\.composition)\.[^'"]+)['"]/g)]
            .map(match => match[1])

        for (const [locale, messages] of Object.entries(locales)) {
            for (const key of new Set(keys)) {
                expect(lookup(messages, key), `${locale} is missing ${key}`).toBeTypeOf('string')
            }
        }
    })
})
