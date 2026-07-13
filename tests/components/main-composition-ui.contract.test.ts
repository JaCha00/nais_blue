import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFile(resolve(process.cwd(), path), 'utf8')

describe('Main composition UI contract', () => {
    it('uses the shared three-zone composition workspace while preserving the result canvas', async () => {
        const [mainMode, workspaceLayout] = await Promise.all([
            source('src/pages/MainMode.tsx'),
            source('src/components/composition-workspace/CompositionWorkspaceLayout.tsx'),
        ])

        expect(mainMode).toContain('<CompositionWorkspaceLayout')
        expect(mainMode).toContain('moduleStack={moduleStack}')
        expect(mainMode).toContain('workspaceClassName="rounded-panel border border-border bg-canvas"')
        expect(mainMode).toContain('data-testid="main-result-canvas"')
        expect(mainMode).toContain('<CompositionInspector')
        expect(mainMode).toContain('<ModuleStack')
        expect(workspaceLayout).toContain('2xl:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)_minmax(18rem,24rem)]')
        expect(workspaceLayout).toContain('overflow-x-hidden')
    })

    it('keeps generation and cancellation as the existing store commands with a one-action control', async () => {
        const mainMode = await source('src/pages/MainMode.tsx')

        expect(mainMode).toMatch(/const handlePrimaryGeneration = \(\) => \{[\s\S]*?cancelGeneration\(\)[\s\S]*?generate\(\)/)
        expect(mainMode).toContain("actionTestId: 'main-generate-action'")
        expect(mainMode).toContain('onGenerate: handlePrimaryGeneration')
        expect(mainMode).toContain('onCancel: cancelGeneration')
        expect(mainMode).toContain('<MobileCommandDock')
        expect(mainMode).toContain('safe-area-inset-bottom')
    })

    it('moves compact module, inspector, and resolved content into focus-managed sheets', async () => {
        const mainMode = await source('src/pages/MainMode.tsx')

        expect(mainMode).toContain('testId="main-module-stack-sheet"')
        expect(mainMode).toContain('testId="main-composition-inspector-sheet"')
        expect(mainMode).toContain('testId="main-resolved-plan-sheet"')
        expect(mainMode).toContain('level="secondary"')
        expect(mainMode).toContain('returnFocusRef={moduleSheetTriggerRef}')
        expect(mainMode).toContain('returnFocusRef={inspectorSheetTriggerRef}')
        expect(mainMode).toContain('returnFocusRef={resolvedSheetTriggerRef}')
        expect(mainMode).toContain('inspectorSheetTriggerRef.current = currentTrigger()')
        expect(mainMode).not.toContain('setModuleSheetOpen(false)')
    })

    it('keeps raw prompt authoring behind the existing Prompt sheet compatibility entry', async () => {
        const mainMode = await source('src/pages/MainMode.tsx')

        expect(mainMode).toContain("window.dispatchEvent(new Event(LAYOUT_SHEET_EVENTS.OPEN_PROMPT))")
        expect(mainMode).toContain("t('composition.compatibility.rawPrompt', 'Advanced raw prompt')")
        expect(mainMode).not.toContain('<AutocompleteTextarea')
    })

    it('mounts the composition controls only for the exact Main route', async () => {
        const promptPanel = await source('src/components/layout/PromptPanel.tsx')

        expect(promptPanel).toContain("const isMainMode = location.pathname === '/'")
        expect(promptPanel).toMatch(/\{isMainMode\s*&&\s*\([\s\S]*?<RecipeSelector\s*\/>[\s\S]*?<ResolvedPlanPanel\s*\/>/)
        expect(promptPanel).toContain('<AutocompleteTextarea')
        expect(promptPanel).toContain('data-testid="prompt-generate-action"')
    })

    it('does not connect the Main composition controls to Scene or Style Lab', async () => {
        const [sceneMode, sceneDetail, styleLab] = await Promise.all([
            source('src/pages/SceneMode.tsx'),
            source('src/pages/SceneDetail.tsx'),
            source('src/pages/StyleLab.tsx'),
        ])

        for (const page of [sceneMode, sceneDetail, styleLab]) {
            expect(page).not.toMatch(/RecipeSelector|ResolvedPlanPanel|ValidationBadge/)
        }
    })

    it('offers the stable direct recipe and mirrors the adapter automatic-selection policy', async () => {
        const recipeSelector = await source('src/components/composition/RecipeSelector.tsx')

        expect(recipeSelector).toContain('getMainDirectRecipeId')
        expect(recipeSelector).toContain('MAIN_DIRECT_SELECTION_ID')
        expect(recipeSelector).toContain('mainAssetRecipeSelectionId')
        expect(recipeSelector).toContain('const displayedRecipeId = selectedRecipeId === null')
        expect(recipeSelector).toContain("t('composition.recipe.direct', 'Direct prompts')")
    })
})
