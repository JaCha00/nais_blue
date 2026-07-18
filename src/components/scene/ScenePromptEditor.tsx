import { useId, useState } from 'react'
import { Copy, Dice5, Lock, Unlock } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AutocompleteTextarea } from '@/components/ui/AutocompleteTextarea'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ResolutionSelector, type Resolution } from '@/components/ui/ResolutionSelector'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import { AVAILABLE_MODELS } from '@/stores/generation-store'
import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import { useGenerationDraftStore } from '@/stores/generation-draft-store'
import {
    resolveSceneGeneration,
    resolveScenePrompts,
    useSceneStore,
    type SceneCard,
    type SceneGenerationConfig,
    type ScenePromptConfig,
} from '@/stores/scene-store'
import { useSettingsStore } from '@/stores/settings-store'

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

type PromptSlot = keyof ScenePromptConfig

interface ScenePromptEditorProps {
    scene: SceneCard
    presetId: string
    disabled?: boolean
}

/**
 * The editor depends on SceneStore for isolated prompt/parameter persistence and
 * reads Main stores only when the explicit copy button is pressed. This one-way
 * boundary keeps Scene edits from mutating the Main prompt panel.
 */
export function ScenePromptEditor({ scene, presetId, disabled = false }: ScenePromptEditorProps) {
    const { t } = useTranslation()
    const [activeSlot, setActiveSlot] = useState<PromptSlot>('base')
    const panelId = `scene-prompt-editor-${useId().replace(/:/g, '')}`
    const fontSize = useSettingsStore(state => state.promptFontSize)
    const prompts = resolveScenePrompts(scene)
    const generation = resolveSceneGeneration(scene)
    const updatePrompts = useSceneStore(state => state.updateScenePrompts)
    const updateGeneration = useSceneStore(state => state.updateSceneGeneration)
    const updateSettings = useSceneStore(state => state.updateSceneSettings)
    const resolution: Resolution = {
        label: `${scene.width ?? 832} × ${scene.height ?? 1216}`,
        width: scene.width ?? 832,
        height: scene.height ?? 1216,
    }

    const basePrompt = useGenerationDraftStore(state => state.basePrompt)
    const additionalPrompt = useGenerationDraftStore(state => state.additionalPrompt)
    const detailPrompt = useGenerationDraftStore(state => state.detailPrompt)
    const negativePrompt = useGenerationDraftStore(state => state.negativePrompt)
    const mainCharacters = useCharacterPromptStore(state => state.characters)

    const promptSlots: Array<{ id: PromptSlot; label: string; placeholder: string; negative?: boolean }> = [
        { id: 'base', label: t('prompt.base', '베이스 프롬프트'), placeholder: t('prompt.basePlaceholder', '베이스 프롬프트') },
        { id: 'additional', label: t('prompt.additional', '추가 프롬프트'), placeholder: t('prompt.additionalPlaceholder', '추가 프롬프트') },
        { id: 'character', label: t('prompt.character', '캐릭터 프롬프트'), placeholder: t('scene.characterPromptPlaceholder', '캐릭터 프롬프트') },
        { id: 'negative', label: t('prompt.negative', '네거티브 프롬프트'), placeholder: t('prompt.negativePlaceholder', '네거티브 프롬프트'), negative: true },
        { id: 'characterNegative', label: t('scene.characterNegativePrompt', '캐릭터 네거티브'), placeholder: t('scene.characterNegativePromptPlaceholder', '캐릭터 네거티브 프롬프트'), negative: true },
    ]
    const active = promptSlots.find(slot => slot.id === activeSlot) ?? promptSlots[0]

    const patchGeneration = <K extends keyof SceneGenerationConfig>(key: K, value: SceneGenerationConfig[K]) => {
        updateGeneration(presetId, scene.id, { [key]: value })
    }

    // ResolutionSelector supplies provider-safe dimensions and SceneStore owns the
    // scene-local snapshot consumed by both legacy and Composition v2 builders.
    const patchResolution = (nextResolution: Resolution) => {
        updateSettings(presetId, scene.id, {
            width: nextResolution.width,
            height: nextResolution.height,
        })
    }

    const copyMainPrompts = () => {
        const enabledCharacters = mainCharacters.filter(character => character.enabled)
        const combinedAdditional = [additionalPrompt, detailPrompt].filter(value => value.trim()).join(', ')
        updatePrompts(presetId, scene.id, {
            base: basePrompt,
            additional: combinedAdditional,
            character: enabledCharacters.map(character => character.prompt).filter(Boolean).join(', '),
            negative: negativePrompt,
            characterNegative: enabledCharacters.map(character => character.negative).filter(Boolean).join(', '),
        })
        toast({ description: t('scene.mainPromptsCopied', '메인 프롬프트를 이 씬에 복사했습니다.') })
    }

    const setNumeric = <K extends keyof SceneGenerationConfig>(
        key: K,
        value: string,
        minimum: number,
        maximum: number,
    ) => {
        const parsed = Number(value)
        if (!Number.isFinite(parsed)) return
        patchGeneration(key, Math.min(maximum, Math.max(minimum, parsed)) as SceneGenerationConfig[K])
    }

    return (
        <section className="shrink-0 rounded-panel border border-border bg-card p-3" data-testid="scene-prompt-editor">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h2 className="text-sm font-semibold">{t('scene.promptComposition', '씬 프롬프트 구성')}</h2>
                    <p className="text-xs text-muted-foreground">{t('scene.promptCompositionHelp', '이 씬에서만 사용할 프롬프트와 생성 설정입니다.')}</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={copyMainPrompts} disabled={disabled}>
                    <Copy className="h-4 w-4" />
                    {t('scene.copyMainPrompts', '메인 프롬프트 가져오기')}
                </Button>
            </div>

            <div className="grid grid-cols-2 gap-1 sm:grid-cols-5" role="tablist" aria-label={t('scene.promptComposition', '씬 프롬프트 구성')}>
                {promptSlots.map(slot => {
                    const selected = slot.id === active.id
                    return (
                        <button
                            key={slot.id}
                            type="button"
                            role="tab"
                            aria-selected={selected}
                            aria-controls={panelId}
                            onClick={() => setActiveSlot(slot.id)}
                            className={cn(
                                'relative min-h-10 min-w-0 rounded-control px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                selected
                                    ? slot.negative ? 'bg-destructive/10 text-destructive' : 'bg-accent text-primary'
                                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                            )}
                        >
                            <span className="line-clamp-2">{slot.label}</span>
                            {prompts[slot.id] && !selected && <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-current" />}
                        </button>
                    )
                })}
            </div>
            <div id={panelId} role="tabpanel" className="mt-2">
                <AutocompleteTextarea
                    key={active.id}
                    value={prompts[active.id]}
                    placeholder={active.placeholder}
                    onChange={(event: any) => updatePrompts(presetId, scene.id, { [active.id]: event.target.value })}
                    disabled={disabled}
                    className={cn('h-24 min-h-24 resize-y rounded-control', active.negative && 'border-destructive/30')}
                    style={{ fontSize: `${fontSize}px` }}
                />
            </div>

            <div className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-2 xl:grid-cols-5">
                <label className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">{t('parameters.model', '모델')}</span>
                    <Select value={generation.model} onValueChange={value => patchGeneration('model', value)} disabled={disabled}>
                        <SelectTrigger className="h-10 rounded-control"><SelectValue /></SelectTrigger>
                        <SelectContent>{AVAILABLE_MODELS.map(model => <SelectItem key={model.id} value={model.id}>{model.name}</SelectItem>)}</SelectContent>
                    </Select>
                </label>
                <div className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">{t('settings.resolution', '해상도')}</span>
                    <div className="[&_button]:h-10 [&_button]:rounded-control" data-testid="scene-resolution-selector">
                        <ResolutionSelector
                            value={resolution}
                            onChange={patchResolution}
                            disabled={disabled}
                        />
                    </div>
                </div>
                <label className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">{t('settings.seed', '시드')}</span>
                    <div className="flex gap-1">
                        <Input type="number" value={generation.seed} onChange={event => setNumeric('seed', event.target.value, 0, 4294967295)} disabled={disabled || !generation.seedLocked} className="h-10 rounded-control font-mono" />
                        <Button type="button" variant={generation.seedLocked ? 'secondary' : 'outline'} size="icon" className="h-10 w-10 shrink-0" onClick={() => patchGeneration('seedLocked', !generation.seedLocked)} disabled={disabled} aria-label={generation.seedLocked ? t('settings.unlockSeed', '시드 잠금 해제') : t('settings.lockSeed', '시드 잠금')}>
                            {generation.seedLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                        </Button>
                        <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => patchGeneration('seed', Math.floor(Math.random() * 4294967295))} disabled={disabled || generation.seedLocked} aria-label={t('settings.randomSeed', '무작위 시드')}>
                            <Dice5 className="h-4 w-4" />
                        </Button>
                    </div>
                </label>
                <label className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">{t('parameters.steps', 'Steps')}</span>
                    <Input type="number" value={generation.steps} min={1} max={50} onChange={event => setNumeric('steps', event.target.value, 1, 50)} disabled={disabled} className="h-10 rounded-control" />
                </label>
                <label className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">{t('parameters.cfgScale', 'CFG Scale')}</span>
                    <Input type="number" value={generation.cfgScale} min={1} max={10} step={0.1} onChange={event => setNumeric('cfgScale', event.target.value, 1, 10)} disabled={disabled} className="h-10 rounded-control" />
                </label>
            </div>

            <details className="mt-2 rounded-control bg-canvas px-3 py-2">
                <summary className="cursor-pointer text-xs font-medium">{t('scene.moreGenerationSettings', '세부 생성 설정')}</summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <label className="space-y-1">
                        <span className="text-xs text-muted-foreground">{t('parameters.cfgRescale', 'CFG Rescale')}</span>
                        <Input type="number" value={generation.cfgRescale} min={0} max={1} step={0.01} onChange={event => setNumeric('cfgRescale', event.target.value, 0, 1)} disabled={disabled} />
                    </label>
                    <label className="space-y-1">
                        <span className="text-xs text-muted-foreground">{t('parameters.sampler', '샘플러')}</span>
                        <Select value={generation.sampler} onValueChange={value => patchGeneration('sampler', value)} disabled={disabled}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>{SAMPLERS.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
                        </Select>
                    </label>
                    <label className="space-y-1">
                        <span className="text-xs text-muted-foreground">{t('parameters.scheduler', '스케줄러')}</span>
                        <Select value={generation.scheduler} onValueChange={value => patchGeneration('scheduler', value)} disabled={disabled}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>{SCHEDULERS.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
                        </Select>
                    </label>
                    <label className="space-y-1">
                        <span className="text-xs text-muted-foreground">{t('parameters.ucPreset', 'UC Preset')}</span>
                        <Input type="number" value={generation.ucPreset} min={0} max={4} onChange={event => setNumeric('ucPreset', event.target.value, 0, 4)} disabled={disabled} />
                    </label>
                    {([
                        ['variety', t('parameters.variety', 'Variety+')],
                        ['qualityToggle', t('parameters.qualityToggle', '품질 태그')],
                    ] as const).map(([key, label]) => (
                        <div key={key} className="flex min-h-10 items-center justify-between rounded-control border border-border px-3">
                            <Label>{label}</Label>
                            <Switch checked={generation[key]} onChange={event => patchGeneration(key, event.target.checked)} disabled={disabled} />
                        </div>
                    ))}
                </div>
            </details>
        </section>
    )
}
