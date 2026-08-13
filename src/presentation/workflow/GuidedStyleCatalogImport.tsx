import { useEffect, useMemo, useState } from 'react'
import { Archive, CheckCircle2, Layers3, LoaderCircle, Search } from 'lucide-react'
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
import {
    naiStyleCatalogModuleName,
    naiStyleCatalogModuleParts,
    type NaiStyleCatalog,
    type NaiStyleCatalogItem,
} from '@/lib/nai-style-catalog'
import { cn } from '@/lib/utils'
import {
    normalizePromptModuleFolder,
    usePromptModuleLibraryStore,
} from '@/stores/prompt-module-library-store'

const MAX_VISIBLE_CATALOG_ITEMS = 100

type CatalogMode = 'individual' | 'all'

interface CatalogSaveStatus {
    readonly created: number
    readonly skipped: number
}

function catalogFolderName(fileName: string, root: string): string {
    const stem = fileName
        .replace(/\.json$/iu, '')
        .replace(/[<>:"|?*\u0000-\u001f]/gu, '-')
        .trim()
        .slice(0, 80) || 'catalog'
    return `${root}/${stem}`
}

function preview(value: string): string {
    const maximum = 600
    return value.length > maximum ? `${value.slice(0, maximum)}…` : value
}

export function GuidedStyleCatalogImport({
    catalog,
    disabled = false,
    onChoose,
}: {
    catalog: NaiStyleCatalog
    disabled?: boolean
    onChoose(item: NaiStyleCatalogItem): void
}) {
    const { t } = useTranslation()
    const createModules = usePromptModuleLibraryStore(state => state.createModules)
    const defaultFolder = catalogFolderName(
        catalog.sourceName,
        t('guided.promptImport.catalog.defaultFolder', '가져온 그림체'),
    )
    const [open, setOpen] = useState(false)
    const [mode, setMode] = useState<CatalogMode>('individual')
    const [query, setQuery] = useState('')
    const [selectedId, setSelectedId] = useState(catalog.items[0]?.id ?? '')
    const [folder, setFolder] = useState(defaultFolder)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [status, setStatus] = useState<CatalogSaveStatus | null>(null)

    useEffect(() => {
        setOpen(false)
        setQuery('')
        setSelectedId(catalog.items[0]?.id ?? '')
        setFolder(defaultFolder)
        setError('')
        setStatus(null)
    }, [catalog, defaultFolder])

    const matchingItems = useMemo(() => {
        const normalized = query.trim().toLocaleLowerCase()
        return normalized
            ? catalog.items.filter(item => `${item.title}\n${item.id}`.toLocaleLowerCase().includes(normalized))
            : catalog.items
    }, [catalog.items, query])
    const visibleItems = matchingItems.slice(0, MAX_VISIBLE_CATALOG_ITEMS)
    const selected = catalog.items.find(item => item.id === selectedId) ?? null

    useEffect(() => {
        if (matchingItems.some(item => item.id === selectedId)) return
        setSelectedId(matchingItems[0]?.id ?? '')
    }, [matchingItems, selectedId])

    const openMode = (nextMode: CatalogMode) => {
        setMode(nextMode)
        setError('')
        setStatus(null)
        setOpen(true)
    }

    const save = async (items: readonly NaiStyleCatalogItem[]) => {
        const normalizedFolder = normalizePromptModuleFolder(folder)
        if (normalizedFolder === null) {
            setError(t('guided.promptImport.catalog.invalidFolder', '저장 폴더 경로를 확인해 주세요.'))
            return
        }
        setSaving(true)
        setError('')
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        try {
            const result = createModules(items.map(item => ({
                name: naiStyleCatalogModuleName(item),
                folder: normalizedFolder,
                parts: naiStyleCatalogModuleParts(item),
            })))
            setStatus({ created: result.createdIds.length, skipped: result.skippedCount })
            if (mode === 'all') setOpen(false)
        } catch {
            setError(t('guided.promptImport.catalog.saveError', '모듈을 저장하지 못했어요. 저장 공간과 폴더 경로를 확인해 주세요.'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <>
            <div className="mt-4 border-y border-border/60 py-4" data-testid="guided-style-catalog-import">
                <div className="flex min-w-0 items-start gap-3">
                    <Archive className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{catalog.sourceName}</p>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                            {t('guided.promptImport.catalog.detected', '그림체 {{count}}개를 찾았어요. 필요한 항목만 저장하거나 전체를 한 번에 보관할 수 있습니다.', { count: catalog.items.length })}
                        </p>
                    </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                    <Button type="button" variant="outline" disabled={disabled || catalog.items.length === 0} onClick={() => openMode('individual')}>
                        {t('guided.promptImport.catalog.individualAction', '개별 선택·저장')}
                    </Button>
                    <Button type="button" disabled={disabled || catalog.items.length === 0} onClick={() => openMode('all')}>
                        <Layers3 className="mr-2 h-4 w-4" aria-hidden="true" />
                        {t('guided.promptImport.catalog.allAction', '전체 저장')}
                    </Button>
                </div>
                {status && (
                    <p className="mt-3 flex items-start gap-2 text-sm text-success" role="status">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        {t('guided.promptImport.catalog.saved', '{{created}}개 저장 · 이미 있던 {{skipped}}개 건너뜀', {
                            created: status.created.toLocaleString(),
                            skipped: status.skipped.toLocaleString(),
                        })}
                    </p>
                )}
            </div>

            <Dialog open={open} onOpenChange={next => { if (!saving) setOpen(next) }}>
                <DialogContent className={cn(
                    'flex max-h-[calc(100dvh-1rem)] flex-col overflow-hidden p-4 sm:p-6',
                    mode === 'individual' ? 'h-[min(44rem,calc(100dvh-1rem))] max-w-5xl' : 'max-w-lg',
                )} aria-busy={saving}>
                    <DialogHeader>
                        <DialogTitle>{mode === 'individual'
                            ? t('guided.promptImport.catalog.individualTitle', '개별 그림체 선택')
                            : t('guided.promptImport.catalog.allTitle', '카탈로그 전체 저장')}</DialogTitle>
                        <DialogDescription>{mode === 'individual'
                            ? t('guided.promptImport.catalog.individualHelp', '한 항목을 골라 현재 작업으로 불러오거나 모듈 보관함에 저장하세요.')
                            : t('guided.promptImport.catalog.allHelp', '{{count}}개 항목을 한 번에 모듈 보관함에 추가합니다.', { count: catalog.items.length })}</DialogDescription>
                    </DialogHeader>

                    {mode === 'individual' && (
                        <>
                            <div className="relative">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                                <Input value={query} onChange={event => setQuery(event.target.value)} className="pl-10" placeholder={t('guided.promptImport.catalog.search', '제목 또는 ID 검색')} autoFocus />
                            </div>
                            <div className="grid min-h-0 flex-1 grid-rows-1 gap-4 sm:grid-rows-[minmax(9rem,42%)_minmax(7rem,1fr)] md:grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.2fr)] md:grid-rows-1">
                                <section className="custom-scrollbar min-h-0 overflow-y-auto border-y border-border/70 py-2" aria-label={t('guided.promptImport.catalog.items', '그림체 항목')}>
                                    {matchingItems.length > visibleItems.length && (
                                        <p className="border-b border-border/50 px-3 py-2 text-xs text-muted-foreground">{t('guided.promptImport.catalog.narrowResults', '{{shown}} / {{total}}개 표시 · 검색어로 범위를 좁혀 주세요.', { shown: visibleItems.length, total: matchingItems.length })}</p>
                                    )}
                                    {visibleItems.map(item => (
                                        <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={cn('flex min-h-11 w-full items-center border-l-2 px-3 py-2 text-left', selectedId === item.id ? 'border-primary bg-primary/[0.08]' : 'border-transparent hover:bg-accent/50')}>
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-sm font-medium">{item.title}</span>
                                                <span className="block truncate font-mono text-[0.68rem] text-muted-foreground">{item.id}</span>
                                            </span>
                                        </button>
                                    ))}
                                    {matchingItems.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t('guided.promptImport.catalog.noResults', '일치하는 항목이 없어요.')}</p>}
                                </section>
                                <section className="custom-scrollbar hidden min-h-0 overflow-y-auto border-y border-border/70 p-4 sm:block" aria-live="polite">
                                    {selected ? (
                                        <div>
                                            <h3 className="break-words text-base font-semibold">{selected.title}</h3>
                                            <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{selected.id}</p>
                                            <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6">{preview(selected.positive) || t('guided.promptImport.catalog.emptyPositive', '긍정 프롬프트 없음')}</p>
                                            {selected.negative && <p className="mt-3 whitespace-pre-wrap break-words border-t border-border/50 pt-3 text-sm leading-6 text-muted-foreground">{preview(selected.negative)}</p>}
                                            {selected.characters.length > 0 && <p className="mt-3 text-xs text-muted-foreground">{t('guided.promptImport.characterCount', '캐릭터 {{count}}명 포함', { count: selected.characters.length })}</p>}
                                        </div>
                                    ) : <p className="py-8 text-center text-sm text-muted-foreground">{t('guided.promptImport.catalog.chooseItem', '왼쪽에서 항목을 선택하세요.')}</p>}
                                </section>
                            </div>
                            {selected && (
                                <section className="border-y border-border/60 py-2 sm:hidden" aria-live="polite">
                                    <p className="truncate text-sm font-semibold">{selected.title}</p>
                                    <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
                                        {selected.positive || selected.negative || t('guided.promptImport.catalog.emptyPositive', '긍정 프롬프트 없음')}
                                    </p>
                                </section>
                            )}
                        </>
                    )}

                    <div className="border-y border-border/60 py-3">
                        <label className="text-sm font-semibold" htmlFor="guided-style-catalog-folder">{t('guided.promptImport.catalog.folder', '저장 폴더')}</label>
                        <Input id="guided-style-catalog-folder" value={folder} onChange={event => { setFolder(event.target.value); setError('') }} className="mt-2" placeholder={t('promptModuleLibrary.folderPath', '폴더/하위 폴더')} />
                        <p className="mt-2 text-xs leading-5 text-muted-foreground">{t('guided.promptImport.catalog.storageHelp', '같은 소스 ID가 같은 폴더에 이미 있으면 중복 저장하지 않습니다. 캐릭터 좌표는 모듈이 아닌 각 작업에서 0.5를 기준으로 정합니다.')}</p>
                    </div>
                    {status && mode === 'individual' && <p className="text-sm text-success" role="status">{t('guided.promptImport.catalog.saved', '{{created}}개 저장 · 이미 있던 {{skipped}}개 건너뜀', { created: status.created.toLocaleString(), skipped: status.skipped.toLocaleString() })}</p>}
                    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

                    <DialogFooter>
                        <Button type="button" variant="ghost" disabled={saving} onClick={() => setOpen(false)}>{t('common.cancel', '취소')}</Button>
                        {mode === 'individual' && (
                            <Button type="button" variant="outline" disabled={saving || !selected} onClick={() => {
                                if (!selected) return
                                onChoose(selected)
                                setOpen(false)
                            }}>{t('guided.promptImport.catalog.chooseForPrompt', '이 항목 불러오기')}</Button>
                        )}
                        <Button type="button" disabled={saving || (mode === 'individual' && !selected)} onClick={() => { void save(mode === 'all' ? catalog.items : selected ? [selected] : []) }}>
                            {saving && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                            {mode === 'all'
                                ? t('guided.promptImport.catalog.saveAllConfirm', '{{count}}개 전체 저장', { count: catalog.items.length })
                                : t('guided.promptImport.catalog.saveOne', '선택 항목 저장')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
