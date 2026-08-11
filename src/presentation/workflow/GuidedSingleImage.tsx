import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import {
    ArrowLeft,
    Check,
    ChevronRight,
    CircleAlert,
    CircleCheck,
    Download,
    FileJson,
    Image as ImageIcon,
    LoaderCircle,
    Pencil,
    RotateCcw,
    Settings2,
    Sparkles,
    WalletCards,
} from 'lucide-react'

import { getWorkflowDraftRepository } from '@/adapters/workflow/indexeddb-workflow-draft-repository'
import { createAnlasCostConsentSnapshot } from '@/domain/queue/anlas-cost-consent'
import type { GenerationJob } from '@/domain/queue/types'
import {
    SINGLE_IMAGE_NODE_IDS,
    isSingleImageDraft,
    isSingleImageDraftReady,
    reviseSingleImageDraft,
    type ReviseSingleImageDraftInput,
    type SingleImageDraft,
    type SingleImageGenerationSettings,
    type SingleImageNodeId,
    type SingleImageOutputSettings,
    type WorkflowCharacterPrompts,
} from '@/domain/workflow/single-image-draft'
import { calculateAnlasCost } from '@/lib/anlas-calculator'
import { cn } from '@/lib/utils'
import { saveNativeFileDialog } from '@/platform/native-file-dialog'
import { writeNativeBinaryFile, writeNativeTextFile } from '@/platform/native-file-system'
import {
    createWorkflowDraftMainBatchPlanner,
    WorkflowDraftCharacterPromptValidationError,
    WorkflowDraftPromptModuleResolutionError,
} from '@/presentation/generation/workflow-draft-main-batch-planner'
import { getRuntimeArtifactRepository } from '@/services/organizer/runtime'
import { childOutputRef } from '@/services/output/platform-adapter'
import { createRuntimeOutputPlatformAdapter } from '@/services/output/tauri-output-adapter'
import { getRuntimeQueueRepository } from '@/services/queue/indexeddb-queue-repository'
import { enqueuePlannedMainBatch } from '@/services/queue/main-queue-adapter'
import { selectActiveCredentialsAreOpus, useAuthStore } from '@/stores/auth-store'
import { useGenerationStore } from '@/stores/generation-store'
import { AutocompleteTextarea } from '@/components/ui/AutocompleteTextarea'
import { Button } from '@/components/ui/button'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/use-toast'
import {
    appendPromptModuleLine,
    PromptModulePicker,
} from '@/components/fragments/PromptModulePicker'
import {
    GUIDED_QUEUE_ACTIVITY_REFRESH_EVENT,
    announceGuidedDraftChange,
} from './guided-draft-events'
import {
    deriveGuidedQueueIssue,
    type GuidedQueueIssue,
} from '@/presentation/activity/activity-status'
import { GuidedPromptFileImport } from './GuidedPromptFileImport'
import { GuidedResolutionDetails } from './GuidedResolutionDetails'
import { GuidedCharacterPromptSheet } from './GuidedCharacterPromptSheet'

type DraftPatch = Omit<ReviseSingleImageDraftInput, 'updatedAt'>
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type GuidedSingleImageNodeId = SingleImageNodeId | 'result'

// Result is presentation-only; persisted workflow node IDs remain stable across draft migrations.
const GUIDED_SINGLE_IMAGE_NODE_IDS = [...SINGLE_IMAGE_NODE_IDS, 'result'] as const

interface GuidedResultProjection {
    readonly id: string
    readonly url: string | null
    readonly prompt: string
    readonly seed: number
    readonly artifactId?: string
    readonly sourceJobId?: string
}

const MODEL_OPTIONS = [
    { id: 'nai-diffusion-4-5-full', name: 'NAI Diffusion V4.5 Full', recommended: true },
    { id: 'nai-diffusion-4-5-curated', name: 'NAI Diffusion V4.5 Curated', recommended: false },
    { id: 'nai-diffusion-4-full', name: 'NAI Diffusion V4 Full', recommended: false },
    { id: 'nai-diffusion-4-curated-preview', name: 'NAI Diffusion V4 Curated', recommended: false },
] as const

const RESOLUTION_OPTIONS = [
    { id: 'portrait', width: 832, height: 1216 },
    { id: 'square', width: 1024, height: 1024 },
    { id: 'landscape', width: 1216, height: 832 },
] as const

const SAMPLER_OPTIONS = [
    { id: 'k_euler_ancestral', label: 'Euler Ancestral' },
    { id: 'k_dpmpp_2m_sde', label: 'DPM++ 2M SDE' },
    { id: 'k_dpmpp_2m', label: 'DPM++ 2M' },
    { id: 'k_euler', label: 'Euler' },
] as const

function isNodeId(value: string | undefined): value is GuidedSingleImageNodeId {
    return value !== undefined && GUIDED_SINGLE_IMAGE_NODE_IDS.includes(value as GuidedSingleImageNodeId)
}

function nextTimestamp(current: SingleImageDraft): string {
    return new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString()
}

function randomSeed(): number {
    const values = new Uint32Array(1)
    crypto.getRandomValues(values)
    return values[0] ?? 0
}

function getModelName(id: string | null): string {
    return MODEL_OPTIONS.find(option => option.id === id)?.name ?? id ?? '—'
}

