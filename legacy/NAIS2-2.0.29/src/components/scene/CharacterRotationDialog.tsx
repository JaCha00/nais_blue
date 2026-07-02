import { useState, useEffect, useMemo } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Drama, AlertTriangle, Play, Square as StopIcon, Pause, Pin, Folder, Coffee } from 'lucide-react'
import { useCharacterPromptStore, CharacterPrompt, FOLDER_COLORS } from '@/stores/character-prompt-store'
import { useRotationStore } from '@/lib/character-rotation'
import { useSceneStore } from '@/stores/scene-store'
import { useGenerationStore } from '@/stores/generation-store'
import { toast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'

interface CharacterRotationDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

function charLabel(c: CharacterPrompt): string {
    return c.name?.trim()
        || (c.prompt ? c.prompt.slice(0, 40) + (c.prompt.length > 40 ? '…' : '') : '')
        || '(빈 캐릭터)'
}

export function CharacterRotationDialog({ open, onOpenChange }: CharacterRotationDialogProps) {
    const characters = useCharacterPromptStore(s => s.characters)
    const groups = useCharacterPromptStore(s => s.groups)
    const {
        characterIds: persistedIds,
        pinnedCharacterIds: persistedPinned,
        repeats: persistedRepeats,
        restEnabled: persistedRestEnabled,
        workMinutes: persistedWork,
        workJitterMinutes: persistedWorkJitter,
        restMinutes: persistedRest,
        restJitterMinutes: persistedRestJitter,
        active,
        paused,
        currentIndex,
        currentRepeat,
        snapshot,
        setCharacterIds,
        setPinnedCharacterIds,
        setRepeats,
        setRestConfig,
        start,
        stop,
        resume,
        resumeSavedSession,
        discardSavedSession,
    } = useRotationStore()

    const isGenerating = useSceneStore(s => s.isGenerating)
    const mainGenerating = useGenerationStore(s => s.generatingMode === 'main')

    const canResumeSaved = !active && snapshot !== null

    // Local mutable state — committed to store on Start.
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [pinned, setPinned] = useState<Set<string>>(new Set())
    const [repeatsLocal, setRepeatsLocal] = useState(1)
    // Rest scheduler config (local, committed on Start)
    const [restOn, setRestOn] = useState(false)
    const [workMin, setWorkMin] = useState(480)
    const [workJit, setWorkJit] = useState(30)
    const [restMin, setRestMin] = useState(300)
    const [restJit, setRestJit] = useState(30)

    // Initialize / sync from store + current stage when opening
    useEffect(() => {
        if (!open) return
        const stageIds = new Set(characters.map(c => c.id))
        setSelected(new Set(persistedIds.filter(id => stageIds.has(id))))
        setPinned(new Set(persistedPinned.filter(id => stageIds.has(id))))
        setRepeatsLocal(persistedRepeats)
        setRestOn(persistedRestEnabled)
        setWorkMin(persistedWork)
        setWorkJit(persistedWorkJitter)
        setRestMin(persistedRest)
        setRestJit(persistedRestJitter)
    }, [open]) // capture snapshot at open

    const charById = useMemo(() => {
        const m = new Map<string, CharacterPrompt>()
        for (const c of characters) m.set(c.id, c)
        return m
    }, [characters])

    // Sections: each group (in order) then ungrouped, preserving character order.
    const sections = useMemo(() => {
        const groupIds = new Set(groups.map(g => g.id))
        const built = groups.map(g => ({
            group: g,
            chars: characters.filter(c => c.groupId === g.id),
        })) as { group: typeof groups[number] | null; chars: CharacterPrompt[] }[]
        built.push({
            group: null,
            chars: characters.filter(c => !c.groupId || !groupIds.has(c.groupId)),
        })
        return built.filter(s => s.chars.length > 0)
    }, [groups, characters])

    // Rotation order follows the grouped/visual order.
    const orderedIds = useMemo(() => sections.flatMap(s => s.chars.map(c => c.id)), [sections])
    const selectedInOrder = orderedIds.filter(id => selected.has(id) && !pinned.has(id))
    const pinnedInOrder = orderedIds.filter(id => pinned.has(id))
    const totalPasses = selectedInOrder.length * repeatsLocal

    const toggleRotation = (id: string) => {
        setPinned(p => { if (!p.has(id)) return p; const n = new Set(p); n.delete(id); return n })
        setSelected(s => {
            const n = new Set(s)
            if (n.has(id)) n.delete(id)
            else n.add(id)
            return n
        })
    }

    const togglePin = (id: string) => {
        setSelected(s => { if (!s.has(id)) return s; const n = new Set(s); n.delete(id); return n })
        setPinned(p => {
            const n = new Set(p)
            if (n.has(id)) n.delete(id)
            else n.add(id)
            return n
        })
    }

    const toggleGroupAll = (groupChars: CharacterPrompt[]) => {
        const ids = groupChars.map(c => c.id)
        const selectableNow = ids.filter(id => !pinned.has(id))
        const allSelected = selectableNow.length > 0 && selectableNow.every(id => selected.has(id))
        setSelected(s => {
            const n = new Set(s)
            if (allSelected) {
                ids.forEach(id => n.delete(id))
            } else {
                ids.forEach(id => { if (!pinned.has(id)) n.add(id) })
            }
            return n
        })
    }

    const commitConfig = () => {
        setCharacterIds(selectedInOrder)
        setPinnedCharacterIds(pinnedInOrder)
        setRepeats(repeatsLocal)
        setRestConfig({
            restEnabled: restOn,
            workMinutes: workMin,
            workJitterMinutes: workJit,
            restMinutes: restMin,
            restJitterMinutes: restJit,
        })
    }

    const handleStart = () => {
        if (selectedInOrder.length === 0) {
            toast({ title: '로테이션할 캐릭터를 1명 이상 선택해주세요.', variant: 'destructive' })
            return
        }
        commitConfig()
        const err = start()
        if (err) {
            toast({ title: '로테이션 시작 실패', description: err, variant: 'destructive' })
            return
        }
        const pinNote = pinnedInOrder.length > 0 ? ` (고정 ${pinnedInOrder.length}명 포함)` : ''
        const restNote = restOn ? ` · ${workMin}±${workJit}분 작업 / ${restMin}±${restJit}분 휴식` : ''
        toast({ title: '로테이션 시작', description: `${selectedInOrder.length} 캐릭터 × ${repeatsLocal}회 = 총 ${totalPasses}바퀴${pinNote}${restNote}`, variant: 'success' })
        onOpenChange(false)
    }

    const handleResumeSaved = () => {
        // Persist any rest-config tweaks the user made before resuming.
        setRestConfig({
            restEnabled: restOn,
            workMinutes: workMin,
            workJitterMinutes: workJit,
            restMinutes: restMin,
            restJitterMinutes: restJit,
        })
        const err = resumeSavedSession()
        if (err) {
            toast({ title: '이어서 시작 실패', description: err, variant: 'destructive' })
            return
        }
        toast({ title: '로테이션 재개', description: '저장된 지점부터 이어서 진행해요.', variant: 'success' })
        onOpenChange(false)
    }

    const handleStop = () => {
        stop('user clicked stop')
        toast({ title: '로테이션 중단됨', description: '진행 상황을 저장했어요. "이어서 시작"으로 재개할 수 있어요.', variant: 'default' })
    }

    const currentChar = active
        ? charById.get(useRotationStore.getState().characterIds[currentIndex])
        : null

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Drama className="h-5 w-5" />
                        캐릭터 로테이션 예약
                    </DialogTitle>
                    <DialogDescription>
                        선택한 캐릭터를 순서대로 하나씩 활성화하면서 현재 큐를 반복 실행해요. 📌 고정 캐릭터는 매 바퀴 항상 함께 켜져요.
                    </DialogDescription>
                </DialogHeader>

                {active && (
                    <div className={cn(
                        "rounded-xl border p-3 space-y-1",
                        paused ? "border-yellow-500/40 bg-yellow-500/5" : "border-primary/30 bg-primary/5"
                    )}>
                        <div className="text-sm font-medium flex items-center gap-2">
                            {paused ? (
                                <><Pause className="h-3.5 w-3.5 text-yellow-500" />로테이션 일시정지됨 — {currentRepeat + 1} / {persistedRepeats} 회차</>
                            ) : (
                                <><Play className="h-3.5 w-3.5 text-primary animate-pulse" />로테이션 진행 중 — {currentRepeat + 1} / {persistedRepeats} 회차</>
                            )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                            현재 캐릭터: {currentChar?.name || currentChar?.prompt?.slice(0, 30) || `[${currentIndex + 1}]`}
                            {' '}({currentIndex + 1} / {useRotationStore.getState().characterIds.length})
                        </div>
                    </div>
                )}

                {canResumeSaved && (
                    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
                        <div className="text-sm font-medium flex items-center gap-2">
                            <Play className="h-3.5 w-3.5 text-amber-500" />
                            이전에 진행하던 로테이션 세션이 남아있어요
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                            중단 지점: 캐릭터 {currentIndex + 1}/{useRotationStore.getState().characterIds.length} · {currentRepeat + 1}/{persistedRepeats}회차 —
                            아래 <strong className="text-amber-500">이어서 시작</strong>으로 바로 재개하거나, <strong>처음부터</strong>로 새로 설정할 수 있어요.
                        </div>
                    </div>
                )}

                {characters.length === 0 ? (
                    <div className="text-center text-sm text-muted-foreground py-8">
                        스테이지에 캐릭터가 없습니다. 먼저 캐릭터 프롬프트 패널에서 캐릭터를 추가하세요.
                    </div>
                ) : (
                    <>
                        <div className="text-xs text-muted-foreground">
                            체크 = 로테이션 포함 · 📌 = 항상 고정 · 폴더 헤더로 폴더 전체 선택
                        </div>

                        <div className="flex-1 overflow-y-auto pr-2 -mr-2 space-y-3">
                            {sections.map(({ group, chars }) => {
                                const folderColor = group ? FOLDER_COLORS[group.colorIndex ?? 0] : null
                                const selectableIds = chars.map(c => c.id).filter(id => !pinned.has(id))
                                const allSelected = selectableIds.length > 0 && selectableIds.every(id => selected.has(id))
                                const sectionKey = group ? group.id : '__ungrouped__'
                                return (
                                    <div key={sectionKey} className="space-y-1.5">
                                        {/* Folder header */}
                                        <div className="flex items-center gap-2 px-1">
                                            <Checkbox
                                                checked={allSelected}
                                                onCheckedChange={() => toggleGroupAll(chars)}
                                                disabled={active || selectableIds.length === 0}
                                            />
                                            <Folder className={cn("h-4 w-4", folderColor?.icon ?? "text-muted-foreground")} />
                                            <span className="text-sm font-semibold">
                                                {group ? group.name : '미분류'}
                                            </span>
                                            <span className="text-xs text-muted-foreground">({chars.length})</span>
                                        </div>

                                        {/* Characters in this folder */}
                                        <div className="space-y-1 pl-2">
                                            {chars.map(c => {
                                                const isPinned = pinned.has(c.id)
                                                const isSelected = selected.has(c.id)
                                                return (
                                                    <div
                                                        key={c.id}
                                                        className={cn(
                                                            'flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-muted/20',
                                                            isSelected && 'border-primary/40 bg-primary/5',
                                                            isPinned && 'border-amber-500/40 bg-amber-500/5'
                                                        )}
                                                    >
                                                        <Checkbox
                                                            checked={isSelected}
                                                            onCheckedChange={() => toggleRotation(c.id)}
                                                            disabled={active || isPinned}
                                                        />
                                                        <div className="flex-1 min-w-0">
                                                            <div className="text-sm font-medium truncate">{charLabel(c)}</div>
                                                            {c.name && c.prompt && (
                                                                <div className="text-xs text-muted-foreground truncate">
                                                                    {c.prompt.slice(0, 60)}{c.prompt.length > 60 ? '…' : ''}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => togglePin(c.id)}
                                                            disabled={active}
                                                            className={cn(
                                                                'flex items-center gap-1 px-2 py-1 rounded-md text-xs border transition-colors shrink-0',
                                                                isPinned
                                                                    ? 'border-amber-500/50 bg-amber-500/15 text-amber-500'
                                                                    : 'border-white/10 text-muted-foreground hover:text-foreground hover:bg-white/5',
                                                                active && 'opacity-50 cursor-not-allowed'
                                                            )}
                                                            title="항상 포함되는 고정 캐릭터로 지정 (로테이션 순서·폴더명에서 제외)"
                                                        >
                                                            <Pin className="h-3 w-3" />
                                                            {isPinned ? '고정' : '고정?'}
                                                        </button>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>

                        <div className="flex items-end gap-3 pt-2 border-t border-white/10">
                            <div className="flex-1">
                                <Label htmlFor="rotation-repeats" className="text-xs">반복 횟수</Label>
                                <Input
                                    id="rotation-repeats"
                                    type="number"
                                    min={1}
                                    max={100}
                                    value={repeatsLocal}
                                    onChange={(e) => setRepeatsLocal(parseInt(e.target.value) || 1)}
                                    disabled={active}
                                    className="h-9"
                                />
                            </div>
                            <div className="flex-1 text-xs text-muted-foreground pb-2">
                                로테이션 {selectedInOrder.length} × {repeatsLocal} = <strong className="text-foreground">총 {totalPasses}바퀴</strong>
                                {pinnedInOrder.length > 0 && <span className="text-amber-500"> · 📌 고정 {pinnedInOrder.length}</span>}
                            </div>
                        </div>

                        {/* Rest scheduler */}
                        <div className="rounded-xl border border-white/10 bg-muted/20 p-3 space-y-3">
                            <div className="flex items-center justify-between">
                                <Label className="text-sm font-medium flex items-center gap-1.5">
                                    <Coffee className="h-4 w-4 text-blue-400" />
                                    휴식 스케줄러 <span className="text-xs text-muted-foreground font-normal">(밴 방지)</span>
                                </Label>
                                <Switch checked={restOn} onChange={(e) => setRestOn(e.target.checked)} disabled={active} />
                            </div>
                            {restOn && (
                                <>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <Label className="text-xs text-muted-foreground">작업 시간 (분)</Label>
                                            <Input type="number" min={1} value={workMin} disabled={active}
                                                onChange={(e) => setWorkMin(Math.max(1, parseInt(e.target.value) || 1))} className="h-9" />
                                        </div>
                                        <div>
                                            <Label className="text-xs text-muted-foreground">작업 랜덤 ± (분)</Label>
                                            <Input type="number" min={0} value={workJit} disabled={active}
                                                onChange={(e) => setWorkJit(Math.max(0, parseInt(e.target.value) || 0))} className="h-9" />
                                        </div>
                                        <div>
                                            <Label className="text-xs text-muted-foreground">휴식 시간 (분)</Label>
                                            <Input type="number" min={1} value={restMin} disabled={active}
                                                onChange={(e) => setRestMin(Math.max(1, parseInt(e.target.value) || 1))} className="h-9" />
                                        </div>
                                        <div>
                                            <Label className="text-xs text-muted-foreground">휴식 랜덤 ± (분)</Label>
                                            <Input type="number" min={0} value={restJit} disabled={active}
                                                onChange={(e) => setRestJit(Math.max(0, parseInt(e.target.value) || 0))} className="h-9" />
                                        </div>
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                        약 <strong className="text-foreground">{Math.max(1, workMin - workJit)}~{workMin + workJit}분</strong> 작업 후
                                        {' '}<strong className="text-foreground">{Math.max(1, restMin - restJit)}~{restMin + restJit}분</strong> 휴식 (매번 랜덤). 휴식은 바퀴 경계에서 시작돼요.
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="text-xs text-yellow-500/80 flex items-start gap-1.5">
                            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                            <span>시작 시 현재 큐를 스냅샷으로 저장하고 매 바퀴 복원해요. 이미지는 <strong>프리셋/캐릭터/씬</strong> 폴더로 저장돼요. 직접 "정지"하면 전체 중단, 토큰/슬롯이 끊기면 일시정지 후 재개됩니다.</span>
                        </div>
                    </>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={false}>
                        닫기
                    </Button>
                    {active ? (
                        <>
                            {paused && (
                                <Button variant="generate" onClick={resume}>
                                    <Play className="h-4 w-4 mr-1" />
                                    재개
                                </Button>
                            )}
                            <Button variant="destructive" onClick={handleStop}>
                                <StopIcon className="h-4 w-4 mr-1" />
                                중단 (이어가기 가능)
                            </Button>
                        </>
                    ) : canResumeSaved ? (
                        <>
                            <Button variant="ghost" className="text-muted-foreground"
                                onClick={() => { discardSavedSession(); toast({ title: '저장된 세션 삭제됨' }) }}>
                                세션 삭제
                            </Button>
                            <Button variant="outline" onClick={handleStart} disabled={characters.length === 0 || isGenerating || mainGenerating}>
                                처음부터
                            </Button>
                            <Button variant="generate" onClick={handleResumeSaved} disabled={isGenerating || mainGenerating}>
                                <Play className="h-4 w-4 mr-1" />
                                이어서 시작 ({currentIndex + 1}/{useRotationStore.getState().characterIds.length} · {currentRepeat + 1}/{persistedRepeats})
                            </Button>
                        </>
                    ) : (
                        <Button onClick={handleStart} disabled={characters.length === 0 || isGenerating || mainGenerating}>
                            <Play className="h-4 w-4 mr-1" />
                            로테이션 시작
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
