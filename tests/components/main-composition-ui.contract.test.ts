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
        expect(workspaceLayout).toContain("desktopRails && '2xl:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)_minmax(18rem,24rem)]'")
        expect(mainMode).toContain('desktopRails={false}')
        expect(workspaceLayout).toContain('overflow-x-hidden')
    })

    it('routes the one-action generation control through the durable command with legacy rollback', async () => {
        const [mainMode, command] = await Promise.all([
            source('src/pages/MainMode.tsx'),
            source('src/services/generation/generation-command.ts'),
        ])

        expect(mainMode).toMatch(/const handlePrimaryGeneration = \(\) => \{[\s\S]*?cancelMainGenerationCommand\(\)[\s\S]*?startMainGenerationCommand\(\)/)
        expect(mainMode).toContain("actionTestId: 'main-generate-action'")
        expect(mainMode).toContain('onGenerate: handlePrimaryGeneration')
        expect(mainMode).toContain('onCancel: () => void cancelMainGenerationCommand()')
        expect(mainMode).toContain('<MobileCommandDock')
        expect(mainMode).toContain('safe-area-inset-bottom')
        expect(command).toContain("executionAuthority === 'legacy'")
        expect(command).toContain("return 'low-quality-steps'")
        expect(command).toContain('await generation.generate()')
        expect(command).toContain('enqueueCurrentMainBatch()')
        expect(mainMode).toContain("outcome !== 'low-quality-steps'")
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

    it('hands a selected module from its sheet to the Inspector at every desktop width', async () => {
        const mainMode = await source('src/pages/MainMode.tsx')

        expect(mainMode).toMatch(/const handleSelectModule[\s\S]*?setSelectedModuleId\(moduleId\)[\s\S]*?if \(moduleSheetOpen\)[\s\S]*?setInspectorSheetOpen\(true\)/)
        expect(mainMode).not.toContain('isDockedWorkspace')
    })

    it('keeps raw prompt authoring behind the existing Prompt sheet compatibility entry', async () => {
        const mainMode = await source('src/pages/MainMode.tsx')

        expect(mainMode).toContain("const handleOpenPromptSheet = () => openSupportSheet('prompt')")
        expect(mainMode).not.toContain('LAYOUT_SHEET_EVENTS')
        expect(mainMode).toContain("t('composition.compatibility.rawPrompt', 'Advanced raw prompt')")
        expect(mainMode).not.toContain('<AutocompleteTextarea')
    })

    it('keeps prompt authoring free of duplicated composition diagnostics', async () => {
        const [promptPanel, editor, controls, autocomplete] = await Promise.all([
            source('src/components/layout/PromptPanel.tsx'),
            source('src/components/prompt/PromptEditorSurface.tsx'),
            source('src/components/prompt/PromptGenerationControls.tsx'),
            source('src/components/ui/AutocompleteTextarea.tsx'),
        ])

        expect(promptPanel).not.toMatch(/isMainMode|RecipeSelector|ResolvedPlanPanel|ValidationBadge/)
        expect(promptPanel).toContain('<PromptEditorSurface />')
        expect(promptPanel).toContain('<PromptGenerationControls isSceneMode={isSceneMode} />')
        expect(promptPanel).toContain("t('generate.restoreRecommendedSteps'")
        expect(promptPanel).toContain('if (!isGenerating) setFragmentDialogOpen')
        expect(promptPanel).toContain('if (isGenerating) setFragmentDialogOpen(false)')
        expect(promptPanel).toMatch(/aria-label=\{t\('prompt\.fragment'\)\}[\s\S]*?disabled=\{isGenerating\}/)
        expect(editor).toContain('<AutocompleteTextarea')
        expect(editor).toContain('aria-controls={editorPanelId}')
        expect(autocomplete).toContain('onBlur={flushPendingChange}')
        expect(autocomplete).toContain('return flushPendingChange')
        expect(controls).toContain('data-testid="prompt-generate-action"')
    })

    it('keeps the shared prompt action cancellable while Style Lab owns the generation store', async () => {
        const [controls, command, shortcuts] = await Promise.all([
            source('src/components/prompt/PromptGenerationControls.tsx'),
            source('src/services/generation/prompt-generation-command.ts'),
            source('src/hooks/useShortcuts.ts'),
        ])

        expect(controls).toContain("const isStyleLabGenerating = generatingMode === 'styleLab'")
        expect(controls).toMatch(/const isConflict = isSceneMode[\s\S]*?: isSceneGenerating\s/)
        expect(controls).not.toMatch(/: isSceneGenerating \|\| isStyleLabGenerating/)
        expect(command).toMatch(/if \(generation\.isGenerating\) \{[\s\S]*?cancelMainGenerationCommand\(\)/)
        expect(command).toContain("if (generation.generatingMode === 'scene') return 'blocked-conflict'")
        expect(shortcuts).toContain("void executePromptGenerationCommand('main')")
        expect(shortcuts).toContain('if (useGenerationStore.getState().isGenerating) return')
        expect(shortcuts).not.toContain('cancelMainGenerationCommand')
        expect(shortcuts).not.toContain('startMainGenerationCommand')
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
        expect(recipeSelector).toContain('const titleId = `main-composition-recipe-title-${useId()')
        expect(recipeSelector).toContain('aria-labelledby={titleId}')
        expect(recipeSelector).toContain('<Label id={titleId}')
        expect(recipeSelector).toContain("t('composition.recipe.direct', 'Direct prompts')")
        expect(recipeSelector).toContain('if (recipes.length === 0 && selectedRecipeExists) return null')
        expect(recipeSelector).toContain('onValueChange={onChange ?? setSelectedRecipeId}')
        expect(recipeSelector).not.toMatch(/compositionMode|setCompositionMode|MODE_OPTIONS/)
    })

    it('shows only contextual Main commands and uses a valid cost basis', async () => {
        const mainMode = await source('src/pages/MainMode.tsx')
        const commandStart = mainMode.indexOf('const commandBar =')
        const commandEnd = mainMode.indexOf('const mobileDock =', commandStart)
        const commandBar = mainMode.slice(commandStart, commandEnd)

        expect(mainMode).toContain('const hasRecipeControls = assetProfile.recipes.length > 0')
        expect(mainMode).toContain('displayedRecipeSelection !== MAIN_DIRECT_SELECTION_ID')
        expect(mainMode).toContain('const hasModuleSheetContent = hasRecipeControls || hasModuleTools')
        expect(mainMode).toContain('const hasResolvedContent = lastResolvedPlan !== null')
        expect(commandBar).toContain('recipe={hasRecipeControls ? {')
        expect(commandBar).toContain('cost={estimatedCost !== null && estimatedCost > 0 ? {')
        expect(commandBar).toContain('resolved={hasResolvedContent ? {')
        expect(commandBar).toContain('onOpenModules={hasModuleSheetContent ? handleOpenModuleStack : undefined}')
        expect(commandBar).toContain('simplified')
        expect(commandBar).not.toMatch(/\bmode=|validation=|\bseed=|onOpenInspector/)
        expect(mainMode).toContain('const resolvedCostParams = lastResolvedPlan?.params')
        expect(mainMode).toContain('const canEstimateCost = displayedRecipeSelection === MAIN_DIRECT_SELECTION_ID')
        expect(mainMode).toMatch(/calculateAnlasCost\(\s*resolvedCostParams\?\.width \?\? selectedResolution\.width,\s*resolvedCostParams\?\.height \?\? selectedResolution\.height,\s*resolvedCostParams\?\.steps \?\? steps,/)
        expect(mainMode).toContain('onOpenResolved={hasResolvedContent ? handleOpenResolvedPlan : undefined}')
        expect(mainMode).toContain('<RecipeSelector onChange={handleRecipeSelection} />')
    })

    it('treats Main rollout mode as release authority instead of a persisted UI preference', async () => {
        const store = await source('src/stores/generation-store.ts')
        const partializeStart = store.indexOf('partialize:')
        const hydrateStart = store.indexOf('onRehydrateStorage:', partializeStart)
        const partialize = store.slice(partializeStart, hydrateStart)
        const hydration = store.slice(hydrateStart)

        expect(partialize).not.toContain('compositionMode: state.compositionMode')
        expect(partialize).toContain('selectedRecipeId: state.selectedRecipeId')
        expect(hydration).toContain("state.compositionMode = 'v2'")
    })
})
