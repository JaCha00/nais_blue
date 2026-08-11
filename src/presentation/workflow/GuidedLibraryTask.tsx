import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'

import { HistoryPanel } from '@/components/layout/HistoryPanel'
import { Button } from '@/components/ui/button'
import { MetadataWorkspace } from '@/pages/DataHub'
import Library from '@/pages/Library'
import R2Upload from '@/pages/R2Upload'
import ToolsMode from '@/pages/ToolsMode'
import Trash from '@/pages/Trash'

export const GUIDED_LIBRARY_TASK_IDS = [
    'library',
    'history',
    'tools',
    'metadata',
    'trash',
    'r2',
] as const

export type GuidedLibraryTaskId = typeof GUIDED_LIBRARY_TASK_IDS[number]

function GuidedLibraryWorkspace() {
    const { t } = useTranslation()
    const [toolsOpen, setToolsOpen] = useState(false)

    if (!toolsOpen) return <Library onOpenTools={() => setToolsOpen(true)} />

    return (
        <div className="min-h-full">
            <div className="px-3 pt-3 sm:px-5">
                <Button variant="ghost" onClick={() => setToolsOpen(false)}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    {t('guided.workflows.native.library.back')}
                </Button>
            </div>
            <ToolsMode guided />
        </div>
    )
}

export function GuidedLibraryTask({ optionId }: { optionId: string }) {
    const { t } = useTranslation()
    let task: ReactNode

    switch (optionId) {
        case 'library':
            task = <GuidedLibraryWorkspace />
            break
        case 'history':
            task = <HistoryPanel guided />
            break
        case 'tools':
            task = <ToolsMode guided />
            break
        case 'metadata':
            task = <MetadataWorkspace />
            break
        case 'trash':
            task = <Trash />
            break
        case 'r2':
            task = <R2Upload />
            break
        default:
            task = (
                <div className="mx-auto flex min-h-64 max-w-2xl items-center justify-center px-4 text-center text-sm text-muted-foreground" role="alert">
                    {t('guided.workflows.native.unavailable.library')}
                </div>
            )
    }

    return (
        <div className="min-h-full min-w-0" data-guided-native-task={`library.${optionId}`}>
            {task}
        </div>
    )
}
