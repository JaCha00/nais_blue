import { Layers3 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { useAssetModuleStore } from '@/stores/asset-module-store'
import {
    hasSceneCompositionOverrides,
    type SceneCard,
} from '@/stores/scene-store'
import type { SceneCompositionResolution } from '@/lib/composition/scene-adapter'

function recipeLabel(scene: SceneCard, recipes: ReturnType<typeof useAssetModuleStore.getState>['profile']['recipes']): {
    inherited: boolean
    label: string
} {
    const recipeId = scene.compositionRef?.recipeId
    if (scene.compositionRef?.selectionKind === 'direct') {
        return { inherited: false, label: 'Direct prompts' }
    }

    if (recipeId !== undefined) {
        const recipe = recipes.find(candidate => candidate.id === recipeId)
        return {
            inherited: false,
            label: recipe?.label || recipe?.id || `${recipeId} (unavailable)`,
        }
    }

    const inheritedRecipe = recipes.find(recipe => recipe.enabled)
    return {
        inherited: true,
        label: inheritedRecipe?.label || inheritedRecipe?.id || 'Direct prompts',
    }
}

export function SceneCompositionCardMeta({
    scene,
    hasOverrides = hasSceneCompositionOverrides(scene),
}: {
    scene: SceneCard
    hasOverrides?: boolean
}) {
    const { t } = useTranslation()
    const recipes = useAssetModuleStore(state => state.profile.recipes)
    const recipe = recipeLabel(scene, recipes)

    return (
        <div
            className="mt-1 flex min-w-0 items-center gap-1 px-1 text-[11px] text-muted-foreground"
            data-testid={`scene-composition-summary-${scene.id}`}
        >
            <Layers3 className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="shrink-0">
                {recipe.inherited ? t('scene.composition.inherited', 'Default') : t('scene.composition.recipe', 'Recipe')}
            </span>
            <span className="min-w-0 flex-1 truncate" title={recipe.label}>{recipe.label}</span>
            {hasOverrides && (
                <span
                    className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-medium text-primary"
                    data-testid={`scene-composition-override-${scene.id}`}
                >
                    {t('scene.composition.override', 'Override')}
                </span>
            )}
        </div>
    )
}

export function SceneCompositionPreviewDialog({
    open,
    onOpenChange,
    loading,
    resolution,
    error,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    loading: boolean
    resolution: SceneCompositionResolution | null
    error: string | null
}) {
    const { t } = useTranslation()
    const result = resolution?.result
    const plan = result?.success ? result.plan : null
    const issues = result === undefined ? [] : [...result.errors, ...result.warnings]

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl overflow-hidden p-4 sm:p-5" data-testid="scene-composition-preview-dialog">
                <DialogHeader>
                    <DialogTitle>{t('scene.composition.resolvedTitle', 'Resolved composition')}</DialogTitle>
                </DialogHeader>

                <div className="max-h-[65dvh] space-y-3 overflow-y-auto pr-1 text-xs">
                    {loading && (
                        <p className="text-muted-foreground">{t('common.loading', 'Loading...')}</p>
                    )}
                    {error && (
                        <p className="rounded-control border border-destructive/40 bg-destructive/10 p-2 text-destructive">
                            {error}
                        </p>
                    )}
                    {!loading && !error && result && (
                        <>
                            <section>
                                <h3 className="mb-1 font-semibold">{t('scene.composition.positive', 'Positive')}</h3>
                                <p className="whitespace-pre-wrap break-words rounded-control border border-border bg-muted/20 p-2" data-testid="scene-resolved-positive">
                                    {plan?.positivePrompt || '—'}
                                </p>
                            </section>
                            <section>
                                <h3 className="mb-1 font-semibold">{t('scene.composition.negative', 'Negative')}</h3>
                                <p className="whitespace-pre-wrap break-words rounded-control border border-border bg-muted/20 p-2" data-testid="scene-resolved-negative">
                                    {plan?.negativePrompt || '—'}
                                </p>
                            </section>
                            <section>
                                <h3 className="mb-1 font-semibold">{t('scene.composition.params', 'Parameters')}</h3>
                                <pre className="overflow-x-auto rounded-control border border-border bg-muted/20 p-2 font-mono text-[11px]" data-testid="scene-resolved-params">
                                    {plan ? JSON.stringify(plan.params, null, 2) : '—'}
                                </pre>
                            </section>
                            <section>
                                <h3 className="mb-1 font-semibold">
                                    {t('scene.composition.issues', 'Issues')} ({issues.length})
                                </h3>
                                {issues.length === 0 ? (
                                    <p className="text-muted-foreground">{t('scene.composition.noIssues', 'No issues')}</p>
                                ) : (
                                    <ul className="space-y-1" data-testid="scene-resolved-issues">
                                        {issues.map((issue, index) => (
                                            <li
                                                key={`${issue.code}:${index}`}
                                                className="rounded-control border border-border bg-muted/20 p-2"
                                            >
                                                <span className={issue.severity === 'error' ? 'font-semibold text-destructive' : 'font-semibold text-warning'}>
                                                    {issue.code}
                                                </span>
                                                <span className="ml-2 break-words text-muted-foreground">{issue.messageKey}</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </section>
                            <section>
                                <h3 className="mb-1 font-semibold">{t('scene.composition.planHash', 'Plan hash')}</h3>
                                <code className="block break-all rounded-control border border-border bg-muted/20 p-2" data-testid="scene-resolved-plan-hash">
                                    {plan ? `${plan.planHash.version}:${plan.planHash.digest}` : '—'}
                                </code>
                            </section>
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
