import {
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
    closestCenter,
    DndContext,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
    AlertTriangle,
    ArrowDown,
    ArrowUp,
    Check,
    CircleAlert,
    GitMerge,
    GripVertical,
    Plus,
    Redo2,
    Save,
    Search,
    Trash2,
    Undo2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { CompositionEngineIssue, CompositionEnginePlan } from '@/domain/composition/engine'
import type { DeepReadonly } from '@/domain/composition/provenance'
import type {
    ActorRef,
    CharacterPosition,
    CharacterSlotPatch,
    ChoiceRandomRule,
    CompositionDocument,
    CompositionModule,
    CompositionModuleKind,
    CompositionRecipe,
    EntityId,
    IntegerRangeRandomRule,
    OutputPolicy,
    ParamsOverride,
    PositivePromptSlot,
    PromptContribution,
    PromptTarget,
    RandomRule,
    RandomScalar,
    RecipeStep,
} from '@/domain/composition/types'
import {
    FixedVirtualModuleList,
    type VirtualModuleRow,
} from './FixedVirtualModuleList'

const GUI_ACTOR: ActorRef = {
    kind: 'user',
    id: 'gui:asset-module-studio',
    displayName: 'Asset Module Studio',
}

const POSITIVE_SLOTS: readonly PositivePromptSlot[] = [
    'base',
    'inpainting',
    'additional',
    'workflow',
    'scene',
    'style',
    'detail',
    'quality',
]

const MODULE_KINDS: readonly CompositionModuleKind[] = [
    'prompt',
    'character',
    'params',
    'output',
    'composite',
]

export interface CompositionStudioIssue {
    readonly code: string
    readonly severity: 'warning' | 'error'
    readonly messageKey: string
    readonly entityRef?: {
        readonly kind: string
        readonly id: EntityId
    }
    readonly fieldPath: readonly (string | number)[]
    readonly blocking: boolean
}
type StudioIssue = CompositionStudioIssue
type EnabledFilter = 'all' | 'enabled' | 'disabled'
type ValidationFilter = 'all' | 'valid' | 'warning' | 'error'
type StudioSection = 'module' | 'recipe' | 'preview'
export type ConflictChoice = 'local' | 'external' | 'merged'

export interface CompositionStudioConflict {
    path: string
    base: unknown
    local: unknown
    external: unknown
    merged: unknown
    resolution?: ConflictChoice
}

export interface CompositionStudioV2Props {
    document: CompositionDocument
    issues: readonly StudioIssue[]
    dirty: boolean
    saving: boolean
    error?: string | null
    externalDocument?: CompositionDocument
    conflicts?: readonly CompositionStudioConflict[]
    preview?: DeepReadonly<CompositionEnginePlan> | null
    previewErrors?: readonly DeepReadonly<CompositionEngineIssue>[]
    onDraftDocument: (next: CompositionDocument) => void
    onCommit: () => void | Promise<void>
    onUndo: () => void
    onReloadExternal: () => void
    onResolveConflict: (path: string, choice: ConflictChoice) => void
}

function newId(prefix: string): EntityId {
    const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    return `${prefix}:${uuid}`
}

function orderKeyFor(index: number): string {
    return String((index + 1) * 1024).padStart(12, '0')
}

function compareOrder(left: { orderKey: string; id: string }, right: { orderKey: string; id: string }): number {
    return left.orderKey.localeCompare(right.orderKey) || left.id.localeCompare(right.id)
}

function active<T extends { deletedAt?: string }>(items: readonly T[]): T[] {
    return items.filter(item => item.deletedAt === undefined)
}

function entityMeta(id: EntityId, orderKey: string) {
    const timestamp = new Date().toISOString()
    return {
        id,
        orderKey,
        revision: 0,
        createdAt: timestamp,
        createdBy: GUI_ACTOR,
        updatedAt: timestamp,
        updatedBy: GUI_ACTOR,
    }
}

function touched<T extends { updatedAt: string; updatedBy: ActorRef }>(value: T): T {
    return {
        ...value,
        updatedAt: new Date().toISOString(),
        updatedBy: GUI_ACTOR,
    }
}

function moduleIssueLevel(moduleId: EntityId, issues: readonly StudioIssue[]): VirtualModuleRow['issueLevel'] {
    const related = issues.filter(issue => issue.entityRef?.kind === 'module' && issue.entityRef.id === moduleId)
    if (related.some(issue => issue.severity === 'error' || issue.blocking)) return 'error'
    if (related.length > 0) return 'warning'
    return 'valid'
}

function Field({ label, hint, children, className }: {
    label: string
    hint?: string
    children: ReactNode
    className?: string
}) {
    return (
        <div className={cn('min-w-0 space-y-1.5', className)}>
            <Label className="block text-xs font-medium text-muted-foreground">{label}</Label>
            {children}
            {hint && <p className="break-words text-[11px] text-muted-foreground">{hint}</p>}
        </div>
    )
}

function Section({ title, description, actions, children, className }: {
    title: string
    description?: string
    actions?: ReactNode
    children: ReactNode
    className?: string
}) {
    return (
        <section className={cn('min-w-0 border-t border-border py-4 first:border-t-0 first:pt-0', className)}>
            <div className="mb-3 flex min-w-0 flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                    <h3 className="break-words text-base font-semibold">{title}</h3>
                    {description && <p className="mt-1 break-words text-xs text-muted-foreground">{description}</p>}
                </div>
                {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
            </div>
            {children}
        </section>
    )
}

function OptionalNumberInput({ value, onChange, ...props }: {
    value: number | undefined
    onChange: (value: number | undefined) => void
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
    return (
        <Input
            {...props}
            type="number"
            value={value ?? ''}
            onChange={(event) => {
                const raw = event.currentTarget.value
                onChange(raw === '' ? undefined : Number(raw))
            }}
        />
    )
}

function OptionalBooleanSelect({ value, onChange, label }: {
    value: boolean | undefined
    onChange: (value: boolean | undefined) => void
    label: string
}) {
    const { t } = useTranslation()
    return (
        <Select
            value={value === undefined ? 'inherit' : value ? 'true' : 'false'}
            onValueChange={(next) => onChange(next === 'inherit' ? undefined : next === 'true')}
        >
            <SelectTrigger aria-label={label}><SelectValue /></SelectTrigger>
            <SelectContent>
                <SelectItem value="inherit">{t('assetModuleStudioV2.common.inherit')}</SelectItem>
                <SelectItem value="true">{t('assetModuleStudioV2.common.on')}</SelectItem>
                <SelectItem value="false">{t('assetModuleStudioV2.common.off')}</SelectItem>
            </SelectContent>
        </Select>
    )
}

function promptTargetValue(target: PromptTarget): string {
    if (target.kind === 'positive') return `positive:${target.slot}`
    if (target.kind === 'negative') return 'negative'
    return `character:${target.characterId}:${target.polarity}`
}

function promptTargetFromValue(value: string): PromptTarget {
    if (value === 'negative') return { kind: 'negative' }
    if (value.startsWith('positive:')) {
        return { kind: 'positive', slot: value.slice('positive:'.length) as PositivePromptSlot }
    }
    const [, characterId, polarity] = value.split(':')
    return {
        kind: 'character',
        characterId,
        polarity: polarity === 'negative' ? 'negative' : 'positive',
    }
}

function sourceLabel(source: { readonly kind: string; readonly entityId?: string; readonly requestId?: string; readonly source?: string }): string {
    if (source.kind === 'entity') return source.entityId ?? 'entity'
    if (source.kind === 'request') return source.requestId ?? 'request'
    return source.source ?? 'external'
}

function ModuleBrowser({
    document,
    issues,
    selectedId,
    recentIds,
    onSelect,
    onAdd,
    onBulkEnabled,
}: {
    document: CompositionDocument
    issues: readonly StudioIssue[]
    selectedId: EntityId | null
    recentIds: readonly EntityId[]
    onSelect: (id: EntityId) => void
    onAdd: () => void
    onBulkEnabled: (ids: readonly EntityId[], enabled: boolean) => void
}) {
    const { t } = useTranslation()
    const [search, setSearch] = useState('')
    const [kind, setKind] = useState<'all' | CompositionModuleKind>('all')
    const [enabled, setEnabled] = useState<EnabledFilter>('all')
    const [validation, setValidation] = useState<ValidationFilter>('all')
    const [recentOnly, setRecentOnly] = useState(false)
    const [checkedIds, setCheckedIds] = useState<Set<EntityId>>(new Set())
    const recentSet = useMemo(() => new Set(recentIds), [recentIds])

    const rows = useMemo(() => {
        const query = search.trim().toLocaleLowerCase()
        return active(document.modules)
            .map(module => ({ module, issueLevel: moduleIssueLevel(module.id, issues) }))
            .filter(row => !query
                || row.module.name.toLocaleLowerCase().includes(query)
                || row.module.id.toLocaleLowerCase().includes(query))
            .filter(row => kind === 'all' || row.module.kind === kind)
            .filter(row => enabled === 'all' || row.module.enabled === (enabled === 'enabled'))
            .filter(row => validation === 'all' || row.issueLevel === validation)
            .filter(row => !recentOnly || recentSet.has(row.module.id))
            .sort((left, right) => compareOrder(left.module, right.module))
    }, [document.modules, enabled, issues, kind, recentOnly, recentSet, search, validation])

    const checkedVisible = rows.filter(row => checkedIds.has(row.module.id)).map(row => row.module.id)

    useEffect(() => {
        const activeIds = new Set(active(document.modules).map(module => module.id))
        setCheckedIds(current => new Set([...current].filter(id => activeIds.has(id))))
    }, [document.modules])

    return (
        <aside className="min-w-0 overflow-hidden rounded-panel border border-border bg-card" aria-label={t('assetModuleStudioV2.filters.browserAria')}>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-border p-3">
                <div className="min-w-0">
                    <h2 className="text-base font-semibold">{t('assetModuleStudioV2.filters.modules')}</h2>
                    <p className="text-xs text-muted-foreground">{rows.length} / {active(document.modules).length}</p>
                </div>
                <Button size="sm" variant="outline" onClick={onAdd}>
                    <Plus className="mr-1.5 h-4 w-4" />{t('assetModuleStudioV2.actions.addModule')}
                </Button>
            </div>

            <div className="space-y-2 p-3">
                <Field label={t('assetModuleStudioV2.filters.search')}>
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            value={search}
                            onChange={(event) => setSearch(event.currentTarget.value)}
                            className="min-w-0 pl-9"
                            placeholder={t('assetModuleStudioV2.filters.searchPlaceholder')}
                        />
                    </div>
                </Field>
                <div className="grid min-w-0 grid-cols-1 gap-2 min-[420px]:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
                    <Select value={kind} onValueChange={value => setKind(value as typeof kind)}>
                        <SelectTrigger aria-label={t('assetModuleStudioV2.filters.kindAria')}><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">{t('assetModuleStudioV2.filters.allKinds')}</SelectItem>
                            {MODULE_KINDS.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <Select value={enabled} onValueChange={value => setEnabled(value as EnabledFilter)}>
                        <SelectTrigger aria-label={t('assetModuleStudioV2.filters.enabledAria')}><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">{t('assetModuleStudioV2.filters.allStates')}</SelectItem>
                            <SelectItem value="enabled">{t('assetModuleStudioV2.common.enabled')}</SelectItem>
                            <SelectItem value="disabled">{t('assetModuleStudioV2.common.disabled')}</SelectItem>
                        </SelectContent>
                    </Select>
                    <Select value={validation} onValueChange={value => setValidation(value as ValidationFilter)}>
                        <SelectTrigger aria-label={t('assetModuleStudioV2.filters.validationAria')}><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">{t('assetModuleStudioV2.filters.allValidation')}</SelectItem>
                            <SelectItem value="valid">{t('assetModuleStudioV2.filters.valid')}</SelectItem>
                            <SelectItem value="warning">{t('assetModuleStudioV2.filters.warnings')}</SelectItem>
                            <SelectItem value="error">{t('assetModuleStudioV2.filters.errors')}</SelectItem>
                        </SelectContent>
                    </Select>
                    <label className="flex min-h-11 min-w-0 items-center gap-2 rounded-control border border-input bg-canvas px-3 text-sm">
                        <input
                            type="checkbox"
                            checked={recentOnly}
                            onChange={event => setRecentOnly(event.currentTarget.checked)}
                            className="h-4 w-4 shrink-0 accent-primary"
                        />
                        <span className="min-w-0 break-words">{t('assetModuleStudioV2.filters.recent')}</span>
                    </label>
                </div>
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-2 border-t border-border px-2 py-1">
                <label className="flex min-h-11 items-center gap-2 px-1 text-xs text-muted-foreground">
                    <input
                        type="checkbox"
                        checked={rows.length > 0 && checkedVisible.length === rows.length}
                        onChange={(event) => setCheckedIds(current => {
                            const next = new Set(current)
                            for (const row of rows) {
                                if (event.currentTarget.checked) next.add(row.module.id)
                                else next.delete(row.module.id)
                            }
                            return next
                        })}
                        className="h-4 w-4 accent-primary"
                    />
                    {t('assetModuleStudioV2.filters.currentResults')}
                </label>
                <span className="mr-auto text-xs text-muted-foreground">{t('assetModuleStudioV2.filters.selected', { count: checkedVisible.length })}</span>
                <Button
                    size="sm"
                    variant="ghost"
                    disabled={checkedVisible.length === 0}
                    onClick={() => onBulkEnabled(checkedVisible, true)}
                >{t('assetModuleStudioV2.actions.enable')}</Button>
                <Button
                    size="sm"
                    variant="ghost"
                    disabled={checkedVisible.length === 0}
                    onClick={() => onBulkEnabled(checkedVisible, false)}
                >{t('assetModuleStudioV2.actions.disable')}</Button>
            </div>

            <FixedVirtualModuleList
                rows={rows}
                selectedId={selectedId}
                checkedIds={checkedIds}
                onSelect={onSelect}
                onCheck={(id, checked) => setCheckedIds(current => {
                    const next = new Set(current)
                    if (checked) next.add(id)
                    else next.delete(id)
                    return next
                })}
                emptyLabel={t('assetModuleStudioV2.filters.empty')}
            />
        </aside>
    )
}

function PromptTargetSelect({
    value,
    document,
    onChange,
}: {
    value: PromptTarget
    document: CompositionDocument
    onChange: (target: PromptTarget) => void
}) {
    const current = promptTargetValue(value)
    const characters = active(document.characters).sort(compareOrder)
    return (
        <Select value={current} onValueChange={next => onChange(promptTargetFromValue(next))}>
            <SelectTrigger aria-label="Prompt target"><SelectValue /></SelectTrigger>
            <SelectContent>
                {POSITIVE_SLOTS.map(slot => (
                    <SelectItem key={slot} value={`positive:${slot}`}>positive · {slot}</SelectItem>
                ))}
                <SelectItem value="negative">negative</SelectItem>
                {characters.map(character => (
                    <SelectItem key={`${character.id}:positive`} value={`character:${character.id}:positive`}>
                        character · {character.name} · positive
                    </SelectItem>
                ))}
                {characters.map(character => (
                    <SelectItem key={`${character.id}:negative`} value={`character:${character.id}:negative`}>
                        character · {character.name} · negative
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}

function PromptContributionsEditor({
    module,
    document,
    onChange,
}: {
    module: CompositionModule
    document: CompositionDocument
    onChange: (module: CompositionModule) => void
}) {
    const { t } = useTranslation()
    const updateContribution = (id: EntityId, updater: (value: PromptContribution) => PromptContribution) => {
        onChange(touched({
            ...module,
            contributions: module.contributions.map(item => item.id === id ? touched(updater(item)) : item),
        }))
    }
    const addContribution = () => {
        const id = newId('contribution')
        const contribution: PromptContribution = {
            ...entityMeta(id, orderKeyFor(module.contributions.length)),
            enabled: true,
            target: { kind: 'positive', slot: 'base' },
            text: '',
            merge: 'append',
            separator: 'comma-space',
        }
        onChange(touched({ ...module, contributions: [...module.contributions, contribution] }))
    }

    return (
        <Section
            title={t('assetModuleStudioV2.contributions.title')}
            description={t('assetModuleStudioV2.contributions.description')}
            actions={<Button size="sm" variant="outline" onClick={addContribution}><Plus className="mr-1.5 h-4 w-4" />{t('assetModuleStudioV2.actions.addContribution')}</Button>}
        >
            {module.contributions.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">{t('assetModuleStudioV2.contributions.empty')}</p>
            ) : (
                <div className="divide-y divide-border">
                    {[...module.contributions].sort(compareOrder).map((contribution, index) => (
                        <div key={contribution.id} className="min-w-0 space-y-3 py-3 first:pt-0">
                            <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.5fr)_minmax(8rem,0.7fr)_minmax(7rem,0.6fr)]">
                                <Field label={t('assetModuleStudioV2.contributions.target')}>
                                    <PromptTargetSelect
                                        value={contribution.target}
                                        document={document}
                                        onChange={target => updateContribution(contribution.id, current => ({ ...current, target }))}
                                    />
                                </Field>
                                <Field label={t('assetModuleStudioV2.contributions.merge')}>
                                    <Select
                                        value={contribution.merge}
                                        onValueChange={merge => updateContribution(contribution.id, current => ({
                                            ...current,
                                            merge: merge as PromptContribution['merge'],
                                        }))}
                                    >
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="append">append</SelectItem>
                                            <SelectItem value="prepend">prepend</SelectItem>
                                            <SelectItem value="replace">replace</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </Field>
                                <Field label={t('assetModuleStudioV2.common.order')}>
                                    <Input
                                        type="number"
                                        value={Number.parseInt(contribution.orderKey, 10) || (index + 1) * 1024}
                                        onChange={event => updateContribution(contribution.id, current => ({
                                            ...current,
                                            orderKey: String(Number(event.currentTarget.value) || 0).padStart(12, '0'),
                                        }))}
                                    />
                                </Field>
                            </div>
                            <Field label={t('assetModuleStudioV2.contributions.text')}>
                                <Textarea
                                    className="min-h-24 min-w-0 font-mono text-xs"
                                    value={contribution.text}
                                    onChange={event => updateContribution(contribution.id, current => ({ ...current, text: event.currentTarget.value }))}
                                />
                            </Field>
                            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                                <label className="flex min-h-11 items-center gap-2 text-sm">
                                    <Switch
                                        checked={contribution.enabled}
                                        onChange={event => updateContribution(contribution.id, current => ({ ...current, enabled: event.currentTarget.checked }))}
                                    />
                                    {t('assetModuleStudioV2.common.enabled')}
                                </label>
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    aria-label={t('assetModuleStudioV2.actions.deleteContribution')}
                                    onClick={() => onChange(touched({
                                        ...module,
                                        contributions: module.contributions.filter(item => item.id !== contribution.id),
                                    }))}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </Section>
    )
}

function ParamsOverrideEditor({
    params,
    document,
    onChange,
}: {
    params: ParamsOverride | undefined
    document: CompositionDocument
    onChange: (params: ParamsOverride) => void
}) {
    const { t } = useTranslation()
    const current = params ?? {}
    const patch = <K extends keyof ParamsOverride>(key: K, value: ParamsOverride[K]) => {
        const next = { ...current, [key]: value }
        if (value === undefined) delete next[key]
        onChange(next)
    }
    const resources = active(document.resources).sort(compareOrder)

    return (
        <Section title={t('assetModuleStudioV2.authoring.paramsTitle')} description={t('assetModuleStudioV2.authoring.paramsDescription')}>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <Field label="Model"><Input value={current.model ?? ''} onChange={event => patch('model', event.currentTarget.value || undefined)} /></Field>
                <Field label="Width"><OptionalNumberInput min={64} step={64} value={current.width} onChange={value => patch('width', value)} /></Field>
                <Field label="Height"><OptionalNumberInput min={64} step={64} value={current.height} onChange={value => patch('height', value)} /></Field>
                <Field label="Steps"><OptionalNumberInput min={1} value={current.steps} onChange={value => patch('steps', value)} /></Field>
                <Field label="CFG scale"><OptionalNumberInput step="0.1" value={current.cfgScale} onChange={value => patch('cfgScale', value)} /></Field>
                <Field label="CFG rescale"><OptionalNumberInput step="0.01" value={current.cfgRescale} onChange={value => patch('cfgRescale', value)} /></Field>
                <Field label="Sampler"><Input value={current.sampler ?? ''} onChange={event => patch('sampler', event.currentTarget.value || undefined)} /></Field>
                <Field label="Scheduler"><Input value={current.scheduler ?? ''} onChange={event => patch('scheduler', event.currentTarget.value || undefined)} /></Field>
                <Field label="Seed"><OptionalNumberInput value={current.seed} onChange={value => patch('seed', value)} /></Field>
                <Field label="UC preset"><OptionalNumberInput min={0} value={current.ucPreset} onChange={value => patch('ucPreset', value)} /></Field>
                <Field label="Source mode">
                    <Select value={current.sourceMode ?? 'inherit'} onValueChange={value => patch('sourceMode', value === 'inherit' ? undefined : value as ParamsOverride['sourceMode'])}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="inherit">Inherit</SelectItem>
                            <SelectItem value="text-to-image">text-to-image</SelectItem>
                            <SelectItem value="image-to-image">image-to-image</SelectItem>
                            <SelectItem value="inpaint">inpaint</SelectItem>
                        </SelectContent>
                    </Select>
                </Field>
                <Field label="Strength"><OptionalNumberInput min={0} max={1} step="0.01" value={current.strength} onChange={value => patch('strength', value)} /></Field>
                <Field label="Noise"><OptionalNumberInput min={0} max={1} step="0.01" value={current.noise} onChange={value => patch('noise', value)} /></Field>
                <Field label="Source image">
                    <Select
                        value={current.sourceImageResourceId ?? 'inherit'}
                        onValueChange={value => patch('sourceImageResourceId', value === 'inherit' ? undefined : value)}
                    >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="inherit">Inherit / none</SelectItem>
                            {resources.map(resource => <SelectItem key={resource.id} value={resource.id}>{resource.id}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </Field>
                <Field label="Mask resource">
                    <Select
                        value={current.maskResourceId ?? 'inherit'}
                        onValueChange={value => patch('maskResourceId', value === 'inherit' ? undefined : value)}
                    >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="inherit">Inherit / none</SelectItem>
                            {resources.map(resource => <SelectItem key={resource.id} value={resource.id}>{resource.id}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </Field>
                <Field label="SMEA"><OptionalBooleanSelect label="SMEA" value={current.smea} onChange={value => patch('smea', value)} /></Field>
                <Field label="SMEA Dynamic"><OptionalBooleanSelect label="SMEA Dynamic" value={current.smeaDyn} onChange={value => patch('smeaDyn', value)} /></Field>
                <Field label="Variety"><OptionalBooleanSelect label="Variety" value={current.variety} onChange={value => patch('variety', value)} /></Field>
                <Field label="Seed locked"><OptionalBooleanSelect label="Seed locked" value={current.seedLocked} onChange={value => patch('seedLocked', value)} /></Field>
                <Field label="Quality tags"><OptionalBooleanSelect label="Quality tags" value={current.qualityToggle} onChange={value => patch('qualityToggle', value)} /></Field>
                <Field label="Character positions"><OptionalBooleanSelect label="Character positions" value={current.characterPositionEnabled} onChange={value => patch('characterPositionEnabled', value)} /></Field>
            </div>
        </Section>
    )
}

function positionForMode(current: CharacterPosition, mode: CharacterPosition['mode']): CharacterPosition {
    if (mode === 'ai-choice') return { mode: 'ai-choice' }
    return current.mode === 'manual' ? current : { mode: 'manual', x: 0.5, y: 0.5 }
}

function CharacterPatchesEditor({
    module,
    document,
    onChange,
}: {
    module: CompositionModule
    document: CompositionDocument
    onChange: (module: CompositionModule) => void
}) {
    const { t } = useTranslation()
    const characters = active(document.characters).sort(compareOrder)
    const updatePatch = (index: number, patch: Partial<CharacterSlotPatch>) => {
        onChange(touched({
            ...module,
            characterPatches: module.characterPatches.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
        }))
    }
    const available = characters.find(character => !module.characterPatches.some(patch => patch.characterId === character.id))

    return (
        <Section
            title={t('assetModuleStudioV2.authoring.characterTitle')}
            description={t('assetModuleStudioV2.authoring.characterDescription')}
            actions={(
                <Button
                    size="sm"
                    variant="outline"
                    disabled={!available}
                    onClick={() => available && onChange(touched({
                        ...module,
                        characterPatches: [
                            ...module.characterPatches,
                            { characterId: available.id, enabled: true, position: { mode: 'ai-choice' } },
                        ],
                    }))}
                >
                    <Plus className="mr-1.5 h-4 w-4" />{t('assetModuleStudioV2.authoring.addCharacter')}
                </Button>
            )}
        >
            {module.characterPatches.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">{t('assetModuleStudioV2.authoring.emptyCharacters')}</p>
            ) : (
                <div className="divide-y divide-border">
                    {module.characterPatches.map((patch, index) => {
                        const position = patch.position ?? { mode: 'ai-choice' as const }
                        return (
                            <div key={`${patch.characterId}:${index}`} className="min-w-0 space-y-3 py-3 first:pt-0">
                                <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                    <Field label="Character stable ID">
                                        <Select value={patch.characterId} onValueChange={characterId => updatePatch(index, { characterId })}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {!characters.some(character => character.id === patch.characterId) && (
                                                    <SelectItem value={patch.characterId}>Missing · {patch.characterId}</SelectItem>
                                                )}
                                                {characters.map(character => <SelectItem key={character.id} value={character.id}>{character.name} · {character.id}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </Field>
                                    <Field label="Position mode">
                                        <Select value={position.mode} onValueChange={mode => updatePatch(index, { position: positionForMode(position, mode as CharacterPosition['mode']) })}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="ai-choice">AI choice</SelectItem>
                                                <SelectItem value="manual">Manual</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </Field>
                                    <div className="flex min-h-11 items-end justify-between gap-2">
                                        <label className="flex min-h-11 items-center gap-2 text-sm">
                                            <Switch checked={patch.enabled !== false} onChange={event => updatePatch(index, { enabled: event.currentTarget.checked })} />
                                            {t('assetModuleStudioV2.common.enabled')}
                                        </label>
                                        <Button size="icon" variant="ghost" aria-label={t('assetModuleStudioV2.authoring.removeCharacter')} onClick={() => onChange(touched({
                                            ...module,
                                            characterPatches: module.characterPatches.filter((_item, itemIndex) => itemIndex !== index),
                                        }))}><Trash2 className="h-4 w-4" /></Button>
                                    </div>
                                </div>
                                {position.mode === 'manual' && (
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <Field label="X (0–1)"><OptionalNumberInput min={0} max={1} step="0.01" value={position.x} onChange={x => updatePatch(index, { position: { ...position, x: x ?? 0.5 } })} /></Field>
                                        <Field label="Y (0–1)"><OptionalNumberInput min={0} max={1} step="0.01" value={position.y} onChange={y => updatePatch(index, { position: { ...position, y: y ?? 0.5 } })} /></Field>
                                    </div>
                                )}
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="Positive override"><Textarea className="min-h-20 font-mono text-xs" value={patch.positivePrompt ?? ''} onChange={event => updatePatch(index, { positivePrompt: event.currentTarget.value || undefined })} /></Field>
                                    <Field label="Negative override"><Textarea className="min-h-20 font-mono text-xs" value={patch.negativePrompt ?? ''} onChange={event => updatePatch(index, { negativePrompt: event.currentTarget.value || undefined })} /></Field>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </Section>
    )
}

function defaultOutputPolicy(): OutputPolicy {
    return {
        destination: { kind: 'filesystem', directory: { kind: 'standard', root: 'pictures', segments: ['NAIS_Output'] } },
        format: 'png',
        filenameTemplate: '{profile}_{seed}_{datetime:YYYYMMDD-HHmmss}',
        metadataMode: 'embedded',
        collisionPolicy: 'unique',
    }
}

function OutputPolicyEditor({ policy, onChange, onRemove }: {
    policy: OutputPolicy | undefined
    onChange: (policy: OutputPolicy) => void
    onRemove: () => void
}) {
    const { t } = useTranslation()
    if (!policy) {
        return (
            <Section title={t('assetModuleStudioV2.authoring.outputTitle')} description={t('assetModuleStudioV2.authoring.outputDescription')}>
                <Button variant="outline" onClick={() => onChange(defaultOutputPolicy())}><Plus className="mr-2 h-4 w-4" />{t('assetModuleStudioV2.authoring.addOutput')}</Button>
            </Section>
        )
    }

    const destination = policy.destination
    const path = destination.kind === 'filesystem' ? destination.directory : null
    return (
        <Section
            title={t('assetModuleStudioV2.authoring.outputTitle')}
            description={t('assetModuleStudioV2.authoring.outputDescription')}
            actions={<Button size="sm" variant="ghost" onClick={onRemove}><Trash2 className="mr-1.5 h-4 w-4" />{t('assetModuleStudioV2.authoring.removeOutput')}</Button>}
        >
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <Field label="Destination">
                    <Select
                        value={destination.kind}
                        onValueChange={kind => onChange({
                            ...policy,
                            destination: kind === 'memory'
                                ? { kind: 'memory' }
                                : { kind: 'filesystem', directory: { kind: 'standard', root: 'pictures', segments: ['NAIS_Output'] } },
                        })}
                    >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="filesystem">filesystem</SelectItem><SelectItem value="memory">memory</SelectItem></SelectContent>
                    </Select>
                </Field>
                <Field label="Format">
                    <Select value={policy.format} onValueChange={format => onChange({ ...policy, format: format as OutputPolicy['format'] })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="png">png</SelectItem><SelectItem value="webp">webp</SelectItem></SelectContent>
                    </Select>
                </Field>
                <Field label="Metadata">
                    <Select value={policy.metadataMode} onValueChange={metadataMode => onChange({ ...policy, metadataMode: metadataMode as OutputPolicy['metadataMode'] })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="embedded">embedded</SelectItem>
                            <SelectItem value="sidecar-only">sidecar-only</SelectItem>
                            <SelectItem value="strip-and-sidecar">strip-and-sidecar</SelectItem>
                        </SelectContent>
                    </Select>
                </Field>
                <Field label="Collision">
                    <Select value={policy.collisionPolicy} onValueChange={collisionPolicy => onChange({ ...policy, collisionPolicy: collisionPolicy as OutputPolicy['collisionPolicy'] })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="unique">unique</SelectItem><SelectItem value="overwrite">overwrite</SelectItem><SelectItem value="error">error</SelectItem></SelectContent>
                    </Select>
                </Field>
                <Field label="Filename template" className="sm:col-span-2">
                    <Input value={policy.filenameTemplate} onChange={event => onChange({ ...policy, filenameTemplate: event.currentTarget.value })} />
                </Field>
                {path && (
                    <>
                        <Field label="Path capability">
                            <Select
                                value={path.kind}
                                onValueChange={kind => onChange({
                                    ...policy,
                                    destination: {
                                        kind: 'filesystem',
                                        directory: kind === 'bookmark'
                                            ? { kind: 'bookmark', bookmarkId: '', segments: [] }
                                            : { kind: 'standard', root: 'pictures', segments: [] },
                                    },
                                })}
                            >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent><SelectItem value="standard">standard</SelectItem><SelectItem value="bookmark">bookmark</SelectItem></SelectContent>
                            </Select>
                        </Field>
                        {path.kind === 'standard' ? (
                            <Field label="Standard root">
                                <Select value={path.root} onValueChange={root => onChange({ ...policy, destination: { kind: 'filesystem', directory: { ...path, root: root as typeof path.root } } })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>{['app-data', 'documents', 'pictures', 'downloads', 'media', 'cache'].map(root => <SelectItem key={root} value={root}>{root}</SelectItem>)}</SelectContent>
                                </Select>
                            </Field>
                        ) : (
                            <Field label="Bookmark ID"><Input value={path.bookmarkId} onChange={event => onChange({ ...policy, destination: { kind: 'filesystem', directory: { ...path, bookmarkId: event.currentTarget.value } } })} /></Field>
                        )}
                        <Field label="Path segments" hint={t('assetModuleStudioV2.authoring.pathSegmentsHint')}>
                            <Input
                                value={path.segments.join('/')}
                                onChange={event => onChange({
                                    ...policy,
                                    destination: {
                                        kind: 'filesystem',
                                        directory: { ...path, segments: event.currentTarget.value.split(/[\\/]+/).filter(Boolean) },
                                    },
                                })}
                            />
                        </Field>
                    </>
                )}
            </div>
        </Section>
    )
}

function defaultRandomRule(index: number): IntegerRangeRandomRule {
    const id = newId('random-rule')
    return {
        ...entityMeta(id, orderKeyFor(index)),
        kind: 'integer-range',
        enabled: true,
        streamKey: id,
        scope: 'parameter',
        source: { mode: 'runtime' },
        min: 0,
        max: 1,
        step: 1,
    }
}

function changeRandomRuleKind(rule: RandomRule, kind: RandomRule['kind']): RandomRule {
    const base = {
        ...entityMeta(rule.id, rule.orderKey),
        revision: rule.revision,
        createdAt: rule.createdAt,
        createdBy: rule.createdBy,
        updatedAt: new Date().toISOString(),
        updatedBy: GUI_ACTOR,
        enabled: rule.enabled,
        streamKey: rule.streamKey,
        scope: rule.scope,
        source: rule.source,
        ...(rule.extensions === undefined ? {} : { extensions: rule.extensions }),
    }
    if (kind === 'choice') return { ...base, kind, options: [], pickCount: 1, withoutReplacement: true }
    if (kind === 'integer-range') return { ...base, kind, min: 0, max: 1, step: 1 }
    if (kind === 'decimal-range') return { ...base, kind, min: 0, max: 1 }
    return { ...base, kind, probability: 0.5 }
}

function randomValueFromInput(type: string, raw: string): RandomScalar {
    if (type === 'number') return Number(raw) || 0
    if (type === 'boolean') return raw === 'true'
    return raw
}

function ChoiceOptionsEditor({ rule, onChange }: { rule: ChoiceRandomRule; onChange: (rule: ChoiceRandomRule) => void }) {
    return (
        <div className="min-w-0 space-y-2 border-l border-border pl-3">
            {rule.options.map((option, index) => {
                const valueType = typeof option.value
                return (
                    <div key={option.id} className="flex min-w-0 flex-wrap items-end gap-2 border-b border-border pb-2">
                        <Field label="Type" className="w-28 shrink-0">
                            <Select
                                value={valueType}
                                onValueChange={type => onChange({
                                    ...rule,
                                    options: rule.options.map(item => item.id === option.id
                                        ? { ...item, value: randomValueFromInput(type, type === 'boolean' ? 'false' : '') }
                                        : item),
                                })}
                            >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent><SelectItem value="string">string</SelectItem><SelectItem value="number">number</SelectItem><SelectItem value="boolean">boolean</SelectItem></SelectContent>
                            </Select>
                        </Field>
                        <Field label="Value" className="min-w-40 flex-1">
                            {valueType === 'boolean' ? (
                                <Select
                                    value={String(option.value)}
                                    onValueChange={raw => onChange({
                                        ...rule,
                                        options: rule.options.map(item => item.id === option.id ? { ...item, value: raw === 'true' } : item),
                                    })}
                                >
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent><SelectItem value="true">true</SelectItem><SelectItem value="false">false</SelectItem></SelectContent>
                                </Select>
                            ) : (
                                <Input
                                    type={valueType === 'number' ? 'number' : 'text'}
                                    value={String(option.value)}
                                    onChange={event => onChange({
                                        ...rule,
                                        options: rule.options.map(item => item.id === option.id
                                            ? { ...item, value: randomValueFromInput(valueType, event.currentTarget.value) }
                                            : item),
                                    })}
                                />
                            )}
                        </Field>
                        <Field label="Weight" className="w-24 shrink-0">
                            <OptionalNumberInput
                                min={0}
                                value={option.weight}
                                onChange={weight => onChange({
                                    ...rule,
                                    options: rule.options.map(item => item.id === option.id ? { ...item, weight: weight ?? 0 } : item),
                                })}
                            />
                        </Field>
                        <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Remove random option"
                            onClick={() => onChange({ ...rule, options: rule.options.filter(item => item.id !== option.id) })}
                        ><Trash2 className="h-4 w-4" /></Button>
                        <span className="sr-only">Option {index + 1}</span>
                    </div>
                )
            })}
            <Button
                size="sm"
                variant="outline"
                onClick={() => onChange({
                    ...rule,
                    options: [...rule.options, {
                        id: newId('random-option'),
                        orderKey: orderKeyFor(rule.options.length),
                        value: '',
                        weight: 1,
                    }],
                })}
            ><Plus className="mr-1.5 h-4 w-4" />Option</Button>
        </div>
    )
}

function RandomRuleEditor({ rule, onChange, onDetach }: {
    rule: RandomRule
    onChange: (rule: RandomRule) => void
    onDetach: () => void
}) {
    const { t } = useTranslation()
    const changeSourceMode = (mode: RandomRule['source']['mode']) => {
        if (mode === 'runtime') onChange(touched({ ...rule, source: { mode } }))
        else if (mode === 'fixed') onChange(touched({ ...rule, source: { mode, seed: 0 } }))
        else if (mode === 'seeded') onChange(touched({ ...rule, source: { mode, seed: 0, algorithm: 'xorshift32-v1' } }))
        else onChange(touched({ ...rule, source: { mode, entries: [] } }))
    }

    return (
        <div className="min-w-0 space-y-3 border-t border-border py-3 first:border-t-0 first:pt-0">
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Field label="Kind">
                    <Select value={rule.kind} onValueChange={kind => onChange(changeRandomRuleKind(rule, kind as RandomRule['kind']))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="choice">choice</SelectItem><SelectItem value="integer-range">integer range</SelectItem><SelectItem value="decimal-range">decimal range</SelectItem><SelectItem value="boolean">boolean</SelectItem></SelectContent>
                    </Select>
                </Field>
                <Field label="Scope">
                    <Select value={rule.scope} onValueChange={scope => onChange(touched({ ...rule, scope: scope as RandomRule['scope'] }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{['generation-seed', 'prompt-wildcard', 'character-rotation', 'filename', 'parameter'].map(scope => <SelectItem key={scope} value={scope}>{scope}</SelectItem>)}</SelectContent>
                    </Select>
                </Field>
                <Field label="Source">
                    <Select value={rule.source.mode} onValueChange={mode => changeSourceMode(mode as RandomRule['source']['mode'])}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="runtime">runtime</SelectItem><SelectItem value="fixed">fixed</SelectItem><SelectItem value="seeded">seeded</SelectItem><SelectItem value="replay">replay</SelectItem></SelectContent>
                    </Select>
                </Field>
                <Field label="Stream key"><Input value={rule.streamKey} onChange={event => onChange(touched({ ...rule, streamKey: event.currentTarget.value }))} /></Field>
            </div>

            {(rule.source.mode === 'fixed' || rule.source.mode === 'seeded') && (
                <Field label="Source seed" className="max-w-48">
                    <OptionalNumberInput value={rule.source.seed} onChange={seed => onChange(touched({ ...rule, source: { ...rule.source, seed: seed ?? 0 } }))} />
                </Field>
            )}

            {rule.kind === 'choice' && (
                <>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Pick count"><OptionalNumberInput min={1} value={rule.pickCount} onChange={pickCount => onChange(touched({ ...rule, pickCount: pickCount ?? 1 }))} /></Field>
                        <Field label="Without replacement"><OptionalBooleanSelect label="Without replacement" value={rule.withoutReplacement} onChange={withoutReplacement => onChange(touched({ ...rule, withoutReplacement: withoutReplacement ?? false }))} /></Field>
                    </div>
                    <ChoiceOptionsEditor rule={rule} onChange={next => onChange(touched(next))} />
                </>
            )}
            {rule.kind === 'integer-range' && (
                <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Min"><OptionalNumberInput value={rule.min} onChange={min => onChange(touched({ ...rule, min: min ?? 0 }))} /></Field>
                    <Field label="Max"><OptionalNumberInput value={rule.max} onChange={max => onChange(touched({ ...rule, max: max ?? 0 }))} /></Field>
                    <Field label="Step"><OptionalNumberInput min={1} value={rule.step} onChange={step => onChange(touched({ ...rule, step: step ?? 1 }))} /></Field>
                </div>
            )}
            {rule.kind === 'decimal-range' && (
                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Min"><OptionalNumberInput step="0.01" value={rule.min} onChange={min => onChange(touched({ ...rule, min: min ?? 0 }))} /></Field>
                    <Field label="Max"><OptionalNumberInput step="0.01" value={rule.max} onChange={max => onChange(touched({ ...rule, max: max ?? 0 }))} /></Field>
                </div>
            )}
            {rule.kind === 'boolean' && (
                <Field label="Probability (0–1)" className="max-w-48"><OptionalNumberInput min={0} max={1} step="0.01" value={rule.probability} onChange={probability => onChange(touched({ ...rule, probability: probability ?? 0 }))} /></Field>
            )}

            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <label className="flex min-h-11 items-center gap-2 text-sm">
                    <Switch checked={rule.enabled} onChange={event => onChange(touched({ ...rule, enabled: event.currentTarget.checked }))} />{t('assetModuleStudioV2.common.enabled')}
                </label>
                <Button size="sm" variant="ghost" onClick={onDetach}><Trash2 className="mr-1.5 h-4 w-4" />{t('assetModuleStudioV2.authoring.detachRule')}</Button>
            </div>
        </div>
    )
}

function RandomRulesEditor({
    module,
    document,
    onModuleChange,
    onDocumentChange,
}: {
    module: CompositionModule
    document: CompositionDocument
    onModuleChange: (module: CompositionModule) => void
    onDocumentChange: (document: CompositionDocument) => void
}) {
    const { t } = useTranslation()
    const [attachId, setAttachId] = useState<string>('none')
    const rules = active(document.randomRules)
    const availableRules = rules.filter(rule => !module.randomRuleIds.includes(rule.id)).sort(compareOrder)
    const attached = module.randomRuleIds.map(id => rules.find(rule => rule.id === id) ?? id)

    const updateRule = (next: RandomRule) => onDocumentChange({
        ...document,
        randomRules: document.randomRules.map(rule => rule.id === next.id ? next : rule),
    })

    return (
        <Section
            title={t('assetModuleStudioV2.authoring.randomTitle')}
            description={t('assetModuleStudioV2.authoring.randomDescription')}
            actions={(
                <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                        const rule = defaultRandomRule(document.randomRules.length)
                        onDocumentChange({
                            ...document,
                            randomRules: [...document.randomRules, rule],
                            modules: document.modules.map(item => item.id === module.id
                                ? touched({ ...item, randomRuleIds: [...item.randomRuleIds, rule.id] })
                                : item),
                        })
                    }}
                ><Plus className="mr-1.5 h-4 w-4" />{t('assetModuleStudioV2.authoring.newRule')}</Button>
            )}
        >
            {availableRules.length > 0 && (
                <div className="mb-3 flex min-w-0 flex-col gap-2 sm:flex-row">
                    <Select value={attachId} onValueChange={setAttachId}>
                        <SelectTrigger className="min-w-0 flex-1" aria-label={t('assetModuleStudioV2.authoring.attachExistingRule')}><SelectValue placeholder={t('assetModuleStudioV2.authoring.existingRule')} /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="none">{t('assetModuleStudioV2.authoring.existingRule')}</SelectItem>
                            {availableRules.map(rule => <SelectItem key={rule.id} value={rule.id}>{rule.streamKey} · {rule.id}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <Button
                        variant="outline"
                        disabled={attachId === 'none'}
                        onClick={() => {
                            if (attachId === 'none') return
                            onModuleChange(touched({ ...module, randomRuleIds: [...module.randomRuleIds, attachId] }))
                            setAttachId('none')
                        }}
                    >{t('assetModuleStudioV2.authoring.attachRule')}</Button>
                </div>
            )}
            {attached.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">{t('assetModuleStudioV2.authoring.emptyRules')}</p>
            ) : attached.map(rule => typeof rule === 'string' ? (
                <div key={rule} className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-border py-3 text-sm text-destructive first:border-t-0">
                    <span className="min-w-0 break-all">{t('assetModuleStudioV2.authoring.missingRule')}: {rule}</span>
                    <Button size="sm" variant="outline" onClick={() => onModuleChange(touched({ ...module, randomRuleIds: module.randomRuleIds.filter(id => id !== rule) }))}>{t('assetModuleStudioV2.authoring.removeReference')}</Button>
                </div>
            ) : (
                <RandomRuleEditor
                    key={rule.id}
                    rule={rule}
                    onChange={updateRule}
                    onDetach={() => onModuleChange(touched({ ...module, randomRuleIds: module.randomRuleIds.filter(id => id !== rule.id) }))}
                />
            ))}
        </Section>
    )
}

function ModuleEditor({
    module,
    document,
    issues,
    onDocumentChange,
    onDelete,
}: {
    module: CompositionModule
    document: CompositionDocument
    issues: readonly StudioIssue[]
    onDocumentChange: (document: CompositionDocument) => void
    onDelete: (module: CompositionModule) => void
}) {
    const { t } = useTranslation()
    const onModuleChange = (next: CompositionModule) => onDocumentChange({
        ...document,
        modules: document.modules.map(item => item.id === next.id ? next : item),
    })
    const relatedIssues = issues.filter(issue => issue.entityRef?.kind === 'module' && issue.entityRef.id === module.id)

    return (
        <div className="min-w-0">
            <Section
                title={t('assetModuleStudioV2.module.identity')}
                description={module.id}
                actions={<Button size="sm" variant="destructive" onClick={() => onDelete(module)}><Trash2 className="mr-1.5 h-4 w-4" />{t('assetModuleStudioV2.actions.delete')}</Button>}
            >
                <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.5fr)_minmax(10rem,0.7fr)_minmax(8rem,0.5fr)]">
                    <Field label={t('assetModuleStudioV2.common.name')}>
                        <Input value={module.name} onChange={event => onModuleChange(touched({ ...module, name: event.currentTarget.value }))} />
                    </Field>
                    <Field label={t('assetModuleStudioV2.common.kind')}>
                        <Select value={module.kind} onValueChange={kind => onModuleChange(touched({ ...module, kind: kind as CompositionModuleKind }))}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>{MODULE_KINDS.map(kind => <SelectItem key={kind} value={kind}>{kind}</SelectItem>)}</SelectContent>
                        </Select>
                    </Field>
                    <Field label={t('assetModuleStudioV2.common.order')}>
                        <Input
                            type="number"
                            value={Number.parseInt(module.orderKey, 10) || 0}
                            onChange={event => onModuleChange(touched({ ...module, orderKey: String(Number(event.currentTarget.value) || 0).padStart(12, '0') }))}
                        />
                    </Field>
                </div>
                <label className="mt-3 flex min-h-11 w-fit items-center gap-2 text-sm">
                    <Switch checked={module.enabled} onChange={event => onModuleChange(touched({ ...module, enabled: event.currentTarget.checked }))} />{t('assetModuleStudioV2.common.enabled')}
                </label>
            </Section>

            <PromptContributionsEditor module={module} document={document} onChange={onModuleChange} />
            <ParamsOverrideEditor params={module.paramsOverride} document={document} onChange={paramsOverride => onModuleChange(touched({ ...module, paramsOverride }))} />
            <CharacterPatchesEditor module={module} document={document} onChange={onModuleChange} />
            <OutputPolicyEditor
                policy={module.outputPolicy}
                onChange={outputPolicy => onModuleChange(touched({ ...module, outputPolicy }))}
                onRemove={() => {
                    const next = { ...module }
                    delete next.outputPolicy
                    onModuleChange(touched(next))
                }}
            />
            <RandomRulesEditor
                module={module}
                document={document}
                onModuleChange={onModuleChange}
                onDocumentChange={onDocumentChange}
            />

            <Section title={t('assetModuleStudioV2.module.validationState')} description={t('assetModuleStudioV2.header.totalIssues', { count: relatedIssues.length })}>
                {relatedIssues.length === 0 ? (
                    <div className="flex items-center gap-2 text-sm text-success"><Check className="h-4 w-4" />{t('assetModuleStudioV2.module.valid')}</div>
                ) : (
                    <ul className="space-y-2">
                        {relatedIssues.map((issue, index) => (
                            <li key={`${issue.code}:${index}`} className={cn(
                                'flex min-w-0 items-start gap-2 border-l-2 py-1 pl-3 text-sm',
                                issue.severity === 'error' ? 'border-destructive text-destructive' : 'border-warning text-foreground',
                            )}>
                                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                                <span className="min-w-0 break-words">
                                    <span className="font-mono text-xs">{issue.code}</span> · {issue.messageKey}
                                    <span className="block break-all text-[11px] text-muted-foreground">{issue.fieldPath.join('.')}</span>
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </Section>
        </div>
    )
}

function normalizeStepOrder(steps: readonly RecipeStep[]): RecipeStep[] {
    return steps.map((step, index) => touched({ ...step, orderKey: orderKeyFor(index) }))
}

function SortableRecipeStep({
    step,
    modules,
    index,
    count,
    onChange,
    onMove,
    onRemove,
}: {
    step: RecipeStep
    modules: readonly CompositionModule[]
    index: number
    count: number
    onChange: (step: RecipeStep) => void
    onMove: (from: number, to: number) => void
    onRemove: () => void
}) {
    const { t } = useTranslation()
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id })
    const missing = !modules.some(module => module.id === step.moduleId)
    return (
        <div
            ref={setNodeRef}
            style={{ transform: CSS.Transform.toString(transform), transition }}
            className={cn('flex min-w-0 flex-wrap items-center gap-2 border-b border-border py-2', isDragging && 'opacity-50')}
            data-testid="recipe-step"
        >
            <button
                type="button"
                {...attributes}
                {...listeners}
                className="flex h-11 w-11 shrink-0 cursor-grab items-center justify-center rounded-control text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                aria-label={t('assetModuleStudioV2.recipe.moveStep', { index: index + 1 })}
            ><GripVertical className="h-4 w-4" /></button>
            <div className="min-w-[min(100%,15rem)] flex-1">
                <Select value={step.moduleId} onValueChange={moduleId => onChange(touched({ ...step, moduleId }))}>
                    <SelectTrigger className={cn('min-w-0', missing && 'border-destructive')} aria-label={t('assetModuleStudioV2.recipe.stepModule', { index: index + 1 })}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {missing && <SelectItem value={step.moduleId}>{t('assetModuleStudioV2.common.missing')} · {step.moduleId}</SelectItem>}
                        {modules.map(module => <SelectItem key={module.id} value={module.id}>{module.name} · {module.id}</SelectItem>)}
                    </SelectContent>
                </Select>
                {missing && <p className="mt-1 break-all text-[11px] text-destructive">{t('assetModuleStudioV2.recipe.missingReference')}</p>}
            </div>
            <label className="flex min-h-11 items-center gap-1 text-xs">
                <Switch checked={step.enabled} onChange={event => onChange(touched({ ...step, enabled: event.currentTarget.checked }))} />
                {t('assetModuleStudioV2.common.enabled')}
            </label>
            <div className="flex shrink-0 items-center gap-1" aria-label={t('assetModuleStudioV2.recipe.moveControls')}>
                <Button size="icon" variant="ghost" disabled={index === 0} aria-label={t('assetModuleStudioV2.recipe.moveUp')} onClick={() => onMove(index, index - 1)}><ArrowUp className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" disabled={index === count - 1} aria-label={t('assetModuleStudioV2.recipe.moveDown')} onClick={() => onMove(index, index + 1)}><ArrowDown className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" aria-label={t('assetModuleStudioV2.recipe.removeStep')} onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>
            </div>
        </div>
    )
}

function RecipeEditor({ document, onDocumentChange }: {
    document: CompositionDocument
    onDocumentChange: (document: CompositionDocument) => void
}) {
    const { t } = useTranslation()
    const recipes = active(document.recipes).sort(compareOrder)
    const modules = active(document.modules).sort(compareOrder)
    const [selectedRecipeId, setSelectedRecipeId] = useState<EntityId>(recipes[0]?.id ?? '')
    const recipe = recipes.find(item => item.id === selectedRecipeId) ?? recipes[0]
    const steps = recipe ? active(recipe.steps).sort(compareOrder) : []
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    )

    useEffect(() => {
        if (!recipes.some(item => item.id === selectedRecipeId)) setSelectedRecipeId(recipes[0]?.id ?? '')
    }, [recipes, selectedRecipeId])

    const updateRecipe = (next: CompositionRecipe) => onDocumentChange({
        ...document,
        recipes: document.recipes.map(item => item.id === next.id ? next : item),
    })
    const updateOrderedSteps = (ordered: RecipeStep[]) => {
        if (!recipe) return
        const normalized = normalizeStepOrder(ordered)
        const byId = new Map(normalized.map(step => [step.id, step]))
        updateRecipe(touched({ ...recipe, steps: recipe.steps.map(step => byId.get(step.id) ?? step) }))
    }
    const move = (from: number, to: number) => {
        if (to < 0 || to >= steps.length || from === to) return
        updateOrderedSteps(arrayMove(steps, from, to))
    }
    const onDragEnd = (event: DragEndEvent) => {
        if (!event.over || event.active.id === event.over.id) return
        const from = steps.findIndex(step => step.id === event.active.id)
        const to = steps.findIndex(step => step.id === event.over?.id)
        if (from >= 0 && to >= 0) move(from, to)
    }

    return (
        <div className="min-w-0">
            <Section title={t('assetModuleStudioV2.recipe.title')} description={t('assetModuleStudioV2.recipe.description')}>
                {recipes.length > 0 && (
                    <Field label={t('assetModuleStudioV2.recipe.recipe')}>
                        <Select value={recipe?.id ?? ''} onValueChange={setSelectedRecipeId}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>{recipes.map(item => <SelectItem key={item.id} value={item.id}>{item.name} · {item.id}</SelectItem>)}</SelectContent>
                        </Select>
                    </Field>
                )}
            </Section>
            {!recipe ? (
                <p className="py-8 text-center text-sm text-muted-foreground">{t('assetModuleStudioV2.recipe.empty')}</p>
            ) : (
                <>
                    <Section title={t('assetModuleStudioV2.recipe.identity')}>
                        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                            <Field label={t('assetModuleStudioV2.common.name')}><Input value={recipe.name} onChange={event => updateRecipe(touched({ ...recipe, name: event.currentTarget.value }))} /></Field>
                            <label className="flex min-h-11 items-end gap-2 text-sm"><Switch checked={recipe.enabled} onChange={event => updateRecipe(touched({ ...recipe, enabled: event.currentTarget.checked }))} />{t('assetModuleStudioV2.common.enabled')}</label>
                        </div>
                    </Section>
                    <Section
                        title={t('assetModuleStudioV2.recipe.orderedSteps')}
                        description={t('assetModuleStudioV2.recipe.orderedStepsDescription')}
                        actions={(
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={modules.length === 0}
                                onClick={() => {
                                    const id = newId('recipe-step')
                                    const step: RecipeStep = {
                                        ...entityMeta(id, orderKeyFor(steps.length)),
                                        moduleId: modules[0].id,
                                        enabled: true,
                                        contributions: [],
                                        characterPatches: [],
                                        resourceBindings: [],
                                        randomRuleIds: [],
                                    }
                                    updateRecipe(touched({ ...recipe, steps: [...recipe.steps, step] }))
                                }}
                            ><Plus className="mr-1.5 h-4 w-4" />{t('assetModuleStudioV2.actions.addStep')}</Button>
                        )}
                    >
                        <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                            onDragEnd={onDragEnd}
                        >
                            <SortableContext items={steps.map(step => step.id)} strategy={verticalListSortingStrategy}>
                                <div className="min-w-0 border-t border-border">
                                    {steps.map((step, index) => (
                                        <SortableRecipeStep
                                            key={step.id}
                                            step={step}
                                            modules={modules}
                                            index={index}
                                            count={steps.length}
                                            onChange={next => updateRecipe(touched({
                                                ...recipe,
                                                steps: recipe.steps.map(item => item.id === next.id ? next : item),
                                            }))}
                                            onMove={move}
                                            onRemove={() => updateRecipe(touched({
                                                ...recipe,
                                                steps: recipe.steps.map(item => item.id === step.id
                                                    ? touched({ ...item, deletedAt: new Date().toISOString() })
                                                    : item),
                                            }))}
                                        />
                                    ))}
                                </div>
                            </SortableContext>
                        </DndContext>
                    </Section>
                    <ParamsOverrideEditor params={recipe.paramsOverride} document={document} onChange={paramsOverride => updateRecipe(touched({ ...recipe, paramsOverride }))} />
                    <OutputPolicyEditor
                        policy={recipe.outputPolicy}
                        onChange={outputPolicy => updateRecipe(touched({ ...recipe, outputPolicy }))}
                        onRemove={() => {
                            const next = { ...recipe }
                            delete next.outputPolicy
                            updateRecipe(touched(next))
                        }}
                    />
                </>
            )}
        </div>
    )
}

function IssueList({ issues }: { issues: readonly StudioIssue[] }) {
    const { t } = useTranslation()
    if (issues.length === 0) return <div className="flex items-center gap-2 text-sm text-success"><Check className="h-4 w-4" />{t('assetModuleStudioV2.preview.noIssues')}</div>
    return (
        <ul className="space-y-2">
            {issues.map((issue, index) => (
                <li key={`${issue.code}:${issue.fieldPath.join('.')}:${index}`} className={cn(
                    'flex min-w-0 items-start gap-2 border-l-2 py-1 pl-3 text-sm',
                    issue.severity === 'error' ? 'border-destructive text-destructive' : 'border-warning text-foreground',
                )}>
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="min-w-0 break-words">
                        <span className="font-mono text-xs">{issue.code}</span> · {issue.messageKey}
                        <span className="block break-all text-[11px] text-muted-foreground">{issue.fieldPath.join('.')}</span>
                    </span>
                </li>
            ))}
        </ul>
    )
}

function ResolvedPreview({
    preview,
    previewErrors,
}: {
    preview?: DeepReadonly<CompositionEnginePlan> | null
    previewErrors: readonly DeepReadonly<CompositionEngineIssue>[]
}) {
    const { t } = useTranslation()
    if (!preview) {
        return (
            <div className="min-w-0">
                <Section title={t('assetModuleStudioV2.preview.title')} description={t('assetModuleStudioV2.preview.description')}>
                    <div className="border-l-2 border-info py-2 pl-3 text-sm text-muted-foreground">
                        {t('assetModuleStudioV2.preview.unavailable')}
                    </div>
                </Section>
                {previewErrors.length > 0 && <Section title={t('assetModuleStudioV2.preview.resolutionErrors')}><IssueList issues={previewErrors} /></Section>}
            </div>
        )
    }

    const paramWinners = new Map<string, DeepReadonly<(typeof preview.provenanceDetails.params)[number]['winner']['sourceRef']>>(
        preview.provenanceDetails.params.map(item => [item.field, item.winner.sourceRef]),
    )
    return (
        <div className="min-w-0">
            <Section title={t('assetModuleStudioV2.preview.title')} description={`${preview.engineVersion} · ${t('assetModuleStudioV2.common.revision')} ${preview.documentRevision} · ${preview.planHash.digest}`}>
                <div className="grid min-w-0 gap-3 lg:grid-cols-2">
                    <Field label={t('assetModuleStudioV2.preview.positive')}>
                        <Textarea readOnly className="min-h-32 font-mono text-xs" value={preview.positivePrompt} />
                    </Field>
                    <Field label={t('assetModuleStudioV2.preview.negative')}>
                        <Textarea readOnly className="min-h-32 font-mono text-xs" value={preview.negativePrompt} />
                    </Field>
                </div>
            </Section>
            <Section title={t('assetModuleStudioV2.preview.slotBreakdown')}>
                <div className="divide-y divide-border border-y border-border">
                    {Object.entries(preview.promptParts).filter(([key]) => key !== 'extensions').map(([slot, text]) => (
                        <div key={slot} className="grid min-w-0 gap-1 py-2 sm:grid-cols-[8rem_minmax(0,1fr)]">
                            <span className="text-xs font-medium text-muted-foreground">{slot}</span>
                            <span className="min-w-0 whitespace-pre-wrap break-words font-mono text-xs">{String(text || '—')}</span>
                        </div>
                    ))}
                </div>
            </Section>
            <Section title={t('assetModuleStudioV2.preview.characters')}>
                {preview.characters.length === 0 ? <p className="text-sm text-muted-foreground">{t('assetModuleStudioV2.preview.noCharacters')}</p> : (
                    <div className="divide-y divide-border border-y border-border">
                        {preview.characters.map(character => (
                            <div key={character.characterId} className="min-w-0 py-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="break-all font-mono text-xs">{character.characterId}</span>
                                    <span className="text-xs text-muted-foreground">{character.enabled ? t('assetModuleStudioV2.common.enabled') : t('assetModuleStudioV2.common.disabled')} · {character.position.mode}</span>
                                </div>
                                <p className="mt-2 whitespace-pre-wrap break-words text-xs">+ {character.positive || '—'}</p>
                                <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">− {character.negative || '—'}</p>
                            </div>
                        ))}
                    </div>
                )}
            </Section>
            <Section title={t('assetModuleStudioV2.preview.paramsWinner')}>
                <div className="grid min-w-0 gap-x-4 sm:grid-cols-2 xl:grid-cols-3">
                    {Object.entries(preview.params).map(([field, value]) => {
                        const winner = paramWinners.get(field) ?? paramWinners.get(`params.${field}`)
                        return (
                            <div key={field} className="min-w-0 border-b border-border py-2">
                                <div className="flex min-w-0 items-center justify-between gap-2">
                                    <span className="text-xs text-muted-foreground">{field}</span>
                                    <span className="break-all font-mono text-xs">{String(value)}</span>
                                </div>
                                {winner && <div className="mt-1 truncate text-[11px] text-primary" title={sourceLabel(winner)}>{sourceLabel(winner)}</div>}
                            </div>
                        )
                    })}
                </div>
            </Section>
            <Section title={t('assetModuleStudioV2.preview.output')}>
                <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                    <div className="border-b border-border py-2 text-sm"><span className="text-muted-foreground">format · </span>{preview.outputPolicy.format}</div>
                    <div className="border-b border-border py-2 text-sm"><span className="text-muted-foreground">metadata · </span>{preview.outputPolicy.metadataMode}</div>
                    <div className="min-w-0 border-b border-border py-2 text-sm"><span className="text-muted-foreground">collision · </span>{preview.outputPolicy.collisionPolicy}</div>
                    <div className="min-w-0 break-all border-b border-border py-2 font-mono text-xs"><span className="font-sans text-muted-foreground">template · </span>{preview.outputPolicy.filenameTemplate}</div>
                </div>
            </Section>
            <Section title={t('assetModuleStudioV2.preview.warningsErrors')}><IssueList issues={[...preview.issues, ...previewErrors]} /></Section>
            <Section title={t('assetModuleStudioV2.preview.randomTrace')}>
                {preview.randomTrace.length === 0 ? <p className="text-sm text-muted-foreground">{t('assetModuleStudioV2.preview.noRandomDraws')}</p> : (
                    <div className="divide-y divide-border border-y border-border">
                        {preview.randomTrace.map((trace, index) => (
                            <div key={`${trace.ruleId}:${trace.drawIndex}:${index}`} className="grid min-w-0 gap-1 py-2 text-xs sm:grid-cols-[minmax(8rem,1fr)_6rem_minmax(5rem,1fr)]">
                                <span className="min-w-0 break-all font-mono">{trace.ruleId}</span>
                                <span>draw {trace.drawIndex}</span>
                                <span className="min-w-0 break-all text-right font-mono">{String(trace.result)}</span>
                            </div>
                        ))}
                    </div>
                )}
            </Section>
            <Section title={t('assetModuleStudioV2.preview.provenance')}>
                <div className="space-y-1 text-xs">
                    {preview.provenance.map((source, index) => (
                        <div key={`${sourceLabel(source)}:${index}`} className="min-w-0 break-all border-b border-border py-2 font-mono">
                            {source.kind} · {sourceLabel(source)}
                        </div>
                    ))}
                </div>
            </Section>
        </div>
    )
}

function displayConflictValue(value: unknown): string {
    if (value === undefined) return '—'
    if (typeof value === 'string') return value
    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value)
    }
}

function ConflictPanel({ conflicts, onResolve }: {
    conflicts: readonly CompositionStudioConflict[]
    onResolve: (path: string, choice: ConflictChoice) => void
}) {
    const { t } = useTranslation()
    if (conflicts.length === 0) return null
    return (
        <section className="min-w-0 rounded-panel border border-warning bg-card" aria-label={t('assetModuleStudioV2.conflict.aria')}>
            <div className="flex min-w-0 items-start gap-3 border-b border-border p-3">
                <GitMerge className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
                <div className="min-w-0">
                    <h2 className="text-base font-semibold">{t('assetModuleStudioV2.conflict.title')}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">{t('assetModuleStudioV2.conflict.description')}</p>
                </div>
            </div>
            <div className="divide-y divide-border">
                {conflicts.map(conflict => (
                    <div key={conflict.path} className="min-w-0 p-3">
                        <div className="mb-2 break-all font-mono text-xs font-semibold">{conflict.path}</div>
                        <div className="grid min-w-0 gap-2 lg:grid-cols-4">
                            {([
                                [t('assetModuleStudioV2.conflict.base'), conflict.base],
                                [t('assetModuleStudioV2.conflict.local'), conflict.local],
                                [t('assetModuleStudioV2.conflict.external'), conflict.external],
                                [t('assetModuleStudioV2.conflict.mergeResult'), conflict.merged],
                            ] as const).map(([label, value]) => (
                                <div key={label} className="min-w-0 border-l border-border pl-2">
                                    <div className="mb-1 text-[11px] font-medium text-muted-foreground">{label}</div>
                                    <pre className="max-h-32 max-w-full overflow-auto whitespace-pre-wrap break-all font-mono text-[11px]">{displayConflictValue(value)}</pre>
                                </div>
                            ))}
                        </div>
                        <div className="mt-3 flex min-w-0 flex-wrap justify-end gap-2">
                            <Button size="sm" variant={conflict.resolution === 'local' ? 'default' : 'outline'} onClick={() => onResolve(conflict.path, 'local')}>{t('assetModuleStudioV2.actions.useLocal')}</Button>
                            <Button size="sm" variant={conflict.resolution === 'external' ? 'default' : 'outline'} onClick={() => onResolve(conflict.path, 'external')}>{t('assetModuleStudioV2.actions.useExternal')}</Button>
                        </div>
                    </div>
                ))}
            </div>
            <div className="flex justify-end border-t border-border p-3">
                <Button
                    onClick={() => onResolve('$merge', 'merged')}
                    disabled={conflicts.some(conflict => conflict.resolution === undefined)}
                >
                    <GitMerge className="mr-2 h-4 w-4" />{t('assetModuleStudioV2.actions.useMerged')}
                </Button>
            </div>
        </section>
    )
}

export function CompositionStudioV2({
    document,
    issues,
    dirty,
    saving,
    error,
    externalDocument,
    conflicts = [],
    preview,
    previewErrors = [],
    onDraftDocument,
    onCommit,
    onUndo,
    onReloadExternal,
    onResolveConflict,
}: CompositionStudioV2Props) {
    const { t } = useTranslation()
    const modules = active(document.modules).sort(compareOrder)
    const [selectedModuleId, setSelectedModuleId] = useState<EntityId | null>(modules[0]?.id ?? null)
    const [recentModuleIds, setRecentModuleIds] = useState<EntityId[]>([])
    const [section, setSection] = useState<StudioSection>('module')
    const selectedModule = modules.find(module => module.id === selectedModuleId) ?? modules[0]
    const blockingIssues = issues.filter(issue => issue.blocking || issue.severity === 'error')
    const externalChanged = externalDocument !== undefined
        && (externalDocument.revision !== document.revision || externalDocument.updatedAt !== document.updatedAt)

    useEffect(() => {
        if (!selectedModule || selectedModule.id === selectedModuleId) return
        setSelectedModuleId(selectedModule.id)
    }, [selectedModule, selectedModuleId])

    const selectModule = (id: EntityId) => {
        setSelectedModuleId(id)
        setRecentModuleIds(current => [id, ...current.filter(item => item !== id)].slice(0, 20))
    }
    const addModule = () => {
        const id = newId('module')
        const next: CompositionModule = {
            ...entityMeta(id, orderKeyFor(document.modules.length)),
            name: t('assetModuleStudioV2.module.newName'),
            enabled: true,
            kind: 'prompt',
            contributions: [],
            characterPatches: [],
            resourceBindings: [],
            randomRuleIds: [],
        }
        const targetProfileId = document.activeProfileId ?? active(document.profiles)[0]?.id
        onDraftDocument({
            ...document,
            modules: [...document.modules, next],
            profiles: document.profiles.map(profile => profile.id === targetProfileId
                ? touched({ ...profile, moduleIds: [...profile.moduleIds, id] })
                : profile),
        })
        selectModule(id)
        setSection('module')
    }
    const deleteModule = (module: CompositionModule) => {
        const deletedAt = new Date().toISOString()
        onDraftDocument({
            ...document,
            modules: document.modules.map(item => item.id === module.id ? touched({ ...item, deletedAt }) : item),
            profiles: document.profiles.map(profile => profile.moduleIds.includes(module.id)
                ? touched({ ...profile, moduleIds: profile.moduleIds.filter(id => id !== module.id) })
                : profile),
            recipes: document.recipes.map(recipe => recipe.steps.some(step => (
                step.moduleId === module.id && step.deletedAt === undefined
            ))
                ? touched({
                    ...recipe,
                    steps: recipe.steps.map(step => step.moduleId === module.id && step.deletedAt === undefined
                        ? touched({ ...step, deletedAt })
                        : step),
                })
                : recipe),
        })
    }
    const bulkEnabled = (ids: readonly EntityId[], enabled: boolean) => {
        const selected = new Set(ids)
        onDraftDocument({
            ...document,
            modules: document.modules.map(module => selected.has(module.id) ? touched({ ...module, enabled }) : module),
        })
    }

    return (
        <div className="mx-auto min-w-0 max-w-[1600px] space-y-3 [&_button]:min-h-11" data-testid="composition-studio-v2">
            <header className="min-w-0 rounded-panel border border-border bg-card p-3 sm:p-4">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <h1 className="break-words text-xl font-semibold sm:text-2xl">{t('assetModuleStudioV2.header.title')}</h1>
                            <span className={cn(
                                'border-l-2 px-2 py-1 text-xs font-medium',
                                dirty ? 'border-warning text-warning' : 'border-success text-success',
                            )}>{dirty ? t('assetModuleStudioV2.header.draftModified') : t('assetModuleStudioV2.header.committed')}</span>
                        </div>
                        <p className="mt-1 break-words text-sm text-muted-foreground">
                            {t('assetModuleStudioV2.header.description')}
                        </p>
                        <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">{document.id} · {t('assetModuleStudioV2.common.revision')} {document.revision}</p>
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Button variant="outline" onClick={onUndo} disabled={!dirty || saving}>
                            <Undo2 className="mr-2 h-4 w-4" />{t('assetModuleStudioV2.actions.undo')}
                        </Button>
                        <Button onClick={() => void Promise.resolve(onCommit()).catch(() => undefined)} disabled={!dirty || saving || blockingIssues.length > 0 || conflicts.some(conflict => !conflict.resolution)}>
                            <Save className="mr-2 h-4 w-4" />{saving ? t('assetModuleStudioV2.actions.saving') : t('assetModuleStudioV2.actions.commit')}
                        </Button>
                    </div>
                </div>
                <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2 border-t border-border pt-3 text-xs">
                    <span className={cn('font-medium', blockingIssues.length > 0 ? 'text-destructive' : 'text-success')}>
                        {blockingIssues.length > 0
                            ? t('assetModuleStudioV2.header.blocking', { count: blockingIssues.length })
                            : t('assetModuleStudioV2.header.validationPassed')}
                    </span>
                    <span className="text-muted-foreground">· {t('assetModuleStudioV2.header.totalIssues', { count: issues.length })}</span>
                </div>
                {error && (
                    <div className="mt-3 border-l-2 border-destructive py-1 pl-3 text-sm text-destructive" role="alert">
                        {error}
                    </div>
                )}
            </header>

            {externalChanged && (
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-panel border border-warning bg-card p-3" role="status">
                    <div className="flex min-w-0 items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                        <span className="min-w-0 break-words text-sm">
                            {t('assetModuleStudioV2.external.detected', {
                                diskRevision: externalDocument.revision,
                                localRevision: document.revision,
                            })}
                            {dirty && ` ${t('assetModuleStudioV2.external.dirtySuffix')}`}
                        </span>
                    </div>
                    <Button variant="outline" onClick={onReloadExternal}><Redo2 className="mr-2 h-4 w-4" />{t('assetModuleStudioV2.actions.reviewExternal')}</Button>
                </div>
            )}

            <ConflictPanel conflicts={conflicts} onResolve={onResolveConflict} />

            <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(17rem,20rem)_minmax(0,1fr)]">
                <ModuleBrowser
                    document={document}
                    issues={issues}
                    selectedId={selectedModule?.id ?? null}
                    recentIds={recentModuleIds}
                    onSelect={id => { selectModule(id); setSection('module') }}
                    onAdd={addModule}
                    onBulkEnabled={bulkEnabled}
                />

                <main className="min-w-0 rounded-panel border border-border bg-card p-3 sm:p-4">
                    <div className="mb-4 grid min-w-0 grid-cols-1 gap-1 border-b border-border pb-3 min-[420px]:grid-cols-3" role="tablist" aria-label={t('assetModuleStudioV2.tabs.aria')}>
                        {([
                            ['module', t('assetModuleStudioV2.tabs.module')],
                            ['recipe', t('assetModuleStudioV2.tabs.recipe')],
                            ['preview', t('assetModuleStudioV2.tabs.preview')],
                        ] as const).map(([value, label]) => (
                            <button
                                key={value}
                                type="button"
                                role="tab"
                                aria-selected={section === value}
                                onClick={() => setSection(value)}
                                className={cn(
                                    'min-h-11 min-w-0 rounded-control px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                    section === value ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                                )}
                            >{label}</button>
                        ))}
                    </div>

                    {section === 'module' && (selectedModule ? (
                        <ModuleEditor
                            module={selectedModule}
                            document={document}
                            issues={issues}
                            onDocumentChange={onDraftDocument}
                            onDelete={deleteModule}
                        />
                    ) : (
                        <div className="py-12 text-center text-sm text-muted-foreground">{t('assetModuleStudioV2.module.emptyEditor')}</div>
                    ))}
                    {section === 'recipe' && <RecipeEditor document={document} onDocumentChange={onDraftDocument} />}
                    {section === 'preview' && <ResolvedPreview preview={preview} previewErrors={previewErrors} />}
                </main>
            </div>
        </div>
    )
}

export default CompositionStudioV2
