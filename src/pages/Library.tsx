import { useState, useCallback, useEffect, useRef } from 'react'
import {
    DndContext,
    pointerWithin,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragOverlay,
    defaultDropAnimationSideEffects,
    DragStartEvent,
    DragEndEvent,
    MeasuringStrategy
} from '@dnd-kit/core'
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    rectSortingStrategy,
} from '@dnd-kit/sortable'
import { snapCenterToCursor } from '@dnd-kit/modifiers'
import { useLibraryStore, LibraryItem } from '@/stores/library-store'
import { SortableLibraryItem } from '@/components/library/SortableLibraryItem'
import { LibraryItem as LibraryItemComponent } from '@/components/library/LibraryItem'
import { useTranslation } from 'react-i18next'
import { mkdir, exists, writeFile } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { toast } from '@/components/ui/use-toast'
import { ImagePlus, X, Grid3x3, Edit3, Trash2, Layers, ArrowLeft, CheckSquare, FolderOpen, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settings-store'
import {
    getMediaStorageRoot,
    MEDIA_STORAGE_BASE_DIRECTORY,
    shouldUseAbsoluteMediaPath,
} from '@/platform/storage'

const dropAnimation = {
    sideEffects: defaultDropAnimationSideEffects({
        styles: {
            active: {
                opacity: '0.5',
            },
        },
    }),
}

import { LibraryRenameDialog } from '@/components/library/LibraryRenameDialog'
import { ImageReferenceDialog } from '@/components/metadata/ImageReferenceDialog'
import { MetadataDialog } from '@/components/metadata/MetadataDialog'
import { readFile } from '@tauri-apps/plugin-fs'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useTrashStore } from '@/stores/trash-store'
import { archiveLibraryItems } from '@/services/trash/asset-trash-service'

// ... existing imports

