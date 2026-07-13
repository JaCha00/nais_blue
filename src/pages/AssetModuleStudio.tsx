import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isTauri } from '@tauri-apps/api/core'
import { appDataDir, join } from '@tauri-apps/api/path'
import {
    AlertTriangle,
    CheckCircle2,
    FileJson,
    FolderSearch,
    Loader2,
    Plus,
    RefreshCw,
    Rocket,
    Save,
    Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CompositionStudioV2 } from '@/components/asset-module-studio/CompositionStudioV2'
import { CapabilityNotice } from '@/components/platform/CapabilityBadge'
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
import { resolveAssetModulePlan, type AssetModulePlan } from '@/lib/asset-modules/resolver'
import {
    ASSET_PROFILE_FILE_PATH,
} from '@/services/asset-profile-file'
import { previewAssetPlanFromDisk, type AssetPlanPreviewResponse } from '@/services/asset-plan-preview-service'
import { verifyPromptTagsWithDanbooru, type DanbooruTagResult } from '@/services/danbooru-tag-verifier'
import { checkR2DeployScope, startR2DeployJob, type R2DeployJobResponse, type R2ScopeCheckResponse } from '@/services/r2-deploy-service'
import { useAssetModuleStore } from '@/stores/asset-module-store'
import { runtimeCapabilities } from '@/platform/capabilities'
import { useCompositionStudioSession } from '@/hooks/useCompositionStudioSession'
import type {
    AssetModuleProfile,
    AssetProfile,
    AssetProfileOutput,
    AssetProfileR2,
    AssetRecipe,
    AssetRecipeStep,
} from '@/types/asset-profile'

type SaveProfile = (profile: AssetProfile) => void

const DEFAULT_OUTPUT_DIRECTORY = 'NAIS_Output'
const DEFAULT_TEMPLATE = '{profile}_{seed}_{datetime:YYYYMMDD-HHmmss}'

