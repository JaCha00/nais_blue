import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ImageIcon, ImagePlus, Download, Copy, RotateCcw, Save, Users, FolderOpen, Paintbrush, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useGenerationStore } from '@/stores/generation-store'
import { useAuthStore } from '@/stores/auth-store'
import { useSettingsStore } from '@/stores/settings-store'
import { MetadataDialog } from '@/components/metadata/MetadataDialog'
import { ImageReferenceDialog } from '@/components/metadata/ImageReferenceDialog'
import { parseMetadataFromBase64 } from '@/lib/metadata-parser'
import { generateImage } from '@/services/novelai-api'
import { createThumbnail } from '@/lib/image-utils'
import { getRuntimeOutputWriter } from '@/services/output/output-writer'
import {
    cancelMainGenerationCommand,
    startMainGenerationCommand,
} from '@/services/generation/generation-command'
import { toast } from '@/components/ui/use-toast'
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
    ContextMenuSeparator,
} from '@/components/ui/context-menu'
import { openPath } from '@tauri-apps/plugin-opener'
import { save } from '@tauri-apps/plugin-dialog'
import { join } from '@tauri-apps/api/path'
import { writeFile, mkdir, exists } from '@tauri-apps/plugin-fs'
import {
    getMediaStorageRoot,
    shouldUseAbsoluteMediaPath,
} from '@/platform/storage'
import { useNavigate } from 'react-router-dom'
import { useToolsStore } from '@/stores/tools-store'
import { Wand2 } from 'lucide-react'
import { InpaintingDialog } from '@/components/tools/InpaintingDialog'
import { useLayoutStore } from '@/stores/layout-store'
import { publishGeneratedArtifact } from '@/stores/artifact-lifecycle-store'
import { useAssetModuleStore } from '@/stores/asset-module-store'
import { useCharacterStore } from '@/stores/character-store'
import { calculateAnlasCost } from '@/lib/anlas-calculator'
import { getRuntimeCompositionDocument } from '@/lib/composition-authority'
import {
    MAIN_ASSET_SELECTION_PREFIX,
    MAIN_DIRECT_RECIPE_ID,
    MAIN_DIRECT_SELECTION_ID,
    getMainDirectRecipeId,
    mainAssetRecipeSelectionId,
    type MainCompositionMode,
} from '@/lib/composition/main-adapter'
import type {
    CompositionValidationSummary,
    ModuleStackItem,
    ReadonlyCompositionIssue,
} from '@/components/composition-workspace/types'
import {
    CompositionCommandBar,
    CompositionInspector,
    CompositionWorkspaceLayout,
    CompositionWorkspaceSheet,
    MobileCommandDock,
    ModuleStack,
    portableIssuesForResolvedPlan,
    ResolvedPlanView,
} from '@/components/composition-workspace'
import { RecipeSelector } from '@/components/composition/RecipeSelector'
import { runtimeCapabilities } from '@/platform/capabilities'
import { assessPortableCompositionPlan } from '@/platform/portable-resources'

const MAIN_MODE_OPTIONS: readonly MainCompositionMode[] = ['legacy', 'shadow', 'v2']

const MAIN_MODE_LABEL_KEYS: Record<MainCompositionMode, { key: string; fallback: string }> = {
    legacy: { key: 'composition.mode.previous', fallback: 'Previous generation engine' },
    shadow: { key: 'composition.mode.compatibility', fallback: 'Compatibility comparison' },
    v2: { key: 'composition.mode.current', fallback: 'Current generation engine' },
}

function useMediaQuery(query: string): boolean {
    const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

    useEffect(() => {
        const mediaQuery = window.matchMedia(query)
        const handleChange = () => setMatches(mediaQuery.matches)
        handleChange()
        mediaQuery.addEventListener('change', handleChange)
        return () => mediaQuery.removeEventListener('change', handleChange)
    }, [query])

    return matches
}

function rawRecipeId(selectionId: string | null, directRecipeId: string): string | null {
    if (selectionId === null) return null
    if (selectionId === MAIN_DIRECT_SELECTION_ID
        || selectionId === MAIN_DIRECT_RECIPE_ID
        || selectionId === directRecipeId) return directRecipeId
    if (!selectionId.startsWith(MAIN_ASSET_SELECTION_PREFIX)) return selectionId

    const encoded = selectionId.slice(MAIN_ASSET_SELECTION_PREFIX.length)
    try {
        return decodeURIComponent(encoded)
    } catch {
        return encoded
    }
}