export default function Library() {
    const { t } = useTranslation()
    const { 
        items, 
        addItem, 
        setItems, 
        updateItem, 
        gridColumns, 
        setGridColumns,
        // Edit Mode
        isEditMode,
        setEditMode,
        selectedItemIds,
        toggleItemSelection,
        selectItemRange,
        selectAllItems,
        clearSelection: _clearSelection,
        deleteSelectedItems,
        lastSelectedItemId,
        // Stack
        createStackFromSelected,
        currentStackId,
        setCurrentStackId,
        unstack
    } = useLibraryStore()
    const addToTrash = useTrashStore(state => state.add)
    const { libraryPath, useAbsoluteLibraryPath } = useSettingsStore()
    const [activeId, setActiveId] = useState<string | null>(null)
    const [isDraggingFile, setIsDraggingFile] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Get current view items (main library or inside a stack)
    const currentStack = currentStackId ? items.find(item => item.id === currentStackId) : null
    const viewItems = currentStack?.stackItems || items.filter(() => !currentStackId)

    // Dialog States
    const [renameDialogOpen, setRenameDialogOpen] = useState(false)
    const [selectedItemForRename, setSelectedItemForRename] = useState<LibraryItem | null>(null)
    const [imageRefDialogOpen, setImageRefDialogOpen] = useState(false)
    const [selectedImageRef, setSelectedImageRef] = useState<string | null>(null)
    const [metadataDialogOpen, setMetadataDialogOpen] = useState(false)
    const [selectedImageForMetadata, setSelectedImageForMetadata] = useState<string | undefined>()
    const [confirmDeleteSelectedOpen, setConfirmDeleteSelectedOpen] = useState(false)

    // Fullscreen viewer state
    const [viewerImageSrc, setViewerImageSrc] = useState<string | null>(null)

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    )

    // ESC key handler for closing viewer
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && viewerImageSrc) {
                setViewerImageSrc(null)
            }
        }
        window.addEventListener('keydown', handleEsc)
        return () => window.removeEventListener('keydown', handleEsc)
    }, [viewerImageSrc])

    // Ensure Library Directory Exists & Sync Files
    useEffect(() => {
        const initDir = async () => {
            try {
                // 1. Ensure Dir Exists
                if (shouldUseAbsoluteMediaPath(useAbsoluteLibraryPath) && libraryPath) {
                    // Absolute path
                    const existsDir = await exists(libraryPath)
                    if (!existsDir) {
                        await mkdir(libraryPath, { recursive: true })
                    }
                } else {
                    // Relative to Pictures folder
                    const relPath = libraryPath || 'NAIS_Library'
                    const existsDir = await exists(relPath, { baseDir: MEDIA_STORAGE_BASE_DIRECTORY })
                    if (!existsDir) {
                        await mkdir(relPath, { baseDir: MEDIA_STORAGE_BASE_DIRECTORY })
                    }
                }

                // 2. Sync: Remove items that no longer exist on disk
                // We process this strictly to keep the library clean.
                // Note: 'items' comes from store, which is persisted.
                // We can't directly map 'items' inside this async function if it changes, 
                // but for init sync (on mount), using the initial state is fine.
                // However, 'items' in dependency array might cause loops if we simply set items.
                // We'll trust the store's current state on mount.

                const currentItems = useLibraryStore.getState().items
                const validItems: LibraryItem[] = []
                let removedCount = 0

                for (const item of currentItems) {
                    try {
                        const fileExists = await exists(item.path)
                        if (fileExists) {
                            validItems.push(item)
                        } else {
                            removedCount++
                        }
                    } catch (e) {
                        // If checking existence fails (e.g. permission), assume valid to be safe? 
                        // Or assume invalid? 'exists' usually returns false on error or file not found.
                        // But tauri v2 exists might throw.
                        // Let's assume if we can't verify it, we keep it, OR we remove it.
                        // Safest is to keep if uncertain, but if file is surely gone, remove.
                        // If error is "file not found", it's gone.
                        console.warn(`Failed to check file existence for ${item.name}:`, e)
                        // For now, keep it to avoid accidental deletion on IO errors.
                        validItems.push(item)
                    }
                }

                if (removedCount > 0) {
                    setItems(validItems)
                    console.log(`[Library] Synced: Removed ${removedCount} missing items.`)
                }

            } catch (e) {
                console.error('Failed to init/sync library:', e)
            }
        }
        initDir()
    }, [setItems, libraryPath, useAbsoluteLibraryPath])

    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(event.active.id as string)
    }

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event

        if (over && active.id !== over.id) {
            const oldIndex = items.findIndex((item) => item.id === active.id)
            const newIndex = items.findIndex((item) => item.id === over.id)
            setItems(arrayMove(items, oldIndex, newIndex))
        }

        setActiveId(null)
    }

    // Handle File Drop from OS
    const onFileDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDraggingFile(false)

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const files = Array.from(e.dataTransfer.files)
            const imageFiles = files.filter(f => f.type.startsWith('image/'))

            if (imageFiles.length === 0) return

            try {
                const mediaStorageRoot = await getMediaStorageRoot()
                const relPath = libraryPath || 'NAIS_Library'
                const libraryDir = shouldUseAbsoluteMediaPath(useAbsoluteLibraryPath) && libraryPath
                    ? libraryPath
                    : await join(mediaStorageRoot, relPath)

                // Ensure dir exists
                if (shouldUseAbsoluteMediaPath(useAbsoluteLibraryPath) && libraryPath) {
                    if (!(await exists(libraryPath))) {
                        await mkdir(libraryPath, { recursive: true })
                    }
                } else {
                    if (!(await exists(relPath, { baseDir: MEDIA_STORAGE_BASE_DIRECTORY }))) {
                        await mkdir(relPath, { baseDir: MEDIA_STORAGE_BASE_DIRECTORY })
                    }
                }

                let addedCount = 0

                // Check for custom app metadata
                const customFilename = e.dataTransfer.getData('nais/filename')

                for (const file of imageFiles) {
                    const buffer = await file.arrayBuffer()
                    const uint8Array = new Uint8Array(buffer)
                    const ext = file.name.split('.').pop() || 'png'
                    const uuid = crypto.randomUUID()
                    const shortUuid = uuid.split('-')[0] // First 8 chars for shorter names

                    // Determine filename - add UUID suffix to prevent collisions
                    let baseName = file.name.replace(/\.[^.]+$/, '') // Remove extension
                    if (customFilename && imageFiles.length === 1) {
                        baseName = customFilename.replace(/\.[^.]+$/, '')
                    }

                    // Create unique filename: originalName_xxxxxxxx.ext
                    const fileName = `${baseName}_${shortUuid}.${ext}`

                    const newPath = await join(libraryDir, fileName)

                    // Write
                    if (shouldUseAbsoluteMediaPath(useAbsoluteLibraryPath) && libraryPath) {
                        await writeFile(newPath, uint8Array)
                    } else {
                        const relPath = libraryPath || 'NAIS_Library'
                        await writeFile(`${relPath}/${fileName}`, uint8Array, { baseDir: MEDIA_STORAGE_BASE_DIRECTORY })
                    }

                    const newItem: LibraryItem = {
                        id: uuid,
                        name: fileName.replace(`.${ext}`, ''), // Display Name matched
                        path: newPath,
                        width: 0,
                        height: 0,
                        createdAt: Date.now()
                    }

                    addItem(newItem)
                    addedCount++
                }

                if (addedCount > 0) {
                    toast({
                        title: t('library.added', '이미지 추가됨'),
                        description: t('library.addedDesc', { count: addedCount }),
                        variant: 'success'
                    })
                }
            } catch (error) {
                console.error('File import failed:', error)
                toast({
                    title: t('library.error', '가져오기 실패'),
                    variant: 'destructive'
                })
            }
        }
    }, [addItem, t])

    const activeItem = activeId ? items.find(i => i.id === activeId) : null

    // Helper
    const arrayBufferToBase64 = (buffer: Uint8Array): string => {
        let binary = ''
        const len = buffer.byteLength
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(buffer[i])
        }
        return btoa(binary)
    }

    // Handlers
    const handleRenameClick = (item: LibraryItem) => {
        setSelectedItemForRename(item)
        setRenameDialogOpen(true)
    }

    const handleRenameConfirm = (newName: string) => {
        if (selectedItemForRename) {
            updateItem(selectedItemForRename.id, { name: newName })
            // Note: We are currently NOT renaming the physical file to avoid file referencing issues or complexity for now.
            // The user request was "Rename in context menu", which usually implies display name.
            // If physical rename is strictly required, we'd need `rename`.
            // Given "Unify filenames" requirement earlier, maybe physical rename is expected?
            // "Name change" usually means the display name in the app.
            // Let's stick to display name update in the store for safety.
            toast({ title: t('actions.saved', '저장 완료'), variant: 'success' })
        }
    }

    const handleAddRefClick = async (item: LibraryItem) => {
        try {
            const data = await readFile(item.path)
            const base64 = arrayBufferToBase64(data)
            setSelectedImageRef(`data:image/png;base64,${base64}`)
            setImageRefDialogOpen(true)
        } catch (e) {
            console.error('Failed to load for ref:', e)
            toast({ title: t('library.error', '오류 발생'), variant: 'destructive' })
        }
    }

    const handleLoadMetadata = async (item: LibraryItem) => {
        try {
            const data = await readFile(item.path)
            const base64 = arrayBufferToBase64(data)
            setSelectedImageForMetadata(`data:image/png;base64,${base64}`)
            setMetadataDialogOpen(true)
        } catch (e) {
            console.error('Failed to load metadata:', e)
            toast({ title: t('library.error', '오류 발생'), variant: 'destructive' })
        }
    }

    const handleToggleGrid = () => {
        const next = gridColumns >= 5 ? 2 : gridColumns + 1
        setGridColumns(next)
    }

    /**
     * Depends on the current stack-aware view and the Library store's existing
     * selection removal. Archiving first preserves every selected file before
     * the UI mutation clears the selection and returns the user to normal mode.
     */
    const handleTrashSelectedItems = async () => {
        const selectedItems = viewItems.filter(item => selectedItemIds.includes(item.id))
        if (selectedItems.length === 0) return
        try {
            const trashItem = await archiveLibraryItems(selectedItems, currentStackId)
            addToTrash(trashItem)
            deleteSelectedItems()
            toast({ title: t('trash.moved', '휴지통으로 이동했습니다.'), variant: 'success' })
        } catch (error) {
            console.error('Failed to move library selection to trash:', error)
            toast({ title: t('common.error', '오류'), variant: 'destructive' })
        }
    }

    // File import handler
    const handleImportClick = () => {
        fileInputRef.current?.click()
    }

    const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files
        if (!files || files.length === 0) return

        const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'))
        if (imageFiles.length === 0) return

        try {
            const mediaStorageRoot = await getMediaStorageRoot()
            const relPath = libraryPath || 'NAIS_Library'
            const libraryDir = shouldUseAbsoluteMediaPath(useAbsoluteLibraryPath) && libraryPath
                ? libraryPath
                : await join(mediaStorageRoot, relPath)

            // Ensure dir exists
            if (shouldUseAbsoluteMediaPath(useAbsoluteLibraryPath) && libraryPath) {
                if (!(await exists(libraryPath))) {
                    await mkdir(libraryPath, { recursive: true })
                }
            } else {
                if (!(await exists(relPath, { baseDir: MEDIA_STORAGE_BASE_DIRECTORY }))) {
                    await mkdir(relPath, { baseDir: MEDIA_STORAGE_BASE_DIRECTORY })
                }
            }

            let addedCount = 0
            for (const file of imageFiles) {
                const buffer = await file.arrayBuffer()
                const uint8Array = new Uint8Array(buffer)
                const ext = file.name.split('.').pop() || 'png'
                const uuid = crypto.randomUUID()
                const shortUuid = uuid.split('-')[0]
                const baseName = file.name.replace(/\.[^.]+$/, '')
                const fileName = `${baseName}_${shortUuid}.${ext}`
                const newPath = await join(libraryDir, fileName)

                if (shouldUseAbsoluteMediaPath(useAbsoluteLibraryPath) && libraryPath) {
                    await writeFile(newPath, uint8Array)
                } else {
                    await writeFile(`${relPath}/${fileName}`, uint8Array, { baseDir: MEDIA_STORAGE_BASE_DIRECTORY })
                }

                const newItem: LibraryItem = {
                    id: uuid,
                    name: fileName.replace(`.${ext}`, ''),
                    path: newPath,
                    width: 0,
                    height: 0,
                    createdAt: Date.now()
                }
                addItem(newItem)
                addedCount++
            }

            if (addedCount > 0) {
                toast({
                    title: t('library.added', '이미지 추가됨'),
                    description: t('library.addedDesc', { count: addedCount }),
                    variant: 'success'
                })
            }
        } catch (error) {
            console.error('File import failed:', error)
            toast({ title: t('library.error', '가져오기 실패'), variant: 'destructive' })
        }

        e.target.value = ''
    }

    return (
        <div
            className="h-full flex flex-col relative"
            onDragOver={(e) => {
                e.preventDefault()
                // Check if it's a file drag from OS
                if (e.dataTransfer.types.includes('Files')) {
                    if (!isDraggingFile) setIsDraggingFile(true)
                }
            }}
            onDragLeave={(e) => {
                e.preventDefault()
                // Simple check to see if we left the window
                if (e.currentTarget.contains(e.relatedTarget as Node)) return
                setIsDraggingFile(false)
            }}
            onDrop={onFileDrop}
        >
            {/* Header */}
            <div className="z-10 flex min-h-14 w-full shrink-0 items-center border-b bg-background/50 px-3 py-2 backdrop-blur-sm sm:px-4 lg:px-6">
                {isEditMode ? (
                    /* Edit Mode Header */
                    <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-center gap-2">
                            <Button variant="ghost" size="sm" className="h-11 shrink-0 hover:bg-white/10 lg:h-9" onClick={() => setEditMode(false)}>
                                <X className="h-4 w-4 mr-2" /> {t('actions.cancel', '취소')}
                            </Button>
                            <span className="min-w-0 truncate text-sm text-muted-foreground">
                                {selectedItemIds.length} {t('library.selected', '개 선택')}
                            </span>
                        </div>
                        <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-11 min-w-0 flex-1 px-2 hover:bg-white/10 sm:flex-none sm:px-3 lg:h-9"
                                onClick={selectAllItems}
                            >
                                <CheckSquare className="mr-1.5 h-4 w-4 shrink-0" />
                                <span className="min-w-0 truncate">{t('scene.selectAll', '전체 선택')}</span>
                            </Button>
                            <div className="hidden h-5 w-px bg-white/10 sm:block" />
                            {!currentStackId && (
                                <Tip content={t('library.createStackDesc', '선택한 이미지를 하나의 스택으로 묶음')}>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-11 min-w-0 flex-1 px-2 hover:bg-white/10 sm:flex-none sm:px-3 lg:h-9"
                                        onClick={createStackFromSelected}
                                        disabled={selectedItemIds.length < 2}
                                    >
                                        <Layers className="mr-1.5 h-4 w-4 shrink-0" />
                                        <span className="min-w-0 truncate">{t('library.createStack', '스택 만들기')}</span>
                                    </Button>
                                </Tip>
                            )}
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-11 min-w-0 flex-1 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive sm:flex-none sm:px-3 lg:h-9"
                                onClick={() => setConfirmDeleteSelectedOpen(true)}
                                disabled={selectedItemIds.length === 0}
                            >
                                <Trash2 className="mr-1.5 h-4 w-4 shrink-0" />
                                <span className="min-w-0 truncate">{t('actions.delete', '삭제')}</span>
                            </Button>
                        </div>
                    </div>
                ) : (
                    /* Normal Header */
                    <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                            {currentStackId ? (
                                <>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-11 w-11 shrink-0 px-0 hover:bg-white/10 sm:w-auto sm:px-3 lg:h-9"
                                        onClick={() => setCurrentStackId(null)}
                                        aria-label={t('actions.back', '뒤로')}
                                    >
                                        <ArrowLeft className="h-4 w-4 shrink-0 sm:mr-2" />
                                        <span className="sr-only sm:not-sr-only">{t('actions.back', '뒤로')}</span>
                                    </Button>
                                    <h2 className="min-w-0 truncate text-lg font-semibold tracking-tight" title={currentStack?.name}>{currentStack?.name}</h2>
                                </>
                            ) : (
                                <h2 className="min-w-0 truncate text-lg font-semibold tracking-tight">{t('library.title', '라이브러리')}</h2>
                            )}
                        </div>
                        <div className="ml-auto flex min-w-0 items-center justify-end gap-2">
                            {/* Hidden file input for image import */}
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                multiple
                                className="hidden"
                                onChange={handleFileInputChange}
                            />
                            {/* Import Image Button */}
                            <Tip content={t('library.import', '이미지 불러오기')}>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-11 w-11 shrink-0 text-muted-foreground hover:bg-white/10 hover:text-foreground lg:h-9 lg:w-9"
                                    onClick={handleImportClick}
                                    aria-label={t('library.import', '이미지 불러오기')}
                                >
                                    <Upload className="h-4 w-4" />
                                </Button>
                            </Tip>
                            <Tip content={t('library.editModeDesc', '여러 이미지를 선택하여 일괄 편집')}>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-11 w-11 shrink-0 text-muted-foreground hover:bg-white/10 hover:text-foreground lg:h-9 lg:w-9"
                                    onClick={() => setEditMode(true)} 
                                    disabled={viewItems.length === 0}
                                    aria-label={t('library.editModeDesc', '여러 이미지를 선택하여 일괄 편집')}
                                >
                                    <Edit3 className="h-4 w-4" />
                                </Button>
                            </Tip>
                            {currentStackId && (
                                <Tip content={t('library.unstackDesc', '스택을 해제하고 개별 이미지로 복원')}>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-11 w-11 shrink-0 px-0 hover:bg-white/10 sm:w-auto sm:px-3 lg:h-9"
                                        onClick={() => unstack(currentStackId)}
                                        aria-label={t('library.unstack', '스택 해제')}
                                    >
                                        <FolderOpen className="h-4 w-4 shrink-0 sm:mr-2" />
                                        <span className="sr-only sm:not-sr-only">{t('library.unstack', '스택 해제')}</span>
                                    </Button>
                                </Tip>
                            )}
                            <Tip content={t('library.gridColumnsDesc', '그리드 열 개수 변경')}>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-11 shrink-0 px-2 text-muted-foreground hover:bg-white/10 hover:text-foreground lg:h-9"
                                    onClick={handleToggleGrid}
                                    aria-label={t('library.gridColumnsDesc', '그리드 열 개수 변경')}
                                >
                                    <Grid3x3 className="h-4 w-4 mr-1.5" />
                                    <span className="text-sm font-medium min-[360px]:hidden">1</span>
                                    <span className="hidden text-sm font-medium min-[360px]:inline lg:hidden">{Math.min(gridColumns, 2)}</span>
                                    <span className="hidden text-sm font-medium lg:inline">{gridColumns}</span>
                                </Button>
                            </Tip>
                            <span className="hidden max-w-24 truncate whitespace-nowrap text-sm text-muted-foreground min-[380px]:inline">
                                {viewItems.length} {t('library.items', 'items')}
                            </span>
                        </div>
                    </div>
                )}
            </div>

            {/* Content */}
            <div className="custom-scrollbar min-h-0 w-full flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6">
                <DndContext
                    sensors={sensors}
                    collisionDetection={pointerWithin}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    measuring={{
                        droppable: {
                            strategy: MeasuringStrategy.Always,
                        },
                    }}
                >
                    <SortableContext
                        items={viewItems.map(i => i.id)}
                        strategy={rectSortingStrategy}
                    >
                        <div
                            className={cn(
                                "grid min-w-0 grid-cols-1 gap-3 pb-10 min-[360px]:grid-cols-2 sm:gap-4 lg:gap-6",
                                gridColumns === 2 && "lg:grid-cols-2",
                                gridColumns === 3 && "lg:grid-cols-3",
                                gridColumns === 4 && "lg:grid-cols-4",
                                gridColumns === 5 && "lg:grid-cols-5"
                            )}
                        >
                            {viewItems.map((item) => (
                                <SortableLibraryItem
                                    key={item.id}
                                    item={item}
                                    onRename={handleRenameClick}
                                    onAddRef={handleAddRefClick}
                                    onLoadMetadata={handleLoadMetadata}
                                    onImageClick={(imgUrl) => {
                                        if (isEditMode && !item.isStack) {
                                            // Edit mode: toggle selection (stacks cannot be selected)
                                            toggleItemSelection(item.id, false)
                                        } else if (item.isStack) {
                                            // Stack: navigate into it
                                            setCurrentStackId(item.id)
                                        } else {
                                            // Normal: show fullscreen
                                            setViewerImageSrc(imgUrl)
                                        }
                                    }}
                                    isEditMode={isEditMode}
                                    isSelected={selectedItemIds.includes(item.id)}
                                    onSelectionClick={(e: React.MouseEvent) => {
                                        if (item.isStack) return // Stacks cannot be selected
                                        if (e.shiftKey && lastSelectedItemId) {
                                            selectItemRange(lastSelectedItemId, item.id)
                                        } else if (e.ctrlKey || e.metaKey) {
                                            toggleItemSelection(item.id, false)
                                        } else {
                                            toggleItemSelection(item.id, true)
                                        }
                                    }}
                                    disabled={isEditMode}
                                />
                            ))}
                        </div>
                    </SortableContext>

                    <DragOverlay dropAnimation={dropAnimation} modifiers={[snapCenterToCursor]}>
                        {activeItem ? (
                            <LibraryItemComponent item={activeItem} isOverlay />
                        ) : null}
                    </DragOverlay>
                </DndContext>

                {viewItems.length === 0 && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none opacity-40">
                        <div className="w-24 h-24 rounded-full bg-muted/30 flex items-center justify-center mb-6 animate-pulse">
                            <ImagePlus className="h-10 w-10 text-muted-foreground" />
                        </div>
                        <h3 className="text-xl font-semibold mb-2 text-foreground/80">
                            {t('library.emptyTitle', '라이브러리가 비어있습니다')}
                        </h3>
                        <p className="max-w-sm px-4 text-center text-sm leading-relaxed text-muted-foreground [text-wrap:balance]">
                            {t('library.emptyDesc', '이미지를 불러오거나 생성해 나만의 컬렉션을 만들어보세요.')}
                        </p>
                    </div>
                )}
            </div>

            {/* File Drop Overlay - Modern Style from MainMode */}
            {isDraggingFile && (
                <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center transition-all duration-300 pointer-events-none">
                    <div className="relative">
                        {/* Animated ring */}
                        <div className="absolute inset-0 rounded-3xl bg-gradient-to-r from-primary via-purple-500 to-primary animate-pulse opacity-50 blur-xl" />

                        {/* Main card */}
                        <div className="relative bg-background/80 backdrop-blur-xl border border-white/20 rounded-3xl p-12 shadow-2xl transform transition-transform scale-100">
                            <div className="text-center space-y-4">
                                {/* Animated icon container */}
                                <div className="relative mx-auto w-20 h-20">
                                    <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
                                    <div className="relative w-full h-full rounded-full bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center shadow-inner">
                                        <ImagePlus className="h-10 w-10 text-white" />
                                    </div>
                                </div>

                                <div>
                                    <p className="text-xl font-bold text-foreground">
                                        {t('library.drop', '여기에 놓아서 추가')}
                                    </p>
                                    <p className="text-sm text-muted-foreground mt-2">
                                        {t('library.dropHint', '이미지를 드래그하여 추가하세요')}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Dialogs */}
            <LibraryRenameDialog
                open={renameDialogOpen}
                onOpenChange={setRenameDialogOpen}
                initialName={selectedItemForRename?.name || ''}
                onConfirm={handleRenameConfirm}
            />

            <ImageReferenceDialog
                open={imageRefDialogOpen}
                onOpenChange={setImageRefDialogOpen}
                imageBase64={selectedImageRef}
            />

            <MetadataDialog
                open={metadataDialogOpen}
                onOpenChange={(open) => {
                    setMetadataDialogOpen(open)
                    if (!open) setSelectedImageForMetadata(undefined)
                }}
                initialImage={selectedImageForMetadata}
            />

            <ConfirmDialog
                open={confirmDeleteSelectedOpen}
                onOpenChange={setConfirmDeleteSelectedOpen}
                title={t('trash.confirmMoveTitle', '휴지통으로 이동할까요?')}
                description={t('trash.confirmMoveDescription', '항목은 30일 동안 휴지통에 보관됩니다.')}
                confirmText={t('trash.move', '휴지통으로 이동')}
                cancelText={t('common.cancel', '취소')}
                variant="destructive"
                onConfirm={handleTrashSelectedItems}
            />

            {/* Full-Screen Image Viewer Overlay */}
            {viewerImageSrc && (
                <div
                    className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center cursor-pointer"
                    onClick={() => setViewerImageSrc(null)}
                >
                    <img
                        src={viewerImageSrc}
                        alt="Full view"
                        className="max-w-[90vw] max-h-[90vh] object-contain"
                        onClick={(e) => e.stopPropagation()}
                    />
                    <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-4 right-4 text-white bg-black/50 hover:bg-black/70 rounded-lg h-10 w-10"
                        onClick={() => setViewerImageSrc(null)}
                        aria-label={t('common.close', '닫기')}
                    >
                        <X className="h-6 w-6" />
                    </Button>
                </div>
            )}
        </div>
    )
}
