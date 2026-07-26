import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { isDesktopRuntime, isMobileRuntime } from './runtime'

export interface ExportTextFileInput {
    suggestedName: string
    content: string
    mimeType: 'application/json' | 'text/csv' | 'text/plain'
    dialogTitle?: string
}

export interface ExportTextFileResult {
    method: 'share' | 'save-dialog' | 'browser-download' | 'cancelled'
    path?: string
}

function extensionFilter(input: ExportTextFileInput): { name: string; extensions: string[] } {
    const extension = input.suggestedName.split('.').pop()?.toLowerCase() ?? 'txt'
    return {
        name: input.mimeType === 'application/json' ? 'JSON' : input.mimeType === 'text/csv' ? 'CSV' : 'Text',
        extensions: [extension],
    }
}

/**
 * Uses the Android/iOS share sheet when available and a native save dialog on
 * desktop. The browser fallback keeps local development usable without adding
 * a second export implementation to Data Hub.
 */
export async function exportTextFile(input: ExportTextFileInput): Promise<ExportTextFileResult> {
    const file = new File([input.content], input.suggestedName, { type: `${input.mimeType};charset=utf-8` })
    if (isMobileRuntime && typeof navigator.share === 'function'
        && (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] }))) {
        await navigator.share({ files: [file], title: input.suggestedName })
        return { method: 'share' }
    }

    if (isDesktopRuntime) {
        const path = await save({
            title: input.dialogTitle,
            defaultPath: input.suggestedName,
            filters: [extensionFilter(input)],
        })
        if (!path) return { method: 'cancelled' }
        await writeTextFile(path, input.content)
        return { method: 'save-dialog', path }
    }

    const href = URL.createObjectURL(file)
    try {
        const anchor = document.createElement('a')
        anchor.href = href
        anchor.download = input.suggestedName
        anchor.click()
    } finally {
        URL.revokeObjectURL(href)
    }
    return { method: 'browser-download' }
}
