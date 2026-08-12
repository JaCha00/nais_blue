import { useEffect, useMemo, useState } from 'react'
import { CloudUpload, FolderOpen, FolderPlus, Save, Trash2 } from 'lucide-react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
    DEFAULT_GENERATION_FOLDER_ID,
    generationFolderDescendantIds,
    resolveGenerationFolder,
    type GenerationFolder,
} from '@/domain/generation-folders'
import type { DefaultR2Readiness } from '@/hooks/useDefaultR2Readiness'
import { openNativeFileDialog } from '@/platform/native-file-dialog'
import { useSettingsStore } from '@/stores/settings-store'

interface FolderRow {
    readonly folder: GenerationFolder
    readonly depth: number
}

function folderRows(folders: readonly GenerationFolder[]): FolderRow[] {
    const rows: FolderRow[] = []
    const append = (parentId: string | null, depth: number) => {
        for (const folder of folders.filter(candidate => candidate.parentId === parentId)) {
            rows.push({ folder, depth })
            append(folder.id, depth + 1)
        }
    }
    append(null, 0)
    return rows
}

export function GenerationFolderManagerDialog({
    open,
    onOpenChange,
    r2State,
}: {
    open: boolean
    onOpenChange(open: boolean): void
    r2State: DefaultR2Readiness
}) {
    const { t } = useTranslation()
    const folders = useSettingsStore(state => state.generationFolders)
    const activeId = useSettingsStore(state => state.activeGenerationFolderId)
    const savePath = useSettingsStore(state => state.savePath)
    const useAbsolutePath = useSettingsStore(state => state.useAbsolutePath)
    const addFolder = useSettingsStore(state => state.addGenerationFolder)
    const updateFolder = useSettingsStore(state => state.updateGenerationFolder)
    const moveFolders = useSettingsStore(state => state.moveGenerationFolders)
    const deleteFolders = useSettingsStore(state => state.deleteGenerationFolders)
    const copyPrompt = useSettingsStore(state => state.copyGenerationFolderPrompt)
    const setActive = useSettingsStore(state => state.setActiveGenerationFolder)
    const rows = useMemo(() => folderRows(folders), [folders])
    const [selectedId, setSelectedId] = useState(activeId)
    const selected = folders.find(folder => folder.id === selectedId) ?? folders[0]
    const [newName, setNewName] = useState('')
    const [name, setName] = useState('')
    const [parentId, setParentId] = useState<string | null>(null)
    const [rootDirectory, setRootDirectory] = useState('')
    const [absolute, setAbsolute] = useState(false)
    const [commonPrompt, setCommonPrompt] = useState('')
    const [autoUpload, setAutoUpload] = useState(false)
    const [bucket, setBucket] = useState('')
    const [prefix, setPrefix] = useState('')
    const [transferTargets, setTransferTargets] = useState<string[]>([])
    const [error, setError] = useState<string | null>(null)
    const [deleteOpen, setDeleteOpen] = useState(false)

    useEffect(() => {
        if (!selected) return
        setName(selected.name)
        setParentId(selected.parentId)
        setRootDirectory(selected.rootDirectory ?? '')
        setAbsolute(selected.useAbsolutePath)
        setCommonPrompt(selected.commonPrompt)
        setAutoUpload(selected.r2.autoUpload)
        setBucket(selected.r2.bucket ?? '')
        setPrefix(selected.r2.prefix ?? '')
        setTransferTargets([])
        setError(null)
    }, [selected])

    if (!selected) return null

    const usesSystemDefaultName = selected.id === DEFAULT_GENERATION_FOLDER_ID && selected.name === '기본 출력'
    const descendants = new Set(generationFolderDescendantIds(folders, selected.id))
    const parentOptions = rows.filter(row => row.folder.id !== selected.id && !descendants.has(row.folder.id))
    const transferOptions = rows.filter(row => descendants.has(row.folder.id))
    const previewFolders = folders.map(folder => folder.id === selected.id
        ? {
            ...folder,
            name: name.trim() || folder.name,
            parentId,
            rootDirectory: parentId === null ? rootDirectory.trim() || null : null,
            useAbsolutePath: parentId === null && absolute,
            commonPrompt,
            r2: {
                autoUpload,
                bucket: bucket.trim() || null,
                prefix: prefix.trim() || null,
            },
        }
        : folder)
    let resolved: ReturnType<typeof resolveGenerationFolder> = null
    try {
        resolved = resolveGenerationFolder(previewFolders, selected.id, {
            directory: savePath,
            useAbsolutePath,
            r2Bucket: r2State.profile?.bucket,
            r2Prefix: r2State.profile?.prefix,
        })
    } catch {
        // The save action reports the field error; an in-progress edit must not close the dialog.
    }

    const createFolder = (child: boolean) => {
        try {
            const id = addFolder({
                name: newName,
                parentId: child ? selected.id : null,
                rootDirectory: child ? null : newName,
            })
            setNewName('')
            setSelectedId(id)
            setActive(id)
        } catch {
            setError(t('generationFolders.manager.createError', '폴더를 만들지 못했습니다.'))
        }
    }

    const save = () => {
        try {
            if (parentId !== selected.parentId) moveFolders([selected.id], parentId)
            updateFolder(selected.id, {
                name,
                rootDirectory,
                useAbsolutePath: absolute,
                commonPrompt,
                r2: {
                    autoUpload: r2State.status === 'ready' ? autoUpload : false,
                    bucket,
                    prefix,
                },
            })
            setActive(selected.id)
            setError(null)
        } catch {
            setError(t('generationFolders.manager.saveError', '폴더 설정을 저장하지 못했습니다.'))
        }
    }

    const browse = async () => {
        const picked = await openNativeFileDialog({ directory: true, multiple: false, title: t('generationFolders.manager.browseTitle', '이미지 생성 최상위 폴더 선택') })
        if (typeof picked === 'string') {
            setRootDirectory(picked)
            setAbsolute(true)
        }
    }

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="max-w-5xl overflow-hidden p-0">
                    <DialogHeader className="border-b border-border/60 px-5 py-4 pr-14">
                        <DialogTitle>{t('generationFolders.manager.title', '이미지 생성 폴더')}</DialogTitle>
                        <DialogDescription>{t('generationFolders.manager.description', '로컬 경로, 공통 프롬프트와 R2 대상을 한 폴더 단위로 관리합니다.')}</DialogDescription>
                    </DialogHeader>
                    <div className="grid min-h-0 overflow-y-auto md:grid-cols-[minmax(14rem,0.7fr)_minmax(0,1.3fr)] md:overflow-hidden">
                        <aside className="border-b border-border/60 p-4 md:overflow-y-auto md:border-b-0 md:border-r">
                            <div className="space-y-1">
                                {rows.map(row => (
                                    <button
                                        key={row.folder.id}
                                        type="button"
                                        className={`flex min-h-10 w-full items-center gap-2 rounded-control px-2 text-left text-sm ${row.folder.id === selected.id ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/55'}`}
                                        style={{ paddingLeft: `${0.5 + row.depth * 1.15}rem` }}
                                        onClick={() => setSelectedId(row.folder.id)}
                                    >
                                        <FolderOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
                                        <span className="truncate">{row.folder.id === DEFAULT_GENERATION_FOLDER_ID && row.folder.name === '기본 출력' ? t('generationFolders.defaultName', '기본 출력') : row.folder.name}</span>
                                    </button>
                                ))}
                            </div>
                            <div className="mt-4 border-t border-border/55 pt-3">
                                <Input value={newName} onChange={event => setNewName(event.target.value)} placeholder={t('generationFolders.manager.newName', '새 폴더 이름')} maxLength={96} />
                                <div className="mt-2 grid grid-cols-2 gap-2">
                                    <Button type="button" variant="outline" size="sm" disabled={!newName.trim()} onClick={() => createFolder(false)}>
                                        <FolderPlus className="mr-1.5 h-4 w-4" />{t('generationFolders.manager.createRoot', '최상위')}
                                    </Button>
                                    <Button type="button" variant="outline" size="sm" disabled={!newName.trim()} onClick={() => createFolder(true)}>
                                        <FolderPlus className="mr-1.5 h-4 w-4" />{t('generationFolders.manager.createChild', '하위')}
                                    </Button>
                                </div>
                            </div>
                        </aside>

                        <main className="min-h-0 space-y-5 p-5 md:overflow-y-auto">
                            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.7fr)]">
                                <label className="grid gap-1 text-xs font-medium">
                                    <span>{t('generationFolders.manager.name', '폴더 이름')}</span>
                                    <Input
                                        value={usesSystemDefaultName ? t('generationFolders.defaultName', '기본 출력') : name}
                                        disabled={usesSystemDefaultName}
                                        onChange={event => setName(event.target.value)}
                                        maxLength={96}
                                    />
                                </label>
                                <label className="grid gap-1 text-xs font-medium">
                                    <span>{t('generationFolders.manager.parent', '상위 폴더')}</span>
                                    <select className="min-h-11 border-x-0 border-y border-input bg-background px-3 text-sm" value={parentId ?? ''} onChange={event => setParentId(event.target.value || null)} disabled={selected.id === DEFAULT_GENERATION_FOLDER_ID}>
                                        <option value="">{t('generationFolders.manager.noParent', '없음 · 최상위')}</option>
                                        {parentOptions.map(row => <option key={row.folder.id} value={row.folder.id}>{'— '.repeat(row.depth)}{row.folder.id === DEFAULT_GENERATION_FOLDER_ID && row.folder.name === '기본 출력' ? t('generationFolders.defaultName', '기본 출력') : row.folder.name}</option>)}
                                    </select>
                                </label>
                            </div>

                            {parentId === null && (
                                <label className="grid gap-1 text-xs font-medium">
                                    <span>{t('generationFolders.manager.rootPath', '로컬 최상위 경로')}</span>
                                    <div className="flex gap-2">
                                        <Input value={rootDirectory} onChange={event => setRootDirectory(event.target.value)} placeholder="NAIS_Output" />
                                        <Button type="button" variant="outline" size="icon" aria-label={t('generationFolders.manager.browse', '폴더 찾아보기')} onClick={() => void browse()}><FolderOpen className="h-4 w-4" /></Button>
                                    </div>
                                    <span className="flex min-h-8 items-center gap-2 font-normal text-muted-foreground">
                                        <Checkbox checked={absolute} onCheckedChange={checked => setAbsolute(checked === true)} />
                                        {t('generationFolders.manager.useAbsolute', '입력값을 전체 경로로 사용')}
                                    </span>
                                </label>
                            )}
                            {resolved && parentId !== null && <p className="text-xs text-muted-foreground">{t('generationFolders.manager.localPath', '로컬 경로')} <span className="break-all font-mono text-foreground">{resolved.directory}</span></p>}

                            <label className="grid gap-1 text-xs font-medium">
                                <span>{t('generationFolders.manager.commonPrompt', '폴더 공통 프롬프트')}</span>
                                <textarea className="min-h-24 resize-y rounded-control border border-input bg-background p-3 text-sm" value={commonPrompt} onChange={event => setCommonPrompt(event.target.value)} maxLength={20_000} placeholder={t('generationFolders.manager.commonPlaceholder', '이 폴더에서 생성하는 작업에만 앞에 추가됩니다.')} />
                                <span className="text-muted-foreground">{t('generationFolders.manager.noPromptInheritance', '하위 폴더에는 자동 상속되지 않습니다.')}</span>
                            </label>

                            {transferOptions.length > 0 && (
                                <details className="border-y border-border/55 py-3">
                                    <summary className="cursor-pointer text-xs font-semibold">{t('generationFolders.manager.transferTitle', '공통 프롬프트를 하위 폴더로 이전')}</summary>
                                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                        {transferOptions.map(row => (
                                            <label key={row.folder.id} className="flex min-h-9 items-center gap-2 text-xs">
                                                <Checkbox checked={transferTargets.includes(row.folder.id)} onCheckedChange={checked => setTransferTargets(current => checked === true ? [...current, row.folder.id] : current.filter(id => id !== row.folder.id))} />
                                                <span className="truncate">{row.folder.name}</span>
                                            </label>
                                        ))}
                                    </div>
                                    <p className="mt-2 text-xs text-muted-foreground">{t('generationFolders.manager.transferWarning', '선택한 폴더의 기존 공통 프롬프트를 덮어씁니다.')}</p>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="mt-3"
                                        disabled={transferTargets.length === 0}
                                        onClick={() => {
                                            updateFolder(selected.id, { commonPrompt })
                                            copyPrompt(selected.id, transferTargets)
                                        }}
                                    >{t('generationFolders.manager.transferAction', '선택한 폴더로 복사')}</Button>
                                </details>
                            )}

                            <section className="space-y-3 border-y border-border/55 py-4">
                                <div className={r2State.status === 'ready' ? '' : 'opacity-55'}>
                                    <label className="flex min-h-11 items-start gap-3 text-sm font-medium">
                                        <Checkbox checked={r2State.status === 'ready' && autoUpload} disabled={r2State.status !== 'ready'} onCheckedChange={checked => setAutoUpload(checked === true)} />
                                        <span>{t('generationFolders.manager.autoUpload', '이 폴더의 결과를 자동 R2 업로드')}<span className="mt-1 block text-xs font-normal text-muted-foreground">{t('generationFolders.manager.autoUploadHelp', '하위 폴더에는 각자 별도로 지정합니다.')}</span></span>
                                    </label>
                                </div>
                                {r2State.status !== 'ready' && (
                                    <Button asChild type="button" variant="outline" size="sm">
                                        <Link to="/guided-preview/task/library/r2"><CloudUpload className="mr-2 h-4 w-4" />{t('generationFolders.manager.setupR2', 'R2 업로드 설정하기')}</Link>
                                    </Button>
                                )}
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <label className="grid gap-1 text-xs font-medium"><span>{t('generationFolders.manager.bucketOverride', '버킷 재정의 · 선택')}</span><Input value={bucket} onChange={event => setBucket(event.target.value)} placeholder={r2State.profile?.bucket || t('generationFolders.manager.useDefaultProfile', '기본 프로필 사용')} /></label>
                                    <label className="grid gap-1 text-xs font-medium"><span>{t('generationFolders.manager.prefixOverride', '프리픽스 재정의 · 선택')}</span><Input value={prefix} onChange={event => setPrefix(event.target.value)} placeholder={r2State.profile?.prefix || t('generationFolders.manager.useDefaultProfile', '기본 프로필 사용')} /></label>
                                </div>
                                {resolved && (
                                    <p className="text-xs leading-5 text-muted-foreground">
                                        {t('generationFolders.manager.target', '실제 대상')} <span className="font-mono text-foreground">{resolved.r2.bucket ?? t('generationFolders.manager.bucketUnset', '버킷 미설정')}/{resolved.r2.prefix}</span><br />
                                        {t('generationFolders.manager.prefixRule', '하위 폴더는 이 프리픽스 아래에 이름이 붙습니다. 하위 폴더가 직접 프리픽스를 지정하면 그 값이 우선합니다.')}
                                    </p>
                                )}
                            </section>

                            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
                            <div className="flex flex-wrap justify-between gap-2">
                                <Button type="button" variant="ghost" className="text-destructive" disabled={selected.id === DEFAULT_GENERATION_FOLDER_ID} onClick={() => setDeleteOpen(true)}><Trash2 className="mr-2 h-4 w-4" />{t('generationFolders.manager.delete', '폴더 정의 삭제')}</Button>
                                <Button type="button" onClick={save}><Save className="mr-2 h-4 w-4" />{t('generationFolders.manager.save', '설정 저장')}</Button>
                            </div>
                        </main>
                    </div>
                </DialogContent>
            </Dialog>
            <ConfirmDialog
                open={deleteOpen}
                onOpenChange={setDeleteOpen}
                title={t('generationFolders.manager.deleteTitle', '이 생성 폴더를 삭제할까요?')}
                description={t('generationFolders.manager.deleteDescription', '하위 폴더 정의도 함께 삭제됩니다. 디스크의 이미지와 R2 파일은 삭제하지 않습니다.')}
                confirmText={t('generationFolders.manager.delete', '폴더 정의 삭제')}
                variant="destructive"
                onConfirm={() => {
                    deleteFolders([selected.id])
                    setSelectedId(DEFAULT_GENERATION_FOLDER_ID)
                }}
            />
        </>
    )
}
