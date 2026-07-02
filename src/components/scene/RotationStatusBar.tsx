import { useEffect, useState } from 'react'
import { Coffee, Drama, FastForward, Play, RotateCcw, Square as StopIcon, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import { useSceneStore } from '@/stores/scene-store'
import { useRotationStore } from '@/stores/character-rotation-store'
import { toast } from '@/components/ui/use-toast'

function formatDuration(ms: number): string {
    const totalSeconds = Math.max(0, Math.round(ms / 1000))
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    if (hours > 0) return `${hours}시간 ${minutes}분`
    if (minutes > 0) return `${minutes}분 ${seconds}초`
    return `${seconds}초`
}

export function RotationStatusBar() {
    const active = useRotationStore(state => state.active)
    const paused = useRotationStore(state => state.paused)
    const resting = useRotationStore(state => state.resting)
    const restUntil = useRotationStore(state => state.restUntil)
    const snapshot = useRotationStore(state => state.snapshot)
    const currentIndex = useRotationStore(state => state.currentIndex)
    const currentRepeat = useRotationStore(state => state.currentRepeat)
    const characterIds = useRotationStore(state => state.characterIds)
    const repeats = useRotationStore(state => state.repeats)
    const resume = useRotationStore(state => state.resume)
    const stop = useRotationStore(state => state.stop)
    const cancel = useRotationStore(state => state.cancel)
    const endRest = useRotationStore(state => state.endRest)
    const resumeSavedSession = useRotationStore(state => state.resumeSavedSession)
    const discardSavedSession = useRotationStore(state => state.discardSavedSession)
    const completed = useSceneStore(state => state.completedCount)
    const total = useSceneStore(state => state.totalQueuedCount)
    const characters = useCharacterPromptStore(state => state.characters)
    const [now, setNow] = useState(() => Date.now())

    useEffect(() => {
        if (!resting) return
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
    }, [resting])

    const canResumeSaved = !active && snapshot !== null
    if (!active && !canResumeSaved) return null

    const currentCharacter = characters.find(character => character.id === characterIds[currentIndex])
    const currentName = currentCharacter?.name?.trim()
        || (currentCharacter?.prompt ? currentCharacter.prompt.slice(0, 24) : '')
        || `#${currentIndex + 1}`
    const restRemaining = restUntil ? restUntil - now : 0

    const handleResumeSaved = () => {
        const error = resumeSavedSession()
        if (error) {
            toast({ title: '로테이션 재개 실패', description: error, variant: 'destructive' })
        } else {
            toast({ title: '로테이션 재개', variant: 'success' })
        }
    }

    const handleStopKeepingSnapshot = () => {
        stop({ reason: 'status bar stop', keepSnapshot: true })
        toast({
            title: '로테이션 중단',
            description: '현재 위치를 저장했습니다. 나중에 이어서 생성할 수 있습니다.',
        })
    }

    const handleCancelRotation = () => {
        cancel('status bar cancel')
        toast({
            title: '로테이션 완전 취소',
            description: '저장된 세션과 진행 상태를 삭제했습니다.',
            variant: 'destructive',
        })
    }

    const handleDiscardSavedSession = () => {
        discardSavedSession()
        toast({
            title: '저장된 세션 완전 취소',
            description: '이어가기 상태를 삭제했습니다.',
            variant: 'destructive',
        })
    }

    return (
        <div className={cn(
            'rounded-2xl border px-4 py-3 flex items-center gap-3 shadow-sm',
            canResumeSaved
                ? 'border-amber-500/40 bg-amber-500/5'
                : resting
                    ? 'border-blue-500/40 bg-blue-500/5'
                    : paused
                    ? 'border-yellow-500/40 bg-yellow-500/5'
                    : 'border-primary/40 bg-primary/5'
        )}>
            {resting ? (
                <Coffee className="h-5 w-5 shrink-0 text-blue-400" />
            ) : (
                <Drama className={cn('h-5 w-5 shrink-0', active ? 'text-primary' : 'text-amber-500')} />
            )}
            <div className="min-w-0 flex-1">
                {canResumeSaved ? (
                    <>
                        <div className="text-sm font-semibold">저장된 로테이션 세션</div>
                        <div className="truncate text-xs text-muted-foreground">
                            {currentIndex + 1}/{characterIds.length}번째 캐릭터, {currentRepeat + 1}/{repeats}회차부터 이어서 시작
                        </div>
                    </>
                ) : resting ? (
                    <>
                        <div className="text-sm font-semibold text-blue-300">로테이션 휴식 중 - 약 {formatDuration(restRemaining)} 후 재개</div>
                        <div className="truncate text-xs text-muted-foreground">
                            다음 캐릭터: {currentName} · {currentIndex + 1}/{characterIds.length}번째 · {currentRepeat + 1}/{repeats}회차
                        </div>
                    </>
                ) : (
                    <>
                        <div className="text-sm font-semibold">
                            {paused ? '로테이션 일시정지' : `로테이션 진행 중 - ${currentName}`}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                            {currentIndex + 1}/{characterIds.length}번째 캐릭터 · {currentRepeat + 1}/{repeats}회차
                            {total > 0 ? ` · ${completed}/${total}장` : ''}
                        </div>
                    </>
                )}
            </div>
            {active && !paused && !resting && total > 0 && (
                <div className="hidden w-28 shrink-0 overflow-hidden rounded-full bg-white/10 sm:block">
                    <div className="h-1.5 bg-primary transition-all" style={{ width: `${Math.min(100, (completed / total) * 100)}%` }} />
                </div>
            )}
            <div className="flex shrink-0 items-center gap-1.5">
                {canResumeSaved ? (
                    <>
                        <Button size="sm" variant="generate" onClick={handleResumeSaved}>
                            <Play className="mr-1 h-3.5 w-3.5" />
                            이어서 시작
                        </Button>
                        <Button size="sm" variant="ghost" onClick={handleDiscardSavedSession} title="저장된 세션 완전 취소">
                            <X className="h-4 w-4" />
                            완전 취소
                        </Button>
                    </>
                ) : (
                    <>
                        {resting && (
                            <Button size="sm" variant="outline" onClick={endRest}>
                                <FastForward className="mr-1 h-3.5 w-3.5" />
                                지금 재개
                            </Button>
                        )}
                        {paused && (
                            <Button size="sm" variant="generate" onClick={resume}>
                                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                                재개
                            </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={handleStopKeepingSnapshot}>
                            <StopIcon className="mr-1 h-3.5 w-3.5" />
                            중단하고 나중에 이어서
                        </Button>
                        <Button size="sm" variant="destructive" onClick={handleCancelRotation}>
                            <X className="mr-1 h-3.5 w-3.5" />
                            완전 취소
                        </Button>
                    </>
                )}
            </div>
        </div>
    )
}
