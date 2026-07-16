import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { FragmentPromptDialog } from '@/components/fragments/FragmentPromptDialog'
import { SourceImagePanel } from '@/components/layout/SourceImagePanel'
import { CharacterSettingsDialog } from '@/components/character/CharacterSettingsDialog'
import { CharacterPromptPanel } from '@/components/character/CharacterPromptPanel'
import { PromptGeneratorDialog } from '@/components/prompt/PromptGeneratorDialog'
import { PromptEditorSurface } from '@/components/prompt/PromptEditorSurface'
import { PromptGenerationControls } from '@/components/prompt/PromptGenerationControls'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
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
    Dice5,
    Lock,
    Unlock,
    SlidersHorizontal,
    Cpu,
    Puzzle,
    Users,
} from 'lucide-react'
import GeminiIcon from '@/assets/gemini-color.svg'
import { AVAILABLE_MODELS } from '@/stores/generation-store'
import { useGenerationDraftStore } from '@/stores/generation-draft-store'
import { useGenerationSessionStore } from '@/stores/generation-session-store'
import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import { ResolutionSelector } from '@/components/ui/ResolutionSelector'
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

    const additionalPrompt = useGenerationDraftStore(state => state.additionalPrompt)
    const seed = useGenerationDraftStore(state => state.seed)
    const seedLocked = useGenerationDraftStore(state => state.seedLocked)
    const selectedResolution = useGenerationDraftStore(state => state.selectedResolution)
    const isGenerating = useGenerationSessionStore(state => state.isGenerating)
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

    // Zustand 선택적 구독 - generationStore (액션)
    const setAdditionalPrompt = useGenerationDraftStore(state => state.setAdditionalPrompt)
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
        // Sequential proposals hold a runtime lease while the provider runs;
        // keep the editor closed so UI mutations cannot invalidate paid work.
        const handleOpenFragment = () => {
            if (!isGenerating) setFragmentDialogOpen(prev => !prev)
        }
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
    }, [isGenerating])

    useEffect(() => {
        if (isGenerating) setFragmentDialogOpen(false)
    }, [isGenerating])

    const handleRandomSeed = () => {
        if (!seedLocked) {
            setSeed(generateRandomSeed())
        }
    }

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

                <PromptEditorSurface />
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
                    disabled={isGenerating}
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

            <PromptGenerationControls isSceneMode={isSceneMode} />

            {/* Fragment Prompt Dialog */}
            <FragmentPromptDialog
                open={fragmentDialogOpen}
                onOpenChange={setFragmentDialogOpen}
            />
        </div>
    )
}
