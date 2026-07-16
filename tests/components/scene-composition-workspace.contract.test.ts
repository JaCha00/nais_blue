import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFile(resolve(process.cwd(), path), 'utf8')

describe('Scene composition workspace information architecture', () => {
    it('uses the prompt-first shell, explicit rail sheets, resolved plan, and mobile command dock', async () => {
        const workspace = await source('src/components/scene/SceneCompositionWorkspace.tsx')

        expect(workspace).toContain('<CompositionWorkspaceLayout')
        expect(workspace).toContain('desktopRails={false}')
        expect(workspace).toContain('<ModuleStack')
        expect(workspace).toContain('<CompositionInspector')
        expect(workspace).toContain('<CompositionCommandBar')
        expect(workspace).toContain('<MobileCommandDock')
        expect(workspace).toContain('<ResolvedPlanView')
        expect(workspace).toContain('testId="scene-modules-sheet"')
        expect(workspace).toContain('testId="scene-inspector-sheet"')
        expect(workspace).toContain('testId="scene-resolved-plan-sheet"')
        expect(workspace).toContain('level="secondary"')
        expect(workspace).toContain('useTranslation()')
        expect(workspace).toContain("t('composition.workspace.moduleStack'")
        expect(workspace).toContain("t('scene.composition.inspector'")
        expect(workspace).toContain("t('composition.plan.help'")
    })

    it('captures the real launcher and opens the inspector as a second-level module flow', async () => {
        const workspace = await source('src/components/scene/SceneCompositionWorkspace.tsx')

        expect(workspace).toContain('document.activeElement instanceof HTMLElement')
        expect(workspace).toContain('returnFocusRef={modulesReturnFocusRef}')
        expect(workspace).toContain('returnFocusRef={inspectorReturnFocusRef}')
        expect(workspace).toContain('returnFocusRef={resolvedReturnFocusRef}')
        expect(workspace).toMatch(/const selectModule[\s\S]*onSelectModule\(moduleId\)[\s\S]*if \(modulesOpen\) openInspector\(\)/)
    })

    it('keeps Scene grid, create/edit, queue, bulk recipe and generation as first-class actions', async () => {
        const sceneMode = await source('src/pages/SceneMode.tsx')
        const compactGroup = sceneMode.indexOf('Compact grouping keeps import')
        const dropdownStart = sceneMode.indexOf('<DropdownMenu>', compactGroup)
        const createAction = sceneMode.indexOf("aria-label={t('scene.addScene')}")
        const editAction = sceneMode.indexOf("aria-label={t('scene.editMode'")

        expect(sceneMode).toContain('data-testid="scene-grid-workspace"')
        expect(sceneMode).toContain('actionTestId: \'scene-generate-action\'')
        expect(sceneMode).toContain('cancelTestId: \'scene-cancel-action\'')
        expect(sceneMode).toContain('handleWorkspaceRecipeChange')
        expect(sceneMode).toContain('setSceneCompositionRef(activePresetId, sceneId')
        expect(sceneMode).toContain('data-testid="scene-bulk-recipe"')
        expect(sceneMode).toContain('<SceneCompositionCardMeta')
        expect(createAction).toBeGreaterThan(-1)
        expect(editAction).toBeGreaterThan(-1)
        expect(createAction).toBeLessThan(dropdownStart)
        expect(editAction).toBeLessThan(dropdownStart)
    })

    it('keeps import/export/rotation/queue grouped while preserving the worker rollback seam', async () => {
        const sceneMode = await source('src/pages/SceneMode.tsx')
        const generationHook = await source('src/hooks/useSceneGeneration.ts')

        for (const command of [
            'handleImportClick',
            'setShowRotationDialog(true)',
            'addAllToQueue(activePresetId, batchCount)',
            'clearAllQueue(activePresetId)',
            'handleExportJson',
            'handleExportZip',
        ]) {
            expect(sceneMode).toContain(command)
        }
        expect(sceneMode).toContain('startNewGenerationSession()')
        expect(sceneMode).toContain('cancelSceneGeneration()')
        expect(sceneMode).toContain('enqueueCurrentSceneQueue()')
        expect(sceneMode).toContain("queueExecutionAuthority === 'legacy'")
        expect(generationHook).toContain('async function workerLoop')
        expect(generationHook).toContain("executionAuthority !== 'legacy' && !rotationActive")
    })

    it('moves raw prompts to compatibility UI and exposes typed override diff and character layout', async () => {
        const detail = await source('src/pages/SceneDetail.tsx')

        expect(detail).toContain('<SceneCompositionWorkspace')
        expect(detail).toContain('<CharacterLayoutEditor')
        expect(detail).toContain("advancedCompatibility', 'Advanced / compatibility prompt'")
        expect(detail).toContain("id: 'prompt'")
        expect(detail).toContain("id: 'resolution'")
        expect(detail).toContain("id: 'characters'")
        expect(detail).toContain("id: 'params'")
        expect(detail).toContain("id: 'output'")
        expect(detail).toContain('handleCharacterPositionChange')
        expect(detail).toContain('data-testid="scene-detail-workspace"')
        expect(detail).toContain('data-testid="scene-resolved-action"')
        expect(detail).toContain('SHORTCUT_EVENTS.OPEN_FRAGMENT_DIALOG')
    })

    it('routes Scene detail generation and cancellation through the selected queue authority', async () => {
        const detail = await source('src/pages/SceneDetail.tsx')

        expect(detail).toContain("queueExecutionAuthority === 'legacy'")
        expect(detail).toContain('enqueueCurrentSceneQueue()')
        expect(detail).toContain('coordinator.drain()')
        expect(detail).toContain("coordinator.cancelWorkflow('scene')")
        expect(detail).toContain('coordinator.cancelBatch(result.batch.id)')
        expect(detail).toContain('durableCancelRequestedRef.current')
    })
})
