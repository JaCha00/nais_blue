import { useTranslation } from 'react-i18next'
import { Link, Navigate, useParams } from 'react-router'
import {
    Activity,
    ArrowRight,
    Bot,
    CloudUpload,
    Database,
    FileSearch,
    Film,
    FlaskConical,
    FolderOpen,
    Globe2,
    History,
    Images,
    KeyRound,
    Keyboard,
    Library,
    ListOrdered,
    Palette,
    PencilLine,
    Shuffle,
    Smartphone,
    Trash2,
    Wrench,
    type LucideIcon,
} from 'lucide-react'

export type GuidedWorkflowId = 'batch' | 'prompt' | 'library' | 'environment'

export interface GuidedWorkflowOption {
    readonly id: string
    readonly icon: LucideIcon
}

interface GuidedWorkflowDefinition {
    readonly icon: LucideIcon
    readonly options: readonly GuidedWorkflowOption[]
}

export const GUIDED_WORKFLOWS: Record<GuidedWorkflowId, GuidedWorkflowDefinition> = {
    batch: {
        icon: Images,
        options: [
            { id: 'sameSettings', icon: Images },
            { id: 'variations', icon: Shuffle },
            { id: 'scenes', icon: Film },
            { id: 'queue', icon: ListOrdered },
        ],
    },
    prompt: {
        icon: PencilLine,
        options: [
            { id: 'localAgent', icon: Bot },
            { id: 'direct', icon: PencilLine },
            { id: 'styleLab', icon: FlaskConical },
        ],
    },
    library: {
        icon: Library,
        options: [
            { id: 'library', icon: Library },
            { id: 'history', icon: History },
            { id: 'tools', icon: Wrench },
            { id: 'metadata', icon: FileSearch },
            { id: 'trash', icon: Trash2 },
            { id: 'r2', icon: CloudUpload },
        ],
    },
    environment: {
        icon: Wrench,
        options: [
            { id: 'credentials', icon: KeyRound },
            { id: 'appearance', icon: Palette },
            { id: 'storage', icon: FolderOpen },
            { id: 'shortcuts', icon: Keyboard },
            { id: 'backup', icon: Database },
            { id: 'device', icon: Smartphone },
            { id: 'web', icon: Globe2 },
            { id: 'diagnostics', icon: Activity },
        ],
    },
}

export function isGuidedWorkflowId(value: string | undefined): value is GuidedWorkflowId {
    return value !== undefined && Object.prototype.hasOwnProperty.call(GUIDED_WORKFLOWS, value)
}

export function GuidedWorkflowChoices({ workflowId }: { workflowId: GuidedWorkflowId }) {
    const { t } = useTranslation()
    const workflow = GUIDED_WORKFLOWS[workflowId]
    const keyPrefix = `guided.workflows.${workflowId}`
    const opensExistingTool = workflowId === 'library' || workflowId === 'environment'

    return (
        <nav className="border-t border-border/70" aria-label={t(`${keyPrefix}.title`)}>
            {workflow.options.map(option => {
                const Icon = option.icon
                const optionKey = `${keyPrefix}.options.${option.id}`
                return (
                    <Link
                        key={option.id}
                        to={`/guided-preview/task/${workflowId}/${option.id}`}
                        className="guided-choice-row group grid min-h-24 gap-3 border-b border-border/45 px-3 py-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4"
                    >
                        <Icon className="h-5 w-5 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden="true" />
                        <span className="min-w-0">
                            <span className="block text-base font-semibold text-foreground">{t(`${optionKey}.title`)}</span>
                            <span className="mt-1 block text-sm leading-6 text-muted-foreground">{t(`${optionKey}.description`)}</span>
                        </span>
                        <span className="flex min-h-11 items-center gap-2 whitespace-nowrap text-sm font-semibold text-primary sm:justify-end">
                            {opensExistingTool
                                ? t('guided.workflows.openDirectly', '바로 열기')
                                : t('guided.workflows.start')}
                            <ArrowRight className="h-4 w-4 transition-transform duration-fast group-hover:translate-x-1" aria-hidden="true" />
                        </span>
                    </Link>
                )
            })}
        </nav>
    )
}

export function GuidedWorkflowHub() {
    const { t } = useTranslation()
    const { workflowId } = useParams<{ workflowId: string }>()

    if (!isGuidedWorkflowId(workflowId)) {
        return <Navigate to="/guided-preview" replace />
    }

    const workflow = GUIDED_WORKFLOWS[workflowId]
    const WorkflowIcon = workflow.icon
    const keyPrefix = `guided.workflows.${workflowId}`

    return (
        <div className="mx-auto min-h-full w-full max-w-[var(--guided-content-max)] px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
            <header className="max-w-3xl">
                <span className="flex h-11 w-11 items-center justify-center text-primary">
                    <WorkflowIcon className="h-6 w-6" aria-hidden="true" />
                </span>
                <p className="mt-4 text-sm font-semibold text-primary">{t(`${keyPrefix}.eyebrow`)}</p>
                <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-4xl">
                    {t(`${keyPrefix}.title`)}
                </h1>
                <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
                    {t(`${keyPrefix}.description`)}
                </p>
            </header>

            <div className="mt-10">
                <GuidedWorkflowChoices workflowId={workflowId} />
            </div>
        </div>
    )
}
