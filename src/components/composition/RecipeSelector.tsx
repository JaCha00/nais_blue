import { Layers3 } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Label } from '@/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { useAssetModuleStore } from '@/stores/asset-module-store'
import { useGenerationStore } from '@/stores/generation-store'
import {
    getMainDirectRecipeId,
    MAIN_ASSET_SELECTION_PREFIX,
    MAIN_DIRECT_RECIPE_ID,
    MAIN_DIRECT_SELECTION_ID,
    mainAssetRecipeSelectionId,
} from '@/lib/composition/main-adapter'

export function RecipeSelector({
    onChange,
}: {
    onChange?: (recipeId: string) => void
}) {
    const { t } = useTranslation()
    // The selector can move between the desktop command bar and mobile module
    // sheet, so each mounted label relationship needs its own DOM ID.
    const titleId = `main-composition-recipe-title-${useId().replace(/:/g, '')}`
    const recipes = useAssetModuleStore(state => state.profile.recipes)
    const isProfileLoading = useAssetModuleStore(state => state.isLoading)
    const selectedRecipeId = useGenerationStore(state => state.selectedRecipeId)
    const setSelectedRecipeId = useGenerationStore(state => state.setSelectedRecipeId)
    const isGenerating = useGenerationStore(state => state.isGenerating)

    const directRecipeId = getMainDirectRecipeId(recipes)
    const selectableRecipes = recipes
    const automaticRecipeId = selectableRecipes.find(recipe => recipe.enabled)?.id
    const automaticSelectionId = automaticRecipeId === undefined
        ? MAIN_DIRECT_SELECTION_ID
        : mainAssetRecipeSelectionId(automaticRecipeId)
    const displayedRecipeId = selectedRecipeId === null
        ? automaticSelectionId
        : selectedRecipeId === MAIN_DIRECT_SELECTION_ID
            || selectedRecipeId === MAIN_DIRECT_RECIPE_ID
            || selectedRecipeId === directRecipeId
            ? MAIN_DIRECT_SELECTION_ID
            : selectedRecipeId.startsWith(MAIN_ASSET_SELECTION_PREFIX)
                ? selectedRecipeId
                : mainAssetRecipeSelectionId(selectedRecipeId)
    const selectedRecipeExists = displayedRecipeId === MAIN_DIRECT_SELECTION_ID
        || selectableRecipes.some(recipe => mainAssetRecipeSelectionId(recipe.id) === displayedRecipeId)
    const recipeSelectionDisabled = isGenerating || isProfileLoading

    // Keep the recovery option visible when persistence points at a deleted recipe.
    if (recipes.length === 0 && selectedRecipeExists) return null

    return (
        <section
            className="flex-none rounded-control border border-border bg-muted/20 p-3"
            aria-labelledby={titleId}
            data-testid="main-recipe-selector"
        >
            <div className="flex min-w-0 items-center gap-2">
                <Label id={titleId} className="flex min-w-0 items-center gap-2 text-xs font-medium">
                    <Layers3 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate">{t('composition.recipe.title', 'Composition recipe')}</span>
                </Label>
            </div>

            <div className="mt-2">
                <Select
                    value={displayedRecipeId}
                    onValueChange={onChange ?? setSelectedRecipeId}
                    disabled={recipeSelectionDisabled}
                >
                    <SelectTrigger
                        className="h-11 rounded-control"
                        aria-label={t('composition.recipe.select', 'Select recipe')}
                    >
                        <SelectValue placeholder={
                            isProfileLoading
                                ? t('common.loading', 'Loading...')
                                : t('composition.recipe.noneSelected', 'Select a recipe')
                        } />
                    </SelectTrigger>
                    <SelectContent>
                        {!selectedRecipeExists && (
                            <SelectItem value={displayedRecipeId} disabled>
                                {t('composition.recipe.unavailable', '{{id}} (unavailable)', { id: displayedRecipeId })}
                            </SelectItem>
                        )}
                        <SelectItem value={MAIN_DIRECT_SELECTION_ID}>
                            {t('composition.recipe.direct', 'Direct prompts')}
                        </SelectItem>
                        {selectableRecipes.map(recipe => (
                            <SelectItem
                                key={recipe.id}
                                value={mainAssetRecipeSelectionId(recipe.id)}
                                disabled={!recipe.enabled}
                            >
                                {recipe.label || recipe.id}
                                {!recipe.enabled && ` ${t('composition.recipe.disabled', '(disabled)')}`}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
        </section>
    )
}
