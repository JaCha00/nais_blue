import { Film, ImagePlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import Counter from '@/components/ui/counter'
import { toast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import { executePromptGenerationCommand } from '@/services/generation/prompt-generation-command'
import { useRotationStore } from '@/stores/character-rotation-store'
import { useGenerationDraftStore } from '@/stores/generation-draft-store'
import { useGenerationSessionStore } from '@/stores/generation-session-store'
import { useSceneStore } from '@/stores/scene-store'

interface PromptGenerationControlsProps {
    isSceneMode: boolean
}

/**
 * Generation status and controls consume Session/Scene projections and invoke
 * one route command adapter. This separation lets PromptEditorSurface remain
 * mounted independently without duplicating queue or cancellation behavior.
 */
export function PromptGenerationControls({ isSceneMode }: PromptGenerationControlsProps) {
    const { t } = useTranslation()
    const activePresetId = useSceneStore(state => state.activePresetId)
    const getTotalQueueCount = useSceneStore(state => state.getTotalQueueCount)
    const sceneIsGenerating = useSceneStore(state => state.isGenerating)
    const sceneIsCancelling = useSceneStore(state => state.isCancelling)
    const completedCount = useSceneStore(state => state.completedCount)
    const totalQueuedCount = useSceneStore(state => state.totalQueuedCount)
    const rotationActive = useRotationStore(state => state.active)
    const isGenerating = useGenerationSessionStore(state => state.isGenerating)
    const isCancelled = useGenerationSessionStore(state => state.isCancelled)
    const currentBatch = useGenerationSessionStore(state => state.currentBatch)
    const generatingMode = useGenerationSessionStore(state => state.generatingMode)
    const batchCount = useGenerationDraftStore(state => state.batchCount)
    const setBatchCount = useGenerationDraftStore(state => state.setBatchCount)
    const sceneQueueCount = activePresetId ? getTotalQueueCount(activePresetId) : 0
    const isMainGenerating = generatingMode === 'main'
    const isSceneGenerating = generatingMode === 'scene'
    const isStyleLabGenerating = generatingMode === 'styleLab'
    const isConflict = isSceneMode
        ? isMainGenerating || isStyleLabGenerating
        : isSceneGenerating

    const execute = () => {
        if (isConflict) return
        void executePromptGenerationCommand(isSceneMode ? 'scene' : 'main')
            .then(outcome => {
                if (outcome !== 'rotation-stopped') return
                toast({
                    title: t('rotation.stopped', '로테이션 중단'),
                    description: t('rotation.resumeLater', '현재 위치를 저장했습니다. 나중에 이어서 생성할 수 있습니다.'),
                })
            })
            .catch(error => toast({
                title: t('common.error', 'Error'),
                description: error instanceof Error ? error.message : t('queue.enqueueFailed', 'Queue enqueue failed'),
                variant: 'destructive',
            }))
    }

    return (
        <div className="p-0">
            <div className="flex flex-wrap gap-2">
                <Button
                    data-testid="prompt-generate-action"
                    variant={(isGenerating || (isSceneMode && (sceneIsGenerating || sceneIsCancelling || rotationActive))) ? 'destructive' : 'generate'}
                    size="lg"
                    className={cn(
                        'h-12 min-w-40 flex-1 rounded-control px-4 text-sm font-semibold leading-tight whitespace-normal',
                        isConflict && 'cursor-not-allowed opacity-50',
                    )}
                    onClick={execute}
                    disabled={
                        (isSceneMode && sceneQueueCount === 0 && !sceneIsGenerating && !sceneIsCancelling && !rotationActive)
                        || isConflict
                        || (sceneIsCancelling && !rotationActive)
                        || (isGenerating && isCancelled)
                    }
                >
                    {isSceneMode ? (
                        sceneIsCancelling ? (
                            <><Spinner />{t('common.cancelling', '취소 중...')}</>
                        ) : rotationActive ? (
                            <><Spinner />{t('rotation.stopAndResume', '중단하고 나중에 이어서')}</>
                        ) : sceneIsGenerating ? (
                            <><Spinner />{t('common.cancel', '취소')} {totalQueuedCount > 0 && `(${completedCount + 1}/${totalQueuedCount})`}</>
                        ) : (
                            <><Film className="mr-2 h-5 w-5" />{t('scene.generateAll', '씬 생성')} {sceneQueueCount > 0 && `(${sceneQueueCount})`}</>
                        )
                    ) : (
                        isGenerating && isCancelled ? (
                            <><Spinner />{t('common.cancelling', '취소 중...')}</>
                        ) : isGenerating ? (
                            <>
                                <Spinner />
                                {batchCount > 1
                                    ? `${t('generate.cancel')} (${currentBatch}/${batchCount})`
                                    : t('generate.cancel')}
                            </>
                        ) : (
                            <><ImagePlus className="mr-2 h-5 w-5" />{t('generate.button')}</>
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
    )
}

function Spinner() {
    return <span className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" aria-hidden="true" />
}
