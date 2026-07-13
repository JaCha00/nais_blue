import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFile(resolve(process.cwd(), path), 'utf8')

describe('Scene composition minimal UI contract', () => {
    it('exposes a Scene-only rollout switch and bulk raw-recipe application', async () => {
        const sceneMode = await source('src/pages/SceneMode.tsx')

        expect(sceneMode).toContain("const SCENE_COMPOSITION_MODES: readonly SceneCompositionMode[] = ['legacy', 'shadow', 'v2']")
        expect(sceneMode).toContain('setSceneCompositionMode')
        expect(sceneMode).toContain('disabled={isGenerating}')
        expect(sceneMode).toContain('decodeSceneRecipeSelection(bulkRecipeId)')
        expect(sceneMode).toContain('applyRecipeToSelectedScenes(')
        expect(sceneMode).toContain('assetProfileRevision')
        expect(sceneMode).toContain('sceneAssetRecipeSelectionId(recipe.id)')
        expect(sceneMode).toContain('<SceneCompositionCardMeta')
    })

    it('resolves the visible Scene prompt and keeps reset local/store state aligned', async () => {
        const sceneDetail = await source('src/pages/SceneDetail.tsx')
        const sceneBuilder = await source('src/lib/scene-generation/build-scene-params.ts')

        expect(sceneDetail).toContain('previewSceneComposition(scene, { scenePrompt: localPrompt })')
        expect(sceneDetail).toContain("localPromptRef.current = ''")
        expect(sceneDetail).toContain("setLocalPrompt('')")
        expect(sceneDetail).toContain('resetSceneToRecipe(activePresetId, scene.id)')
        expect(sceneDetail).toContain('decodeSceneRecipeSelection(selectionValue)')
        expect(sceneDetail).toContain('selectionKind: selection.selectionKind')
        expect(sceneDetail).toContain('data-testid="scene-resolved-action"')
        expect(sceneBuilder).toContain('effectiveSceneCompositionMode(useSceneStore.getState().sceneCompositionMode)')
        expect(sceneBuilder).toContain('Composition preview is unavailable while legacy authority is active')
    })

    it('shows the requested resolved summary without mounting Main controls', async () => {
        const controls = await source('src/components/scene/SceneCompositionControls.tsx')

        expect(controls).toContain('plan?.positivePrompt')
        expect(controls).toContain('plan?.negativePrompt')
        expect(controls).toContain('JSON.stringify(plan.params, null, 2)')
        expect(controls).toContain('result.errors')
        expect(controls).toContain('result.warnings')
        expect(controls).toContain('plan.planHash.digest')
        expect(controls).not.toMatch(/RecipeSelector|ResolvedPlanPanel|ValidationBadge/)
    })
})
