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
} from 'lucide-react'
import GeminiIcon from '@/assets/gemini-color.svg'
import { AVAILABLE_MODELS } from '@/stores/generation-store'
import { useGenerationDraftStore } from '@/stores/generation-draft-store'
import { useGenerationSessionStore } from '@/stores/generation-session-store'
import { useSceneStore } from '@/stores/scene-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import { ResolutionSelector } from '@/components/ui/ResolutionSelector'
import { useRotationStore } from '@/stores/character-rotation-store'
import { toast } from '@/components/ui/use-toast'
import { RecipeSelector } from '@/components/composition/RecipeSelector'
import { ResolvedPlanPanel } from '@/components/composition/ResolvedPlanPanel'
import { useQueueStore } from '@/stores/queue-store'
import { enqueueCurrentSceneQueue } from '@/services/queue/scene-queue-adapter'
import { getRuntimeDurableQueueCoordinator } from '@/services/queue/runtime'
import {
    cancelMainGenerationCommand,
    startMainGenerationCommand,
} from '@/services/generation/generation-command'

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
type PromptSlot = 'base' | 'additional' | 'detail' | 'negative'

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
    const queueExecutionAuthority = useQueueStore(state => state.executionAuthority)

    const sceneQueueCount = activePresetId ? getTotalQueueCount(activePresetId) : 0

    // Zustand 선택적 구독 - generationStore (상태)
    const basePrompt = useGenerationDraftStore(state => state.basePrompt)
    const additionalPrompt = useGenerationDraftStore(state => state.additionalPrompt)
    const detailPrompt = useGenerationDraftStore(state => state.detailPrompt)
    const negativePrompt = useGenerationDraftStore(state => state.negativePrompt)
    const seed = useGenerationDraftStore(state => state.seed)
    const seedLocked = useGenerationDraftStore(state => state.seedLocked)
    const selectedResolution = useGenerationDraftStore(state => state.selectedResolution)
    const isGenerating = useGenerationSessionStore(state => state.isGenerating)
    const isCancelled = useGenerationSessionStore(state => state.isCancelled)
    const model = useGenerationDraftStore(state => state.model)
    const steps = useGenerationDraftStore(state => state.steps)
    const cfgScale = useGenerationDraftStore(state => state.cfgScale)
    const cfgRescale = useGenerationDraftStore(state => state.cfgRescale)
    const sampler = useGenerationDraftStore(state => state.sampler)
    const scheduler = useGenerationDraftStore(state => state.scheduler)
    const smea = useGenerationDraftStore(state => state.smea)
    const smeaDyn = useGenerationDraftStore(state => state.smeaDyn)
    const variety = useGenerationDraftStore(state => state.variety)
    const qualityToggle = useGenerationDraftStore(state => state.qualityToggle)
    const ucPreset = useGenerationDraftStore(state => state.ucPreset)
    const batchCount = useGenerationDraftStore(state => state.batchCount)
    const currentBatch = useGenerationSessionStore(state => state.currentBatch)
    const generatingMode = useGenerationSessionStore(state => state.generatingMode)

    // Zustand 선택적 구독 - generationStore (액션)
    const setBasePrompt = useGenerationDraftStore(state => state.setBasePrompt)
    const setAdditionalPrompt = useGenerationDraftStore(state => state.setAdditionalPrompt)
    const setDetailPrompt = useGenerationDraftStore(state => state.setDetailPrompt)
    const setNegativePrompt = useGenerationDraftStore(state => state.setNegativePrompt)
    const setSeed = useGenerationDraftStore(state => state.setSeed)
    const setSeedLocked = useGenerationDraftStore(state => state.setSeedLocked)
    const setSelectedResolution = useGenerationDraftStore(state => state.setSelectedResolution)
    const setModel = useGenerationDraftStore(state => state.setModel)
    const setSteps = useGenerationDraftStore(state => state.setSteps)
    const setCfgScale = useGenerationDraftStore(state => state.setCfgScale)
    const setCfgRescale = useGenerationDraftStore(state => state.setCfgRescale)
    const setSampler = useGenerationDraftStore(state => state.setSampler)
    const setScheduler = useGenerationDraftStore(state => state.setScheduler)
    const setSmea = useGenerationDraftStore(state => state.setSmea)
    const setSmeaDyn = useGenerationDraftStore(state => state.setSmeaDyn)
    const setVariety = useGenerationDraftStore(state => state.setVariety)
    const setQualityToggle = useGenerationDraftStore(state => state.setQualityToggle)
    const setUcPreset = useGenerationDraftStore(state => state.setUcPreset)
    const setBatchCount = useGenerationDraftStore(state => state.setBatchCount)

    // Font size remains a shared display preference. Legacy collapse flags stay
    // persisted for sync compatibility, while the command surface uses one local slot.
    const promptFontSize = useSettingsStore(state => state.promptFontSize)

    // Zustand 선택적 구독 - characterPromptStore
    const characterCount = useCharacterPromptStore(state => state.characters.filter(c => c.enabled).length)

    const [promptGenOpen, setPromptGenOpen] = useState(false)
    const [fragmentDialogOpen, setFragmentDialogOpen] = useState(false)
    const [characterPanelOpen, setCharacterPanelOpen] = useState(false)
    const [imageRefDialogOpen, setImageRefDialogOpen] = useState(false)
    const [parameterDialogOpen, setParameterDialogOpen] = useState(false)
    const [activePromptSlot, setActivePromptSlot] = useState<PromptSlot>('base')

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
        : isSceneGenerating

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
                cancelSceneGeneration()  // Invalidate the session and abort its active requests
            } else if (queueExecutionAuthority === 'legacy') {
                startNewGenerationSession()  // Start - creates new session ID
            } else if (sceneQueueCount > 0) {
                void enqueueCurrentSceneQueue()
                    .then(result => result === null ? undefined : getRuntimeDurableQueueCoordinator().drain())
                    .catch(error => toast({
                        title: t('common.error', 'Error'),
                        description: error instanceof Error ? error.message : t('queue.enqueueFailed', 'Queue enqueue failed'),
                        variant: 'destructive',
                    }))
            }
            return
        }

        if (isGenerating) {
            void cancelMainGenerationCommand()
        } else {
            void startMainGenerationCommand()
        }
    }, [isConflict, isSceneMode, rotationActive, sceneIsGenerating, sceneIsCancelling, cancelSceneGeneration, queueExecutionAuthority, sceneQueueCount, startNewGenerationSession, isGenerating, t])

    const promptSlots = [
        {
            id: 'base' as const,
            label: t('prompt.base'),
            placeholder: t('prompt.basePlaceholder'),
            value: basePrompt,
            setValue: setBasePrompt,
        },
        {
            id: 'additional' as const,
            label: t('prompt.additional'),
            placeholder: t('prompt.additionalPlaceholder'),
            value: additionalPrompt,
            setValue: setAdditionalPrompt,
        },
        {
            id: 'detail' as const,
            label: t('prompt.detail'),
            placeholder: t('prompt.detailPlaceholder'),
            value: detailPrompt,
            setValue: setDetailPrompt,
        },
        {
            id: 'negative' as const,
            label: t('prompt.negative'),
            placeholder: t('prompt.negativePlaceholder'),
            value: negativePrompt,
            setValue: setNegativePrompt,
        },
    ]
    const activePrompt = promptSlots.find(slot => slot.id === activePromptSlot) ?? promptSlots[0]

    return (
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden p-5">
            {/* Source Image Panel (I2I/Inpaint Mode) */}
            <SourceImagePanel />

            {/* This is the only scrolling region in the prompt sheet. The action
                rail and generate control below remain reachable on short Android
                viewports while every prompt field stays available. */}
            <div className="relative mb-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain pr-1">
                {isMainMode && (
                    <div className="flex flex-none flex-col gap-3">
                        <RecipeSelector />
                        <ResolvedPlanPanel />
                    </div>
                )}

                {/* Character Prompt Panel (Accordion Style) - 프롬프트 영역 위에 오버레이 */}
                <CharacterPromptPanel
                    open={characterPanelOpen}
                    onOpenChange={setCharacterPanelOpen}
                />

                {/* A single command surface keeps every prompt layer one tap away
                    without stacking four competing card headers and editors. */}
                <div className="flex min-h-40 flex-none flex-col gap-2 rounded-panel bg-canvas p-2">
                    <div className="grid grid-cols-4 gap-1" role="tablist" aria-label={t('prompt.title', '프롬프트')}>
                        {promptSlots.map(slot => {
                            const isActive = slot.id === activePrompt.id
                            return (
                                <button
                                    key={slot.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={isActive}
                                    aria-controls="prompt-command-editor"
                                    onClick={() => setActivePromptSlot(slot.id)}
                                    className={cn(
                                        'relative flex h-11 min-w-0 items-center justify-center rounded-control px-2 text-xs font-medium transition-colors duration-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                        isActive
                                            ? slot.id === 'negative' ? 'bg-destructive/10 text-destructive' : 'bg-accent text-primary'
                                            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                                    )}
                                >
                                    <span className="truncate">{slot.label}</span>
                                    {slot.value && !isActive && (
                                        <span className="absolute bottom-1.5 h-1 w-1 rounded-full bg-current opacity-60" aria-hidden="true" />
                                    )}
                                </button>
                            )
                        })}
                    </div>
                    <div id="prompt-command-editor" role="tabpanel" className="min-h-28 flex-1">
                        <AutocompleteTextarea
                            key={activePrompt.id}
                            placeholder={activePrompt.placeholder}
                            value={activePrompt.value}
                            onChange={(event) => activePrompt.setValue(event.target.value)}
                            className={cn(
                                'h-full min-h-28 resize-none rounded-control bg-card',
                                activePrompt.id === 'negative' && 'border-destructive/30',
                            )}
                            style={{ fontSize: `${promptFontSize}px` }}
                        />
                    </div>
                </div>
            </div>

            {/* Prompt helpers share a quiet tonal rail; dialogs carry their own hierarchy once opened. */}
            <div className="mb-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem_2.75rem_2.75rem] gap-1 rounded-panel bg-canvas p-1 min-[480px]:flex">
                <CharacterSettingsDialog open={imageRefDialogOpen} onOpenChange={setImageRefDialogOpen} />
                {/* Character Prompt Toggle Button */}
                <Button
                    variant={characterPanelOpen ? "default" : "ghost"}
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
                            "absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-md px-1 py-0.5 text-[11px] font-bold leading-none",
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
                    variant="ghost"
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
                        variant="ghost"
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
                        <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0 rounded-control" aria-label={t('parameters.title')}>
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
                                        className={cn("h-11 w-11 shrink-0 rounded-control", seedLocked && 'bg-primary/10 text-primary')}
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
