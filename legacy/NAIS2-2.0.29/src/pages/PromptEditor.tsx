import { useState, useRef } from 'react'
import { usePromptLibraryStore, PromptTab, PromptWindow } from '@/stores/prompt-library-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AutocompleteTextarea } from '@/components/ui/AutocompleteTextarea'
import { toast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import {
    Plus, Copy, Trash2, Pencil, ChevronUp, ChevronDown,
    CopyCheck, Upload, EyeOff, Eye,
} from 'lucide-react'

// --- helpers -------------------------------------------------------------

async function copyText(text: string, label: string) {
    if (!text.trim()) {
        toast({ title: '복사할 내용이 없어요', variant: 'destructive' })
        return
    }
    try {
        await navigator.clipboard.writeText(text)
        toast({ title: '복사됨', description: label, variant: 'success' })
        return
    } catch { /* fall through */ }
    try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        toast(ok ? { title: '복사됨', description: label, variant: 'success' } : { title: '복사 실패', variant: 'destructive' })
    } catch {
        toast({ title: '복사 실패', variant: 'destructive' })
    }
}

// --- window card ---------------------------------------------------------

function WindowCard({ tabId, win, index, count }: { tabId: string; win: PromptWindow; index: number; count: number }) {
    const { renameWindow, deleteWindow, toggleExcluded, moveWindow, setWindowText } = usePromptLibraryStore()
    const [editingTitle, setEditingTitle] = useState(false)
    const [titleVal, setTitleVal] = useState(win.title)

    return (
        <div className={cn(
            'rounded-lg border bg-muted/20 p-2',
            win.excluded ? 'border-white/5 opacity-50' : 'border-white/10'
        )}>
            {/* header */}
            <div className="flex items-center gap-1 mb-1.5">
                <button onClick={() => toggleExcluded(tabId, win.id)} title={win.excluded ? '전체복사에 포함' : '전체복사에서 제외'}
                    className="text-muted-foreground hover:text-foreground shrink-0">
                    {win.excluded ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5 text-primary" />}
                </button>
                {editingTitle ? (
                    <Input
                        autoFocus value={titleVal} onChange={(e) => setTitleVal(e.target.value)}
                        onBlur={() => { setEditingTitle(false); if (titleVal.trim()) renameWindow(tabId, win.id, titleVal.trim()) }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { setEditingTitle(false); if (titleVal.trim()) renameWindow(tabId, win.id, titleVal.trim()) } if (e.key === 'Escape') { setEditingTitle(false); setTitleVal(win.title) } }}
                        className="h-6 text-sm px-1.5 py-0 flex-1"
                    />
                ) : (
                    <div className="flex-1 text-sm font-semibold truncate cursor-text" onClick={() => { setTitleVal(win.title); setEditingTitle(true) }}>
                        {win.title}
                    </div>
                )}
                <button onClick={() => copyText(win.text, `${win.title} 복사`)} title="이 창 복사" className="text-muted-foreground hover:text-primary shrink-0 p-0.5"><Copy className="h-3.5 w-3.5" /></button>
                <button onClick={() => moveWindow(tabId, win.id, -1)} disabled={index === 0} title="위로" className="text-muted-foreground hover:text-foreground disabled:opacity-20 shrink-0 p-0.5"><ChevronUp className="h-3.5 w-3.5" /></button>
                <button onClick={() => moveWindow(tabId, win.id, 1)} disabled={index === count - 1} title="아래로" className="text-muted-foreground hover:text-foreground disabled:opacity-20 shrink-0 p-0.5"><ChevronDown className="h-3.5 w-3.5" /></button>
                <button onClick={() => deleteWindow(tabId, win.id)} title="삭제" className="text-muted-foreground hover:text-destructive shrink-0 p-0.5"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
            {/* prompt text with autocomplete (same as the main prompt box) */}
            <AutocompleteTextarea
                value={win.text}
                onChange={(e) => setWindowText(tabId, win.id, e.target.value)}
                placeholder="프롬프트 입력 — 쉼표로 구분, 입력 시 자동완성"
                className="w-full min-h-[64px] rounded-md border border-white/10 bg-background/40 px-2 py-1.5 text-sm"
            />
        </div>
    )
}

// --- one column ----------------------------------------------------------

