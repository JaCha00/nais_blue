import { useEffect, useState } from 'react'
import { Drama, Play, Pause, Square as StopIcon, Coffee, RotateCcw, FastForward, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useRotationStore } from '@/lib/character-rotation'
import { useSceneStore } from '@/stores/scene-store'
import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import { toast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'

function fmtDuration(ms: number): string {
    const total = Math.max(0, Math.round(ms / 1000))
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    if (h > 0) return `${h}시간 ${m}분`
    if (m > 0) return `${m}분 ${s}초`
    return `${s}초`
}

export function RotationStatusBar() {
    const active = useRotationStore(s => s.active)
    const paused = useRotationStore(s => s.paused)
    const resting = useRotationStore(s => s.resting)
    const restUntil = useRotationStore(s => s.restUntil)
    const currentIndex = useRotationStore(s => s.currentIndex)
    const currentRepeat = useRotationStore(s => s.currentRepeat)
    const characterIds = useRotationStore(s => s.characterIds)
    const repeats = useRotationStore(s => s.repeats)
    const hasSnapshot = useRotationStore(s => s.snapshot !== null)
    const resume = useRotationStore(s => s.resume)
    const stop = useRotationStore(s => s.stop)
    const endRest = useRotationStore(s => s.endRest)
    const resumeSavedSession = useRotationStore(s => s.resumeSavedSession)
    const discardSavedSession = useRotationStore(s => s.discardSavedSession)

    const completed = useSceneStore(s => s.completedCount)
    const total = useSceneStore(s => s.totalQueuedCount)
    const characters = useCharacterPromptStore(s => s.characters)

    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        if (!resting) return
        const t = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(t)
    }, [resting])

    const canResumeSaved = !active && hasSnapshot
    if (!active && !canResumeSaved) return null

    const currentChar = characters.find(c => c.id === characterIds[currentIndex])
    const charName = currentChar?.name?.trim()
        || (currentChar?.prompt ? currentChar.prompt.slice(0, 18) : '')
        || `#${currentIndex + 1}`
    const restLeft = restUntil ? restUntil - now : 0

    const handleResumeSaved = () => {
        const err = resumeSavedSession()
        if (err) toast({ title: '이어서 시작 실패', description: err, variant: 'destructive' })
        else toast({ title: '로테이션 재개', description: '저장된 지점부터 이어서 진행해요.', variant: 'success' })
    }

    // Visual theme per state
    const theme = resting
        ? 'border-blue-500/40 bg-blue-500/5'
        : paused
            ? 'border-yellow-500/40 bg-yellow-500/5'
            : active
                ? 'border-primary/40 bg-primary/5'
                : 'border-amber-500/40 bg-amber-500/5'

    return (
        <div className={cn('rounded-2xl border px-4 py-3 flex items-center gap-3 shadow-sm', theme)}>
            {/* State icon */}
            <div className="shrink-0">
                {resting ? <Coffee className="h-5 w-5 text-blue-400" />
                    : paused ? <Pause className="h-5 w-5 text-yellow-500" />
                        : active ? <Drama className="h-5 w-5 text-primary animate-pulse" />
                            : <Drama className="h-5 w-5 text-amber-500" />}
            </div>

            {/* Status text */}
            <div className="flex-1 min-w-0">
                {canResumeSaved ? (
                    <>
                        <div className="text-sm font-semibold">이전 로테이션 세션이 남아있어요</div>
                        <div className="text-xs text-muted-foreground truncate">
                            중단 지점: 캐릭터 {currentIndex + 1}/{characterIds.length} · {currentRepeat + 1}/{repeats}회차 — "이어서 시작"으로 바로 재개돼요
                        </div>
                    </>
                ) : resting ? (
                    <>
                        <div className="text-sm font-semibold text-blue-300">휴식 중 — 약 {fmtDuration(restLeft)} 후 자동 재개</div>
                        <div className="text-xs text-muted-foreground truncate">
                            밴 방지 휴식 · 다음 캐릭터 {charName} ({currentIndex + 1}/{characterIds.length}) · {currentRepeat + 1}/{repeats}회차
                        </div>
                    </>
                ) : paused ? (
                    <>
                        <div className="text-sm font-semibold text-yellow-500">로테이션 일시정지됨</div>
                        <div className="text-xs text-muted-foreground truncate">
                            {charName} ({currentIndex + 1}/{characterIds.length}) · {currentRepeat + 1}/{repeats}회차 — 토큰/슬롯 확인 후 재개
                        </div>
                    </>
                ) : (
                    <>
                        <div className="text-sm font-semibold">
                            로테이션 진행 중 — {charName}
                            <span className="text-muted-foreground font-normal"> ({currentIndex + 1}/{characterIds.length} · {currentRepeat + 1}/{repeats}회차)</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                            현재 캐릭터 {total > 0 ? `${completed}/${total}장` : '준비 중'}
                        </div>
                    </>
                )}
            </div>

            {/* Progress (active, generating) */}
            {active && !paused && !resting && total > 0 && (
                <div className="hidden sm:block w-28 shrink-0">
                    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, (completed / total) * 100)}%` }} />
                    </div>
                </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-1.5 shrink-0">
                {canResumeSaved ? (
                    <>
                        <Button size="sm" variant="generate" onClick={handleResumeSaved}>
                            <Play className="h-3.5 w-3.5 mr-1" /> 이어서 시작
                        </Button>
                        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => discardSavedSession()} title="저장된 세션 삭제">
                            <X className="h-4 w-4" />
                        </Button>
                    </>
                ) : (
                    <>
                        {resting && (
                            <Button size="sm" variant="outline" onClick={() => endRest()} title="휴식을 건너뛰고 지금 재개">
                                <FastForward className="h-3.5 w-3.5 mr-1" /> 지금 재개
                            </Button>
                        )}
                        {paused && (
                            <Button size="sm" variant="generate" onClick={() => resume()}>
                                <RotateCcw className="h-3.5 w-3.5 mr-1" /> 재개
                            </Button>
                        )}
                        <Button size="sm" variant="destructive" onClick={() => stop('user clicked stop')} title="중단 (이어서 시작 가능)">
                            <StopIcon className="h-3.5 w-3.5 mr-1" /> 중단
                        </Button>
                    </>
                )}
            </div>
        </div>
    )
}