export default function MainMode() {
    const { t } = useTranslation()
    const {
        previewImage,
        isGenerating,
        selectedResolution,
        seed,
        previewSeed,

        lastGenerationTime,
        batchCount,
        currentBatch,
        streamProgress,
        steps,
        isCancelled,
        generatingMode,
        compositionMode,
        selectedRecipeId,
        compositionWarnings,
        compositionErrors,
        lastResolvedPlan,
        setCompositionMode,
        setSelectedRecipeId,
        setSourceImage,
        setI2IMode,
    } = useGenerationStore()

    const navigate = useNavigate()
    const { setActiveImage } = useToolsStore()
    const assetProfile = useAssetModuleStore(state => state.profile)
    const profileLoading = useAssetModuleStore(state => state.isLoading)
    const profileConflict = useAssetModuleStore(state => state.hasConflict)
    const profileConflictMessage = useAssetModuleStore(state => state.conflictMessage)
    const characterImages = useCharacterStore(state => state.characterImages)
    const vibeImages = useCharacterStore(state => state.vibeImages)
    const isMobileWorkspace = useMediaQuery('(max-width: 767px)')
    const [moduleSheetOpen, setModuleSheetOpen] = useState(false)
    const [inspectorSheetOpen, setInspectorSheetOpen] = useState(false)
    const [resolvedSheetOpen, setResolvedSheetOpen] = useState(false)
    const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null)
    const moduleSheetTriggerRef = useRef<HTMLElement | null>(null)
    const inspectorSheetTriggerRef = useRef<HTMLElement | null>(null)
    const resolvedSheetTriggerRef = useRef<HTMLElement | null>(null)

    const [metadataDialogOpen, setMetadataDialogOpen] = useState(false)
    const [metadataImage, setMetadataImage] = useState<string | undefined>(undefined)
    const [isDragOver, setIsDragOver] = useState(false)
    const [imageRefDialogOpen, setImageRefDialogOpen] = useState(false)
    // Inpainting dialog state
    const [inpaintDialogOpen, setInpaintDialogOpen] = useState(false)

    // Get more store functions for regenerate with metadata
    const genStore = useGenerationStore()

    const directRecipeId = getMainDirectRecipeId(assetProfile.recipes)
    const firstEnabledRecipe = assetProfile.recipes.find(recipe => recipe.enabled)
    const automaticRecipeSelection = firstEnabledRecipe === undefined
        ? MAIN_DIRECT_SELECTION_ID
        : mainAssetRecipeSelectionId(firstEnabledRecipe.id)
    const displayedRecipeSelection = selectedRecipeId === null
        ? automaticRecipeSelection
        : selectedRecipeId === MAIN_DIRECT_SELECTION_ID
            || selectedRecipeId === MAIN_DIRECT_RECIPE_ID
            || selectedRecipeId === directRecipeId
            ? MAIN_DIRECT_SELECTION_ID
            : selectedRecipeId.startsWith(MAIN_ASSET_SELECTION_PREFIX)
                ? selectedRecipeId
                : mainAssetRecipeSelectionId(selectedRecipeId)
    const effectiveRecipeId = rawRecipeId(displayedRecipeSelection, directRecipeId)
    const runtimeDocument = getRuntimeCompositionDocument()
    const canonicalRecipe = runtimeDocument?.recipes.find(recipe => recipe.id === effectiveRecipeId)
    const legacyRecipe = assetProfile.recipes.find(recipe => recipe.id === effectiveRecipeId)
    const selectedRecipeName = canonicalRecipe?.name
        ?? legacyRecipe?.label
        ?? (effectiveRecipeId === directRecipeId
            ? t('composition.recipe.direct', 'Direct prompts')
            : effectiveRecipeId ?? t('composition.recipe.noneSelected', 'Select a recipe'))

    const portableResolvedIssues = useMemo(() => lastResolvedPlan === null
        ? []
        : portableIssuesForResolvedPlan(
            assessPortableCompositionPlan(lastResolvedPlan, runtimeCapabilities).issues,
        ), [lastResolvedPlan])

    const validation = useMemo<CompositionValidationSummary>(() => {
        if (profileConflict) {
            return {
                severity: 'conflict',
                warningCount: compositionWarnings.length,
                errorCount: compositionErrors.length,
                label: t('composition.validation.conflict', 'External edit conflict'),
            }
        }
        if (profileLoading) {
            return { severity: 'loading', label: t('common.loading', 'Loading...') }
        }
        if (compositionMode === 'legacy') {
            return { severity: 'disabled', label: t('composition.validation.legacy', 'Legacy') }
        }
        if (compositionErrors.length + portableResolvedIssues.length > 0) {
            return {
                severity: 'error',
                errorCount: compositionErrors.length + portableResolvedIssues.length,
                warningCount: compositionWarnings.length,
            }
        }
        if (compositionWarnings.length > 0) {
            return { severity: 'warning', warningCount: compositionWarnings.length }
        }
        return lastResolvedPlan === null
            ? { severity: 'disabled', label: t('composition.validation.pending', 'Not resolved') }
            : { severity: 'valid' }
    }, [
        compositionErrors.length,
        compositionMode,
        compositionWarnings.length,
        lastResolvedPlan,
        portableResolvedIssues.length,
        profileConflict,
        profileLoading,
        t,
    ])

    const moduleStackItems = useMemo<ModuleStackItem[]>(() => {
        const allIssues = [...compositionErrors, ...compositionWarnings]
        const canonicalById = new Map(runtimeDocument?.modules.map(module => [module.id, module]) ?? [])
        const recipeModuleIds = canonicalRecipe?.steps.map(step => step.moduleId)
            ?? legacyRecipe?.steps.map(step => step.moduleId)
            ?? []
        const fallbackIds = runtimeDocument?.profiles.find(profile => profile.id === runtimeDocument.activeProfileId)?.moduleIds
            ?? Object.keys(assetProfile.modules)
        const moduleIds = recipeModuleIds.length > 0 ? recipeModuleIds : fallbackIds

        return [...new Set(moduleIds)].map((moduleId, order) => {
            const canonical = canonicalById.get(moduleId)
            const legacy = assetProfile.modules[moduleId]
            const issues = allIssues.filter(issue => issue.entityRef?.kind === 'module' && issue.entityRef.id === moduleId)
            const errorCount = issues.filter(issue => issue.severity === 'error').length
            const warningCount = issues.length - errorCount
            const itemValidation: CompositionValidationSummary = errorCount > 0
                ? { severity: 'error', errorCount, warningCount }
                : warningCount > 0
                    ? { severity: 'warning', warningCount }
                    : { severity: 'valid' }

            if (canonical !== undefined) {
                return {
                    id: canonical.id,
                    name: canonical.name,
                    kind: canonical.kind,
                    enabled: canonical.enabled,
                    order,
                    validation: itemValidation,
                    summary: t('composition.module.summary', '{{count}} prompt parts', {
                        count: canonical.contributions.length,
                    }),
                }
            }

            return {
                id: moduleId,
                name: legacy?.label?.trim() || moduleId,
                kind: legacy?.kind ?? 'composite',
                enabled: legacy?.enabled ?? false,
                order,
                validation: legacy === undefined
                    ? { severity: 'error', errorCount: 1, label: t('composition.module.missing', 'Missing reference') }
                    : itemValidation,
                summary: legacy === undefined
                    ? t('composition.module.repairRequired', 'Repair required')
                    : legacy.target || t('composition.module.compatibility', 'Compatibility module'),
                missing: legacy === undefined,
            }
        })
    }, [
        assetProfile.modules,
        canonicalRecipe,
        compositionErrors,
        compositionWarnings,
        legacyRecipe,
        runtimeDocument,
        t,
    ])

    const selectedModule = moduleStackItems.find(module => module.id === selectedModuleId) ?? null
    const generationDisabled = (isGenerating && generatingMode !== 'main') || (isGenerating && isCancelled)
    const enabledCharacterCount = characterImages.filter(item => item.enabled !== false).length
    const uncachedVibeCount = vibeImages.filter(item => item.enabled !== false && !item.encodedVibe).length
    const resolvedParams = lastResolvedPlan?.params
    const estimatedCost = calculateAnlasCost(
        resolvedParams?.width ?? selectedResolution.width,
        resolvedParams?.height ?? selectedResolution.height,
        resolvedParams?.steps ?? steps,
        batchCount,
        resolvedParams === undefined ? enabledCharacterCount : lastResolvedPlan?.characters.length ?? enabledCharacterCount,
        uncachedVibeCount,
    )

    // Regenerate with metadata - direct API call without modifying UI
    const handleRegenerateWithMetadata = async () => {
        if (!previewImage || isGenerating) return

        const token = useAuthStore.getState().token
        if (!token) {
            useAuthStore.getState().requestTokenEntry()
            toast({
                title: t('toast.tokenRequired.title', '토큰 필요'),
                variant: 'destructive',
            })
            return
        }

        try {
            // Parse metadata from current image
            const metadata = await parseMetadataFromBase64(previewImage)
            if (!metadata) {
                toast({
                    title: t('toast.noMetadata', '메타데이터 없음'),
                    description: t('toast.noMetadataDesc', '이 이미지에서 메타데이터를 찾을 수 없습니다'),
                    variant: 'destructive',
                })
                return
            }

            // Set generating state
            genStore.setIsGenerating(true)

            // Generate random seed
            const newSeed = Math.floor(Math.random() * 4294967295)

            // Map metadata model name to API model ID
            // Metadata returns display names like "NovelAI Diffusion V4.5 ..." 
            // but API needs IDs like "nai-diffusion-4-5-full"
            const mapModelNameToId = (name?: string): string => {
                if (!name) return 'nai-diffusion-4-5-full'
                const lower = name.toLowerCase()
                if (lower.includes('4.5') || lower.includes('4-5')) {
                    if (lower.includes('curated')) return 'nai-diffusion-4-5-curated'
                    return 'nai-diffusion-4-5-full'
                }
                if (lower.includes('v4') || lower.includes('4')) {
                    if (lower.includes('curated')) return 'nai-diffusion-4-curated-preview'
                    return 'nai-diffusion-4-full'
                }
                if (lower.includes('furry')) return 'nai-diffusion-furry-3'
                if (lower.includes('v3') || lower.includes('3')) return 'nai-diffusion-3'
                return 'nai-diffusion-4-5-full'
            }

            // Call API directly with metadata (without modifying UI store)
            // Use all settings from metadata, only randomize seed
            const regenerateParams = {
                prompt: metadata.prompt || '',
                negative_prompt: metadata.negativePrompt || '',
                model: mapModelNameToId(metadata.model),
                width: metadata.width || 832,
                height: metadata.height || 1216,
                steps: metadata.steps || 28,
                cfg_scale: metadata.cfgScale || 5,
                cfg_rescale: metadata.cfgRescale || 0,
                sampler: metadata.sampler || 'k_euler',
                scheduler: metadata.scheduler || 'native',
                smea: metadata.smea ?? true,
                smea_dyn: metadata.smeaDyn ?? false,
                variety: metadata.variety ?? false,
                seed: newSeed,
                imageFormat: useSettingsStore.getState().imageFormat,
                metadataMode: useSettingsStore.getState().metadataMode,
            } as const
            const result = await generateImage(token, regenerateParams)

            if (result.success && result.imageData) {
                // Update preview with new image
                const { imageFormat } = useSettingsStore.getState()
                const mimeType = imageFormat === 'webp' ? 'image/webp' : 'image/png'
                const fileExt = imageFormat === 'webp' ? 'webp' : 'png'
                genStore.setPreviewImage(`data:${mimeType};base64,${result.imageData}`)

                // Save to disk if autoSave is enabled
                const { savePath, autoSave, useAbsolutePath } = useSettingsStore.getState()
                if (autoSave) {
                    try {
                        const binaryString = atob(result.imageData)
                        const bytes = new Uint8Array(binaryString.length)
                        for (let j = 0; j < binaryString.length; j++) {
                            bytes[j] = binaryString.charCodeAt(j)
                        }

                        const fileName = `NAIS_${Date.now()}.${fileExt}`
                        const outputDir = savePath || 'NAIS_Output'
                        const imageDataUrl = `data:${mimeType};base64,${result.imageData}`
                        const canCommit = (): boolean => {
                            const state = useGenerationStore.getState()
                            return state.isGenerating && state.generatingMode === 'main' && !state.isCancelled
                        }
                        await getRuntimeOutputWriter().write({
                            destination: {
                                directory: outputDir,
                                useAbsolutePath,
                                capabilityFallbackDirectory: 'NAIS_Output',
                                workflowDefaultDirectory: 'NAIS_Output',
                                fileName,
                                extension: fileExt,
                                collisionPolicy: 'unique',
                            },
                            imageBytes: bytes,
                            imageDataUrl,
                            metadata: {
                                params: { ...regenerateParams, sentPayloadSummary: result.sentPayloadSummary },
                                imageFormat,
                                metadataMode: useSettingsStore.getState().metadataMode,
                                includeWebpCompatibilitySidecar: true,
                            },
                            generateThumbnail: createThumbnail,
                            canCommit,
                            commitWorkflow: output => {
                                if (!canCommit()) throw new Error('Main metadata regeneration session changed')
                                publishGeneratedArtifact({ path: output.path })
                            },
                        })
                    } catch (e) {
                        console.warn('Failed to save regenerated image:', e)
                    }
                }

                toast({
                    title: t('toast.regenerated', '재생성 완료'),
                    variant: 'success',
                })
            } else {
                toast({
                    title: t('toast.generateFailed', '생성 실패'),
                    description: result.error,
                    variant: 'destructive',
                })
            }
        } catch (e) {
            console.error('Regenerate failed:', e)
        } finally {
            genStore.setIsGenerating(false)
        }
    }



    const handleCopy = async () => {
        if (!previewImage) return
        try {
            const response = await fetch(previewImage)
            const blob = await response.blob()
            await navigator.clipboard.write([
                new ClipboardItem({ [blob.type]: blob })
            ])
        } catch (e) {
            console.error('Copy failed', e)
        }
    }

    // Save As with native Windows dialog
    const handleSaveAs = async () => {
        if (!previewImage) return
        try {
            const { imageFormat } = useSettingsStore.getState()
            const fileExt = imageFormat === 'webp' ? 'webp' : 'png'
            const filterName = imageFormat === 'webp' ? 'WebP Image' : 'PNG Image'
            const filePath = await save({
                defaultPath: `NAIS_${Date.now()}.${fileExt}`,
                filters: [{ name: filterName, extensions: [fileExt] }],
            })

            if (filePath) {
                const base64Data = previewImage.split(',')[1]
                const binaryString = atob(base64Data)
                const bytes = new Uint8Array(binaryString.length)
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i)
                }

                await writeFile(filePath, bytes)
                toast({
                    title: t('toast.saved', '저장 완료'),
                    variant: 'success',
                })
            }
        } catch (e) {
            console.error('Save failed:', e)
            toast({
                title: t('toast.saveFailed', '저장 실패'),
                variant: 'destructive',
            })
        }
    }

    // Open folder containing saved images
    const handleOpenFolder = async () => {
        try {
            const { savePath, useAbsolutePath } = useSettingsStore.getState()
            const finalSavePath = savePath || 'NAIS_Output'

            let folderPath: string
            if (shouldUseAbsoluteMediaPath(useAbsolutePath)) {
                folderPath = finalSavePath
            } else {
                folderPath = await join(await getMediaStorageRoot(), finalSavePath)
            }

            const dirExists = await exists(folderPath)
            if (!dirExists) {
                await mkdir(folderPath, { recursive: true })
            }

            await openPath(folderPath)
        } catch (e) {
            console.error('Failed to open folder:', e)
        }
    }

    const handleOpenSmartTools = () => {
        if (previewImage) {
            setActiveImage(previewImage)
            navigate('/tools')
        }
    }

    // Inpainting: Open dialog directly (source/mode set when mask is saved)
    const handleInpaint = () => {
        if (!previewImage) return
        setInpaintDialogOpen(true)
    }

    // I2I: Set source and stay on page (already in main mode)
    const handleI2I = () => {
        if (!previewImage) return
        setSourceImage(previewImage)
        setI2IMode('i2i')
    }

    // Image Reference popup
    const handleAddAsReference = () => {
        if (previewImage) {
            setImageRefDialogOpen(true)
        }
    }

    // Metadata loading from current preview
    const handleLoadMetadata = () => {
        if (previewImage) {
            setMetadataImage(previewImage)
            setMetadataDialogOpen(true)
        }
    }

    const openSupportSheet = useLayoutStore(state => state.openSupportSheet)
    // layout-store is the single sheet authority shared by shell and compact command dock.
    const handleOpenPromptSheet = () => openSupportSheet('prompt')

    const handlePrimaryGeneration = () => {
        if (isGenerating && generatingMode === 'main') {
            void cancelMainGenerationCommand()
            return
        }
        if (!isGenerating) {
            void startMainGenerationCommand()
        }
    }

    const handleRecipeSelection = (recipeId: string) => {
        setSelectedRecipeId(recipeId)
        setSelectedModuleId(null)
    }

    const currentTrigger = (): HTMLElement | null => document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null

    const handleOpenModuleStack = () => {
        moduleSheetTriggerRef.current = currentTrigger()
        setModuleSheetOpen(true)
    }

    const handleOpenInspector = () => {
        inspectorSheetTriggerRef.current = currentTrigger()
        setInspectorSheetOpen(true)
    }

    const handleSelectModule = (moduleId: string) => {
        setSelectedModuleId(moduleId)
        // The Main workspace keeps its desktop rails disabled, so a module chosen
        // from its sheet must hand off to the Inspector sheet at every viewport.
        if (moduleSheetOpen) {
            inspectorSheetTriggerRef.current = currentTrigger()
            setInspectorSheetOpen(true)
        }
    }

    const handleEditModule = (moduleId: string) => {
        navigate('/asset-modules', { state: { moduleId, from: 'main' } })
    }

    const handleOpenResolvedPlan = () => {
        resolvedSheetTriggerRef.current = currentTrigger()
        setResolvedSheetOpen(true)
    }

    const handleRepairCompositionIssue = (issue: ReadonlyCompositionIssue) => {
        const repairTarget = issue.entityRef?.id ?? issue.code
        const params = new URLSearchParams({ repair: repairTarget })
        if (issue.actionId) params.set('action', issue.actionId)
        navigate(`/asset-modules?${params.toString()}`, {
            state: { repairTarget, actionId: issue.actionId, issueCode: issue.code, from: 'main' },
        })
    }

    // Drag counter to prevent flickering from child elements
    const dragCounter = useRef(0)

    // Drag & Drop for metadata loading
    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        dragCounter.current = 0
        setIsDragOver(false)

        const file = e.dataTransfer.files[0]
        if (file && file.type.startsWith('image/')) {
            // Convert file to base64
            const reader = new FileReader()
            reader.onload = () => {
                setMetadataImage(reader.result as string)
                setMetadataDialogOpen(true)
            }
            reader.readAsDataURL(file)
        }
    }, [])

    const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        dragCounter.current++
        if (e.dataTransfer.types.includes('Files')) {
            setIsDragOver(true)
        }
    }, [])

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
    }, [])

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        dragCounter.current--
        if (dragCounter.current === 0) {
            setIsDragOver(false)
        }
    }, [])

    // Memory cleanup on unmount - release large Base64 data when leaving main mode
    // This prevents OOM when switching between modes (Issue #6)
    useEffect(() => {
        return () => {
            console.log('[MainMode] Unmounting - clearing runtime data')
            useGenerationStore.getState().clearRuntimeData()
        }
    }, [])

    // Timer Logic
    const [elapsedTime, setElapsedTime] = useState(0)

    useEffect(() => {
        let interval: any
        if (isGenerating) {
            const start = Date.now()
            setElapsedTime(0)
            interval = setInterval(() => {
                setElapsedTime(Date.now() - start)
            }, 100)
        } else {
            setElapsedTime(0)
        }
        return () => clearInterval(interval)
    }, [isGenerating])

    // Format time (s.ms)
    const formatTime = (ms: number) => (ms / 1000).toFixed(1)

    const generationControl = {
        generating: isGenerating && generatingMode === 'main',
        disabled: generationDisabled,
        progressLabel: isGenerating && generatingMode === 'main' && batchCount > 1
            ? `${t('generate.cancel', '취소')} (${currentBatch}/${batchCount})`
            : undefined,
        generateLabel: t('generate.button', '생성'),
        cancelLabel: t('generate.cancel', '취소'),
        onGenerate: handlePrimaryGeneration,
        onCancel: () => void cancelMainGenerationCommand(),
        actionTestId: 'main-generate-action',
        cancelTestId: 'main-generate-action',
    }
    const recipeOptions = [
        { value: MAIN_DIRECT_SELECTION_ID, label: t('composition.recipe.direct', 'Direct prompts') },
        ...assetProfile.recipes.map(recipe => ({
            value: mainAssetRecipeSelectionId(recipe.id),
            label: recipe.label || recipe.id,
            disabled: !recipe.enabled,
        })),
    ]
    const workspaceLabels = {
        modules: t('composition.workspace.modules', 'Modules'),
        inspector: t('composition.workspace.inspector', 'Inspector'),
        resolvedPlan: t('composition.plan.title', 'Resolved plan'),
        edit: t('common.edit', 'Edit'),
        enable: t('common.enable', 'Enable'),
        disable: t('common.disable', 'Disable'),
        moveUp: t('common.moveUp', 'Move up'),
        moveDown: t('common.moveDown', 'Move down'),
        empty: t('composition.module.noneSelected', 'No module selected'),
    }
    const moduleStack = (
        <ModuleStack
            modules={moduleStackItems}
            activeModuleId={selectedModuleId}
            title={t('composition.workspace.moduleStack', 'Module Stack')}
            disabled={isGenerating}
            height="100%"
            emptyLabel={t('composition.module.emptyRecipe', 'This recipe has no modules.')}
            searchLabel={t('composition.module.search', 'Search modules')}
            labels={workspaceLabels}
            onSelectModule={handleSelectModule}
            onEditModule={handleEditModule}
        />
    )
    const inspector = (
        <CompositionInspector
            module={selectedModule}
            recipeName={selectedRecipeName}
            validation={validation}
            resolvedPlan={lastResolvedPlan}
            conflict={profileConflict ? {
                severity: 'error',
                title: t('composition.conflict.externalEdit', 'External edit detected'),
                message: profileConflictMessage || t('composition.conflict.review', 'Review the repository conflict before generating.'),
                revision: String(assetProfile.revision),
            } : null}
            disabled={isGenerating}
            labels={{
                title: t('composition.workspace.inspector', 'Context Inspector'),
                noSelection: t('composition.module.selectToInspect', 'Select a module to inspect its resolved state.'),
                recipe: t('composition.recipe.title', 'Recipe'),
                kind: t('composition.module.kind', 'Kind'),
                moduleId: t('composition.module.id', 'Module ID'),
                overrideDiff: t('composition.override.diff', 'Override diff'),
                inherited: t('composition.override.inherited', 'Inherited'),
                override: t('composition.override.value', 'Override'),
                unchanged: t('composition.override.unchanged', 'Unchanged'),
                edit: t('composition.module.edit', 'Edit module'),
                resetOverride: t('composition.override.reset', 'Reset override'),
                resolvedPlan: t('composition.plan.open', 'Open resolved plan'),
            }}
            onEditModule={handleEditModule}
            onOpenResolvedPlan={handleOpenResolvedPlan}
        >
            <div className="p-3 pt-5">
                <Button type="button" variant="outline" className="w-full justify-start" onClick={handleOpenPromptSheet}>
                    <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                    <span className="min-w-0 truncate">{t('composition.compatibility.rawPrompt', 'Advanced raw prompt')}</span>
                </Button>
            </div>
        </CompositionInspector>
    )
    const resolvedPlan = (
        <ResolvedPlanView
            plan={lastResolvedPlan}
            issues={[...compositionErrors, ...portableResolvedIssues, ...compositionWarnings]}
            loading={profileLoading}
            error={profileConflict ? profileConflictMessage : null}
            title={t('composition.plan.title', 'Resolved plan')}
            onRepairIssue={handleRepairCompositionIssue}
        />
    )
    const commandBar = (
        <div data-testid="main-command-dock">
            <CompositionCommandBar
                mode={{
                    value: compositionMode,
                    options: MAIN_MODE_OPTIONS.map(value => ({
                        value,
                        label: t(MAIN_MODE_LABEL_KEYS[value].key, MAIN_MODE_LABEL_KEYS[value].fallback),
                    })),
                    onChange: value => setCompositionMode(value as MainCompositionMode),
                    label: t('composition.mode.title', 'Mode'),
                    disabled: isGenerating,
                }}
                recipe={{
                    value: displayedRecipeSelection,
                    options: recipeOptions,
                    onChange: handleRecipeSelection,
                    label: t('composition.recipe.title', 'Recipe'),
                    disabled: isGenerating || profileLoading || compositionMode === 'legacy',
                }}
                validation={validation}
                cost={{
                    value: `${estimatedCost} Anlas`,
                    label: t('composition.cost.estimated', 'Estimated cost'),
                    severity: estimatedCost > 0 ? 'warning' : 'normal',
                }}
                seed={{
                    value: previewSeed ?? seed ?? t('settings.random', 'Random'),
                    label: t('settings.seed', 'Seed'),
                    disabled: isGenerating,
                    onPreviewWildcard: handleOpenResolvedPlan,
                    wildcardPreviewLabel: t('composition.random.preview', 'Preview wildcard resolution'),
                }}
                resolved={{
                    available: true,
                    label: t('composition.plan.resolved', 'Resolved'),
                    open: resolvedSheetOpen,
                    onOpen: handleOpenResolvedPlan,
                }}
                generation={generationControl}
                labels={{
                    modules: t('composition.workspace.modules', 'Modules'),
                    inspector: t('composition.workspace.inspector', 'Inspector'),
                    generate: t('generate.button', 'Generate'),
                    cancel: t('generate.cancel', 'Cancel'),
                }}
                onOpenModules={handleOpenModuleStack}
                onOpenInspector={handleOpenInspector}
            />
        </div>
    )
    const mobileDock = isMobileWorkspace ? (
        <MobileCommandDock
            generation={generationControl}
            resolvedAvailable
            testId="main-command-dock"
            labels={{
                modules: t('composition.workspace.modules', 'Modules'),
                inspector: t('composition.workspace.inspector', 'Inspector'),
                resolved: t('composition.plan.resolved', 'Resolved'),
                generate: t('generate.button', 'Generate'),
                cancel: t('generate.cancel', 'Cancel'),
            }}
            onOpenModules={handleOpenModuleStack}
            onOpenInspector={handleOpenInspector}
            onOpenResolved={handleOpenResolvedPlan}
        />
    ) : null

    return (
        <div
            className="relative h-full min-h-0 w-full overflow-hidden bg-canvas"
            onDrop={handleDrop}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
        >
            {/* DESIGN.md Cobalt Instrument: drag feedback is a single semantic
                layer so metadata import stays clear without glow or glass. */}
            {isDragOver && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-scrim/70 p-4" role="status" aria-live="polite">
                    <div className="w-full max-w-md rounded-panel border-2 border-primary bg-card p-6 text-center shadow-overlay sm:p-8">
                        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-panel bg-accent text-primary">
                            <ImagePlus className="h-8 w-8" />
                        </div>
                        <p className="text-lg font-semibold text-foreground">
                            {t('metadata.dropToLoad', '이미지를 드롭하여 메타데이터 불러오기')}
                        </p>
                        <p className="mt-2 text-sm text-muted-foreground">
                            {t('metadata.extractDesc', 'PNG 파일에서 프롬프트와 설정을 추출합니다')}
                        </p>
                    </div>
                </div>
            )}

            <CompositionWorkspaceLayout
                desktopRails={false}
                commandBar={isMobileWorkspace ? null : commandBar}
                moduleStack={moduleStack}
                inspector={inspector}
                mobileDock={mobileDock}
                workspaceClassName="rounded-panel border border-border bg-canvas"
                workspace={(
                    <div className="relative h-full min-h-0 min-w-0 overflow-hidden" data-testid="main-result-canvas">
            {/* Full Screen Image Area */}
            <div className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden">
                {previewImage ? (
                    // Generated Image with Context Menu
                    <ContextMenu>
                        <ContextMenuTrigger asChild>
                            <div className="group relative h-full w-full cursor-context-menu">
                                <img
                                    src={previewImage}
                                    alt="Generated preview"
                                    className="w-full h-full object-contain"
                                />
                                {/* Image Actions Overlay (Visible on hover) */}
                                <div className="absolute right-3 top-3 flex gap-2 opacity-100 transition-opacity duration-standard sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                                    <Button
                                        size="icon"
                                        variant="secondary"
                                        className="h-11 w-11 rounded-control bg-popover text-popover-foreground shadow-overlay hover:bg-accent"
                                        onClick={handleRegenerateWithMetadata}
                                        disabled={isGenerating}
                                        aria-label={t('actions.regenerate', '재생성')}
                                    >
                                        <RotateCcw className="h-5 w-5" />
                                    </Button>
                                    <Button
                                        size="icon"
                                        variant="secondary"
                                        className="h-11 w-11 rounded-control bg-popover text-popover-foreground shadow-overlay hover:bg-accent"
                                        onClick={handleCopy}
                                        aria-label={t('actions.copy', '복사')}
                                    >
                                        <Copy className="h-5 w-5" />
                                    </Button>
                                    <Button
                                        size="icon"
                                        variant="secondary"
                                        className="h-11 w-11 rounded-control bg-popover text-popover-foreground shadow-overlay hover:bg-accent"
                                        onClick={handleSaveAs}
                                        aria-label={t('actions.saveAs', '저장')}
                                    >
                                        <Download className="h-5 w-5" />
                                    </Button>
                                </div>
                            </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                            <ContextMenuItem onClick={handleSaveAs}>
                                <Save className="h-4 w-4 mr-2" />
                                {t('actions.saveAs', '저장')}
                            </ContextMenuItem>
                            <ContextMenuItem onClick={handleCopy}>
                                <Copy className="h-4 w-4 mr-2" />
                                {t('actions.copy', '복사')}
                            </ContextMenuItem>
                            <ContextMenuItem onClick={handleRegenerateWithMetadata} disabled={isGenerating}>
                                <RotateCcw className="h-4 w-4 mr-2" />
                                {t('actions.regenerate', '재생성')}
                            </ContextMenuItem>
                            <ContextMenuItem onClick={handleOpenSmartTools}>
                                <Wand2 className="h-4 w-4 mr-2" />
                                {t('smartTools.title', '스마트 툴')}
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem onClick={handleInpaint}>
                                <Paintbrush className="h-4 w-4 mr-2" />
                                {t('tools.inpainting.title', '인페인팅')}
                            </ContextMenuItem>
                            <ContextMenuItem onClick={handleI2I}>
                                <ImageIcon className="h-4 w-4 mr-2" />
                                {t('tools.i2i.title', 'Image to Image')}
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem onClick={handleAddAsReference}>
                                <Users className="h-4 w-4 mr-2" />
                                {t('actions.addAsRef', '이미지 참조')}
                            </ContextMenuItem>
                            <ContextMenuItem onClick={handleOpenFolder}>
                                <FolderOpen className="h-4 w-4 mr-2" />
                                {t('actions.openFolder', '폴더 열기')}
                            </ContextMenuItem>
                            <ContextMenuItem onClick={handleLoadMetadata}>
                                <ImageIcon className="h-4 w-4 mr-2" />
                                {t('metadata.loadFromImage', '메타데이터 불러오기')}
                            </ContextMenuItem>
                        </ContextMenuContent>
                    </ContextMenu>
                ) : isGenerating ? (
                    // Loading State (Only shown when no previous image exists)
                    <div className="z-10 flex max-w-sm flex-col items-center justify-center px-6 text-center" role="status" aria-live="polite">
                        <div className="relative mb-4 flex h-16 w-16 items-center justify-center rounded-panel bg-muted/50">
                            <div className="absolute inset-2 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
                            <ImagePlus className="h-6 w-6 text-primary" />
                        </div>
                        <p className="text-base font-semibold text-foreground">
                            {batchCount > 1
                                ? `${t('generate.loadingTitle')} (${currentBatch}/${batchCount})`
                                : t('generate.loadingTitle')
                            }
                        </p>
                        <p className="mt-2 font-mono text-xs tabular-nums text-muted-foreground">
                            {formatTime(elapsedTime)}s
                            {lastGenerationTime && (
                                <span className="mx-1 text-muted-foreground/70">/ ~{formatTime(lastGenerationTime)}s</span>
                            )}
                        </p>
                    </div>
                ) : (
                    // Empty state intentionally keeps one action and one import hint.
                    <div className="flex max-w-md flex-col items-center justify-center px-6 text-center">
                        <div className="mb-4 flex h-16 w-16 items-center justify-center text-muted-foreground/70">
                            <ImageIcon className="h-8 w-8" />
                        </div>
                        <h1 className="text-lg font-semibold text-foreground">{t('generate.emptyState')}</h1>
                        <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
                            {t('generate.emptyDescription')}
                        </p>
                        <Button variant="outline" className="mt-4" onClick={handleOpenPromptSheet}>
                            <SlidersHorizontal className="h-4 w-4" />
                            {t('generate.openPrompt', '프롬프트 열기')}
                        </Button>
                        <p className="mt-3 hidden text-xs text-muted-foreground sm:block">
                            {t('metadata.dropHint', '이미지를 드래그하여 메타데이터를 불러올 수 있습니다')}
                        </p>
                    </div>
                )}
            </div>

            {/* Generation Progress Bar - Above Info Bar */}
            {isGenerating && (
                <div className="absolute bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-1/2 z-20 flex w-[min(30rem,calc(100%-1rem))] -translate-x-1/2 items-center gap-3 rounded-panel bg-popover px-3 py-2 text-popover-foreground shadow-overlay md:bottom-3" role="status" aria-live="polite">
                    <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                            <span className="truncate text-xs font-medium text-foreground">
                            {t('generate.generating')}
                            </span>
                            <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                                {formatTime(elapsedTime)}s
                                {lastGenerationTime && <> / {formatTime(lastGenerationTime)}s</>}
                            </span>
                        </div>
                        {streamProgress > 0 && streamProgress < 100 && (
                            <div className="mt-2 flex items-center gap-2">
                                <div
                                    className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
                                    role="progressbar"
                                    aria-label={t('generate.progress', '생성 진행률')}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-valuenow={streamProgress}
                                >
                                <div
                                        className="h-full bg-primary transition-[width] duration-standard ease-out"
                                    style={{ width: `${streamProgress}%` }}
                                />
                                </div>
                                <span className="w-9 text-right font-mono text-xs tabular-nums text-primary">{streamProgress}%</span>
                            </div>
                        )}
                    </div>
                </div>
            )}

                    </div>
                )}
            />

            <CompositionWorkspaceSheet
                open={moduleSheetOpen}
                onOpenChange={setModuleSheetOpen}
                title={t('composition.workspace.moduleStack', 'Module Stack')}
                description={t('composition.workspace.moduleStackHelp', 'Choose a recipe module, then inspect or edit it.')}
                side={isMobileWorkspace ? 'bottom' : 'left'}
                level="primary"
                testId="main-module-stack-sheet"
                closeLabel={t('common.close', 'Close')}
                returnFocusRef={moduleSheetTriggerRef}
            >
                <div className="flex min-h-0 flex-col gap-3">
                    {isMobileWorkspace && <RecipeSelector />}
                    {moduleStack}
                </div>
            </CompositionWorkspaceSheet>

            <CompositionWorkspaceSheet
                open={inspectorSheetOpen}
                onOpenChange={setInspectorSheetOpen}
                title={t('composition.workspace.inspector', 'Context Inspector')}
                description={t('composition.workspace.inspectorHelp', 'Review module context before opening the canonical editor.')}
                side={isMobileWorkspace ? 'bottom' : 'right'}
                level="secondary"
                testId="main-composition-inspector-sheet"
                closeLabel={t('common.close', 'Close')}
                returnFocusRef={inspectorSheetTriggerRef}
            >
                {inspector}
            </CompositionWorkspaceSheet>

            <CompositionWorkspaceSheet
                open={resolvedSheetOpen}
                onOpenChange={setResolvedSheetOpen}
                title={t('composition.plan.title', 'Resolved plan')}
                description={t('composition.plan.help', 'Final prompts, parameters, random trace, and provenance.')}
                side={isMobileWorkspace ? 'bottom' : 'right'}
                level="secondary"
                testId="main-resolved-plan-sheet"
                closeLabel={t('common.close', 'Close')}
                returnFocusRef={resolvedSheetTriggerRef}
            >
                {resolvedPlan}
            </CompositionWorkspaceSheet>

            {/* Metadata Dialog */}
            <MetadataDialog
                open={metadataDialogOpen}
                onOpenChange={(open) => {
                    setMetadataDialogOpen(open)
                    if (!open) setMetadataImage(undefined)
                }}
                initialImage={metadataImage}
            />

            {/* Image Reference Dialog */}
            <ImageReferenceDialog
                open={imageRefDialogOpen}
                onOpenChange={setImageRefDialogOpen}
                imageBase64={previewImage || null}
            />

            {/* Inpainting Dialog */}
            <InpaintingDialog
                open={inpaintDialogOpen}
                onOpenChange={setInpaintDialogOpen}
                sourceImage={previewImage}
            />
        </div>
    )
}
