import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { FragmentPromptDialog } from '@/components/fragments/FragmentPromptDialog'
import { SourceImagePanel } from '@/components/layout/SourceImagePanel'
import { CharacterSettingsDialog } from '@/components/character/CharacterSettingsDialog'
import { CharacterPromptPanel } from '@/components/character/CharacterPromptPanel'
import { PromptGeneratorDialog } from '@/components/prompt/PromptGeneratorDialog'
import { AutocompleteTextarea } from '@/components/ui/AutocompleteTextarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import Counter from '@/components/ui/counter'
import { SHORTCUT_EVENTS } from '@/hooks/useShortcuts'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { Tip } from '@/components/ui/tooltip'
import { generateRandomSeed } from '@/lib/utils'
import {
    ImagePlus,
    Dice5,
    Lock,
    Unlock,
    SlidersHorizontal,
    Cpu,
    Film,
    Puzzle,
    Users,
    ChevronDown,
    ChevronUp,
} from 'lucide-react'
import GeminiIcon from '@/assets/gemini-color.svg'
import { useGenerationStore, AVAILABLE_MODELS } from '@/stores/generation-store'
import { useSceneStore } from '@/stores/scene-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import { ResolutionSelector } from '@/components/ui/ResolutionSelector'
import { useRotationStore } from '@/stores/character-rotation-store'
import { toast } from '@/components/ui/use-toast'
import { RecipeSelector } from '@/components/composition/RecipeSelector'
import { ResolvedPlanPanel } from '@/components/composition/ResolvedPlanPanel'

const SAMPLERS = [
    'k_euler',
    'k_euler_ancestral',
    'k_dpmpp_2s_ancestral',
    'k_dpmpp_2m',
    'k_dpmpp_2m_sde',
    'k_dpmpp_sde',
    'ddim',
]

const SCHEDULERS = ['native', 'karras', 'exponential', 'polyexponential']

