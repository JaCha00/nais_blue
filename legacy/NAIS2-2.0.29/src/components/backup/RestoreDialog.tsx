import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, RefreshCw, RotateCcw, AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { listBackups, restoreFromBackup, type BackupGroup, type BackupEntry } from '@/lib/auto-backup'
import { toast } from '@/components/ui/use-toast'
import { relaunch } from '@tauri-apps/plugin-process'

interface RestoreDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

const STORE_LABELS: Record<string, string> = {
    'scenes': '씬 (Scenes)',
    'generation': '생성 설정 (Prompts/Params)',
    'presets': '프리셋 (Presets)',
    'character-prompts': '캐릭터 프롬프트',
    'character-store': '캐릭터/바이브 이미지',
    'wildcards': '와일드카드/조각',
    'settings': '앱 설정',
    'shortcuts': '단축키',
}

function formatTs(ts: string): string {
    // YYYYMMDD-HHMMSS -> YYYY-MM-DD HH:MM:SS
    if (ts.length < 15) return ts
    return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)} ${ts.slice(9, 11)}:${ts.slice(11, 13)}:${ts.slice(13, 15)}`
}

export function RestoreDialog({ open, onOpenChange }: RestoreDialogProps) {
    const { t } = useTranslation()
    const [groups, setGroups] = useState<BackupGroup[]>([])
    const [loading, setLoading] = useState(false)
    const [selected, setSelected] = useState<Record<string, string>>({})
    const [restoring, setRestoring] = useState<string | null>(null)
    const [pendingRestart, setPendingRestart] = useState(false)

    const reload = async () => {
        setLoading(true)
        try {
            const gs = await listBackups()
            setGroups(gs)
            const sel: Record<string, string> = {}
            for (const g of gs) {
                if (g.entries.length > 0) sel[g.name] = g.entries[0].relPath
            }
            setSelected(sel)
        } catch (e) {
            console.error(e)
            toast({ title: '백업 목록 로드 실패', description: String(e), variant: 'destructive' })
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { if (open) void reload() }, [open])

    const handleRestore = async (group: BackupGroup) => {
        const path = selected[group.name]
        if (!path) return
        const entry = group.entries.find(e => e.relPath === path)
        const ok = window.confirm(
            `"${STORE_LABELS[group.name] ?? group.name}"를 ${entry ? formatTs(entry.timestamp) : ''} 시점으로 복원합니다.\n\n현재 데이터는 덮어쓰여지고 앱이 재시작됩니다. 계속할까요?`
        )
        if (!ok) return

        setRestoring(group.name)
        try {
            await restoreFromBackup(group.name, path)
            toast({ title: '복원 완료', description: `${STORE_LABELS[group.name] ?? group.name} — 재시작이 필요해요.`, variant: 'success' })
            setPendingRestart(true)
        } catch (e) {
            console.error(e)
            toast({ title: '복원 실패', description: String(e), variant: 'destructive' })
        } finally {
            setRestoring(null)
        }
    }

    const handleRestart = async () => {
        try { await relaunch() } catch (e) { console.error(e); window.location.reload() }
    }

    return (
        <Dialog open={open} onOpenChange={(v) => !restoring && onOpenChange(v)}>
            <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle>{t('backup.restoreTitle', '백업에서 복원')}</DialogTitle>
                    <DialogDescription>
                        {t('backup.restoreDesc', '자동백업 스냅샷에서 복원합니다. 위치: Pictures/NAIS_Backup/')}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{loading ? '로딩 중…' : `${groups.length}개 카테고리`}</span>
                    <Button variant="ghost" size="sm" onClick={reload} disabled={loading}>
                        <RefreshCw className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
                        새로고침
                    </Button>
                </div>

                <div className="flex-1 overflow-y-auto pr-2 -mr-2 space-y-2">
                    {groups.length === 0 && !loading && (
                        <div className="text-center text-sm text-muted-foreground py-8">
                            아직 백업이 없어요. 데이터를 변경하면 5초 뒤 자동으로 생성돼요.
                        </div>
                    )}

                    {groups.map((g) => {
                        const hasBackups = g.entries.length > 0
                        const sel = selected[g.name] ?? g.entries[0]?.relPath ?? ''
                        const selEntry = g.entries.find(e => e.relPath === sel)
                        return (
                            <div key={g.name} className="border border-white/10 rounded-xl p-3 bg-muted/20">
                                <div className="flex items-center justify-between mb-2">
                                    <div>
                                        <div className="font-medium text-sm">{STORE_LABELS[g.name] ?? g.name}</div>
                                        <div className="text-xs text-muted-foreground">
                                            {g.entries.length}개 스냅샷
                                            {!g.isRegistered && (
                                                <span className="ml-2 text-yellow-500">
                                                    <AlertTriangle className="inline h-3 w-3 mr-0.5" />
                                                    이번 빌드엔 미등록
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <Button
                                        size="sm"
                                        onClick={() => handleRestore(g)}
                                        disabled={!hasBackups || !g.isRegistered || restoring !== null}
                                    >
                                        {restoring === g.name
                                            ? <Loader2 className="h-4 w-4 animate-spin" />
                                            : <><RotateCcw className="h-3 w-3 mr-1" />복원</>}
                                    </Button>
                                </div>

                                {hasBackups && (
                                    <Select
                                        value={sel}
                                        onValueChange={(v) => setSelected((s) => ({ ...s, [g.name]: v }))}
                                        disabled={restoring !== null}
                                    >
                                        <SelectTrigger className="h-8 text-xs">
                                            <SelectValue>
                                                {selEntry ? formatTs(selEntry.timestamp) : '선택'}
                                            </SelectValue>
                                        </SelectTrigger>
                                        <SelectContent>
                                            {g.entries.map((e: BackupEntry) => (
                                                <SelectItem key={e.relPath} value={e.relPath}>
                                                    {formatTs(e.timestamp)}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            </div>
                        )
                    })}
                </div>

                <DialogFooter className="sm:justify-between items-center">
                    {pendingRestart ? (
                        <span className="text-xs text-yellow-500">
                            <AlertTriangle className="inline h-3 w-3 mr-1" />
                            복원 적용을 위해 재시작이 필요해요.
                        </span>
                    ) : <span />}
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={restoring !== null}>
                            닫기
                        </Button>
                        {pendingRestart && (
                            <Button onClick={handleRestart}>지금 재시작</Button>
                        )}
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