function TabColumn({ column }: { column: 'left' | 'right' }) {
    const { tabs, activeLeftId, activeRightId, setActive, addTab, renameTab, deleteTab, addWindow } = usePromptLibraryStore()
    const activeId = column === 'left' ? activeLeftId : activeRightId
    const tab: PromptTab | undefined = tabs.find(t => t.id === activeId) ?? tabs[0]
    const [editingTab, setEditingTab] = useState(false)
    const [tabName, setTabName] = useState('')

    const copyAll = () => {
        if (!tab) return
        const all = tab.windows.filter(w => !w.excluded).map(w => w.text.trim()).filter(Boolean).join(', ')
        copyText(all, `${tab.name} 전체복사`)
    }

    return (
        <div className="flex-1 min-w-0 flex flex-col rounded-xl border border-border/50 bg-card/30 overflow-hidden">
            {/* tab bar */}
            <div className="flex items-center gap-1 p-1.5 border-b border-border/50 overflow-x-auto">
                {tabs.map(t => (
                    <button key={t.id} onClick={() => setActive(column, t.id)}
                        className={cn(
                            'px-2.5 py-1 rounded-md text-xs whitespace-nowrap shrink-0 transition-colors',
                            t.id === tab?.id ? 'bg-primary/20 text-primary font-semibold' : 'text-muted-foreground hover:bg-white/5'
                        )}>
                        {t.name}
                    </button>
                ))}
                <button onClick={() => { const id = addTab(); setActive(column, id) }} title="새 탭" className="shrink-0 p-1 text-muted-foreground hover:text-foreground"><Plus className="h-4 w-4" /></button>
            </div>

            {!tab ? (
                <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">탭이 없어요. + 로 추가하세요.</div>
            ) : (
                <>
                    {/* tab toolbar */}
                    <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border/50">
                        {editingTab ? (
                            <Input autoFocus value={tabName} onChange={(e) => setTabName(e.target.value)}
                                onBlur={() => { setEditingTab(false); if (tabName.trim()) renameTab(tab.id, tabName.trim()) }}
                                onKeyDown={(e) => { if (e.key === 'Enter') { setEditingTab(false); if (tabName.trim()) renameTab(tab.id, tabName.trim()) } if (e.key === 'Escape') setEditingTab(false) }}
                                className="h-7 text-sm flex-1" />
                        ) : (
                            <div className="flex-1 text-sm font-semibold truncate">{tab.name}</div>
                        )}
                        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => { setTabName(tab.name); setEditingTab(true) }} title="탭 이름 변경"><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={copyAll} title="전체복사"><CopyCheck className="h-3.5 w-3.5 mr-1" />전체복사</Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => addWindow(tab.id)} title="프롬프트 창 추가"><Plus className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive" onClick={() => { if (confirm(`'${tab.name}' 탭을 삭제할까요?`)) deleteTab(tab.id) }} title="탭 삭제"><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>

                    {/* windows */}
                    <div className="flex-1 overflow-y-auto p-2 space-y-2">
                        {tab.windows.length === 0 ? (
                            <div className="text-center text-sm text-muted-foreground py-8">프롬프트 창이 없어요. + 로 추가하세요.</div>
                        ) : (
                            tab.windows.map((w, i) => (
                                <WindowCard key={w.id} tabId={tab.id} win={w} index={i} count={tab.windows.length} />
                            ))
                        )}
                    </div>
                </>
            )}
        </div>
    )
}

// --- page ----------------------------------------------------------------

export default function PromptEditor() {
    const { tabs, addTab, importFile } = usePromptLibraryStore()
    const fileRef = useRef<HTMLInputElement>(null)

    const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? [])
        e.target.value = ''
        if (files.length === 0) return
        Promise.all(files.map(f => f.text())).then(texts => {
            let added = 0
            for (const txt of texts) {
                try {
                    if (importFile(JSON.parse(txt))) added++
                } catch { /* skip bad file */ }
            }
            toast(added > 0
                ? { title: '가져오기 완료', description: `${added}개 파일을 추가했어요`, variant: 'success' }
                : { title: '가져오기 실패', description: '프롬프트 에디터 또는 조각 JSON이 아니에요', variant: 'destructive' })
        })
    }

    return (
        <div className="h-full flex flex-col gap-2">
            <div className="flex items-center justify-between shrink-0">
                <h1 className="text-lg font-bold">프롬프트 라이브러리</h1>
                <div className="flex items-center gap-2">
                    <input ref={fileRef} type="file" accept=".json" multiple className="hidden" onChange={handleImport} />
                    <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                        <Upload className="h-4 w-4 mr-1" /> 가져오기 (프롬프트 / 조각 JSON)
                    </Button>
                </div>
            </div>

            {tabs.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                    <p className="text-sm">저장된 프롬프트가 없어요.</p>
                    <div className="flex gap-2">
                        <Button onClick={() => addTab()}><Plus className="h-4 w-4 mr-1" /> 새 탭 만들기</Button>
                        <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4 mr-1" /> 기존 데이터 가져오기</Button>
                    </div>
                    <p className="text-xs">NovelAI Prompt Editor 내보내기 JSON, 또는 <b>조각 프롬프트 JSON</b>을 가져올 수 있어요 (조각은 폴더별 탭으로 변환).</p>
                </div>
            ) : (
                <div className="flex-1 min-h-0 flex gap-2">
                    <TabColumn column="left" />
                    <TabColumn column="right" />
                </div>
            )}
        </div>
    )
}
