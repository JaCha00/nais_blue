import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import ko from './locales/ko.json'
import en from './locales/en.json'
import ja from './locales/ja.json'

const resources = {
    ko: { translation: ko },
    en: { translation: en },
    ja: { translation: ja },
}

i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        resources,
        fallbackLng: 'en', // 지원하지 않는 언어는 영어로 fallback
        supportedLngs: ['ko', 'en', 'ja'],

        interpolation: {
            escapeValue: false,
        },

        detection: {
            order: ['localStorage', 'navigator'], // localStorage 우선, 그 다음 시스템 언어
            caches: ['localStorage'],
            lookupLocalStorage: 'i18nextLng',
        },
    })

export default i18n