export function PromptPanel() {
    const { t } = useTranslation()
    const location = useLocation()
    const isMainMode = location.pathname === '/'
    const isSceneMode = location.pathname.startsWith('/scenes')

    // Zustand 선택적 구독 - sceneStore
    const activePresetId = useSceneStore(state => state.activePresetId)
    const getTotalQueueCount = useSceneStore(state => state.getTotalQueueCount)
    const sceneIsGenerating = useSceneStore(state => state.isGenerating)
    const sceneIsCancelling = useSceneStore(state => state.isCancelling)
    const cancelSceneGeneration = useSceneStore(state => state.cancelSceneGeneration)
    const startNewGenerationSession = useSceneStore(state => state.startNewGenerationSession)
    const completedCount = useSceneStore(state => state.completedCount)
    const totalQueuedCount = useSceneStore(state => state.totalQueuedCount)
    const rotationActive = useRotationStore(state => state.active)

    const sceneQueueCount = activePresetId ? getTotalQueueCount(activePresetId) : 0

    // Zustand 선택적 구독 - generationStore (상태)
    const basePrompt = useGenerationStore(state => state.basePrompt)
    const additionalPrompt = useGenerationStore(state => state.additionalPrompt)
    const detailPrompt = useGenerationStore(state => state.detailPrompt)
    const negativePrompt = useGenerationStore(state => state.negativePrompt)
    const seed = useGenerationStore(state => state.seed)
    const seedLocked = useGenerationStore(state => state.seedLocked)
    const selectedResolution = useGenerationStore(state => state.selectedResolution)
    const isGenerating = useGenerationStore(state => state.isGenerating)
    const isCancelled = useGenerationStore(state => state.isCancelled)
    const model = useGenerationStore(state => state.model)
    const steps = useGenerationStore(state => state.steps)
    const cfgScale = useGenerationStore(state => state.cfgScale)
    const cfgRescale = useGenerationStore(state => state.cfgRescale)
    const sampler = useGenerationStore(state => state.sampler)
    const scheduler = useGenerationStore(state => state.scheduler)
    const smea = useGenerationStore(state => state.smea)
    const smeaDyn = useGenerationStore(state => state.smeaDyn)
    const variety = useGenerationStore(state => state.variety)
    const qualityToggle = useGenerationStore(state => state.qualityToggle)
    const ucPreset = useGenerationStore(state => state.ucPreset)
    const batchCount = useGenerationStore(state => state.batchCount)
    const currentBatch = useGenerationStore(state => state.currentBatch)
    const generatingMode = useGenerationStore(state => state.generatingMode)

    // Zustand 선택적 구독 - generationStore (액션)
    const setBasePrompt = useGenerationStore(state => state.setBasePrompt)
    const setAdditionalPrompt = useGenerationStore(state => state.setAdditionalPrompt)
    const setDetailPrompt = useGenerationStore(state => state.setDetailPrompt)
    const setNegativePrompt = useGenerationStore(state => state.setNegativePrompt)
    const setSeed = useGenerationStore(state => state.setSeed)
    const setSeedLocked = useGenerationStore(state => state.setSeedLocked)
    const setSelectedResolution = useGenerationStore(state => state.setSelectedResolution)
    const setModel = useGenerationStore(state => state.setModel)
    const setSteps = useGenerationStore(state => state.setSteps)
    const setCfgScale = useGenerationStore(state => state.setCfgScale)
    const setCfgRescale = useGenerationStore(state => state.setCfgRescale)
    const setSampler = useGenerationStore(state => state.setSampler)
    const setScheduler = useGenerationStore(state => state.setScheduler)
    const setSmea = useGenerationStore(state => state.setSmea)
    const setSmeaDyn = useGenerationStore(state => state.setSmeaDyn)
    const setVariety = useGenerationStore(state => state.setVariety)
    const setQualityToggle = useGenerationStore(state => state.setQualityToggle)
    const setUcPreset = useGenerationStore(state => state.setUcPreset)
    const setBatchCount = useGenerationStore(state => state.setBatchCount)
    const generate = useGenerationStore(state => state.generate)
    const cancelGeneration = useGenerationStore(state => state.cancelGeneration)

    // Zustand 선택적 구독 - settingsStore
    const promptFontSize = useSettingsStore(state => state.promptFontSize)
    const basePromptCollapsed = useSettingsStore(state => state.basePromptCollapsed)
    const setBasePromptCollapsed = useSettingsStore(state => state.setBasePromptCollapsed)
    const additionalPromptCollapsed = useSettingsStore(state => state.additionalPromptCollapsed)
    const setAdditionalPromptCollapsed = useSettingsStore(state => state.setAdditionalPromptCollapsed)
    const detailPromptCollapsed = useSettingsStore(state => state.detailPromptCollapsed)
    const setDetailPromptCollapsed = useSettingsStore(state => state.setDetailPromptCollapsed)
    const negativePromptCollapsed = useSettingsStore(state => state.negativePromptCollapsed)
    const setNegativePromptCollapsed = useSettingsStore(state => state.setNegativePromptCollapsed)

    // Zustand 선택적 구독 - characterPromptStore
    const characterCount = useCharacterPromptStore(state => state.characters.filter(c => c.enabled).length)

    const [promptGenOpen, setPromptGenOpen] = useState(false)
    const [fragmentDialogOpen, setFragmentDialogOpen] = useState(false)
    const [characterPanelOpen, setCharacterPanelOpen] = useState(false)
    const [imageRefDialogOpen, setImageRefDialogOpen] = useState(false)
    const [parameterDialogOpen, setParameterDialogOpen] = useState(false)

    // 전역 단축키 이벤트 수신
    useEffect(() => {
        const handleOpenPromptGen = () => setPromptGenOpen(prev => !prev)
        const handleOpenFragment = () => setFragmentDialogOpen(prev => !prev)
        const handleOpenParameters = () => setParameterDialogOpen(prev => !prev)
        const handleOpenCharacterPrompt = () => setCharacterPanelOpen(prev => !prev)
        const handleOpenImageReference = () => setImageRefDialogOpen(prev => !prev)

        window.addEventListener(SHORTCUT_EVENTS.OPEN_PROMPT_GENERATOR, handleOpenPromptGen)
        window.addEventListener(SHORTCUT_EVENTS.OPEN_FRAGMENT_DIALOG, handleOpenFragment)
        window.addEventListener(SHORTCUT_EVENTS.OPEN_PARAMETER_SETTINGS, handleOpenParameters)
        window.addEventListener(SHORTCUT_EVENTS.OPEN_CHARACTER_PROMPT, handleOpenCharacterPrompt)
        window.addEventListener(SHORTCUT_EVENTS.OPEN_IMAGE_REFERENCE, handleOpenImageReference)

        return () => {
            window.removeEventListener(SHORTCUT_EVENTS.OPEN_PROMPT_GENERATOR, handleOpenPromptGen)
            window.removeEventListener(SHORTCUT_EVENTS.OPEN_FRAGMENT_DIALOG, handleOpenFragment)
            window.removeEventListener(SHORTCUT_EVENTS.OPEN_PARAMETER_SETTINGS, handleOpenParameters)
            window.removeEventListener(SHORTCUT_EVENTS.OPEN_CHARACTER_PROMPT, handleOpenCharacterPrompt)
            window.removeEventListener(SHORTCUT_EVENTS.OPEN_IMAGE_REFERENCE, handleOpenImageReference)
        }
    }, [])

    const handleRandomSeed = () => {
        if (!seedLocked) {
            setSeed(generateRandomSeed())
        }
    }




    // Conflict Detection
    const isMainGenerating = generatingMode === 'main'
    const isSceneGenerating = generatingMode === 'scene'
    const isStyleLabGenerating = generatingMode === 'styleLab'
    const isConflict = isSceneMode
        ? isMainGenerating || isStyleLabGenerating
        : isSceneGenerating || isStyleLabGenerating

    const handleGenerateOrCancel = useCallback(() => {
        if (isConflict) return // Prevent action if conflict exists

        if (isSceneMode) {
            // Toggle scene generation: start new session or cancel
            if (rotationActive) {
                useRotationStore.getState().stop({ reason: 'prompt panel stop', keepSnapshot: true })
                toast({
                    title: '로테이션 중단',
                    description: '현재 위치를 저장했습니다. 나중에 이어서 생성할 수 있습니다.',
                })
                return
            }
            if (sceneIsGenerating || sceneIsCancelling) {
                cancelSceneGeneration()  // Cancel - invalidates session but keeps button locked
            } else {
                startNewGenerationSession()  // Start - creates new session ID
            }
            return
        }

        if (isGenerating) {
            cancelGeneration()
        } else {
            generate()
        }
    }, [isConflict, isSceneMode, rotationActive, sceneIsGenerating, sceneIsCancelling, cancelSceneGeneration, startNewGenerationSession, isGenerating, cancelGeneration, generate])

    return (
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden p-2">
            {/* Source Image Panel (I2I/Inpaint Mode) */}
            <SourceImagePanel />

            {/* This is the only scrolling region in the prompt sheet. The action
                rail and generate control below remain reachable on short Android
                viewports while every prompt field stays available. */}
            <div className="relative mb-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain pr-1">
                {isMainMode && (
                    <div className="flex flex-none flex-col gap-2">
                        <RecipeSelector />
                        <ResolvedPlanPanel />
                    </div>
                )}

                {/* Character Prompt Panel (Accordion Style) - 프롬프트 영역 위에 오버레이 */}
                <CharacterPromptPanel
                    open={characterPanelOpen}
                    onOpenChange={setCharacterPanelOpen}
                />

                {/* Base Prompt - Collapsible */}
                <div className={cn(
                    "flex flex-none flex-col overflow-hidden",
                    basePromptCollapsed ? "" : "min-h-36"
                )}>
                    <button
                        type="button"
                        onClick={() => setBasePromptCollapsed(!basePromptCollapsed)}
                        className="flex h-11 shrink-0 items-center gap-2 rounded-control px-2 text-left text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-expanded={!basePromptCollapsed}
                        aria-controls="prompt-base-field"
                    >
                        {basePromptCollapsed ? (
                            <ChevronDown className="h-3 w-3" />
                        ) : (
                            <ChevronUp className="h-3 w-3" />
                        )}
                        {t('prompt.base')}
                        {basePromptCollapsed && basePrompt && (
                            <span className="text-muted-foreground font-normal truncate max-w-[200px]">
                                - {basePrompt.split(',')[0]}...
                            </span>
                        )}
                    </button>
                    {!basePromptCollapsed && (
                        <div id="prompt-base-field" className="min-h-0 flex-1">
                            <AutocompleteTextarea
                                placeholder={t('prompt.basePlaceholder')}
                                value={basePrompt}
                                onChange={(e) => setBasePrompt(e.target.value)}
                                className="h-full min-h-24 resize-none rounded-control"
                                style={{ fontSize: `${promptFontSize}px` }}
                            />
                        </div>
                    )}
                </div>

                {/* Additional Prompt - Collapsible */}
                <div className={cn(
                    "flex flex-none flex-col overflow-hidden",
                    additionalPromptCollapsed ? "" : "min-h-32"
                )}>
                    <button
                        type="button"
                        onClick={() => setAdditionalPromptCollapsed(!additionalPromptCollapsed)}
                        className="flex h-11 shrink-0 items-center gap-2 rounded-control px-2 text-left text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-expanded={!additionalPromptCollapsed}
                        aria-controls="prompt-additional-field"
                    >
                        {additionalPromptCollapsed ? (
                            <ChevronDown className="h-3 w-3" />
                        ) : (
                            <ChevronUp className="h-3 w-3" />
                        )}
                        {t('prompt.additional')}
                        {additionalPromptCollapsed && additionalPrompt && (
                            <span className="text-muted-foreground font-normal truncate max-w-[200px]">
                                - {additionalPrompt.split(',')[0]}...
                            </span>
                        )}
                    </button>
                    {!additionalPromptCollapsed && (
                        <div id="prompt-additional-field" className="min-h-0 flex-1">
                            <AutocompleteTextarea
                                placeholder={t('prompt.additionalPlaceholder')}
                                value={additionalPrompt}
                                onChange={(e) => setAdditionalPrompt(e.target.value)}
                                className="h-full min-h-20 resize-none rounded-control"
                                style={{ fontSize: `${promptFontSize}px` }}
                            />
                        </div>
                    )}
                </div>

                {/* Detail Prompt - Collapsible */}
                <div className={cn(
                    "flex flex-none flex-col overflow-hidden",
                    detailPromptCollapsed ? "" : "min-h-32"
                )}>
                    <button
                        type="button"
                        onClick={() => setDetailPromptCollapsed(!detailPromptCollapsed)}
                        className="flex h-11 shrink-0 items-center gap-2 rounded-control px-2 text-left text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-expanded={!detailPromptCollapsed}
                        aria-controls="prompt-detail-field"
                    >
                        {detailPromptCollapsed ? (
                            <ChevronDown className="h-3 w-3" />
                        ) : (
                            <ChevronUp className="h-3 w-3" />
                        )}
                        {t('prompt.detail')}
                        {detailPromptCollapsed && detailPrompt && (
                            <span className="text-muted-foreground font-normal truncate max-w-[200px]">
                                - {detailPrompt.split(',')[0]}...
                            </span>
                        )}
                    </button>
                    {!detailPromptCollapsed && (
                        <div id="prompt-detail-field" className="min-h-0 flex-1">
                            <AutocompleteTextarea
                                placeholder={t('prompt.detailPlaceholder')}
                                value={detailPrompt}
                                onChange={(e) => setDetailPrompt(e.target.value)}
                                className="h-full min-h-20 resize-none rounded-control"
                                style={{ fontSize: `${promptFontSize}px` }}
                            />
                        </div>
                    )}
                </div>

                {/* Negative Prompt - 20% (collapsible, collapses downward) */}
                <div className={cn(
                    "flex flex-none flex-col overflow-hidden",
                    negativePromptCollapsed ? "" : "min-h-32"
                )}>
                    <button
                        type="button"
                        onClick={() => setNegativePromptCollapsed(!negativePromptCollapsed)}
                        className="flex h-11 shrink-0 items-center gap-2 rounded-control px-2 text-left text-xs font-medium text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-expanded={!negativePromptCollapsed}
                        aria-controls="prompt-negative-field"
                    >
                        {negativePromptCollapsed ? (
                            <ChevronDown className="h-3 w-3" />
                        ) : (
                            <ChevronUp className="h-3 w-3" />
                        )}
                        {t('prompt.negative')}
                        {negativePromptCollapsed && negativePrompt && (
                            <span className="text-muted-foreground font-normal truncate max-w-[200px]">
                                - {negativePrompt.split(',')[0]}...
                            </span>
                        )}
                    </button>
                    {!negativePromptCollapsed && (
                        <div id="prompt-negative-field" className="min-h-0 flex-1">
                            <AutocompleteTextarea
                                placeholder={t('prompt.negativePlaceholder')}
                                value={negativePrompt}
                                onChange={(e) => setNegativePrompt(e.target.value)}
                                className="h-full min-h-20 resize-none rounded-control border-destructive/30"
                                style={{ fontSize: `${promptFontSize}px` }}
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* Quick Actions & Parameters Button */}
            <div className="mb-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem_2.75rem_2.75rem] gap-2 min-[480px]:flex">
                <CharacterSettingsDialog open={imageRefDialogOpen} onOpenChange={setImageRefDialogOpen} />
                {/* Character Prompt Toggle Button */}
                <Button
                    variant={characterPanelOpen ? "default" : "outline"}
                    size="sm"
                    className={cn(
                        "relative h-11 min-w-0 rounded-control px-2 text-xs",
                        characterPanelOpen && "bg-primary text-primary-foreground"
                    )}
                    onClick={() => setCharacterPanelOpen(!characterPanelOpen)}
                >
                    <Users className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 truncate">{t('prompt.character', '캐릭터')}</span>
                    {characterCount > 0 && (
                        <div className={cn(
                            "absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-md px-1 py-0.5 text-[11px] font-bold leading-none shadow-sm",
                            characterPanelOpen
                                ? "bg-primary-foreground text-primary"
                                : "bg-primary text-primary-foreground"
                        )}>
                            {characterCount}
                        </div>
                    )}
                </Button>
                {/* Fragment Prompt Button */}
                <Button
                    variant="outline"
                    size="sm"
                    className="h-11 w-11 min-w-0 rounded-control px-0 text-xs min-[480px]:w-auto min-[480px]:flex-1 min-[480px]:px-2"
                    onClick={() => setFragmentDialogOpen(true)}
                    aria-label={t('prompt.fragment')}
                >
                    <Puzzle className="h-3.5 w-3.5 shrink-0 min-[480px]:mr-1.5" />
                    <span className="sr-only min-[480px]:not-sr-only min-[480px]:min-w-0 min-[480px]:truncate">{t('prompt.fragment')}</span>
                </Button>
                {/* AI Prompt Generator Button */}
                <Tip content={t('promptGenerator.desc', 'Gemini AI로 프롬프트 생성')}>
                    <Button
                        variant="outline"
                        size="icon"
                        className="h-11 w-11 shrink-0 rounded-control hover:bg-accent"
                        onClick={() => setPromptGenOpen(true)}
                        aria-label={t('promptGenerator.title', 'AI 프롬프트 생성')}
                    >
                        <img src={GeminiIcon} alt="Gemini" className="h-5 w-5" />
                    </Button>
                </Tip>
                {/* Parameter Settings Dialog */}
                <Dialog open={parameterDialogOpen} onOpenChange={setParameterDialogOpen}>
                    <DialogTrigger asChild>
                        <Button variant="outline" size="icon" className="h-11 w-11 shrink-0 rounded-control" aria-label={t('parameters.title')}>
                            <SlidersHorizontal className="h-4 w-4" />
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[480px] max-h-[85vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle>{t('parameters.title')}</DialogTitle>
                            <DialogDescription>
                                {t('parameters.description')}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-5 py-4">
                            {/* Model Selection */}
                            <div className="space-y-2">
                                <Label className="flex items-center gap-2">
                                    <Cpu className="h-4 w-4" />
                                    {t('parameters.model')}
                                </Label>
                                <Select value={model} onValueChange={setModel}>
                                    <SelectTrigger className="rounded-control">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {AVAILABLE_MODELS.map((m) => (
                                            <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Resolution (Moved here) */}
                            {/* Resolution (Moved here) */}
                            <div className="space-y-2">
                                <Label className="text-sm font-medium">
                                    {t('settingsPage.general.resolution', '해상도')}
                                </Label>
                                <ResolutionSelector
                                    value={selectedResolution}
                                    onChange={setSelectedResolution}
                                    disabled={isGenerating}
                                />
                            </div>

                            {/* Seed (Moved here) */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium">{t('settings.seed')}</label>
                                <div className="flex gap-2">
                                    <Input
                                        type="number"
                                        value={seed}
                                        onChange={(e) => setSeed(Number(e.target.value))}
                                        disabled={seedLocked}
                                        className="h-11 flex-1 rounded-control text-xs"
                                    />
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className={cn("h-11 w-11 shrink-0 rounded-control", seedLocked && 'border-primary bg-primary/10 text-primary')}
                                        onClick={() => setSeedLocked(!seedLocked)}
                                        aria-label={seedLocked ? t('settings.unlockSeed', '시드 잠금 해제') : t('settings.lockSeed', '시드 잠금')}
                                    >
                                        {seedLocked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="h-11 w-11 shrink-0 rounded-control"
                                        onClick={handleRandomSeed}
                                        disabled={seedLocked}
                                        aria-label={t('settings.randomSeed', '무작위 시드')}
                                    >
                                        <Dice5 className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            </div>

                            {/* Steps */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <Label>{t('parameters.steps')}</Label>
                                    <span className="text-sm text-muted-foreground">{steps}</span>
                                </div>
                                <Slider
                                    value={[steps]}
                                    onValueChange={([v]) => setSteps(v)}
                                    min={1}
                                    max={50}
                                    step={1}
                                    className={cn("w-full", steps > 28 && "[&>.relative>.bg-primary]:bg-destructive")}
                                />
                            </div>

                            {/* CFG Scale */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <Label>{t('parameters.cfgScale')}</Label>
                                    <span className="text-sm text-muted-foreground">{cfgScale.toFixed(1)}</span>
                                </div>
                                <Slider
                                    value={[cfgScale]}
                                    onValueChange={([v]) => setCfgScale(v)}
                                    min={1}
                                    max={10}
                                    step={0.1}
                                    className="w-full"
                                />
                            </div>

                            {/* CFG Rescale */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <Label>{t('parameters.cfgRescale')}</Label>
                                    <span className="text-sm text-muted-foreground">{cfgRescale.toFixed(2)}</span>
                                </div>
                                <Slider
                                    value={[cfgRescale]}
                                    onValueChange={([v]) => setCfgRescale(v)}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    className="w-full"
                                />
                            </div>

                            {/* Sampler & Scheduler */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <Label>{t('parameters.sampler')}</Label>
                                    <Select value={sampler} onValueChange={setSampler}>
                                        <SelectTrigger className="rounded-control">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {SAMPLERS.map((s) => (
                                                <SelectItem key={s} value={s}>{s}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>{t('parameters.scheduler')}</Label>
                                    <Select value={scheduler} onValueChange={setScheduler}>
                                        <SelectTrigger className="rounded-control">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {SCHEDULERS.map((s) => (
                                                <SelectItem key={s} value={s}>{s}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            {/* SMEA & SMEA DYN */}
                            <div className="flex items-center justify-between pt-2">
                                <div className="flex flex-col gap-1">
                                    <Label className="cursor-pointer" onClick={() => setSmea(!smea)}>
                                        {t('parameters.smea')}
                                    </Label>
                                    <span className="text-xs text-muted-foreground">Switchable Multi-head External Attention</span>
                                </div>
                                <Switch
                                    checked={smea}
                                    onChange={(e) => setSmea(e.target.checked)}
                                    aria-label={t('parameters.smea')}
                                />
                            </div>

                            <div className="flex items-center justify-between">
                                <div className="flex flex-col gap-1">
                                    <Label className="cursor-pointer" onClick={() => setSmeaDyn(!smeaDyn)}>
                                        {t('parameters.smeaDyn')}
                                    </Label>
                                    <span className="text-xs text-muted-foreground">Dynamic SMEA</span>
                                </div>
                                <Switch
                                    checked={smeaDyn}
                                    disabled={!smea}
                                    onChange={(e) => setSmeaDyn(e.target.checked)}
                                    aria-label={t('parameters.smeaDyn')}
                                />
                            </div>

                            {/* Variety+ */}
                            <div className="flex items-center justify-between">
                                <div className="flex flex-col gap-1">
                                    <Label className="cursor-pointer" onClick={() => setVariety(!variety)}>
                                        {t('parameters.variety', 'Variety+')}
                                    </Label>
                                    <span className="text-xs text-muted-foreground">Increases generation variety</span>
                                </div>
                                <Switch
                                    checked={variety}
                                    onChange={(e) => setVariety(e.target.checked)}
                                    aria-label={t('parameters.variety', 'Variety+')}
                                />
                            </div>

                            {/* Add Quality Tags */}
                            <div className="flex items-center justify-between">
                                <div className="flex flex-col gap-1">
                                    <Label className="cursor-pointer" onClick={() => setQualityToggle(!qualityToggle)}>
                                        {t('parameters.qualityToggle', 'Add Quality Tags')}
                                    </Label>
                                    <span className="text-xs text-muted-foreground">Adds quality tags to prompt</span>
                                </div>
                                <Switch
                                    checked={qualityToggle}
                                    onChange={(e) => setQualityToggle(e.target.checked)}
                                    aria-label={t('parameters.qualityToggle', 'Add Quality Tags')}
                                />
                            </div>

                            {/* UC Preset */}
                            <div className="space-y-2">
                                <Label>{t('parameters.ucPreset', 'UC Preset')}</Label>
                                <Select value={String(ucPreset)} onValueChange={(v) => setUcPreset(Number(v))}>
                                    <SelectTrigger className="rounded-control">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="0">Heavy</SelectItem>
                                        <SelectItem value="1">Light</SelectItem>
                                        <SelectItem value="2">Furry Focus</SelectItem>
                                        <SelectItem value="3">Human Focus</SelectItem>
                                        <SelectItem value="4">None</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* End of Parameters Dialog Content */}
                        </div>

                    </DialogContent>
                </Dialog>
            </div>

            {/* AI Prompt Generator Dialog */}
            <PromptGeneratorDialog
                open={promptGenOpen}
                onOpenChange={setPromptGenOpen}
                onApply={(tags) => {
                    // Append to additional prompt
                    const current = additionalPrompt.trim()
                    const newValue = current ? `${current}, ${tags}` : tags
                    setAdditionalPrompt(newValue)
                }}
            />

            {/* Bottom Generate Button Area */}
            <div className="p-0">
                {/* Generate Button + Counter */}
                <div className="flex flex-wrap gap-2">
                    <Button
                        data-testid="prompt-generate-action"
                        variant={(isGenerating || (isSceneMode && (sceneIsGenerating || sceneIsCancelling || rotationActive))) ? "destructive" : "generate"}
                        size="lg"
                        className={cn(
                            "h-12 min-w-40 flex-1 rounded-control px-4 text-sm font-semibold leading-tight whitespace-normal",
                            isConflict && "opacity-50 cursor-not-allowed"
                        )}
                        onClick={handleGenerateOrCancel}
                        disabled={
                            (isSceneMode && sceneQueueCount === 0 && !sceneIsGenerating && !sceneIsCancelling && !rotationActive) ||
                            isConflict ||
                            (sceneIsCancelling && !rotationActive) ||  // Disable while waiting for API to complete after cancel (Scene Mode)
                            (isGenerating && isCancelled)  // Disable while waiting for API to complete after cancel (Main Mode)
                        }
                    >
                        {isSceneMode ? (
                            sceneIsCancelling ? (
                                <>
                                    <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                                    {t('common.cancelling', '취소 중...')}
                                </>
                            ) : rotationActive ? (
                                <>
                                    <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                                    중단하고 나중에 이어서
                                </>
                            ) : sceneIsGenerating ? (
                                <>
                                    <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                                    {t('common.cancel', '취소')} {totalQueuedCount > 0 && `(${completedCount + 1}/${totalQueuedCount})`}
                                </>
                            ) : (
                                <>
                                    <Film className="mr-2 h-5 w-5" />
                                    {t('scene.generateAll', '씬 생성')} {sceneQueueCount > 0 && `(${sceneQueueCount})`}
                                </>
                            )
                        ) : (
                            isGenerating && isCancelled ? (
                                <>
                                    <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                                    {t('common.cancelling', '취소 중...')}
                                </>
                            ) : isGenerating ? (
                                <>
                                    <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                                    {batchCount > 1
                                        ? `${t('generate.cancel')} (${currentBatch}/${batchCount})`
                                        : t('generate.cancel')
                                    }
                                </>
                            ) : (
                                <>
                                    <ImagePlus className="mr-2 h-5 w-5" />
                                    {t('generate.button')}
                                </>
                            )
                        )}
                    </Button>
                    <Counter
                        value={batchCount}
                        onChange={setBatchCount}
                        min={1}
                        max={9999}
                        fontSize={16}
                        className="shrink-0"
                    />
                </div>
            </div>

            {/* Fragment Prompt Dialog */}
            <FragmentPromptDialog
                open={fragmentDialogOpen}
                onOpenChange={setFragmentDialogOpen}
            />
        </div>
    )
}
