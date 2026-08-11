import { useMemo, useRef, useState } from 'react'
import { FileText, FolderOpen, LoaderCircle, Pencil, Plus, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { PromptModuleContentEditor } from '@/components/fragments/PromptModuleContentEditor'
import { PromptModuleCreator } from '@/components/fragments/PromptModuleCreator'
import { cn } from '@/lib/utils'
import {
    getFragmentCanonicalPath,
    useFragmentStore,
    type FragmentFileMeta,
} from '@/stores/fragment-store'

export interface PromptModulePickerProps {
    onSelectLine(line: string): void
    disabled?: boolean
    showManageAction?: boolean
    allowInlineManage?: boolean
    createSourceText?: string
    triggerLabel?: string
    triggerClassName?: string
}

export function appendPromptModuleLine(current: string, line: string): string {
    const prompt = current.trimEnd()
    const moduleLine = line.trim()
    if (!moduleLine) return current
    if (!prompt) return moduleLine
    const lastLine = prompt.slice(prompt.lastIndexOf('\n') + 1).trimStart()
    if (lastLine.startsWith('#')) return `${prompt}\n${moduleLine}`
    return `${prompt}${prompt.endsWith(',') ? ' ' : ', '}${moduleLine}`
}

export function getUsablePromptModuleLines(lines: readonly string[]): string[] {
    return lines
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'))
}

interface PromptModuleGroup {
    folder: string
    files: FragmentFileMeta[]
}

function groupPromptModules(files: readonly FragmentFileMeta[], query: string): PromptModuleGroup[] {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    const matchingFiles = normalizedQuery.length === 0
        ? files
        : files.filter(file => (
            getFragmentCanonicalPath(file).toLocaleLowerCase().includes(normalizedQuery)
        ))
    const folders = new Map<string, FragmentFileMeta[]>()

    for (const file of matchingFiles) {
        const group = folders.get(file.folder) ?? []
        group.push(file)
        folders.set(file.folder, group)
    }

    return [...folders.entries()]
        .sort(([left], [right]) => {
            if (left === '') return -1
            if (right === '') return 1
            return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
        })
        .map(([folder, groupFiles]) => ({
            folder,
            files: [...groupFiles].sort((left, right) => (
                getFragmentCanonicalPath(left).localeCompare(
                    getFragmentCanonicalPath(right),
                    undefined,
                    { numeric: true, sensitivity: 'base' },
                )
            )),
        }))
}

export function PromptModulePicker({
    onSelectLine,
    disabled = false,
    showManageAction = true,
    allowInlineManage = false,
    createSourceText = '',
    triggerLabel,
    triggerClassName,
}: PromptModulePickerProps) {
    const { t } = useTranslation()
    const files = useFragmentStore(state => state.files)
    const loadFileContent = useFragmentStore(state => state.loadFileContent)
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
    const [lines, setLines] = useState<string[]>([])
    const [loading, setLoading] = useState(false)
    const [loadFailed, setLoadFailed] = useState(false)
    const [createOpen, setCreateOpen] = useState(false)
    const [editingFileId, setEditingFileId] = useState<string | null>(null)
    const requestId = useRef(0)

    const groups = useMemo(() => groupPromptModules(files, query), [files, query])
    const selectedFile = files.find(file => file.id === selectedFileId) ?? null
    const editingFile = files.find(file => file.id === editingFileId) ?? null

    const handleOpenChange = (nextOpen: boolean) => {
        setOpen(nextOpen)
        if (nextOpen) return
        requestId.current += 1
        setQuery('')
        setSelectedFileId(null)
        setLines([])
        setLoading(false)
        setLoadFailed(false)
    }

    const selectFile = async (file: FragmentFileMeta) => {
        const currentRequestId = requestId.current + 1
        requestId.current = currentRequestId
        setSelectedFileId(file.id)
        setLines([])
        setLoading(true)
        setLoadFailed(false)

        try {
            const content = await loadFileContent(file.id)
            if (requestId.current !== currentRequestId) return
            setLines(getUsablePromptModuleLines(content))
        } catch {
            if (requestId.current !== currentRequestId) return
            setLoadFailed(true)
        } finally {
            if (requestId.current === currentRequestId) setLoading(false)
        }
    }

    const selectLine = (line: string) => {
        onSelectLine(line)
        handleOpenChange(false)
    }

    const createModule = () => {
        handleOpenChange(false)
        setCreateOpen(true)
    }

    const editModule = (fileId: string) => {
        setOpen(false)
        setEditingFileId(fileId)
    }

    return (
        <>
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    className={cn(
                        'gap-2 rounded-none border-b border-border/70 bg-transparent px-1 text-sm text-muted-foreground hover:border-primary hover:bg-primary/[0.045] hover:text-foreground',
                        triggerClassName,
                    )}
                >
                    <FolderOpen className="h-4 w-4" aria-hidden="true" />
                    {triggerLabel ?? t('guided.promptModules.trigger', '폴더에서 프롬프트 불러오기')}
                </Button>
            </DialogTrigger>

            <DialogContent className="flex h-[min(44rem,calc(100dvh-1rem))] max-h-[calc(100dvh-1rem)] max-w-4xl flex-col gap-4 overflow-hidden p-4 sm:p-6">
                <div className="flex min-w-0 flex-col items-start gap-3 pr-10 sm:flex-row sm:justify-between">
                    <DialogHeader className="min-w-0 flex-1 text-left">
                        <DialogTitle className="text-xl leading-tight">
                            {t('guided.promptModules.title', '프롬프트 모듈 불러오기')}
                        </DialogTitle>
                        <DialogDescription className="text-base leading-6">
                            {t('guided.promptModules.description', '폴더를 고르고 원하는 한 줄을 눌러 현재 프롬프트에 추가하세요.')}
                        </DialogDescription>
                    </DialogHeader>
                    {allowInlineManage && (
                        <Button type="button" variant="ghost" size="sm" onClick={createModule} className="shrink-0 self-start">
                            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                            {t('guided.promptModules.create.trigger', '새 모듈 만들기')}
                        </Button>
                    )}
                </div>

                <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        placeholder={t('guided.promptModules.searchPlaceholder', '폴더 또는 파일 이름 검색')}
                        aria-label={t('guided.promptModules.searchLabel', '프롬프트 모듈 검색')}
                        className="pl-10 text-base"
                    />
                </div>

                <div className="grid min-h-0 flex-1 grid-rows-[minmax(11rem,40%)_minmax(0,1fr)] gap-4 md:grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.2fr)] md:grid-rows-1">
                    <section className="min-h-0 overflow-y-auto border-y border-border/70 py-2" aria-label={t('guided.promptModules.filesLabel', '프롬프트 모듈 파일')}>
                        {files.length === 0 ? (
                            <div className="flex flex-col items-center gap-3 px-3 py-6 text-center">
                                <p className="text-base leading-6 text-muted-foreground">
                                    {t('guided.promptModules.empty', '저장된 프롬프트 모듈이 아직 없어요.')}
                                </p>
                                {showManageAction && (
                                    <Button asChild variant="outline">
                                        <Link to="/advanced?guided=fragments" onClick={() => handleOpenChange(false)}>
                                            {t('guided.promptModules.manage', '모듈 관리 열기')}
                                        </Link>
                                    </Button>
                                )}
                            </div>
                        ) : groups.length === 0 ? (
                            <p className="px-3 py-6 text-center text-base leading-6 text-muted-foreground">
                                {t('guided.promptModules.noResults', '검색 결과가 없어요.')}
                            </p>
                        ) : groups.map(group => (
                            <div key={group.folder || '__unfiled'} className="pb-3 last:pb-0">
                                <h3 className="px-3 py-1 text-sm font-semibold text-muted-foreground">
                                    {group.folder || t('guided.promptModules.unfiled', '폴더 없음')}
                                </h3>
                                <div>
                                    {group.files.map(file => {
                                        const path = getFragmentCanonicalPath(file)
                                        const selected = file.id === selectedFileId
                                        return (
                                            <button
                                                key={file.id}
                                                type="button"
                                                aria-pressed={selected}
                                                onClick={() => void selectFile(file)}
                                                className={cn(
                                                    'flex min-h-11 w-full items-start gap-2 border-l-2 border-transparent px-3 py-2.5 text-left transition-colors duration-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                                                    selected
                                                        ? 'border-primary bg-primary/10 text-foreground'
                                                        : 'hover:border-primary/40 hover:bg-primary/[0.06]',
                                                )}
                                            >
                                                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                                                <span className="min-w-0 flex-1">
                                                    <span className="block break-words text-base font-medium leading-5 [overflow-wrap:anywhere]">{path}</span>
                                                    <span className="mt-1 block text-sm text-muted-foreground">
                                                        {t('guided.promptModules.lineCount', '{{count}}줄', { count: file.lineCount })}
                                                    </span>
                                                </span>
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>
                        ))}
                    </section>

                    <section className="flex min-h-0 flex-col border-y border-border/70" aria-live="polite" aria-label={t('guided.promptModules.linesLabel', '선택할 프롬프트 문장')}>
                        {selectedFile !== null && (
                            <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
                                <p className="min-w-0 flex-1 break-words text-sm font-medium text-muted-foreground [overflow-wrap:anywhere]">
                                    {getFragmentCanonicalPath(selectedFile)}
                                </p>
                                {allowInlineManage && (
                                    <Button type="button" variant="ghost" size="sm" className="shrink-0" onClick={() => editModule(selectedFile.id)}>
                                        <Pencil className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                                        {t('guided.promptModules.edit.trigger', '내용 편집')}
                                    </Button>
                                )}
                            </div>
                        )}

                        <div className="min-h-0 flex-1 overflow-y-auto">
                            {selectedFile === null ? (
                                <p className="px-4 py-10 text-center text-base leading-6 text-muted-foreground">
                                    {t('guided.promptModules.selectFile', '왼쪽에서 파일을 먼저 골라주세요.')}
                                </p>
                            ) : loading ? (
                                <div className="flex items-center justify-center gap-2 px-4 py-10 text-base text-muted-foreground">
                                    <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
                                    {t('guided.promptModules.loading', '내용을 불러오는 중…')}
                                </div>
                            ) : loadFailed ? (
                                <div className="flex flex-col items-center gap-3 px-4 py-10 text-center text-base text-destructive">
                                    <p>{t('guided.promptModules.loadError', '내용을 불러오지 못했어요. 다시 시도해 주세요.')}</p>
                                    <Button type="button" variant="outline" onClick={() => void selectFile(selectedFile)}>
                                        {t('guided.promptModules.retry', '다시 시도')}
                                    </Button>
                                </div>
                            ) : lines.length === 0 ? (
                                <p className="px-4 py-10 text-center text-base leading-6 text-muted-foreground">
                                    {t('guided.promptModules.noUsableLines', '선택할 수 있는 문장이 없어요.')}
                                </p>
                            ) : (
                                <div>
                                    {lines.map((line, index) => (
                                        <button
                                            key={`${index}:${line}`}
                                            type="button"
                                            onClick={() => selectLine(line)}
                                            className="min-h-11 w-full border-b border-border/50 px-3 py-3 text-left text-base leading-6 transition-colors duration-standard last:border-b-0 hover:bg-primary/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                                        >
                                            <span className="block break-words [overflow-wrap:anywhere]">{line}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </section>
                </div>
            </DialogContent>
        </Dialog>
        {allowInlineManage && (
            <>
                <PromptModuleCreator
                    open={createOpen}
                    onOpenChange={nextOpen => {
                        setCreateOpen(nextOpen)
                        if (!nextOpen) setOpen(true)
                    }}
                    hideTrigger
                    sourceText={createSourceText}
                />
                <PromptModuleContentEditor
                    file={editingFile}
                    open={editingFileId !== null && editingFile !== null}
                    onOpenChange={nextOpen => {
                        if (!nextOpen) {
                            setEditingFileId(null)
                            setOpen(true)
                        }
                    }}
                    onSaved={nextLines => setLines([...nextLines])}
                />
            </>
        )}
        </>
    )
}
