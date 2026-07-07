import { useRef, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { usePromptLibraryStore, type PromptTab, type PromptWindow } from '@/stores/prompt-library-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AutocompleteTextarea } from '@/components/ui/AutocompleteTextarea'
import { DanbooruTagVerifyDialog } from '@/components/prompt/DanbooruTagVerifyDialog'
import { toast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import {
    Plus,
    Copy,
    Trash2,
    Pencil,
    ChevronUp,
    ChevronDown,
    CopyCheck,
    Upload,
    EyeOff,
    Eye,
    ShieldCheck,
} from 'lucide-react'

interface CopyMessages {
    empty: string
    copied: string
    failed: string
}

async function copyText(text: string, label: string, messages: CopyMessages) {
    if (!text.trim()) {
        toast({ title: messages.empty, variant: 'destructive' })
        return
    }

    try {
        await navigator.clipboard.writeText(text)
        toast({ title: messages.copied, description: label, variant: 'success' })
        return
    } catch {
        // Tauri and older WebViews may not expose clipboard permissions; use the DOM fallback below.
    }

    try {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()

        const copied = document.execCommand('copy')
        document.body.removeChild(textarea)

        toast(copied
            ? { title: messages.copied, description: label, variant: 'success' }
            : { title: messages.failed, variant: 'destructive' })
    } catch {
        toast({ title: messages.failed, variant: 'destructive' })
    }
}

function WindowCard({ tabId, window, index, count }: { tabId: string; window: PromptWindow; index: number; count: number }) {
    const { t } = useTranslation()
    const { renameWindow, deleteWindow, toggleExcluded, moveWindow, setWindowText } = usePromptLibraryStore()
    const [editingTitle, setEditingTitle] = useState(false)
    const [titleValue, setTitleValue] = useState(window.title)
    const [isDanbooruOpen, setIsDanbooruOpen] = useState(false)

    const copyMessages: CopyMessages = {
        empty: t('promptEditor.copyEmptyTitle'),
        copied: t('promptEditor.copySuccessTitle'),
        failed: t('promptEditor.copyFailedTitle'),
    }

    const commitTitle = () => {
        setEditingTitle(false)
        const nextTitle = titleValue.trim()
        if (nextTitle) {
            renameWindow(tabId, window.id, nextTitle)
        } else {
            setTitleValue(window.title)
        }
    }

    return (
        <div
            className={cn(
                'rounded-lg border bg-muted/20 p-2',
                window.excluded ? 'border-white/5 opacity-50' : 'border-white/10'
            )}
        >
            <div className="mb-1.5 flex items-center gap-1">
                <button
                    type="button"
                    onClick={() => toggleExcluded(tabId, window.id)}
                    title={window.excluded ? t('promptEditor.includeInCopy') : t('promptEditor.excludeFromCopy')}
                    aria-label={window.excluded ? t('promptEditor.includeInCopy') : t('promptEditor.excludeFromCopy')}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                    {window.excluded ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5 text-primary" />}
                </button>

                {editingTitle ? (
                    <Input
                        autoFocus
                        value={titleValue}
                        onChange={(event) => setTitleValue(event.target.value)}
                        onBlur={commitTitle}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') commitTitle()
                            if (event.key === 'Escape') {
                                setEditingTitle(false)
                                setTitleValue(window.title)
                            }
                        }}
                        className="h-6 flex-1 px-1.5 py-0 text-sm"
                    />
                ) : (
                    <button
                        type="button"
                        className="flex-1 truncate text-left text-sm font-semibold"
                        onClick={() => {
                            setTitleValue(window.title)
                            setEditingTitle(true)
                        }}
                    >
                        {window.title}
                    </button>
                )}

                <button
                    type="button"
                    onClick={() => copyText(window.text, t('promptEditor.copyWindowDescription', { title: window.title }), copyMessages)}
                    title={t('promptEditor.copyWindow')}
                    aria-label={t('promptEditor.copyWindow')}
                    className="shrink-0 p-0.5 text-muted-foreground hover:text-primary"
                >
                    <Copy className="h-3.5 w-3.5" />
                </button>
                <button
                    type="button"
                    onClick={() => setIsDanbooruOpen(true)}
                    disabled={!window.text.trim()}
                    title={t('promptEditor.verifyDanbooru', 'Danbooru 실검증')}
                    aria-label={t('promptEditor.verifyDanbooru', 'Danbooru 실검증')}
                    className="shrink-0 p-0.5 text-muted-foreground hover:text-primary disabled:opacity-20"
                >
                    <ShieldCheck className="h-3.5 w-3.5" />
                </button>
                <button
                    type="button"
                    onClick={() => moveWindow(tabId, window.id, -1)}
                    disabled={index === 0}
                    title={t('promptEditor.moveUp')}
                    aria-label={t('promptEditor.moveUp')}
                    className="shrink-0 p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-20"
                >
                    <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                    type="button"
                    onClick={() => moveWindow(tabId, window.id, 1)}
                    disabled={index === count - 1}
                    title={t('promptEditor.moveDown')}
                    aria-label={t('promptEditor.moveDown')}
                    className="shrink-0 p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-20"
                >
                    <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button
                    type="button"
                    onClick={() => deleteWindow(tabId, window.id)}
                    title={t('promptEditor.deleteWindow')}
                    aria-label={t('promptEditor.deleteWindow')}
                    className="shrink-0 p-0.5 text-muted-foreground hover:text-destructive"
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </button>
            </div>

            <AutocompleteTextarea
                value={window.text}
                onChange={(event) => setWindowText(tabId, window.id, event.target.value)}
                placeholder={t('promptEditor.promptPlaceholder')}
                className="min-h-[64px] w-full rounded-md border border-white/10 bg-background/40 px-2 py-1.5 text-sm"
            />
            <DanbooruTagVerifyDialog
                open={isDanbooruOpen}
                onOpenChange={setIsDanbooruOpen}
                prompt={window.text}
                onApply={(nextPrompt) => {
                    setWindowText(tabId, window.id, nextPrompt)
                    setIsDanbooruOpen(false)
                    toast({
                        title: t('promptEditor.danbooruApplied', 'Danbooru 검증 결과가 반영되었습니다'),
                        variant: 'success',
                    })
                }}
            />
        </div>
    )
}

function TabColumn({ column }: { column: 'left' | 'right' }) {
    const { t } = useTranslation()
    const { tabs, activeLeftId, activeRightId, setActive, addTab, renameTab, deleteTab, addWindow } = usePromptLibraryStore()
    const activeId = column === 'left' ? activeLeftId : activeRightId
    const tab: PromptTab | undefined = tabs.find(item => item.id === activeId) ?? tabs[0]
    const [editingTab, setEditingTab] = useState(false)
    const [tabName, setTabName] = useState('')

    const copyMessages: CopyMessages = {
        empty: t('promptEditor.copyEmptyTitle'),
        copied: t('promptEditor.copySuccessTitle'),
        failed: t('promptEditor.copyFailedTitle'),
    }

    const copyAll = () => {
        if (!tab) return

        const joined = tab.windows
            .filter(window => !window.excluded)
            .map(window => window.text.trim())
            .filter(Boolean)
            .join(', ')

        void copyText(joined, t('promptEditor.copyAllDescription', { name: tab.name }), copyMessages)
    }

    const commitTabName = () => {
        setEditingTab(false)
        const nextName = tabName.trim()
        if (tab && nextName) {
            renameTab(tab.id, nextName)
        }
    }

    return (
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/50 bg-card/30">
            <div className="flex items-center gap-1 overflow-x-auto border-b border-border/50 p-1.5">
                {tabs.map(item => (
                    <button
                        key={item.id}
                        type="button"
                        onClick={() => setActive(column, item.id)}
                        className={cn(
                            'shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-xs transition-colors',
                            item.id === tab?.id
                                ? 'bg-primary/20 font-semibold text-primary'
                                : 'text-muted-foreground hover:bg-white/5'
                        )}
                    >
                        {item.name}
                    </button>
                ))}
                <button
                    type="button"
                    onClick={() => {
                        const id = addTab()
                        setActive(column, id)
                    }}
                    title={t('promptEditor.addTab')}
                    aria-label={t('promptEditor.addTab')}
                    className="shrink-0 p-1 text-muted-foreground hover:text-foreground"
                >
                    <Plus className="h-4 w-4" />
                </button>
            </div>

            {!tab ? (
                <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                    {t('promptEditor.noTabs')}
                </div>
            ) : (
                <>
                    <div className="flex items-center gap-1.5 border-b border-border/50 px-2 py-1.5">
                        {editingTab ? (
                            <Input
                                autoFocus
                                value={tabName}
                                onChange={(event) => setTabName(event.target.value)}
                                onBlur={commitTabName}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') commitTabName()
                                    if (event.key === 'Escape') setEditingTab(false)
                                }}
                                className="h-7 flex-1 text-sm"
                            />
                        ) : (
                            <div className="flex-1 truncate text-sm font-semibold">{tab.name}</div>
                        )}

                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            onClick={() => {
                                setTabName(tab.name)
                                setEditingTab(true)
                            }}
                            title={t('promptEditor.renameTab')}
                        >
                            <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={copyAll} title={t('promptEditor.copyAll')}>
                            <CopyCheck className="mr-1 h-3.5 w-3.5" />
                            {t('promptEditor.copyAll')}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => addWindow(tab.id)} title={t('promptEditor.addWindow')}>
                            <Plus className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-destructive hover:text-destructive"
                            onClick={() => {
                                if (window.confirm(t('promptEditor.confirmDeleteTab', { name: tab.name }))) {
                                    deleteTab(tab.id)
                                }
                            }}
                            title={t('promptEditor.deleteTab')}
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                    </div>

                    <div className="flex-1 space-y-2 overflow-y-auto p-2">
                        {tab.windows.length === 0 ? (
                            <div className="py-8 text-center text-sm text-muted-foreground">{t('promptEditor.noWindows')}</div>
                        ) : (
                            tab.windows.map((window, index) => (
                                <WindowCard
                                    key={window.id}
                                    tabId={tab.id}
                                    window={window}
                                    index={index}
                                    count={tab.windows.length}
                                />
                            ))
                        )}
                    </div>
                </>
            )}
        </div>
    )
}

