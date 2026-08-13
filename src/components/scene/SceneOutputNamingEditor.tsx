import { useId, useState } from 'react'
import { FilePenLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useSceneStore, type SceneCard } from '@/stores/scene-store'

interface SceneOutputNamingEditorProps {
    presetId: string
    scene: SceneCard
    disabled?: boolean
}

export function SceneOutputNamingEditor({
    presetId,
    scene,
    disabled = false,
}: SceneOutputNamingEditorProps) {
    const { t } = useTranslation()
    const templateInputId = useId()
    const [queueEditorOpen, setQueueEditorOpen] = useState(false)
    const [queueNamesDraft, setQueueNamesDraft] = useState('')
    const setSceneFilenameTemplate = useSceneStore(state => state.setSceneFilenameTemplate)
    const setQueuedImageFileNames = useSceneStore(state => state.setQueuedImageFileNames)
    const customQueueNameCount = scene.queuedFileNames?.filter(name => name.trim()).length ?? 0

    const setQueueDialogOpen = (open: boolean) => {
        if (open) {
            setQueueNamesDraft(Array.from({ length: scene.queueCount }, (_, index) => (
                scene.queuedFileNames?.[index] ?? ''
            )).join('\n'))
        }
        setQueueEditorOpen(open)
    }

    const saveQueueNames = () => {
        const lines = queueNamesDraft.replace(/\r/g, '').split('\n')
        setQueuedImageFileNames(
            presetId,
            scene.id,
            Array.from({ length: scene.queueCount }, (_, index) => lines[index] ?? ''),
        )
        setQueueEditorOpen(false)
    }

    return (
        <div className="mt-3 grid gap-3 border-t border-border/60 pt-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="space-y-1.5">
                <Label htmlFor={templateInputId} className="text-xs text-muted-foreground">
                    {t('scene.filenameTemplate', '씬 기본 파일명')}
                </Label>
                <Input
                    id={templateInputId}
                    value={scene.filenameTemplate ?? ''}
                    maxLength={180}
                    placeholder="NAI_Blue_{timestamp}"
                    onChange={event => setSceneFilenameTemplate(presetId, scene.id, event.target.value)}
                    onBlur={event => setSceneFilenameTemplate(presetId, scene.id, event.target.value.trim())}
                    disabled={disabled}
                />
                <p className="text-xs leading-relaxed text-muted-foreground">
                    {t(
                        'scene.filenameTemplateHint',
                        '확장자는 자동으로 붙습니다. {timestamp}, {seed}, {scene.name}, {preset.name}을 사용할 수 있습니다.',
                    )}
                </p>
            </div>

            <Button
                type="button"
                variant="outline"
                className="h-11 justify-start lg:justify-center"
                onClick={() => setQueueDialogOpen(true)}
                disabled={disabled || scene.queueCount === 0}
            >
                <FilePenLine className="mr-2 h-4 w-4" />
                {scene.queueCount === 0
                    ? t('scene.queueNamesAfterAdding', '대기열 추가 후 개별 이름 설정')
                    : t('scene.queueFileNames', '대기 이미지별 이름 {{custom}}/{{total}}', {
                        custom: customQueueNameCount,
                        total: scene.queueCount,
                    })}
            </Button>

            <Dialog open={queueEditorOpen} onOpenChange={setQueueDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('scene.queueFileNamesTitle', '대기 이미지별 파일명')}</DialogTitle>
                        <DialogDescription>
                            {t(
                                'scene.queueFileNamesDescription',
                                '한 줄이 대기 이미지 한 장입니다. 빈 줄은 씬 기본 파일명을 사용하며, 위에서부터 생성 순서대로 적용됩니다.',
                            )}
                        </DialogDescription>
                    </DialogHeader>
                    <Textarea
                        value={queueNamesDraft}
                        onChange={event => setQueueNamesDraft(event.target.value)}
                        className="min-h-64 resize-y font-mono"
                        placeholder={Array.from(
                            { length: Math.min(3, Math.max(1, scene.queueCount)) },
                            (_, index) => `scene_${String(index + 1).padStart(2, '0')}_{seed}`,
                        ).join('\n')}
                        aria-label={t('scene.queueFileNamesTitle', '대기 이미지별 파일명')}
                    />
                    <p className="text-xs text-muted-foreground">
                        {t('scene.queueFileNamesCount', '현재 대기 이미지 {{count}}장', { count: scene.queueCount })}
                    </p>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setQueueEditorOpen(false)}>
                            {t('common.cancel', '취소')}
                        </Button>
                        <Button type="button" onClick={saveQueueNames}>
                            {t('common.save', '저장')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
