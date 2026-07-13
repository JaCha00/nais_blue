import type { CompositionModule } from '@/domain/composition/types'

export const ASSET_STUDIO_TEST_LOCALES = ['en', 'ko', 'ja'] as const

export type AssetStudioTestLocale = (typeof ASSET_STUDIO_TEST_LOCALES)[number]

export const LONG_MODULE_NAMES: Record<AssetStudioTestLocale, string> = {
    en: 'Cinematic environmental portrait module with deliberately verbose lighting, wardrobe, lens, atmosphere, and continuity notes',
    ko: '영화적인 환경 인물화를 위한 조명과 의상과 렌즈와 분위기와 장면 연속성 설명이 아주 길게 이어지는 모듈 이름',
    ja: '映画的な環境ポートレートの照明と衣装とレンズと雰囲気とシーン連続性の説明が非常に長く続くモジュール名',
}

const actor = {
    kind: 'user' as const,
    id: 'asset-studio-contract',
}

export function makeModule(index: number, name = `Module ${index}`): CompositionModule {
    return {
        id: `module-${index}`,
        name,
        kind: index % 2 === 0 ? 'prompt' : 'composite',
        enabled: index % 3 !== 0,
        orderKey: String(index).padStart(6, '0'),
        revision: 1,
        createdAt: '2026-07-13T00:00:00.000Z',
        createdBy: actor,
        updatedAt: '2026-07-13T00:00:00.000Z',
        updatedBy: actor,
        contributions: [],
        characterPatches: [],
        resourceBindings: [],
        randomRuleIds: [],
    }
}