function parseImportFile(text: string): unknown | null {
    try {
        return JSON.parse(text)
    } catch {
        return null
    }
}

export default function PromptEditor() {
    const { t } = useTranslation()
    const { tabs, addTab, importFile } = usePromptLibraryStore()
    const fileRef = useRef<HTMLInputElement>(null)

    const handleImport = (event: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files ?? [])
        event.target.value = ''
        if (files.length === 0) return

        void Promise.all(files.map(file => file.text()))
            .then(texts => {
                let added = 0

                for (const text of texts) {
                    const parsed = parseImportFile(text)
                    if (parsed && importFile(parsed)) {
                        added += 1
                    }
                }

                toast(added > 0
                    ? {
                        title: t('promptEditor.importCompleteTitle'),
                        description: t('promptEditor.importCompleteDescription', { count: added }),
                        variant: 'success',
                    }
                    : {
                        title: t('promptEditor.importFailedTitle'),
                        description: t('promptEditor.importFailedDescription'),
                        variant: 'destructive',
                    })
            })
            .catch(() => {
                toast({
                    title: t('promptEditor.importFailedTitle'),
                    description: t('promptEditor.importFailedDescription'),
                    variant: 'destructive',
                })
            })
    }

    return (
        <div className="flex h-full flex-col gap-2">
            <div className="flex shrink-0 items-center justify-between gap-3">
                <h1 className="text-lg font-bold">{t('promptEditor.title')}</h1>
                <div className="flex items-center gap-2">
                    <input
                        ref={fileRef}
                        type="file"
                        accept=".json,application/json"
                        multiple
                        className="hidden"
                        onChange={handleImport}
                    />
                    <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                        <Upload className="mr-1 h-4 w-4" />
                        {t('promptEditor.importButton')}
                    </Button>
                </div>
            </div>

            {tabs.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
                    <p className="text-sm">{t('promptEditor.emptyTitle')}</p>
                    <div className="flex gap-2">
                        <Button onClick={() => addTab()}>
                            <Plus className="mr-1 h-4 w-4" />
                            {t('promptEditor.newTab')}
                        </Button>
                        <Button variant="outline" onClick={() => fileRef.current?.click()}>
                            <Upload className="mr-1 h-4 w-4" />
                            {t('promptEditor.importExisting')}
                        </Button>
                    </div>
                    <p className="max-w-xl text-center text-xs">{t('promptEditor.emptyHelp')}</p>
                </div>
            ) : (
                <div className="flex min-h-0 flex-1 gap-2">
                    <TabColumn column="left" />
                    <TabColumn column="right" />
                </div>
            )}
        </div>
    )
}
