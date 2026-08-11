import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, LoaderCircle } from 'lucide-react'
import { Link, Navigate, useParams } from 'react-router'

import type { GuidedBatchOptionId } from './GuidedBatchImages'
import type { GuidedPromptTaskId } from './GuidedPromptTasks'
import {
    GUIDED_WORKFLOWS,
    isGuidedWorkflowId,
    type GuidedWorkflowId,
} from './GuidedWorkflowHub'

const GuidedBatchTask = lazy(() => import('./GuidedBatchImages').then(module => ({ default: module.GuidedBatchTask })))
const GuidedPromptTasks = lazy(() => import('./GuidedPromptTasks').then(module => ({ default: module.GuidedPromptTasks })))
const GuidedLibraryTask = lazy(() => import('./GuidedLibraryTask').then(module => ({ default: module.GuidedLibraryTask })))
const GuidedEnvironmentTask = lazy(() => import('./GuidedEnvironmentTask').then(module => ({ default: module.GuidedEnvironmentTask })))

function TaskLoadingFallback() {
    const { t } = useTranslation()
    return (
        <div className="flex min-h-64 items-center justify-center gap-3 text-sm text-muted-foreground" role="status">
            <LoaderCircle className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
            {t('guided.batch.starting')}
        </div>
    )
}

function NativeTaskFrame({
    workflowId,
    optionId,
    children,
}: {
    workflowId: Extract<GuidedWorkflowId, 'library' | 'environment'>
    optionId: string
    children: React.ReactNode
}) {
    const { t } = useTranslation()
    return (
        <div className="min-h-full min-w-0">
            <nav className="border-b border-border/55 px-4 py-2.5 sm:px-6" aria-label={t('guided.workflows.breadcrumb')}>
                <Link
                    to={`/guided-preview/guide/${workflowId}`}
                    className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground focus-ring"
                >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    <span>{t(`guided.workflows.${workflowId}.title`)}</span>
                    <span className="text-foreground" aria-current="page">
                        · {t(`guided.workflows.${workflowId}.options.${optionId}.title`)}
                    </span>
                </Link>
            </nav>
            {children}
        </div>
    )
}

function isKnownOption(workflowId: GuidedWorkflowId, optionId: string): boolean {
    return GUIDED_WORKFLOWS[workflowId].options.some(option => option.id === optionId)
}

function isPromptTask(optionId: string): optionId is GuidedPromptTaskId {
    return optionId === 'direct' || optionId === 'styleLab' || optionId === 'localAgent'
}

export function GuidedTaskRouter() {
    const { workflowId, optionId } = useParams<{ workflowId: string; optionId: string }>()

    if (!isGuidedWorkflowId(workflowId) || optionId === undefined || !isKnownOption(workflowId, optionId)) {
        return <Navigate to="/guided-preview" replace />
    }

    let task: React.ReactNode
    switch (workflowId) {
        case 'batch':
            task = <GuidedBatchTask optionId={optionId as GuidedBatchOptionId} />
            break
        case 'prompt':
            if (!isPromptTask(optionId)) return <Navigate to="/guided-preview/guide/prompt" replace />
            task = <GuidedPromptTasks taskId={optionId} />
            break
        case 'library':
            task = (
                <NativeTaskFrame workflowId="library" optionId={optionId}>
                    <GuidedLibraryTask optionId={optionId} />
                </NativeTaskFrame>
            )
            break
        case 'environment':
            task = (
                <NativeTaskFrame workflowId="environment" optionId={optionId}>
                    <GuidedEnvironmentTask optionId={optionId} />
                </NativeTaskFrame>
            )
            break
    }

    return <Suspense fallback={<TaskLoadingFallback />}>{task}</Suspense>
}