function SaveIndicator({ status }: { status: SaveStatus }) {
    const { t } = useTranslation()
    return (
        <span className={cn(
            'inline-flex min-h-8 shrink-0 items-center gap-1.5 text-sm text-muted-foreground',
            status === 'error' && 'text-destructive',
        )} aria-live="polite">
            {status === 'saving' && <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            {status === 'saved' && <CircleCheck className="h-3.5 w-3.5 text-success" aria-hidden="true" />}
            {status === 'error' && <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />}
            {status === 'saving'
                ? t('guided.single.save.saving', '저장 중…')
                : status === 'error'
                    ? t('guided.single.save.error', '저장을 확인해 주세요')
                    : t('guided.single.save.saved', '자동 저장됨')}
        </span>
    )
}

interface StepFrameProps {
    nodeId: GuidedSingleImageNodeId
    saveStatus: SaveStatus
    title: string
    description: string
    onBack(): void
    canVisit(nodeId: GuidedSingleImageNodeId): boolean
    onVisit(nodeId: GuidedSingleImageNodeId): void
    children: ReactNode
    footer: ReactNode
}

function StepFrame({
    nodeId,
    saveStatus,
    title,
    description,
    onBack,
    canVisit,
    onVisit,
    children,
    footer,
}: StepFrameProps) {
    const { t } = useTranslation()
    const titleRef = useRef<HTMLHeadingElement>(null)
    const index = GUIDED_SINGLE_IMAGE_NODE_IDS.indexOf(nodeId)
    const progress = ((index + 1) / GUIDED_SINGLE_IMAGE_NODE_IDS.length) * 100

    useEffect(() => {
        titleRef.current?.focus()
    }, [nodeId])

    return (
        <div className={cn(
            'mx-auto flex min-h-full w-full flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-5 sm:px-6 sm:pt-8',
            nodeId === 'review' || nodeId === 'result'
                ? 'max-w-[var(--guided-review-max)]'
                : 'max-w-[var(--guided-question-max)]',
        )}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <Button type="button" variant="ghost" size="icon" onClick={onBack} aria-label={t('guided.single.back', '이전으로')}>
                    <ArrowLeft className="h-5 w-5" aria-hidden="true" />
                </Button>
                <nav className="flex min-w-[16rem] flex-1 flex-wrap items-center gap-y-1 text-base leading-6 text-muted-foreground" aria-label={t('guided.single.breadcrumb', '현재 작업 경로')}>
                    <Link to="/guided-preview" className="hover:text-foreground focus-ring">
                        {t('guided.single.home', '작업 홈')}
                    </Link>
                    <ChevronRight className="mx-1 inline h-3.5 w-3.5" aria-hidden="true" />
                    <button type="button" onClick={() => onVisit('model')} className="hover:text-foreground focus-ring">
                        {t('guided.single.title', '이미지 한 장 만들기')}
                    </button>
                    <ChevronRight className="mx-1 inline h-3.5 w-3.5" aria-hidden="true" />
                    <span className="font-medium text-foreground">
                        {t(`guided.single.steps.${nodeId}.short`, nodeId)}
                    </span>
                </nav>
                <SaveIndicator status={saveStatus} />
            </div>

            <div className="mt-7" aria-label={t('guided.single.progress', '작업 진행률')}>
                <div className="flex items-center justify-between gap-4 text-sm font-medium">
                    <span className="text-primary">
                        {t('guided.single.stepLabel', '단계 {{current}} · {{label}}', {
                            current: index + 1,
                            label: t(`guided.single.steps.${nodeId}.short`, nodeId),
                        })}
                    </span>
                    <span className="font-mono text-muted-foreground" aria-label={t('guided.single.stepA11y', '{{current}}단계, 전체 {{total}}단계', { current: index + 1, total: GUIDED_SINGLE_IMAGE_NODE_IDS.length })}>
                        {index + 1} / {GUIDED_SINGLE_IMAGE_NODE_IDS.length}
                    </span>
                </div>
                <div className="mt-3 h-px overflow-hidden bg-border">
                    <div className="h-full bg-primary transition-[width] duration-slow" style={{ width: `${progress}%` }} />
                </div>
                <ol className="mt-3 flex gap-5 overflow-x-auto pb-1 text-sm font-medium [scrollbar-width:none]" aria-label={t('guided.single.stepNavigation', '세부 단계 이동')}>
                    {GUIDED_SINGLE_IMAGE_NODE_IDS.map((step, stepIndex) => {
                        const current = step === nodeId
                        const enabled = canVisit(step)
                        return (
                            <li key={step} className="shrink-0">
                                <button
                                    type="button"
                                    onClick={() => onVisit(step)}
                                    disabled={!enabled}
                                    aria-current={current ? 'step' : undefined}
                                    className={cn(
                                        'border-b py-1.5 transition-colors focus-ring',
                                        current
                                            ? 'border-primary text-foreground'
                                            : enabled
                                                ? 'border-transparent text-muted-foreground hover:border-foreground/45 hover:text-foreground'
                                                : 'cursor-not-allowed border-transparent text-muted-foreground/40',
                                    )}
                                >
                                    <span className="mr-1 font-mono text-sm">{stepIndex + 1}</span>
                                    {t(`guided.single.steps.${step}.short`, step)}
                                </button>
                            </li>
                        )
                    })}
                </ol>
            </div>

            <section className="flex-1 py-9 sm:py-12">
                <h1 ref={titleRef} tabIndex={-1} className="max-w-[24ch] text-3xl font-semibold tracking-[-0.03em] outline-none sm:text-4xl">
                    {title}
                </h1>
                <p className="mt-3 max-w-[58ch] text-base leading-7 text-muted-foreground">{description}</p>
                <div className="mt-8">{children}</div>
            </section>

            <footer className="sticky bottom-0 z-10 -mx-4 flex min-h-[72px] flex-wrap items-center justify-end gap-2 border-t border-border/70 bg-background/95 px-4 py-3 text-base sm:-mx-6 sm:px-6">
                {footer}
            </footer>
        </div>
    )
}

function ModelStep({
    draft,
    disabled,
    onSelect,
}: {
    draft: SingleImageDraft
    disabled: boolean
    onSelect(model: string): void
}) {
    const { t } = useTranslation()
    return (
        <fieldset className="divide-y divide-border/70 border-y border-border/70" disabled={disabled}>
            <legend className="sr-only">{t('guided.single.model.legend', '생성 모델')}</legend>
            {MODEL_OPTIONS.map(option => {
                const checked = draft.payload.model === option.id
                return (
                    <label key={option.id} className={cn(
                        'relative flex min-h-[76px] cursor-pointer items-start gap-4 px-2 py-4 transition-colors hover:bg-accent/60 focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring',
                        checked && 'bg-accent/75',
                    )}>
                        <input
                            type="radio"
                            name="guided-model"
                            value={option.id}
                            checked={checked}
                            onChange={() => onSelect(option.id)}
                            className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                        />
                        <span className={cn(
                            'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-input',
                            checked && 'border-primary bg-primary text-primary-foreground',
                        )} aria-hidden="true">
                            {checked && <Check className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                                {option.name}
                                {option.recommended && (
                                    <span className="bg-primary px-1.5 py-0.5 text-[11px] font-semibold text-primary-foreground">
                                        {t('guided.single.recommended', '추천')}
                                    </span>
                                )}
                            </span>
                            <span className="mt-1.5 block text-xs leading-5 text-muted-foreground">
                                {t(`guided.single.model.${option.id}`, option.id)}
                            </span>
                        </span>
                    </label>
                )
            })}
        </fieldset>
    )
}

function PromptStep({
    positive,
    negative,
    characterPrompts,
    disabled,
    onPositiveChange,
    onNegativeChange,
    onCharacterPromptsChange,
}: {
    positive: string
    negative: string
    characterPrompts: WorkflowCharacterPrompts
    disabled: boolean
    onPositiveChange(value: string): void
    onNegativeChange(value: string): void
    onCharacterPromptsChange(value: WorkflowCharacterPrompts): void
}) {
    const { t } = useTranslation()
    return (
        <div className="space-y-4">
            <GuidedPromptFileImport
                positive={positive}
                disabled={disabled}
                onReplace={value => {
                    if (value.positive) onPositiveChange(value.positive)
                    if (value.negative) onNegativeChange(value.negative)
                }}
                onAppend={value => {
                    if (value.positive) onPositiveChange(appendPromptModuleLine(positive, value.positive))
                    if (value.negative) onNegativeChange(appendPromptModuleLine(negative, value.negative))
                }}
            />
            <div className="flex justify-end">
                <PromptModulePicker
                    disabled={disabled}
                    showManageAction={false}
                    allowInlineManage
                    createSourceText={positive}
                    onSelectLine={line => onPositiveChange(appendPromptModuleLine(positive, line))}
                />
            </div>
            <div className="h-64 sm:h-72">
                <AutocompleteTextarea
                    value={positive}
                    onChange={event => onPositiveChange(event.target.value)}
                    disabled={disabled}
                    placeholder={t('guided.single.prompt.placeholder', '예: 1girl, blue hair, quiet library, warm afternoon light')}
                    ariaLabel={t('guided.single.prompt.label', '만들고 싶은 이미지')}
                    maxSuggestions={8}
                    className="bg-card text-base"
                />
            </div>
            <div className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                <p>{t('guided.single.prompt.tagHelp', '영문 태그나 영문 자연어를 쓸 수 있어요. 태그 추천의 숫자는 학습량이 아니라 참고용 태그 데이터의 게시물 수예요.')}</p>
            </div>
            <GuidedCharacterPromptSheet
                value={characterPrompts}
                disabled={disabled}
                onChange={onCharacterPromptsChange}
            />
            <details className="border-y border-border/70 py-3">
                <summary className="cursor-pointer text-xs font-medium">
                    {t('guided.single.prompt.negativeTitle', '피하고 싶은 내용 추가 · 선택')}
                </summary>
                <div className="mt-3 flex justify-end">
                    <PromptModulePicker
                        disabled={disabled}
                        showManageAction={false}
                        allowInlineManage
                        createSourceText={negative}
                        triggerLabel={t('guided.promptModules.negativeTrigger', '제외 모듈 불러오기')}
                        onSelectLine={line => onNegativeChange(appendPromptModuleLine(negative, line))}
                    />
                </div>
                <Textarea
                    value={negative}
                    onChange={event => onNegativeChange(event.target.value)}
                    disabled={disabled}
                    className="mt-3 min-h-28 bg-card"
                    placeholder={t('guided.single.prompt.negativePlaceholder', '예: lowres, blurry, text')}
                />
            </details>
        </div>
    )
}

function ResolutionStep({
    draft,
    disabled,
    estimatedAnlas,
    pricingBasis,
    onSelect,
}: {
    draft: SingleImageDraft
    disabled: boolean
    estimatedAnlas: number
    pricingBasis: 'all-active-opus' | 'paid'
    onSelect(width: number, height: number): void
}) {
    const { t } = useTranslation()
    const resolution = draft.payload.resolution ?? RESOLUTION_OPTIONS[0]
    return (
        <div className="space-y-6">
            <fieldset className="grid divide-y divide-border/55 border-y border-border/55 sm:grid-cols-3 sm:divide-x sm:divide-y-0" disabled={disabled}>
                <legend className="sr-only">{t('guided.single.resolution.legend', '이미지 비율과 해상도')}</legend>
                {RESOLUTION_OPTIONS.map(option => {
                    const checked = draft.payload.resolution?.width === option.width
                        && draft.payload.resolution.height === option.height
                    return (
                        <label key={option.id} className={cn(
                            'guided-choice-row relative flex min-h-44 cursor-pointer flex-col items-center justify-center px-4 py-5 text-center focus-within:text-primary focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring',
                            checked && 'bg-primary/[0.06] text-primary',
                        )}>
                            <input
                                type="radio"
                                name="guided-resolution"
                                checked={checked}
                                onChange={() => onSelect(option.width, option.height)}
                                className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                            />
                            <span
                                className={cn('block border-2 border-muted-foreground/45', checked && 'border-primary')}
                                style={{
                                    width: option.width >= option.height ? 58 : Math.round(58 * option.width / option.height),
                                    height: option.height >= option.width ? 58 : Math.round(58 * option.height / option.width),
                                }}
                                aria-hidden="true"
                            />
                            <span className="mt-4 text-sm font-semibold">
                                {t(`guided.single.resolution.${option.id}`, option.id)}
                            </span>
                            <span className="mt-1 font-mono text-xs text-muted-foreground">
                                {option.width} × {option.height}
                            </span>
                        </label>
                    )
                })}
            </fieldset>
            <GuidedResolutionDetails
                width={resolution.width}
                height={resolution.height}
                steps={draft.payload.generation.steps}
                imageCount={1}
                estimatedAnlas={draft.payload.resolution === null ? null : estimatedAnlas}
                pricingBasis={pricingBasis}
                disabled={disabled}
                onChange={onSelect}
            />
        </div>
    )
}

function SettingsStep({
    draft,
    disabled,
    activeTokenCount,
    estimatedAnlas,
    onPatch,
    onOutputPatch,
}: {
    draft: SingleImageDraft
    disabled: boolean
    activeTokenCount: number
    estimatedAnlas: number
    onPatch(patch: Partial<SingleImageGenerationSettings>): void
    onOutputPatch(patch: Partial<SingleImageOutputSettings>): void
}) {
    const { t } = useTranslation()
    const [steps, setSteps] = useState(draft.payload.generation.steps)
    const [directory, setDirectory] = useState(draft.payload.output.directory)

    useEffect(() => setSteps(draft.payload.generation.steps), [draft.payload.generation.steps])
    useEffect(() => setDirectory(draft.payload.output.directory), [draft.payload.output.directory])

    const commitDirectory = () => {
        const value = directory.trim()
        if (value.length === 0) {
            setDirectory(draft.payload.output.directory)
            return
        }
        if (value !== draft.payload.output.directory) onOutputPatch({ directory: value })
    }

    return (
        <div className="space-y-7">
            <section className="border-y border-border/70 py-5" aria-labelledby="guided-steps-label">
                <div className="flex items-end justify-between gap-4">
                    <div>
                        <h2 id="guided-steps-label" className="text-sm font-semibold">Steps</h2>
                        <p className="mt-1 text-xs text-muted-foreground">
                            {t('guided.single.settings.stepsShort', '이미지를 얼마나 세밀하게 다듬을지 정해요.')}
                        </p>
                    </div>
                    <span className={cn('font-mono text-2xl font-semibold', steps > 28 && 'text-warning')}>{steps}</span>
                </div>
                <Slider
                    className="mt-4"
                    value={[steps]}
                    min={1}
                    max={50}
                    step={1}
                    disabled={disabled}
                    onValueChange={values => { if (values[0] !== undefined) setSteps(values[0]) }}
                    onValueCommit={values => { if (values[0] !== undefined) onPatch({ steps: values[0] }) }}
                    aria-label="Steps"
                />
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {steps <= 28
                        ? t('guided.single.settings.stepsFree', '28은 안정적인 기본값이에요. Opus 계정과 1024² 이하 해상도에서는 기본 생성 비용이 들지 않습니다.')
                        : t('guided.single.settings.stepsPaid', '28을 넘으면 Anlas가 필요할 수 있어요. 지시 이행이 나아질 수 있지만, 숫자가 높다고 항상 더 좋은 결과가 되는 건 아니에요.')}
                </p>
            </section>

            <section className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(14rem,0.72fr)] sm:items-end">
                <div>
                    <label className="text-sm font-semibold" htmlFor="guided-sampler">
                        {t('guided.single.settings.sampler', '샘플러')}
                    </label>
                    <p className="mt-1 text-xs text-muted-foreground">
                        {t('guided.single.settings.samplerHelp', '노이즈를 이미지로 다듬는 방식이에요.')}
                    </p>
                </div>
                <Select
                    value={draft.payload.generation.sampler}
                    onValueChange={value => onPatch({ sampler: value })}
                    disabled={disabled}
                >
                    <SelectTrigger id="guided-sampler"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {SAMPLER_OPTIONS.map(option => (
                            <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </section>

            <section className="border-y border-border/55 py-5" aria-labelledby="guided-output-heading">
                <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-end">
                    <div>
                        <label id="guided-output-heading" htmlFor="guided-output-directory" className="text-sm font-semibold">
                            {t('guided.single.settings.outputDirectory', '저장 폴더')}
                        </label>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {t('guided.single.settings.outputHelp', '상대 경로는 앱의 기본 이미지 폴더 아래에 만들어져요.')}
                        </p>
                        <Input
                            id="guided-output-directory"
                            className="mt-3"
                            value={directory}
                            disabled={disabled}
                            onChange={event => setDirectory(event.target.value)}
                            onBlur={commitDirectory}
                            onKeyDown={event => {
                                if (event.key === 'Enter') event.currentTarget.blur()
                            }}
                        />
                    </div>
                    <div>
                        <label htmlFor="guided-output-format" className="text-sm font-semibold">
                            {t('guided.single.settings.imageFormat', '이미지 형식')}
                        </label>
                        <Select
                            value={draft.payload.output.imageFormat}
                            onValueChange={value => onOutputPatch({ imageFormat: value as SingleImageOutputSettings['imageFormat'] })}
                            disabled={disabled}
                        >
                            <SelectTrigger id="guided-output-format" className="mt-3"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="png">PNG</SelectItem>
                                <SelectItem value="webp">WebP</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </section>

            <section className="grid divide-y divide-border/55 border-y border-border/55 sm:grid-cols-2 sm:divide-x sm:divide-y-0" aria-label={t('guided.single.settings.accountAndCost', '계정과 예상 비용')}>
                <div className="px-2 py-5 sm:px-5">
                    <div className="flex items-center gap-2">
                        <Settings2 className="h-4 w-4 text-primary" aria-hidden="true" />
                        <h2 className="text-xs font-semibold">{t('guided.single.settings.account', '사용할 계정')}</h2>
                    </div>
                    <p className="mt-3 text-sm font-semibold">
                        {activeTokenCount > 0
                            ? t('guided.single.settings.autoAccount', '사용 가능한 계정 자동 선택')
                            : t('guided.single.settings.noAccount', '사용 가능한 계정 없음')}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {t('guided.single.settings.accountCount', '현재 {{count}}개 토큰을 사용할 수 있어요.', { count: activeTokenCount })}
                    </p>
                </div>
                <div className="px-2 py-5 sm:px-5">
                    <div className="flex items-center gap-2">
                        <WalletCards className="h-4 w-4 text-primary" aria-hidden="true" />
                        <h2 className="text-xs font-semibold">{t('guided.single.settings.cost', '현재 예상 비용')}</h2>
                    </div>
                    <p className="mt-3 text-sm font-semibold">
                        {estimatedAnlas === 0
                            ? t('guided.single.settings.free', '0 Anlas · 무료 조건')
                            : t('guided.single.settings.anlas', '{{cost}} Anlas 예상', { cost: estimatedAnlas })}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {t('guided.single.settings.costFinal', '최종 단계에서 상한을 확인한 뒤만 대기열에 추가해요.')}
                    </p>
                </div>
            </section>

            <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                {activeTokenCount > 1
                    ? t('guided.single.settings.multiToken', '서로 다른 API 토큰을 쓰는 백그라운드 작업은 각 계정에서 병행할 수 있어요.')
                    : t('guided.single.settings.singleToken', '같은 API 토큰으로는 이미지를 동시에 만들 수 없어요. 다른 생성이 중이면 이 작업을 다음 순서에 이어서 실행할게요.')}
            </p>
        </div>
    )
}

function ReviewRow({
    label,
    wide = false,
    onEdit,
    children,
}: {
    label: string
    wide?: boolean
    onEdit?: () => void
    children: ReactNode
}) {
    const { t } = useTranslation()
    return (
        <div className={cn('grid gap-1 border-b border-border/70 py-3 sm:px-3', wide && 'sm:col-span-2')}>
            <dt className="flex min-h-8 items-center justify-between gap-3 text-sm font-medium text-muted-foreground">
                {label}
                {onEdit !== undefined && (
                    <button
                        type="button"
                        onClick={onEdit}
                        className="inline-flex min-h-8 items-center gap-1 border-b border-transparent text-xs font-semibold text-primary transition-colors hover:border-primary focus-ring"
                    >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        {t('guided.single.review.edit', '수정')}
                    </button>
                )}
            </dt>
            <dd className="min-w-0 [overflow-wrap:anywhere] text-sm text-foreground">{children}</dd>
        </div>
    )
}

function ReviewStep({
    draft,
    activeTokenCount,
    estimatedAnlas,
    consented,
    submitting,
    submitError,
    onConsentChange,
    onSubmit,
    onEdit,
    onManageAccount,
    onOpenResult,
}: {
    draft: SingleImageDraft
    activeTokenCount: number
    estimatedAnlas: number
    consented: boolean
    submitting: boolean
    submitError: string | null
    onConsentChange(value: boolean): void
    onSubmit(): void
    onEdit(nodeId: SingleImageNodeId): void
    onManageAccount(): void
    onOpenResult(): void
}) {
    const { t } = useTranslation()
    const submitted = draft.status === 'queued' || draft.status === 'completed'
    const resolution = draft.payload.resolution
    const enabledCharacters = draft.payload.characterPrompts.items.filter(character => character.enabled)
    return (
        <div className="space-y-6">
            <dl className="grid border-t border-border/70 sm:grid-cols-2 sm:gap-x-6">
                <ReviewRow
                    label={t('guided.single.review.prompt', '프롬프트')}
                    wide
                    onEdit={submitted ? undefined : () => onEdit('prompt')}
                >
                    <p className="whitespace-pre-wrap break-words leading-6">{draft.payload.prompt.positive || '—'}</p>
                    {draft.payload.prompt.negative.trim().length > 0 && (
                        <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
                            {t('guided.single.review.negative', '피할 내용')}: {draft.payload.prompt.negative}
                        </p>
                    )}
                    {enabledCharacters.length > 0 && (
                        <p className="mt-2 text-xs leading-5 text-muted-foreground">
                            {t('guided.single.review.characters', '캐릭터 {{count}}명', { count: enabledCharacters.length })}: {' '}
                            {enabledCharacters.map((character, index) => (
                                character.name?.trim() || t('guided.characters.unnamed', '캐릭터 {{index}}', { index: index + 1 })
                            )).join(', ')}
                        </p>
                    )}
                </ReviewRow>
                <ReviewRow label={t('guided.single.review.model', '모델')} onEdit={submitted ? undefined : () => onEdit('model')}>
                    {getModelName(draft.payload.model)}
                </ReviewRow>
                <ReviewRow label={t('guided.single.review.resolution', '해상도')} onEdit={submitted ? undefined : () => onEdit('resolution')}>
                    {resolution === null ? '—' : `${resolution.width} × ${resolution.height}`}
                </ReviewRow>
                <ReviewRow label={t('guided.single.review.settings', '생성 설정')} onEdit={submitted ? undefined : () => onEdit('settings')}>
                    {draft.payload.generation.steps} Steps · {SAMPLER_OPTIONS.find(item => item.id === draft.payload.generation.sampler)?.label ?? draft.payload.generation.sampler} · CFG {draft.payload.generation.cfgScale}
                </ReviewRow>
                <ReviewRow label={t('guided.single.review.account', '계정')} onEdit={submitted ? undefined : onManageAccount}>
                    {activeTokenCount > 0
                        ? t('guided.single.review.autoAccount', '자동 선택 · {{count}}개 사용 가능', { count: activeTokenCount })
                        : t('guided.single.review.noAccount', '사용 가능한 계정 없음')}
                </ReviewRow>
                <ReviewRow label={t('guided.single.review.output', '저장')} onEdit={submitted ? undefined : () => onEdit('settings')}>
                    {draft.payload.output.directory} · {draft.payload.output.imageFormat.toUpperCase()} · {t('guided.single.review.autosave', '자동 저장')}
                </ReviewRow>
                <ReviewRow label={t('guided.single.review.cost', '최대 비용')}>
                    <span className="font-semibold">
                        {estimatedAnlas === 0
                            ? t('guided.single.review.free', '0 Anlas')
                            : t('guided.single.review.maxAnlas', '최대 {{cost}} Anlas', { cost: estimatedAnlas })}
                    </span>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {t('guided.single.review.costGuard', '이 상한을 넘는 설정으로 바뀌면 실행하지 않고 다시 확인할게요.')}
                    </p>
                </ReviewRow>
            </dl>

            {submitted ? (
                <div className="flex items-start gap-3 border-y border-success/40 px-2 py-4 sm:px-4" role="status">
                    <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
                    <div>
                        <p className="text-sm font-semibold">
                            {draft.status === 'completed'
                                ? t('guided.single.review.completedTitle', '이미지가 완성되었어요.')
                                : t('guided.single.review.queuedTitle', '대기열에 추가했어요.')}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {draft.status === 'completed'
                                ? t('guided.single.review.completedDescription', 'Guided 화면에서 결과를 확인하고 다음 작업을 정할 수 있어요.')
                                : t('guided.single.review.queuedDescription', '이제 다른 프롬프트를 다듬어도 이 설정 스냅샷은 바뀌지 않아요.')}
                        </p>
                    </div>
                </div>
            ) : (
                <label className="guided-choice-row flex cursor-pointer items-start gap-3 border-y border-border/70 px-2 py-4 sm:px-4">
                    <input
                        type="checkbox"
                        checked={consented}
                        onChange={event => onConsentChange(event.target.checked)}
                        className="mt-0.5 h-4 w-4 accent-[oklch(var(--primary))]"
                    />
                    <span>
                        <span className="block text-sm font-semibold">
                            {estimatedAnlas === 0
                                ? t('guided.single.review.consentFree', '현재 무료 조건을 확인했어요.')
                                : t('guided.single.review.consentPaid', '최대 {{cost}} Anlas 사용에 동의해요.', { cost: estimatedAnlas })}
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                            {t('guided.single.review.consentHelp', '동의한 예상치와 상한은 이 작업 스냅샷에 함께 저장됩니다.')}
                        </span>
                    </span>
                </label>
            )}

            {submitError !== null && (
                <div className="flex items-start gap-2 text-xs leading-5 text-destructive" role="alert">
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    {submitError}
                </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
                {submitted ? (
                    <Button type="button" className="sm:flex-1" onClick={onOpenResult}>
                        {draft.status === 'queued'
                            ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                            : <ImageIcon className="mr-2 h-4 w-4" aria-hidden="true" />}
                        {draft.status === 'completed'
                            ? t('guided.single.review.openResult', '완성 이미지 보기')
                            : t('guided.single.review.waitForResult', '결과 화면에서 기다리기')}
                    </Button>
                ) : (
                    <Button
                        type="button"
                        className="sm:flex-1"
                        onClick={onSubmit}
                        disabled={!consented || activeTokenCount === 0 || submitting || !isSingleImageDraftReady(draft)}
                    >
                        {submitting && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                        <ImageIcon className="mr-2 h-4 w-4" aria-hidden="true" />
                        {t('guided.single.review.enqueue', '이미지 1장 대기열에 추가')}
                    </Button>
                )}
            </div>
        </div>
    )
}

async function readResultArtifactBytes(result: GuidedResultProjection): Promise<Uint8Array> {
    const artifactId = result.artifactId
        ?? (result.sourceJobId === undefined ? null : `artifact:${result.sourceJobId}`)
    if (artifactId === null) throw new Error('The completed result has no durable artifact identity')
    const artifact = await getRuntimeArtifactRepository().get(artifactId)
    if (artifact === null) throw new Error('The completed result artifact is unavailable')
    const platform = createRuntimeOutputPlatformAdapter()
    const directory = await platform.resolveDirectory({
        portableDirectory: artifact.original.file.directory,
        workflowDefaultDirectory: 'NAIS_Output',
    })
    return platform.readFile(childOutputRef(directory, artifact.original.file.fileName))
}

function ResultStep({
    draft,
    result,
    queueIssue,
    onRetry,
    onEdit,
    onRegenerate,
}: {
    draft: SingleImageDraft
    result: GuidedResultProjection | null
    queueIssue: GuidedQueueIssue | null
    onRetry(): void
    onEdit(): void
    onRegenerate(): void
}) {
    const { t } = useTranslation()
    const [previewUrl, setPreviewUrl] = useState(result?.url ?? null)
    const [previewError, setPreviewError] = useState(false)
    const [previewAttempt, setPreviewAttempt] = useState(0)
    const [saving, setSaving] = useState<'image' | 'metadata' | null>(null)
    const fileStem = `nais-guided-${draft.id.replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 80)}`

    useEffect(() => {
        setPreviewError(false)
        setPreviewUrl(result?.url ?? null)
        if (result === null) return
        let active = true
        let objectUrl: string | null = null
        void readResultArtifactBytes(result).then(bytes => {
            if (!active) return
            const ownedBytes = Uint8Array.from(bytes)
            objectUrl = URL.createObjectURL(new Blob([ownedBytes.buffer], {
                type: `image/${draft.payload.output.imageFormat}`,
            }))
            setPreviewUrl(objectUrl)
        }).catch(() => {
            if (active && result.url === null) setPreviewError(true)
        })
        return () => {
            active = false
            if (objectUrl !== null) URL.revokeObjectURL(objectUrl)
        }
    }, [draft.payload.output.imageFormat, previewAttempt, result])

    const saveImage = async () => {
        if (result === null) return
        setSaving('image')
        try {
            const extension = draft.payload.output.imageFormat
            const path = await saveNativeFileDialog({
                defaultPath: `${fileStem}.${extension}`,
                filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
            })
            if (path === null) return
            await writeNativeBinaryFile(path, await readResultArtifactBytes(result))
            toast({ title: t('guided.single.result.imageSaved', '이미지를 저장했어요.'), variant: 'success' })
        } catch {
            toast({ title: t('guided.single.result.saveFailed', '저장하지 못했어요.'), variant: 'destructive' })
        } finally {
            setSaving(null)
        }
    }

    const saveMetadata = async () => {
        if (result === null) return
        setSaving('metadata')
        try {
            const path = await saveNativeFileDialog({
                defaultPath: `${fileStem}.json`,
                filters: [{ name: 'JSON', extensions: ['json'] }],
            })
            if (path === null) return
            await writeNativeTextFile(path, JSON.stringify({
                schemaVersion: 1,
                kind: 'nais-guided-single-image-settings',
                draftId: draft.id,
                sourceBatchId: draft.lastSnapshotId,
                sourceJobId: result.sourceJobId ?? null,
                model: draft.payload.model,
                prompt: { ...draft.payload.prompt, positive: result.prompt },
                characterPrompts: draft.payload.characterPrompts,
                resolution: draft.payload.resolution,
                generation: draft.payload.generation,
                output: draft.payload.output,
                savedAt: new Date().toISOString(),
            }, null, 2))
            toast({ title: t('guided.single.result.metadataSaved', '이번 설정을 JSON으로 보존했어요.'), variant: 'success' })
        } catch {
            toast({ title: t('guided.single.result.saveFailed', '저장하지 못했어요.'), variant: 'destructive' })
        } finally {
            setSaving(null)
        }
    }

    if (queueIssue !== null) {
        const cancelled = queueIssue === 'cancelled'
        const needsAttention = queueIssue === 'needs-attention'
        return (
            <div className="border-y border-destructive/35 px-4 py-8 text-center" role="alert">
                <CircleAlert className="mx-auto h-6 w-6 text-destructive" aria-hidden="true" />
                <h2 className="mt-4 text-lg font-semibold">
                    {cancelled
                        ? t('guided.single.result.cancelledTitle', '이미지 생성이 취소되었어요.')
                        : needsAttention
                            ? t('guided.single.result.needsAttentionTitle', '계속하려면 작업 확인이 필요해요.')
                            : t('guided.single.result.failedTitle', '이미지를 만들지 못했어요.')}
                </h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                    {cancelled
                        ? t('guided.single.result.cancelledDescription', '비용은 다시 승인하지 않았어요. 같은 설정으로 다시 시도하거나 설정을 수정할 수 있어요.')
                        : needsAttention
                            ? t('guided.single.result.needsAttentionDescription', '큐 센터에서 막힌 이유를 확인한 뒤 다시 시도하거나 설정을 수정해 주세요.')
                            : t('guided.single.result.failedDescription', '큐 센터에서 실패 원인을 확인한 뒤 같은 설정으로 다시 시도할 수 있어요.')}
                </p>
                <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row sm:flex-wrap">
                    <Button type="button" onClick={onRetry}>
                        <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
                        {t('guided.single.result.retryGeneration', '같은 설정으로 다시 시도')}
                    </Button>
                    <Button type="button" variant="outline" onClick={onEdit}>
                        <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
                        {t('guided.single.result.edit', '설정 수정하기')}
                    </Button>
                    <Button asChild variant="ghost">
                        <Link to="/guided-preview/task/batch/queue">{t('guided.single.result.openQueue', '큐 센터 열기')}</Link>
                    </Button>
                </div>
            </div>
        )
    }

    if (result !== null && previewUrl === null && previewError) {
        return (
            <div className="flex min-h-72 flex-col items-center justify-center border-y border-destructive/35 px-4 text-center" role="alert">
                <CircleAlert className="h-6 w-6 text-destructive" aria-hidden="true" />
                <p className="mt-4 text-base font-semibold">{t('guided.single.result.previewErrorTitle', '완성된 이미지를 불러오지 못했어요.')}</p>
                <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                    {t('guided.single.result.previewErrorDescription', '원본 파일 위치와 큐 상태를 확인한 뒤 다시 시도해 주세요.')}
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                    <Button type="button" variant="outline" onClick={() => setPreviewAttempt(value => value + 1)}>
                        <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
                        {t('guided.single.result.retryPreview', '다시 불러오기')}
                    </Button>
                    <Button asChild variant="ghost">
                        <Link to="/guided-preview/task/batch/queue">{t('guided.single.result.openQueue', '큐 센터 열기')}</Link>
                    </Button>
                </div>
            </div>
        )
    }

    if (result === null || previewUrl === null) {
        return (
            <div className="flex min-h-72 flex-col items-center justify-center border-y border-border/70 text-center" role="status" aria-live="polite">
                <LoaderCircle className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
                <p className="mt-4 text-base font-semibold">{t('guided.single.result.waitingTitle', '이미지를 마무리하고 있어요.')}</p>
                <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                    {t('guided.single.result.waitingDescription', '완료되는 즉시 이 화면에 결과를 보여드릴게요. 다른 작업으로 이동해도 생성은 계속됩니다.')}
                </p>
            </div>
        )
    }

    return (
        <div className="space-y-8">
            <figure className="border-y border-border/70 py-5">
                <img
                    src={previewUrl}
                    alt={t('guided.single.result.imageAlt', '완성된 이미지')}
                    className="mx-auto max-h-[62vh] w-auto max-w-full object-contain"
                />
                <figcaption className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                    <span>{getModelName(draft.payload.model)}</span>
                    <span className="font-mono">
                        {draft.payload.resolution?.width} × {draft.payload.resolution?.height} · Seed {result.seed}
                    </span>
                </figcaption>
            </figure>

            <section className="border-y border-primary/30 py-6" aria-labelledby="guided-result-keep-title">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                    {t('guided.single.result.keepEyebrow', '다음 작업')}
                </p>
                <h2 id="guided-result-keep-title" className="mt-2 text-2xl font-semibold tracking-[-0.025em]">
                    {t('guided.single.result.keepTitle', '이 설정이 마음에 든다면?')}
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                    {t('guided.single.result.keepDescription', '이미지는 이미 지정 폴더에 저장되었어요. 설정 JSON도 함께 보존하면 나중에 같은 조건을 쉽게 다시 확인할 수 있어요.')}
                </p>
                <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    <Button type="button" onClick={() => void saveMetadata()} disabled={saving !== null}>
                        {saving === 'metadata'
                            ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                            : <FileJson className="mr-2 h-4 w-4" aria-hidden="true" />}
                        {t('guided.single.result.saveMetadata', '이번 설정 보존하기')}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => void saveImage()} disabled={saving !== null}>
                        {saving === 'image'
                            ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                            : <Download className="mr-2 h-4 w-4" aria-hidden="true" />}
                        {t('guided.single.result.saveImage', '이미지 다른 곳에 저장')}
                    </Button>
                </div>
            </section>

            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button type="button" variant="outline" onClick={onRegenerate}>
                    <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
                    {t('guided.single.result.regenerate', '같은 설정 · 새 Seed로 다시 만들기')}
                </Button>
                <Button type="button" variant="outline" onClick={onEdit}>
                    <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
                    {t('guided.single.result.edit', '설정 수정하기')}
                </Button>
            </div>
        </div>
    )
}

export function GuidedSingleImage() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const params = useParams<{ draftId: string; nodeId: string }>()
    const draftId = params.draftId ?? ''
    const nodeId = isNodeId(params.nodeId) ? params.nodeId : null
    const [draft, setDraft] = useState<SingleImageDraft | null>(null)
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState(false)
    const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
    const [positive, setPositive] = useState('')
    const [negative, setNegative] = useState('')
    const [characterPrompts, setCharacterPrompts] = useState<WorkflowCharacterPrompts>({
        positionEnabled: false,
        items: [],
    })
    const [consented, setConsented] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)
    const [queuedJobs, setQueuedJobs] = useState<readonly GenerationJob[]>([])
    const draftRef = useRef<SingleImageDraft | null>(null)
    const saveChainRef = useRef<Promise<void>>(Promise.resolve())
    const promptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const promptDirtyRef = useRef(false)
    const positiveRef = useRef('')
    const negativeRef = useRef('')
    const characterPromptsRef = useRef<WorkflowCharacterPrompts>({
        positionEnabled: false,
        items: [],
    })
    const completionInFlightRef = useRef(false)
    const completionNavigatedRef = useRef(false)

    const token1 = useAuthStore(state => state.token)
    const token2 = useAuthStore(state => state.token2)
    const verified1 = useAuthStore(state => state.isVerified)
    const verified2 = useAuthStore(state => state.isVerified2)
    const enabled1 = useAuthStore(state => state.slot1Enabled)
    const enabled2 = useAuthStore(state => state.slot2Enabled)
    const activeCredentialsAreOpus = useAuthStore(selectActiveCredentialsAreOpus)
    const history = useGenerationStore(state => state.history)
    const activeTokenCount = Number(Boolean(token1 && verified1 && enabled1))
        + Number(Boolean(token2 && verified2 && enabled2))
    const resultProjection = useMemo<GuidedResultProjection | null>(() => {
        const queuedJobIds = new Set(queuedJobs.map(job => job.id))
        const historyResult = history.find(item => (
            item.sourceJobId !== undefined && queuedJobIds.has(item.sourceJobId)
        ))
        if (historyResult !== undefined) return historyResult

        const succeededJob = queuedJobs.find(job => (
            job.state === 'succeeded' && job.artifactReference !== null
        ))
        if (draft === null || succeededJob === undefined) return null
        return {
            id: `queue-history:${succeededJob.id}`,
            url: null,
            prompt: draft.payload.prompt.positive,
            seed: draft.payload.generation.seed,
            artifactId: succeededJob.artifactReference?.artifactId,
            sourceJobId: succeededJob.id,
        }
    }, [draft, history, queuedJobs])
    const queueIssue = useMemo(
        () => resultProjection === null
            ? deriveGuidedQueueIssue(queuedJobs.map(job => job.state))
            : null,
        [queuedJobs, resultProjection],
    )

    useEffect(() => {
        let active = true
        setLoading(true)
        setLoadError(false)
        void getWorkflowDraftRepository().get(draftId).then(found => {
            if (!active) return
            if (!isSingleImageDraft(found)) {
                navigate('/guided-preview', { replace: true })
                return
            }
            draftRef.current = found
            setDraft(found)
            positiveRef.current = found.payload.prompt.positive
            negativeRef.current = found.payload.prompt.negative
            characterPromptsRef.current = found.payload.characterPrompts
            setPositive(found.payload.prompt.positive)
            setNegative(found.payload.prompt.negative)
            setCharacterPrompts(found.payload.characterPrompts)
            setLoading(false)
        }).catch(() => {
            if (active) {
                setLoadError(true)
                setLoading(false)
            }
        })
        return () => { active = false }
    }, [draftId, navigate])

    useEffect(() => {
        if (draft !== null && nodeId === null) {
            navigate(`/guided-preview/work/${draft.id}/${draft.currentNodeId}`, { replace: true })
        }
    }, [draft, navigate, nodeId])

    useEffect(() => {
        const batchId = draft?.lastSnapshotId
        if (batchId === null || batchId === undefined) {
            setQueuedJobs([])
            return
        }
        let active = true
        const refresh = () => {
            void getRuntimeQueueRepository().listJobs({ batchId, limit: 10 }).then(page => {
                if (active) setQueuedJobs(page.items)
            }).catch(() => {
                if (active) setQueuedJobs([])
            })
        }
        refresh()
        window.addEventListener(GUIDED_QUEUE_ACTIVITY_REFRESH_EVENT, refresh)
        return () => {
            active = false
            window.removeEventListener(GUIDED_QUEUE_ACTIVITY_REFRESH_EVENT, refresh)
        }
    }, [draft?.lastSnapshotId])

    const commitMutation = useCallback((mutation: (current: SingleImageDraft) => DraftPatch): Promise<SingleImageDraft> => {
        setSaveStatus('saving')
        const operation = saveChainRef.current.then(async () => {
            const current = draftRef.current
            if (current === null) throw new Error('Workflow draft is not loaded')
            const next = reviseSingleImageDraft(current, {
                ...mutation(current),
                updatedAt: nextTimestamp(current),
            })
            const result = await getWorkflowDraftRepository().commit({
                expectedRevision: current.revision,
                draft: next,
            })
            if (result.status === 'conflict') {
                if (isSingleImageDraft(result.current)) {
                    draftRef.current = result.current
                    setDraft(result.current)
                }
                throw new Error('Workflow draft changed in another window')
            }
            if (!isSingleImageDraft(result.draft)) throw new Error('Workflow draft kind changed')
            draftRef.current = result.draft
            setDraft(result.draft)
            setSaveStatus('saved')
            announceGuidedDraftChange()
            return result.draft
        }).catch(error => {
            setSaveStatus('error')
            throw error
        })
        saveChainRef.current = operation.then(() => undefined, () => undefined)
        return operation
    }, [])

    useEffect(() => {
        if (draft === null || resultProjection === null) return
        if (draft.status === 'queued' && !completionInFlightRef.current) {
            completionInFlightRef.current = true
            const completedBatchId = draft.lastSnapshotId
            void commitMutation(current => (
                current.status === 'queued' && current.lastSnapshotId === completedBatchId
                    ? { status: 'completed' }
                    : {}
            )).then(() => {
                completionNavigatedRef.current = true
                navigate(`/guided-preview/work/${draft.id}/result`, { replace: true })
            }).catch(() => undefined).finally(() => {
                completionInFlightRef.current = false
            })
            return
        }
        if (draft.status === 'completed'
            && nodeId === 'review'
            && !completionNavigatedRef.current) {
            completionNavigatedRef.current = true
            navigate(`/guided-preview/work/${draft.id}/result`, { replace: true })
        }
    }, [commitMutation, draft, navigate, nodeId, resultProjection])

    const savePrompt = useCallback(async (nextNodeId?: SingleImageNodeId) => {
        const current = draftRef.current
        if (current === null) return null
        const promptChanged = current.payload.prompt.positive !== positiveRef.current
            || current.payload.prompt.negative !== negativeRef.current
            || JSON.stringify(current.payload.characterPrompts) !== JSON.stringify(characterPromptsRef.current)
        if (!promptChanged && (nextNodeId === undefined || current.currentNodeId === nextNodeId)) return current
        const submittedPositive = positiveRef.current
        const submittedNegative = negativeRef.current
        const submittedCharacters = characterPromptsRef.current
        const result = await commitMutation(latest => ({
            currentNodeId: nextNodeId,
            ...(nextNodeId === 'review' ? { status: 'review' as const } : {}),
            payload: {
                ...latest.payload,
                prompt: { positive: submittedPositive, negative: submittedNegative },
                characterPrompts: submittedCharacters,
            },
        }))
        if (positiveRef.current === submittedPositive
            && negativeRef.current === submittedNegative
            && characterPromptsRef.current === submittedCharacters) {
            promptDirtyRef.current = false
        }
        return result
    }, [commitMutation])

    const schedulePromptSave = useCallback(() => {
        promptDirtyRef.current = true
        if (promptTimerRef.current !== null) clearTimeout(promptTimerRef.current)
        promptTimerRef.current = setTimeout(() => {
            promptTimerRef.current = null
            void savePrompt().catch(() => undefined)
        }, 400)
    }, [savePrompt])

    useEffect(() => () => {
        if (promptTimerRef.current !== null) clearTimeout(promptTimerRef.current)
        if (promptDirtyRef.current) void savePrompt().catch(() => undefined)
    }, [savePrompt])

    if (loading) {
        return (
            <div className="flex min-h-full items-center justify-center" role="status">
                <LoaderCircle className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
                <span className="ml-3 text-sm text-muted-foreground">{t('guided.single.loading', '초안을 불러오는 중…')}</span>
            </div>
        )
    }
    if (loadError || draft === null || nodeId === null) {
        return (
            <div className="mx-auto flex min-h-full max-w-lg items-center px-4">
                <div className="w-full border-y border-border py-8 text-center">
                    <CircleAlert className="mx-auto h-6 w-6 text-destructive" aria-hidden="true" />
                    <p className="mt-3 text-sm font-semibold">{t('guided.single.loadError', '초안을 불러오지 못했어요.')}</p>
                    <Button className="mt-5" variant="outline" onClick={() => navigate('/guided-preview')}>
                        {t('guided.single.returnHome', '작업 홈으로')}
                    </Button>
                </div>
            </div>
        )
    }

    const locked = draft.status === 'queued' || draft.status === 'completed'
    const patchPayload = (patch: Partial<SingleImageDraft['payload']>) => {
        setConsented(false)
        return commitMutation(current => ({ payload: { ...current.payload, ...patch } }))
    }
    const canVisit = (target: GuidedSingleImageNodeId): boolean => {
        const hasPrompt = positive.trim().length > 0
        if (target === 'model') return true
        if (target === 'prompt') return draft.payload.model !== null
        if (target === 'resolution') return draft.payload.model !== null && hasPrompt
        if (target === 'settings') return draft.payload.resolution !== null && hasPrompt
        if (target === 'review') return isSingleImageDraftReady({
            ...draft,
            payload: {
                ...draft.payload,
                prompt: { positive, negative },
                characterPrompts,
            },
        })
        return draft.status === 'queued' || (draft.status === 'completed' && resultProjection !== null)
    }
    const goTo = async (target: GuidedSingleImageNodeId) => {
        if (target === nodeId || !canVisit(target)) return
        try {
            if (promptTimerRef.current !== null) {
                clearTimeout(promptTimerRef.current)
                promptTimerRef.current = null
            }
            if (target === 'result' || locked) {
                completionNavigatedRef.current = true
                navigate(`/guided-preview/work/${draft.id}/${target}`)
                return
            }
            if (nodeId === 'prompt') await savePrompt(target)
            else if (draft.currentNodeId !== target || target === 'review') {
                await commitMutation(() => ({
                    currentNodeId: target,
                    ...(target === 'review' ? { status: 'review' as const } : {}),
                }))
            }
            navigate(`/guided-preview/work/${draft.id}/${target}`)
        } catch {
            setSaveStatus('error')
        }
    }
    const currentIndex = GUIDED_SINGLE_IMAGE_NODE_IDS.indexOf(nodeId)
    const previous = GUIDED_SINGLE_IMAGE_NODE_IDS[currentIndex - 1]
    const back = () => {
        if (previous === undefined) navigate('/guided-preview')
        else void goTo(previous)
    }
    const estimatedAnlas = draft.payload.resolution === null
        ? 0
        : calculateAnlasCost({
            width: draft.payload.resolution.width,
            height: draft.payload.resolution.height,
            steps: draft.payload.generation.steps,
            imageCount: 1,
            pricingBasis: activeCredentialsAreOpus ? 'all-active-opus' : 'paid',
        })

    const submit = async () => {
        setSubmitting(true)
        setSubmitError(null)
        try {
            const estimatedAt = new Date().toISOString()
            const costConsent = createAnlasCostConsentSnapshot({
                pricingBasis: activeCredentialsAreOpus ? 'all-active-opus' : 'paid',
                estimatedAnlas,
                maxAnlas: estimatedAnlas,
                estimatedAt,
                approvedAt: new Date().toISOString(),
            })
            const result = await enqueuePlannedMainBatch({
                planner: createWorkflowDraftMainBatchPlanner(draft),
                submissionPolicy: { kind: 'guided', costConsent },
                idempotencyScope: `guided:${draft.id}:revision:${draft.revision}`,
            })
            if (result === null) throw new Error('The draft could not be planned')
            setQueuedJobs(result.jobs)
            const queuedDraft = await commitMutation(() => ({
                status: 'queued',
                currentNodeId: 'review',
                lastSnapshotId: result.batch.id,
            }))
            completionNavigatedRef.current = true
            navigate(`/guided-preview/work/${queuedDraft.id}/result`)
        } catch (error) {
            setSubmitError(error instanceof WorkflowDraftPromptModuleResolutionError
                ? t('guided.single.review.promptModuleError', '저장된 프롬프트 모듈을 찾지 못했어요. 프롬프트 단계에서 다시 선택해 주세요.')
                : error instanceof WorkflowDraftCharacterPromptValidationError
                    ? t('guided.single.review.characterPromptError', '활성 캐릭터의 외형 프롬프트를 확인해 주세요.')
                    : t('guided.single.review.submitError', '대기열에 추가하지 못했어요. 계정과 비용 설정을 확인해 주세요.'))
        } finally {
            setSubmitting(false)
        }
    }

    const reviseCompletedResult = async (target: SingleImageNodeId, withNewSeed: boolean) => {
        completionNavigatedRef.current = true
        try {
            const revised = await commitMutation(current => ({
                status: 'review',
                currentNodeId: target,
                lastSnapshotId: null,
                payload: withNewSeed
                    ? {
                        ...current.payload,
                        generation: { ...current.payload.generation, seed: randomSeed() },
                    }
                    : current.payload,
            }))
            setQueuedJobs([])
            setConsented(false)
            setSubmitError(null)
            navigate(`/guided-preview/work/${revised.id}/${target}`)
        } catch {
            setSaveStatus('error')
        }
    }

    const footer = (() => {
        if (nodeId === 'model') {
            return <Button onClick={() => void goTo('prompt')} disabled={draft.payload.model === null || saveStatus === 'saving'}>{t('guided.single.continue', '계속')}</Button>
        }
        if (nodeId === 'prompt') {
            return <Button onClick={() => void goTo('resolution')} disabled={positive.trim().length === 0 || saveStatus === 'saving'}>{t('guided.single.continue', '계속')}</Button>
        }
        if (nodeId === 'resolution') {
            return <Button onClick={() => void goTo('settings')} disabled={draft.payload.resolution === null || saveStatus === 'saving'}>{t('guided.single.continue', '계속')}</Button>
        }
        if (nodeId === 'settings') {
            return <Button onClick={() => void goTo('review')} disabled={activeTokenCount === 0 || saveStatus === 'saving'}>{t('guided.single.reviewSettings', '설정 검토')}</Button>
        }
        if (nodeId === 'result') {
            return <span className="text-sm text-muted-foreground">{t('guided.single.result.footer', '결과는 자동 저장되며, 설정은 언제든 다시 다듬을 수 있어요.')}</span>
        }
        return <span className="text-sm text-muted-foreground">{t('guided.single.review.footer', '실행 전 설정과 비용을 한 번 더 확인해 주세요.')}</span>
    })()

    const stepCopy = {
        model: {
            title: t('guided.single.steps.model.title', '어떤 모델을 사용할까요?'),
            description: t('guided.single.steps.model.description', '처음이라면 지시를 잘 따르고 표현 범위가 넓은 V4.5 Full을 권해요.'),
        },
        prompt: {
            title: t('guided.single.steps.prompt.title', '어떤 이미지를 만들고 싶나요?'),
            description: t('guided.single.steps.prompt.description', '떠오르는 장면을 영문 태그 또는 영문 문장으로 적어 주세요.'),
        },
        resolution: {
            title: t('guided.single.steps.resolution.title', '어떤 모양의 이미지가 필요한가요?'),
            description: t('guided.single.steps.resolution.description', '용도에 가장 가까운 비율을 고르세요. 세 선택지 모두 1024² 픽셀 범위 안이에요.'),
        },
        settings: {
            title: t('guided.single.steps.settings.title', '이 설정으로 다듬어 볼까요?'),
            description: t('guided.single.steps.settings.description', '추천값은 그대로 써도 충분해요. 결과의 느낌을 바꾸고 싶을 때만 조절해 보세요.'),
        },
        review: {
            title: t('guided.single.steps.review.title', '만들기 전에 한 눈에 확인해 볼까요?'),
            description: t('guided.single.steps.review.description', '대기열에 추가한 뒤에는 이 설정을 스냅샷으로 고정해 안전하게 실행해요.'),
        },
        result: {
            title: t('guided.single.steps.result.title', '완성된 이미지를 확인해 볼까요?'),
            description: t('guided.single.steps.result.description', '결과를 바로 확인하고, 저장하거나 설정을 바꿔 다음 이미지를 이어서 만들 수 있어요.'),
        },
    }[nodeId]

    return (
        <StepFrame
            nodeId={nodeId}
            saveStatus={saveStatus}
            title={stepCopy.title}
            description={stepCopy.description}
            onBack={back}
            canVisit={canVisit}
            onVisit={target => void goTo(target)}
            footer={footer}
        >
            {nodeId === 'model' && (
                <ModelStep
                    draft={draft}
                    disabled={locked}
                    onSelect={model => { void patchPayload({ model }).catch(() => undefined) }}
                />
            )}
            {nodeId === 'prompt' && (
                <PromptStep
                    positive={positive}
                    negative={negative}
                    characterPrompts={characterPrompts}
                    disabled={locked}
                    onPositiveChange={value => {
                        setConsented(false)
                        positiveRef.current = value
                        setPositive(value)
                        schedulePromptSave()
                    }}
                    onNegativeChange={value => {
                        setConsented(false)
                        negativeRef.current = value
                        setNegative(value)
                        schedulePromptSave()
                    }}
                    onCharacterPromptsChange={value => {
                        setConsented(false)
                        characterPromptsRef.current = value
                        setCharacterPrompts(value)
                        schedulePromptSave()
                    }}
                />
            )}
            {nodeId === 'resolution' && (
                <ResolutionStep
                    draft={draft}
                    disabled={locked}
                    estimatedAnlas={estimatedAnlas}
                    pricingBasis={activeCredentialsAreOpus ? 'all-active-opus' : 'paid'}
                    onSelect={(width, height) => {
                        setConsented(false)
                        void patchPayload({ resolution: { width, height } }).catch(() => undefined)
                    }}
                />
            )}
            {nodeId === 'settings' && (
                <SettingsStep
                    draft={draft}
                    disabled={locked}
                    activeTokenCount={activeTokenCount}
                    estimatedAnlas={estimatedAnlas}
                    onPatch={patch => {
                        setConsented(false)
                        void commitMutation(current => ({
                            payload: {
                                ...current.payload,
                                generation: { ...current.payload.generation, ...patch },
                            },
                        })).catch(() => undefined)
                    }}
                    onOutputPatch={patch => {
                        setConsented(false)
                        void commitMutation(current => ({
                            payload: {
                                ...current.payload,
                                output: { ...current.payload.output, ...patch },
                            },
                        })).catch(() => undefined)
                    }}
                />
            )}
            {nodeId === 'review' && (
                <ReviewStep
                    draft={draft}
                    activeTokenCount={activeTokenCount}
                    estimatedAnlas={estimatedAnlas}
                    consented={consented}
                    submitting={submitting}
                    submitError={submitError}
                    onConsentChange={setConsented}
                    onSubmit={() => void submit()}
                    onEdit={target => void goTo(target)}
                    onManageAccount={() => navigate('/guided-preview/task/environment/credentials')}
                    onOpenResult={() => void goTo('result')}
                />
            )}
            {nodeId === 'result' && (
                <ResultStep
                    draft={draft}
                    result={resultProjection}
                    queueIssue={queueIssue}
                    onRetry={() => void reviseCompletedResult('review', false)}
                    onRegenerate={() => void reviseCompletedResult('review', true)}
                    onEdit={() => void reviseCompletedResult('prompt', false)}
                />
            )}
        </StepFrame>
    )
}
