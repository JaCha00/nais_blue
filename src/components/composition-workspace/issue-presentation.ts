import type { ReadonlyCompositionIssue } from './types'

export interface PresentedCompositionIssue {
    title: string
    description: string
}

export type CompositionIssueTranslator = (key: string) => string | undefined

const LOCALE_KEY = /^[a-z][a-z0-9_-]*(?:\.[a-zA-Z0-9_-]+)+$/

/** Keeps domain diagnostics private unless a stable locale entry can present them safely. */
export function presentCompositionIssue(
    issue: ReadonlyCompositionIssue,
    translate: CompositionIssueTranslator,
): PresentedCompositionIssue {
    const genericTitleKey = issue.severity === 'error'
        ? 'composition.issue.genericErrorTitle'
        : 'composition.issue.genericWarningTitle'
    const genericDescriptionKey = issue.severity === 'error'
        ? 'composition.issue.genericErrorDescription'
        : 'composition.issue.genericWarningDescription'
    const translated = (key: string): string | undefined => {
        const value = translate(key)
        return value === undefined || value === key ? undefined : value
    }
    const genericTitle = translated(genericTitleKey) ?? (issue.severity === 'error' ? 'Generation setup needs attention' : 'Review this generation setup')
    const genericDescription = translated(genericDescriptionKey) ?? 'Review the related generation settings before continuing.'
    const message = issue.messageKey.trim()

    if (LOCALE_KEY.test(message)) {
        const title = translated(message)
        if (title === undefined) return { title: genericTitle, description: genericDescription }
        const description = issue.repairHintKey === undefined ? undefined : translated(issue.repairHintKey)
        return {
            title,
            description: description ?? genericDescription,
        }
    }

    return {
        title: message || genericTitle,
        description: issue.repairHintKey === undefined
            ? genericDescription
            : translated(issue.repairHintKey) ?? genericDescription,
    }
}