function idStamp(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}`
}

function moduleList(profile: AssetProfile): AssetModuleProfile[] {
    return Object.values(profile.modules).sort((left, right) => left.id.localeCompare(right.id))
}

function activeRecipeId(profile: AssetProfile): string {
    return profile.recipes.find(recipe => recipe.enabled)?.id ?? profile.recipes[0]?.id ?? ''
}

function asOptional(value: string): string | undefined {
    const trimmed = value.trim()
    return trimmed ? trimmed : undefined
}

function updateProfileOutput(profile: AssetProfile, output: Partial<AssetProfileOutput>): AssetProfile {
    return {
        ...profile,
        output: {
            ...profile.output,
            ...output,
        },
    }
}

function updateProfileR2(profile: AssetProfile, r2: Partial<AssetProfileR2>): AssetProfile {
    return {
        ...profile,
        r2: {
            ...profile.r2,
            ...r2,
        },
    }
}

function SectionPanel({
    title,
    subtitle,
    children,
    actions,
    className,
}: {
    title: string
    subtitle?: string
    children: React.ReactNode
    actions?: React.ReactNode
    className?: string
}) {
    return (
        <section className={cn('rounded-lg border border-border/50 bg-card/50', className)}>
            <div className="flex min-w-0 items-start justify-between gap-3 border-b border-border/50 p-3">
                <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold">{title}</h2>
                    {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
                </div>
                {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
            </div>
            <div className="p-3">{children}</div>
        </section>
    )
}

function Field({
    label,
    children,
}: {
    label: string
    children: React.ReactNode
}) {
    return (
        <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{label}</Label>
            {children}
        </div>
    )
}

function WarningList({ warnings }: { warnings: string[] }) {
    if (warnings.length === 0) {
        return (
            <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/20 p-3 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>검산 경고가 없습니다.</span>
            </div>
        )
    }

    return (
        <div className="space-y-2">
            {warnings.map((warning, index) => (
                <div key={`${warning}-${index}`} className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="min-w-0 break-words">{warning}</span>
                </div>
            ))}
        </div>
    )
}

function ModuleList({
    profile,
    selectedModuleId,
    onSelectModule,
    saveProfile,
}: {
    profile: AssetProfile
    selectedModuleId: string
    onSelectModule: (moduleId: string) => void
    saveProfile: SaveProfile
}) {
    const modules = moduleList(profile)
    const selectedModule = profile.modules[selectedModuleId] ?? modules[0]

    const upsert = (module: AssetModuleProfile) => {
        saveProfile({
            ...profile,
            modules: {
                ...profile.modules,
                [module.id]: module,
            },
        })
    }

    const addModule = () => {
        const id = idStamp('module')
        const module: AssetModuleProfile = {
            id,
            enabled: true,
            label: '새 모듈',
            target: 'main.base',
            order: modules.length * 10,
            prompt: '',
            settings: {},
        }
        onSelectModule(id)
        upsert(module)
    }

    const removeModule = (moduleId: string) => {
        const nextModules = { ...profile.modules }
        delete nextModules[moduleId]
        const nextRecipes = profile.recipes.map(recipe => ({
            ...recipe,
            steps: recipe.steps.filter(step => step.moduleId !== moduleId),
        }))
        saveProfile({ ...profile, modules: nextModules, recipes: nextRecipes })
        onSelectModule(Object.keys(nextModules)[0] ?? '')
    }

    return (
        <SectionPanel
            title="Module List"
            subtitle={`${modules.length}개 모듈`}
            actions={(
                <Button size="sm" variant="outline" onClick={addModule}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    추가
                </Button>
            )}
            className="min-h-[360px]"
        >
            <div className="grid gap-3 lg:grid-cols-[minmax(180px,240px)_1fr]">
                <div className="space-y-2">
                    {modules.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                            모듈이 없습니다.
                        </div>
                    ) : modules.map(module => (
                        <button
                            key={module.id}
                            type="button"
                            onClick={() => onSelectModule(module.id)}
                            className={cn(
                                'flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border p-2 text-left transition-colors',
                                selectedModule?.id === module.id
                                    ? 'border-foreground/30 bg-foreground/10'
                                    : 'border-border/50 bg-background/40 hover:bg-muted/40'
                            )}
                        >
                            <span className="min-w-0">
                                <span className="block truncate text-sm font-medium">{module.label || module.id}</span>
                                <span className="block truncate font-mono text-[11px] text-muted-foreground">{module.id}</span>
                            </span>
                            <span className={cn(
                                'rounded-full px-2 py-0.5 text-[11px]',
                                module.enabled ? 'bg-primary/10 text-foreground' : 'bg-muted text-muted-foreground'
                            )}>
                                {module.enabled ? 'on' : 'off'}
                            </span>
                        </button>
                    ))}
                </div>

                {selectedModule ? (
                    <div className="space-y-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Field label="라벨">
                                <Input
                                    value={selectedModule.label ?? ''}
                                    onChange={(event) => upsert({ ...selectedModule, label: event.target.value })}
                                />
                            </Field>
                            <Field label="종류">
                                <Input
                                    value={selectedModule.kind ?? ''}
                                    placeholder="style, character, scene"
                                    onChange={(event) => upsert({ ...selectedModule, kind: asOptional(event.target.value) })}
                                />
                            </Field>
                            <Field label="타겟">
                                <Input
                                    value={selectedModule.target ?? 'main.base'}
                                    onChange={(event) => upsert({ ...selectedModule, target: event.target.value })}
                                />
                            </Field>
                            <Field label="정렬 순서">
                                <Input
                                    type="number"
                                    value={selectedModule.order ?? 0}
                                    onChange={(event) => upsert({ ...selectedModule, order: Number(event.target.value) })}
                                />
                            </Field>
                        </div>

                        <Field label="프롬프트">
                            <Textarea
                                className="min-h-[120px] font-mono text-xs"
                                value={selectedModule.prompt ?? ''}
                                onChange={(event) => upsert({ ...selectedModule, prompt: event.target.value })}
                            />
                        </Field>
                        <Field label="네거티브">
                            <Textarea
                                className="min-h-[72px] font-mono text-xs"
                                value={selectedModule.negativePrompt ?? selectedModule.negative ?? ''}
                                onChange={(event) => upsert({ ...selectedModule, negativePrompt: event.target.value })}
                            />
                        </Field>

                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <label className="flex items-center gap-2 text-sm">
                                <Switch
                                    checked={selectedModule.enabled}
                                    onChange={(event) => upsert({ ...selectedModule, enabled: event.currentTarget.checked })}
                                />
                                활성화
                            </label>
                            <Button size="sm" variant="destructive" onClick={() => removeModule(selectedModule.id)}>
                                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                                삭제
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                        편집할 모듈을 선택하세요.
                    </div>
                )}
            </div>
        </SectionPanel>
    )
}

function RecipeBuilder({
    profile,
    selectedRecipeId,
    onSelectRecipe,
    saveProfile,
}: {
    profile: AssetProfile
    selectedRecipeId: string
    onSelectRecipe: (recipeId: string) => void
    saveProfile: SaveProfile
}) {
    const modules = moduleList(profile)
    const recipe = profile.recipes.find(item => item.id === selectedRecipeId) ?? profile.recipes[0]

    const upsertRecipe = (nextRecipe: AssetRecipe) => {
        const exists = profile.recipes.some(item => item.id === nextRecipe.id)
        saveProfile({
            ...profile,
            recipes: exists
                ? profile.recipes.map(item => item.id === nextRecipe.id ? nextRecipe : item)
                : [...profile.recipes, nextRecipe],
        })
    }

    const addRecipe = () => {
        const id = idStamp('recipe')
        const next: AssetRecipe = {
            id,
            enabled: true,
            label: '새 레시피',
            steps: modules[0] ? [{ moduleId: modules[0].id, enabled: true }] : [],
        }
        onSelectRecipe(id)
        upsertRecipe(next)
    }

    const removeRecipe = (recipeId: string) => {
        const nextRecipes = profile.recipes.filter(item => item.id !== recipeId)
        saveProfile({ ...profile, recipes: nextRecipes })
        onSelectRecipe(nextRecipes[0]?.id ?? '')
    }

    const updateStep = (index: number, patch: Partial<AssetRecipeStep>) => {
        if (!recipe) return
        upsertRecipe({
            ...recipe,
            steps: recipe.steps.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step),
        })
    }

    return (
        <SectionPanel
            title="Recipe Builder"
            subtitle={`${profile.recipes.length}개 레시피`}
            actions={(
                <Button size="sm" variant="outline" onClick={addRecipe}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    추가
                </Button>
            )}
        >
            {profile.recipes.length > 0 && (
                <div className="mb-3">
                    <Select value={recipe?.id ?? ''} onValueChange={onSelectRecipe}>
                        <SelectTrigger>
                            <SelectValue placeholder="레시피 선택" />
                        </SelectTrigger>
                        <SelectContent>
                            {profile.recipes.map(item => (
                                <SelectItem key={item.id} value={item.id}>
                                    {item.label || item.id}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )}

            {recipe ? (
                <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                        <Field label="레시피 라벨">
                            <Input
                                value={recipe.label ?? ''}
                                onChange={(event) => upsertRecipe({ ...recipe, label: event.target.value })}
                            />
                        </Field>
                        <div className="flex items-end gap-3">
                            <label className="flex h-9 items-center gap-2 text-sm">
                                <Switch
                                    checked={recipe.enabled}
                                    onChange={(event) => upsertRecipe({ ...recipe, enabled: event.currentTarget.checked })}
                                />
                                활성화
                            </label>
                            <Button size="sm" variant="destructive" onClick={() => removeRecipe(recipe.id)}>
                                <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    </div>

                    <div className="space-y-2">
                        {recipe.steps.map((step, index) => (
                            <div key={`${step.moduleId}-${index}`} className="grid gap-2 rounded-lg border border-border/50 bg-background/40 p-2 md:grid-cols-[1.2fr_1fr_86px_auto]">
                                <Select
                                    value={step.moduleId}
                                    onValueChange={(value) => updateStep(index, { moduleId: value })}
                                    disabled={modules.length === 0}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="모듈" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {modules.map(module => (
                                            <SelectItem key={module.id} value={module.id}>
                                                {module.label || module.id}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Input
                                    value={step.target ?? ''}
                                    placeholder="step target override"
                                    onChange={(event) => updateStep(index, { target: asOptional(event.target.value) })}
                                />
                                <Input
                                    type="number"
                                    value={step.order ?? ''}
                                    placeholder="order"
                                    onChange={(event) => updateStep(index, { order: event.target.value ? Number(event.target.value) : undefined })}
                                />
                                <div className="flex items-center justify-end gap-2">
                                    <Switch
                                        checked={step.enabled !== false}
                                        onChange={(event) => updateStep(index, { enabled: event.currentTarget.checked })}
                                    />
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => upsertRecipe({ ...recipe, steps: recipe.steps.filter((_item, stepIndex) => stepIndex !== index) })}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>

                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => modules[0] && upsertRecipe({
                            ...recipe,
                            steps: [...recipe.steps, { moduleId: modules[0].id, enabled: true }],
                        })}
                        disabled={modules.length === 0}
                    >
                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                        Step 추가
                    </Button>
                </div>
            ) : (
                <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                    레시피가 없습니다.
                </div>
            )}
        </SectionPanel>
    )
}

function FilenameTemplateEditor({
    profile,
    saveProfile,
}: {
    profile: AssetProfile
    saveProfile: SaveProfile
}) {
    const output = profile.output

    return (
        <SectionPanel title="Filename Template" subtitle="출력 파일명과 sidecar 모드">
            <div className="grid gap-3 md:grid-cols-2">
                <Field label="출력 디렉터리">
                    <Input
                        value={output.directory ?? ''}
                        placeholder={DEFAULT_OUTPUT_DIRECTORY}
                        onChange={(event) => saveProfile(updateProfileOutput(profile, { directory: asOptional(event.target.value) }))}
                    />
                </Field>
                <Field label="파일 형식">
                    <Input
                        value={output.format ?? ''}
                        placeholder="png, webp, jpg"
                        onChange={(event) => saveProfile(updateProfileOutput(profile, { format: asOptional(event.target.value) }))}
                    />
                </Field>
                <Field label="템플릿">
                    <Input
                        value={output.filenameTemplate ?? ''}
                        placeholder={DEFAULT_TEMPLATE}
                        onChange={(event) => saveProfile(updateProfileOutput(profile, { filenameTemplate: asOptional(event.target.value) }))}
                    />
                </Field>
                <Field label="메타데이터 모드">
                    <Select
                        value={output.metadataMode ?? 'embedded'}
                        onValueChange={(value) => saveProfile(updateProfileOutput(profile, { metadataMode: value as AssetProfileOutput['metadataMode'] }))}
                    >
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="embedded">embedded</SelectItem>
                            <SelectItem value="sidecar-only">sidecar-only</SelectItem>
                            <SelectItem value="strip-and-sidecar">strip-and-sidecar</SelectItem>
                        </SelectContent>
                    </Select>
                </Field>
            </div>
        </SectionPanel>
    )
}

function R2DeployPanel({
    profile,
    saveProfile,
    canUseLocalTagger,
}: {
    profile: AssetProfile
    saveProfile: SaveProfile
    canUseLocalTagger: boolean
}) {
    const [localRoot, setLocalRoot] = useState(profile.output.directory ?? DEFAULT_OUTPUT_DIRECTORY)
    const [scope, setScope] = useState<R2ScopeCheckResponse | null>(null)
    const [job, setJob] = useState<R2DeployJobResponse | null>(null)
    const [isChecking, setIsChecking] = useState(false)
    const [isStarting, setIsStarting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const r2 = profile.r2

    const canRun = canUseLocalTagger && Boolean(r2.bucket && localRoot.trim())

    const runScopeCheck = async () => {
        if (!canUseLocalTagger || !r2.bucket) return
        setIsChecking(true)
        setError(null)
        try {
            setScope(await checkR2DeployScope({
                bucket: r2.bucket,
                key_prefix: r2.keyPrefix,
                local_root: localRoot,
                remote_probe: false,
            }))
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught))
        } finally {
            setIsChecking(false)
        }
    }

    const startDryRun = async () => {
        if (!canUseLocalTagger || !r2.bucket) return
        setIsStarting(true)
        setError(null)
        try {
            const started = await startR2DeployJob({
                mode: 'dry-run',
                bucket: r2.bucket,
                key_prefix: r2.keyPrefix,
                local_root: localRoot,
            })
            setJob({
                job_id: started.job_id,
                status: started.status,
                mode: 'dry-run',
                bucket: r2.bucket,
                key_prefix: r2.keyPrefix ?? '',
                total: 0,
                completed: 0,
                failed: 0,
                skipped: 0,
                cancel_requested: false,
                message: started.message,
                error: null,
                started_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                results: [],
            })
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught))
        } finally {
            setIsStarting(false)
        }
    }

    return (
        <SectionPanel title="R2 Deploy Panel" subtitle="자격증명은 Wrangler 프로필 또는 보안 설정에서만 사용">
            <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                    <Field label="Bucket">
                        <Input
                            value={r2.bucket ?? ''}
                            onChange={(event) => saveProfile(updateProfileR2(profile, { bucket: asOptional(event.target.value) }))}
                        />
                    </Field>
                    <Field label="Key prefix">
                        <Input
                            value={r2.keyPrefix ?? ''}
                            onChange={(event) => saveProfile(updateProfileR2(profile, { keyPrefix: asOptional(event.target.value) }))}
                        />
                    </Field>
                    <Field label="Public base URL">
                        <Input
                            value={r2.publicBaseUrl ?? ''}
                            onChange={(event) => saveProfile(updateProfileR2(profile, { publicBaseUrl: asOptional(event.target.value) }))}
                        />
                    </Field>
                    <Field label="Local root">
                        <Input value={localRoot} onChange={(event) => setLocalRoot(event.target.value)} />
                    </Field>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-sm">
                        <Switch
                            checked={r2.enabled}
                            onChange={(event) => saveProfile(updateProfileR2(profile, { enabled: event.currentTarget.checked }))}
                        />
                        R2 활성화
                    </label>
                    <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={runScopeCheck} disabled={!canRun || isChecking}>
                            {isChecking ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FolderSearch className="mr-1.5 h-3.5 w-3.5" />}
                            Scope check
                        </Button>
                        <Button size="sm" variant="outline" onClick={startDryRun} disabled={!canRun || isStarting}>
                            {isStarting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Rocket className="mr-1.5 h-3.5 w-3.5" />}
                            Dry run
                        </Button>
                    </div>
                </div>

                {scope && (
                    <div className="grid gap-2 rounded-lg border border-border/50 bg-background/40 p-3 text-xs md:grid-cols-4">
                        <span>local {scope.total_local}</span>
                        <span>planned {scope.planned}</span>
                        <span>uploaded {scope.manifest_uploaded}</span>
                        <span>changed {scope.manifest_missing_or_changed}</span>
                    </div>
                )}
                {job && (
                    <div className="rounded-lg border border-border/50 bg-background/40 p-3 text-xs">
                        <span className="font-mono">{job.job_id}</span>
                        <span className="ml-2 text-muted-foreground">{job.message}</span>
                    </div>
                )}
                {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">{error}</div>}
            </div>
        </SectionPanel>
    )
}

function PreviewPanel({
    profile,
    selectedRecipeId,
    plan,
    danbooruWarnings,
    isVerifyingTags,
    pythonPreview,
    pythonPreviewPath,
    onRunPythonPreview,
    isRunningPythonPreview,
    canUseLocalTagger,
}: {
    profile: AssetProfile
    selectedRecipeId: string
    plan: AssetModulePlan | null
    danbooruWarnings: string[]
    isVerifyingTags: boolean
    pythonPreview: AssetPlanPreviewResponse | null
    pythonPreviewPath: string
    onRunPythonPreview: () => void
    isRunningPythonPreview: boolean
    canUseLocalTagger: boolean
}) {
    const warnings = [
        ...(plan?.warnings ?? []),
        ...danbooruWarnings,
    ]

    return (
        <SectionPanel
            title="Preview"
            subtitle={`revision ${profile.revision} · ${selectedRecipeId || 'no recipe'}`}
            actions={(
                <Button size="sm" variant="outline" onClick={onRunPythonPreview} disabled={!canUseLocalTagger || !pythonPreviewPath || isRunningPythonPreview}>
                    {isRunningPythonPreview ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileJson className="mr-1.5 h-3.5 w-3.5" />}
                    Python 검산
                </Button>
            )}
        >
            <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-lg border border-border/50 bg-background/40 p-3">
                        <div className="text-xs text-muted-foreground">파일명</div>
                        <div className="mt-1 break-all font-mono text-xs">{plan?.filename ?? '-'}</div>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-background/40 p-3">
                        <div className="text-xs text-muted-foreground">모듈</div>
                        <div className="mt-1 font-mono text-xs">{plan?.modules.length ?? 0}</div>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-background/40 p-3">
                        <div className="text-xs text-muted-foreground">Danbooru</div>
                        <div className="mt-1 text-xs">{isVerifyingTags ? '검증 중' : `${danbooruWarnings.length} warnings`}</div>
                    </div>
                </div>

                <Field label="Final prompt">
                    <Textarea readOnly className="min-h-[120px] font-mono text-xs" value={String(plan?.generationParams.prompt ?? '')} />
                </Field>
                <Field label="Negative prompt">
                    <Textarea readOnly className="min-h-[80px] font-mono text-xs" value={String(plan?.generationParams.negative_prompt ?? '')} />
                </Field>

                <WarningList warnings={warnings} />

                {pythonPreview && (
                    <div className="rounded-lg border border-border/50 bg-background/40 p-3 text-xs">
                        <div className="mb-2 flex items-center gap-2 font-medium">
                            {pythonPreview.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                            Python preview: {pythonPreview.ok ? 'ok' : 'warning'}
                        </div>
                        <div className="break-all font-mono">{pythonPreview.fileName}</div>
                        {pythonPreview.warnings.length > 0 && (
                            <ul className="mt-2 space-y-1 text-muted-foreground">
                                {pythonPreview.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
                            </ul>
                        )}
                    </div>
                )}
            </div>
        </SectionPanel>
    )
}

function danbooruWarningsFromResults(results: DanbooruTagResult[]): string[] {
    return results
        .filter(result => result.status === 'LOW' || result.status === 'GHOST' || result.status === 'ERROR')
        .slice(0, 20)
        .map(result => {
            if (result.status === 'ERROR') return `Danbooru error: ${result.normalized || result.raw}`
            return `${result.status} tag: ${result.normalized || result.raw}`
        })
}

function StudioCapabilityStrip() {
    const { t } = useTranslation()
    const labels = {
        available: t('assetModuleStudioV2.capabilities.available'),
        unavailable: t('assetModuleStudioV2.capabilities.unavailable'),
        alternative: t('assetModuleStudioV2.capabilities.alternative'),
    }
    return (
        <section
            className="min-w-0 border-y border-border py-2"
            aria-label={t('assetModuleStudioV2.capabilities.title')}
            data-testid="asset-studio-capabilities"
            data-runtime-platform={runtimeCapabilities.platform}
        >
            <div className="mb-2 flex min-w-0 flex-wrap items-baseline justify-between gap-2 px-3">
                <h2 className="text-sm font-semibold">{t('assetModuleStudioV2.capabilities.title')}</h2>
                <span className="break-all font-mono text-xs text-muted-foreground">{runtimeCapabilities.platform}</span>
            </div>
            <div className="grid min-w-0 gap-1 md:grid-cols-3">
                <CapabilityNotice
                    label={t('assetModuleStudioV2.capabilities.externalWatch')}
                    capability={runtimeCapabilities.externalProfileFileWatch}
                    labels={labels}
                    reason={t('assetModuleStudioV2.capabilities.externalWatchReason', runtimeCapabilities.externalProfileFileWatch.reason ?? '')}
                    alternative={t('assetModuleStudioV2.capabilities.externalWatchAlternative', runtimeCapabilities.externalProfileFileWatch.alternative ?? '')}
                />
                <CapabilityNotice
                    label={t('assetModuleStudioV2.capabilities.localTagger')}
                    capability={runtimeCapabilities.localTaggerSidecar}
                    labels={labels}
                    reason={t('assetModuleStudioV2.capabilities.localTaggerReason', runtimeCapabilities.localTaggerSidecar.reason ?? '')}
                    alternative={t('assetModuleStudioV2.capabilities.localTaggerAlternative', runtimeCapabilities.localTaggerSidecar.alternative ?? '')}
                />
                <CapabilityNotice
                    label={t('assetModuleStudioV2.capabilities.r2Deploy')}
                    capability={runtimeCapabilities.r2DeployTooling}
                    labels={labels}
                    reason={t('assetModuleStudioV2.capabilities.r2DeployReason', runtimeCapabilities.r2DeployTooling.reason ?? '')}
                    alternative={t('assetModuleStudioV2.capabilities.r2DeployAlternative', runtimeCapabilities.r2DeployTooling.alternative ?? '')}
                />
            </div>
        </section>
    )
}

function LegacyAssetModuleStudio() {
    const profile = useAssetModuleStore(state => state.profile)
    const sourcePath = useAssetModuleStore(state => state.sourcePath)
    const isLoading = useAssetModuleStore(state => state.isLoading)
    const isSaving = useAssetModuleStore(state => state.isSaving)
    const lastError = useAssetModuleStore(state => state.lastError)
    const hasConflict = useAssetModuleStore(state => state.hasConflict)
    const conflictMessage = useAssetModuleStore(state => state.conflictMessage)
    const reloadFromDisk = useAssetModuleStore(state => state.reloadFromDisk)
    const saveToDisk = useAssetModuleStore(state => state.saveToDisk)
    const clearConflictWarning = useAssetModuleStore(state => state.clearConflictWarning)

    const modules = useMemo(() => moduleList(profile), [profile])
    const [selectedModuleId, setSelectedModuleId] = useState('')
    const [selectedRecipeId, setSelectedRecipeId] = useState('')
    const [plan, setPlan] = useState<AssetModulePlan | null>(null)
    const [danbooruWarnings, setDanbooruWarnings] = useState<string[]>([])
    const [isVerifyingTags, setIsVerifyingTags] = useState(false)
    const [pythonPreview, setPythonPreview] = useState<AssetPlanPreviewResponse | null>(null)
    const [pythonPreviewPath, setPythonPreviewPath] = useState('')
    const [isRunningPythonPreview, setIsRunningPythonPreview] = useState(false)
    const canUseLocalTagger = runtimeCapabilities.localTaggerSidecar.supported

    useEffect(() => {
        if (!selectedModuleId && modules[0]) setSelectedModuleId(modules[0].id)
    }, [modules, selectedModuleId])

    useEffect(() => {
        if (!selectedRecipeId) setSelectedRecipeId(activeRecipeId(profile))
    }, [profile, selectedRecipeId])

    useEffect(() => {
        let cancelled = false
        void resolveAssetModulePlan({ profile, recipeId: selectedRecipeId || undefined }).then(nextPlan => {
            if (!cancelled) setPlan(nextPlan)
        })
        return () => {
            cancelled = true
        }
    }, [profile, selectedRecipeId])

    useEffect(() => {
        let cancelled = false
        const prompt = String(plan?.generationParams.prompt ?? '').trim()
        setDanbooruWarnings([])
        if (!prompt || !canUseLocalTagger) return

        const timer = window.setTimeout(() => {
            setIsVerifyingTags(true)
            verifyPromptTagsWithDanbooru(prompt, { okThreshold: 100, fuzzyLimit: 3 })
                .then(result => {
                    if (!cancelled) setDanbooruWarnings(danbooruWarningsFromResults(result.results))
                })
                .catch(error => {
                    if (!cancelled) setDanbooruWarnings([`Danbooru verification failed: ${error instanceof Error ? error.message : String(error)}`])
                })
                .finally(() => {
                    if (!cancelled) setIsVerifyingTags(false)
                })
        }, 700)

        return () => {
            cancelled = true
            window.clearTimeout(timer)
        }
    }, [canUseLocalTagger, plan?.generationParams.prompt])

    useEffect(() => {
        let cancelled = false
        const resolveProfilePath = async () => {
            if (!isTauri()) {
                setPythonPreviewPath('')
                return
            }
            const base = await appDataDir()
            const absolute = await join(base, sourcePath || ASSET_PROFILE_FILE_PATH)
            if (!cancelled) setPythonPreviewPath(absolute)
        }
        void resolveProfilePath()
        return () => {
            cancelled = true
        }
    }, [sourcePath])

    const saveProfile = useCallback<SaveProfile>((nextProfile) => {
        void saveToDisk(nextProfile, 'gui').catch(() => undefined)
    }, [saveToDisk])

    const runPythonPreview = async () => {
        if (!canUseLocalTagger || !pythonPreviewPath) return
        setIsRunningPythonPreview(true)
        try {
            setPythonPreview(await previewAssetPlanFromDisk({
                profilePath: pythonPreviewPath,
                recipeId: selectedRecipeId || undefined,
            }))
        } finally {
            setIsRunningPythonPreview(false)
        }
    }

    return (
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border/50 bg-card/50 p-4">
                <div className="min-w-0">
                    <h1 className="text-2xl font-semibold">Asset Module Studio</h1>
                    <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                        로컬 JSON 프로필을 기준으로 모듈, 레시피, 파일명, R2 배포 범위를 편집합니다.
                    </p>
                    <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{pythonPreviewPath || sourcePath}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => void reloadFromDisk()} disabled={isLoading}>
                        {isLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                        Reload
                    </Button>
                    <Button size="sm" variant="outline" disabled>
                        {isSaving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                        Autosave
                    </Button>
                </div>
            </div>

            {hasConflict && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                    <span>{conflictMessage}</span>
                    <Button size="sm" variant="outline" onClick={clearConflictWarning}>확인</Button>
                </div>
            )}
            {lastError && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                    {lastError}
                </div>
            )}

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)]">
                <div className="space-y-4">
                    <ModuleList
                        profile={profile}
                        selectedModuleId={selectedModuleId}
                        onSelectModule={setSelectedModuleId}
                        saveProfile={saveProfile}
                    />
                    <RecipeBuilder
                        profile={profile}
                        selectedRecipeId={selectedRecipeId}
                        onSelectRecipe={setSelectedRecipeId}
                        saveProfile={saveProfile}
                    />
                </div>
                <div className="space-y-4">
                    <FilenameTemplateEditor profile={profile} saveProfile={saveProfile} />
                    <R2DeployPanel profile={profile} saveProfile={saveProfile} canUseLocalTagger={canUseLocalTagger} />
                    <PreviewPanel
                        profile={profile}
                        selectedRecipeId={selectedRecipeId}
                        plan={plan}
                        danbooruWarnings={danbooruWarnings}
                        isVerifyingTags={isVerifyingTags}
                        pythonPreview={pythonPreview}
                        pythonPreviewPath={pythonPreviewPath}
                        onRunPythonPreview={runPythonPreview}
                        isRunningPythonPreview={isRunningPythonPreview}
                        canUseLocalTagger={canUseLocalTagger}
                    />
                </div>
            </div>
        </div>
    )
}

/** Composition v2 is the authoring authority; legacy tools remain opt-in compatibility utilities. */
export default function AssetModuleStudio() {
    const { t } = useTranslation()
    const studio = useCompositionStudioSession()
    const [showLegacyTools, setShowLegacyTools] = useState(false)

    if (showLegacyTools) {
        return (
            <div className="mx-auto flex w-full max-w-[1600px] min-w-0 flex-col gap-4 overflow-x-hidden">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-border px-1 pb-3">
                    <div className="min-w-0">
                        <h1 className="break-words text-lg font-semibold">{t('assetModuleStudioV2.wrapper.legacyTitle')}</h1>
                        <p className="text-sm text-muted-foreground">
                            {t('assetModuleStudioV2.wrapper.legacyDescription')}
                        </p>
                    </div>
                    <Button className="min-h-11" variant="outline" onClick={() => setShowLegacyTools(false)}>
                        {t('assetModuleStudioV2.wrapper.backToV2')}
                    </Button>
                </div>
                <StudioCapabilityStrip />
                <LegacyAssetModuleStudio />
            </div>
        )
    }

    return (
        <div className="mx-auto flex w-full max-w-[1800px] min-w-0 flex-col gap-3 overflow-x-hidden">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-border px-1 pb-3">
                <div className="min-w-0">
                    <p className="break-words text-sm text-muted-foreground">
                        {t('assetModuleStudioV2.wrapper.authorityCaption')}
                    </p>
                </div>
                <Button className="min-h-11" variant="outline" onClick={() => setShowLegacyTools(true)}>
                    {t('assetModuleStudioV2.wrapper.openLegacy')}
                </Button>
            </div>

            <StudioCapabilityStrip />

            {studio.document === null ? (
                <section className="min-w-0 border border-border bg-card p-4" aria-live="polite">
                    <h1 className="text-xl font-semibold">{t('assetModuleStudioV2.wrapper.pageTitle')}</h1>
                    <p className="mt-2 break-words text-sm text-muted-foreground">
                        {studio.state.status === 'loading'
                            ? t('assetModuleStudioV2.wrapper.loading')
                            : studio.state.lastError ?? t('assetModuleStudioV2.wrapper.unavailable')}
                    </p>
                    <Button className="mt-4 min-h-11" variant="outline" onClick={() => void studio.reload()}>
                        {t('assetModuleStudioV2.wrapper.retry')}
                    </Button>
                </section>
            ) : (
                <CompositionStudioV2
                    document={studio.document}
                    issues={studio.issues}
                    dirty={studio.state.dirty}
                    saving={studio.state.status === 'committing'}
                    error={studio.state.lastError}
                    externalDocument={studio.externalDocument}
                    conflicts={studio.conflicts}
                    preview={studio.preview}
                    previewErrors={studio.previewErrors}
                    onDraftDocument={studio.updateDraft}
                    onCommit={studio.commit}
                    onUndo={studio.undo}
                    onReloadExternal={() => void studio.reloadExternal()}
                    onResolveConflict={studio.resolveConflict}
                />
            )}
        </div>
    )
}
