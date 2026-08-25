import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AutocompleteTextarea } from '@/components/ui/AutocompleteTextarea'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
    resolveSceneCharacterCaptions,
    useSceneStore,
    type SceneCard,
    type SceneCharacterCaption,
} from '@/stores/scene-store'
import { useSettingsStore } from '@/stores/settings-store'

interface SceneCharacterCaptionsEditorProps {
    scene: SceneCard
    presetId: string
    disabled?: boolean
}

const clampCoordinate = (value: number): number => Math.min(1, Math.max(0, value))

/**
 * This controlled editor writes the complete Scene-owned caption array. The
 * generation builders consume that same array, so UI order, enable state,
 * negatives, and coordinates survive persistence without touching Main mode.
 */
export function SceneCharacterCaptionsEditor({
    scene,
    presetId,
    disabled = false,
}: SceneCharacterCaptionsEditorProps) {
    const { t } = useTranslation()
    const fontSize = useSettingsStore(state => state.promptFontSize)
    const captions = resolveSceneCharacterCaptions(scene)
    const updateCaptions = useSceneStore(state => state.updateSceneCharacterCaptions)
    const positionEnabled = scene.characterPositionEnabled === true

    const commit = (next: readonly SceneCharacterCaption[], nextPositionEnabled?: boolean) => {
        updateCaptions(presetId, scene.id, next, nextPositionEnabled)
    }

    const addCaption = () => {
        commit([...captions, {
            id: `${Date.now()}-${crypto.randomUUID()}`,
            name: '',
            prompt: '',
            negative: '',
            enabled: true,
            position: { x: 0.5, y: 0.5 },
        }])
    }

    const patchCaption = (id: string, patch: Partial<SceneCharacterCaption>) => {
        commit(captions.map(caption => caption.id === id
            ? {
                ...caption,
                ...patch,
                position: patch.position ? { ...patch.position } : caption.position,
            }
            : caption))
    }

    const patchCoordinate = (caption: SceneCharacterCaption, axis: 'x' | 'y', raw: string) => {
        const value = Number(raw)
        if (!Number.isFinite(value)) return
        patchCaption(caption.id, {
            position: { ...caption.position, [axis]: clampCoordinate(value) },
        })
    }

    return (
        <section className="mt-3 border-t border-border/70 pt-3" data-testid="scene-character-captions-editor">
            <div className="flex flex-wrap items-center justify-between gap-2 px-2">
                <div>
                    <h3 className="text-sm font-semibold">{t('scene.characterCaptions', '캐릭터 캡션')}</h3>
                    <p className="text-xs text-muted-foreground">
                        {t('scene.characterCaptionsHelp', '이 씬에 보낼 캐릭터별 프롬프트와 네거티브를 각각 설정합니다.')}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Label htmlFor={`scene-character-position-${scene.id}`} className="text-xs">
                        {t('scene.characterPosition', '위치 지정')}
                    </Label>
                    <Switch
                        id={`scene-character-position-${scene.id}`}
                        checked={positionEnabled}
                        onChange={event => commit(captions, event.target.checked)}
                        disabled={disabled}
                    />
                    <Button type="button" variant="outline" size="sm" onClick={addCaption} disabled={disabled}>
                        <Plus className="h-4 w-4" />
                        {t('scene.addCharacterCaption', '캐릭터 추가')}
                    </Button>
                </div>
            </div>

            {captions.length === 0 ? (
                <div className="mx-2 mt-3 border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                    {t('scene.noCharacterCaptions', '아직 캐릭터 캡션이 없습니다.')}
                </div>
            ) : (
                <div className="mt-3 grid gap-3 px-2">
                    {captions.map((caption, index) => (
                        <article
                            key={caption.id}
                            className="border border-border/70 bg-background/40 p-3"
                            data-testid="scene-character-caption"
                        >
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center bg-muted text-xs font-semibold">
                                    {index + 1}
                                </span>
                                <Input
                                    value={caption.name ?? ''}
                                    onChange={event => patchCaption(caption.id, { name: event.target.value })}
                                    placeholder={t('scene.characterName', '캐릭터 이름')}
                                    aria-label={t('scene.characterName', '캐릭터 이름')}
                                    disabled={disabled}
                                    className="h-9 min-w-40 flex-1"
                                />
                                <Label htmlFor={`scene-character-enabled-${caption.id}`} className="text-xs">
                                    {t('common.enabled', '사용')}
                                </Label>
                                <Switch
                                    id={`scene-character-enabled-${caption.id}`}
                                    checked={caption.enabled}
                                    onChange={event => patchCaption(caption.id, { enabled: event.target.checked })}
                                    disabled={disabled}
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => commit(captions.filter(item => item.id !== caption.id))}
                                    disabled={disabled}
                                    aria-label={t('scene.removeCharacterCaption', '캐릭터 캡션 삭제')}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>

                            <div className="mt-3 grid gap-3 lg:grid-cols-2">
                                <label className="space-y-1">
                                    <span className="text-xs font-medium text-muted-foreground">
                                        {t('characterPanel.prompt', '프롬프트')}
                                    </span>
                                    <AutocompleteTextarea
                                        key={`${caption.id}:positive`}
                                        value={caption.prompt}
                                        onChange={event => patchCaption(caption.id, { prompt: event.target.value })}
                                        placeholder={t('scene.characterPromptPlaceholder', '캐릭터 프롬프트')}
                                        ariaLabel={`${caption.name || index + 1} ${t('characterPanel.prompt', '프롬프트')}`}
                                        disabled={disabled}
                                        className="h-28 min-h-28 resize-y"
                                        style={{ fontSize: `${fontSize}px` }}
                                    />
                                </label>
                                <label className="space-y-1">
                                    <span className="text-xs font-medium text-muted-foreground">
                                        {t('scene.characterNegativePrompt', '캐릭터 네거티브')}
                                    </span>
                                    <AutocompleteTextarea
                                        key={`${caption.id}:negative`}
                                        value={caption.negative}
                                        onChange={event => patchCaption(caption.id, { negative: event.target.value })}
                                        placeholder={t('scene.characterNegativePromptPlaceholder', '캐릭터 네거티브 프롬프트')}
                                        ariaLabel={`${caption.name || index + 1} ${t('scene.characterNegativePrompt', '캐릭터 네거티브')}`}
                                        disabled={disabled}
                                        className="h-28 min-h-28 resize-y focus-within:ring-destructive/50"
                                        style={{ fontSize: `${fontSize}px` }}
                                    />
                                </label>
                            </div>

                            {positionEnabled && (
                                <div className="mt-3 grid max-w-xs grid-cols-2 gap-2">
                                    {(['x', 'y'] as const).map(axis => (
                                        <label key={axis} className="space-y-1">
                                            <span className="text-xs font-medium uppercase text-muted-foreground">{axis}</span>
                                            <Input
                                                type="number"
                                                min={0}
                                                max={1}
                                                step={0.01}
                                                value={caption.position[axis]}
                                                onChange={event => patchCoordinate(caption, axis, event.target.value)}
                                                disabled={disabled}
                                            />
                                        </label>
                                    ))}
                                </div>
                            )}
                        </article>
                    ))}
                </div>
            )}
        </section>
    )
}
