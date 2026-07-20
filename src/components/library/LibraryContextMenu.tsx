import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { LibraryItem, useLibraryStore } from '@/stores/library-store'
import { Copy, FolderOpen, Save, Trash2, Wand2, Users, Pencil, FileSearch } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/components/ui/use-toast'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile, readFile } from '@tauri-apps/plugin-fs'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { useNavigate } from 'react-router-dom'
import { useToolsStore } from '@/stores/tools-store'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useTrashStore } from '@/stores/trash-store'
import { archiveLibraryItems } from '@/services/trash/asset-trash-service'

interface LibraryContextMenuProps {
    item: LibraryItem
    children: React.ReactNode
    onRename?: () => void
    onAddRef?: () => void
    onLoadMetadata?: () => void
}

export function LibraryContextMenu({ item, children, onRename, onAddRef, onLoadMetadata }: LibraryContextMenuProps) {
    const { t } = useTranslation()
    const { items: libraryItems, removeItem } = useLibraryStore()
    const addToTrash = useTrashStore(state => state.add)
    const navigate = useNavigate()
    const { setActiveImage } = useToolsStore()
    const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

    const handleCopy = async () => {
        try {
            const data = await readFile(item.path)
            const blob = new Blob([data], { type: 'image/png' })
            await navigator.clipboard.write([
                new ClipboardItem({ [blob.type]: blob })
            ])
            toast({ title: t('actions.copied', '복사 완료'), variant: 'success' })
        } catch (e) {
            console.error('Copy failed:', e)
            toast({ title: t('actions.copyFailed', '복사 실패'), variant: 'destructive' })
        }
    }

    const handleSaveAs = async () => {
        try {
            const data = await readFile(item.path)
            const filePath = await save({
                defaultPath: item.name,
                filters: [{ name: 'Image', extensions: ['png', 'jpg', 'webp'] }],
            })
            if (filePath) {
                await writeFile(filePath, data)
                toast({ title: t('toast.saved', '저장 완료'), variant: 'success' })
            }
        } catch (e) {
            console.error('Save failed:', e)
            toast({ title: t('toast.saveFailed', '저장 실패'), variant: 'destructive' })
        }
    }

    const handleSmartTools = async () => {
        try {
            const data = await readFile(item.path)
            let binary = ''
            const len = data.byteLength
            for (let i = 0; i < len; i++) {
                binary += String.fromCharCode(data[i])
            }
            const base64 = btoa(binary)

            setActiveImage(`data:image/png;base64,${base64}`)
            navigate('/tools')
        } catch (e) {
            console.error('Failed to load for tools:', e)
            toast({ title: t('smartTools.error', '이미지 로드 실패'), variant: 'destructive' })
        }
    }

    const handleOpenFolder = async () => {
        try {
            await revealItemInDir(item.path)
        } catch (e) {
            console.error('Failed to open folder:', e)
        }
    }

    const handleDelete = async () => {
        try {
            const sourceStackId = libraryItems.find(libraryItem => libraryItem.stackItems?.some(stackItem => stackItem.id === item.id))?.id ?? null
            const trashItem = await archiveLibraryItems([item], sourceStackId)
            addToTrash(trashItem)
            removeItem(item.id)
            toast({ title: t('trash.moved', '휴지통으로 이동했습니다.'), variant: 'success' })
        } catch (e) {
            console.error('Move to trash failed:', e)
            toast({ title: t('common.error', '오류'), variant: 'destructive' })
        }
    }

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                {children}
            </ContextMenuTrigger>
            <ContextMenuContent className="w-64">
                <ContextMenuItem onClick={onRename}>
                    <Pencil className="h-4 w-4 mr-2" />
                    {t('actions.rename', '이름 변경')}
                </ContextMenuItem>
                <ContextMenuItem onClick={handleSaveAs}>
                    <Save className="h-4 w-4 mr-2" />
                    {t('actions.saveAs', '다른 이름으로 저장')}
                </ContextMenuItem>
                <ContextMenuItem onClick={handleCopy}>
                    <Copy className="h-4 w-4 mr-2" />
                    {t('actions.copy', '복사')}
                </ContextMenuItem>
                <ContextMenuItem onClick={handleSmartTools}>
                    <Wand2 className="h-4 w-4 mr-2" />
                    {t('smartTools.title', '스마트 툴')}
                </ContextMenuItem>
                <ContextMenuItem onClick={onAddRef}>
                    <Users className="h-4 w-4 mr-2" />
                    {t('actions.addAsRef', '이미지 참조')}
                </ContextMenuItem>
                <ContextMenuItem onClick={onLoadMetadata}>
                    <FileSearch className="h-4 w-4 mr-2" />
                    {t('metadata.loadFromImage', '메타데이터 불러오기')}
                </ContextMenuItem>
                <ContextMenuItem onClick={handleOpenFolder}>
                    <FolderOpen className="h-4 w-4 mr-2" />
                    {t('actions.openFolder', '폴더 열기')}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => setConfirmDeleteOpen(true)} className="text-red-500 focus:text-red-500">
                    <Trash2 className="h-4 w-4 mr-2" />
                    {t('actions.delete', '삭제')}
                </ContextMenuItem>
            </ContextMenuContent>
            <ConfirmDialog
                open={confirmDeleteOpen}
                onOpenChange={setConfirmDeleteOpen}
                title={t('trash.confirmMoveTitle', '휴지통으로 이동할까요?')}
                description={t('trash.confirmMoveDescription', '항목은 30일 동안 휴지통에 보관됩니다.')}
                confirmText={t('trash.move', '휴지통으로 이동')}
                cancelText={t('common.cancel', '취소')}
                variant="destructive"
                onConfirm={handleDelete}
            />
        </ContextMenu>
    )
}
