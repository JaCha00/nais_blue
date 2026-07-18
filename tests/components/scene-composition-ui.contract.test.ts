import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFile(resolve(process.cwd(), path), 'utf8')

describe('Scene composition minimal UI contract', () => {
    it('keeps internal rollout and recipes out of the simplified Scene surface', async () => {
        const sceneMode = await source('src/pages/SceneMode.tsx')
        const sceneDetail = await source('src/pages/SceneDetail.tsx')
        const editor = await source('src/components/scene/ScenePromptEditor.tsx')

        expect(sceneMode).toContain('<SceneCompositionWorkspace')
        expect(sceneMode).toContain('simplified')
        expect(sceneMode).not.toContain('data-testid="scene-bulk-recipe"')
        expect(sceneDetail).toContain('<ScenePromptEditor')
        expect(editor).toContain("type PromptSlot = keyof ScenePromptConfig")
        expect(editor).toContain("t('scene.copyMainPrompts'")
        expect(sceneMode).toContain('<SceneCompositionCardMeta')
    })

    it('resolves the visible Scene prompt and keeps reset local/store state aligned', async () => {
        const sceneDetail = await source('src/pages/SceneDetail.tsx')
        const sceneBuilder = await source('src/lib/scene-generation/build-scene-params.ts')

        expect(sceneDetail).toContain('<ScenePromptEditor')
        expect(sceneBuilder).toContain('resolveScenePrompts(scene)')
        expect(sceneBuilder).toContain('resolveSceneGeneration(scene)')
        expect(sceneBuilder).toContain('SCENE_DIRECT_RECIPE_ID')
        expect(sceneBuilder).toContain("inpainting: ''")
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

    it('keeps the empty Scene prompt guidance visible at its initial height', async () => {
        const editor = await source('src/components/scene/ScenePromptEditor.tsx')
        const autocomplete = await source('src/components/ui/AutocompleteTextarea.tsx')

        expect(editor).toContain("'h-24 min-h-24 resize-y rounded-control'")
        expect(autocomplete).toContain('.prompt-editor-wrapper textarea::placeholder')
        expect(autocomplete).toContain('-webkit-text-fill-color: oklch(var(--muted-foreground))')
    })

    it('owns resolution per scene and fits every generated preview without cropping', async () => {
        const sceneDetail = await source('src/pages/SceneDetail.tsx')
        const editor = await source('src/components/scene/ScenePromptEditor.tsx')
        const sceneBuilder = await source('src/lib/scene-generation/build-scene-params.ts')

        expect(editor).toContain('data-testid="scene-resolution-selector"')
        expect(editor).toContain('updateSettings(presetId, scene.id')
        expect(sceneBuilder).toContain('width: roundTo64(scene.width ?? 832)')
        expect(sceneBuilder).toContain('height: roundTo64(scene.height ?? 1216)')
        expect(sceneDetail).toContain('style={{ aspectRatio: previewAspectRatio }}')
        expect(sceneDetail).toContain('data-scene-preview-resolution={resolutionLabel}')
        expect(sceneDetail).toContain('className="h-full w-full object-contain"')
        expect(sceneDetail).not.toContain('thumbnailLayout={thumbnailLayout}')
    })
})
