import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LibraryItem as LibraryItemType } from '@/stores/library-store'
import { readFile } from '@tauri-apps/plugin-fs'
import { LibraryContextMenu } from './LibraryContextMenu'
import { cn } from '@/lib/utils'
import { Check, Square, Layers } from 'lucide-react'

interface LibraryItemProps {
    item: LibraryItemType
    className?: string
    isOverlay?: boolean
    onRename?: (item: LibraryItemType) => void
    onAddRef?: (item: LibraryItemType) => void
    onLoadMetadata?: (item: LibraryItemType) => void
    onImageClick?: (imageUrl: string) => void
    isEditMode?: boolean
    isSelected?: boolean
    onSelectionClick?: (e: React.MouseEvent) => void
}

export function LibraryItem({ item, className, isOverlay, onRename, onAddRef, onLoadMetadata, onImageClick, isEditMode, isSelected, onSelectionClick }: LibraryItemProps) {
    const { t } = useTranslation()
    const [imageUrl, setImageUrl] = useState<string>('')
    const [isLoading, setIsLoading] = useState(true)

    useEffect(() => {
        let active = true
        const loadImage = async () => {
            try {
                const data = await readFile(item.path)

                // Convert to base64 safely without stack overflow
                let binary = ''
                const len = data.byteLength
                for (let i = 0; i < len; i++) {
                    binary += String.fromCharCode(data[i])
                }
                const base64 = btoa(binary)

                if (active) {
                    setImageUrl(`data:image/png;base64,${base64}`)
                    setIsLoading(false)
                }
            } catch (e) {
                console.error('Failed to load library image:', e)
                if (active) setIsLoading(false)
            }
        }
        loadImage()
        return () => { active = false }
    }, [item.path])

    const handleClick = (e: React.MouseEvent) => {
        if (isEditMode && onSelectionClick) {
            e.preventDefault()
            e.stopPropagation()
            onSelectionClick(e)
        } else if (imageUrl && onImageClick) {
            onImageClick(imageUrl)
        }
    }

    const content = (
        <div
            className={cn(
                "relative group aspect-[2/3] rounded-xl overflow-hidden bg-muted/30 border border-border/50 shadow-sm transition-all hover:ring-2 hover:ring-primary/50",
                isOverlay && "ring-2 ring-primary shadow-xl cursor-grabbing z-50",
                isEditMode && isSelected && "ring-2 ring-orange-500",
                className
            )}
            onClick={handleClick}
        >
            {isLoading ? (
                <div className="w-full h-full flex items-center justify-center animate-pulse bg-muted">
                    <span className="sr-only">Loading...</span>
                </div>
            ) : (
                <img
                    src={imageUrl}
                    alt={item.name}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    draggable={false} // Prevent native drag
                />
            )}

            {/* Edit Mode Checkbox - not shown for stacks */}
            {isEditMode && !item.isStack && (
                <div className="absolute top-2 left-2 z-30">
                    <div className={cn(
                        "h-6 w-6 rounded-md flex items-center justify-center transition-all",
                        isSelected ? "bg-orange-500 text-white" : "bg-black/50 text-white/70"
                    )}>
                        {isSelected ? <Check className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                    </div>
                </div>
            )}

            {/* Stack Badge */}
            {item.isStack && (
                <div className="absolute top-2 right-2 z-30 px-2 py-1 bg-purple-500 text-white text-xs font-bold rounded-full flex items-center gap-1">
                    <Layers className="h-3 w-3" />
                    {t('library.stackCount', '{{count}}개', { count: item.stackItems?.length || 0 })}
                </div>
            )}

            <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                <p className="text-xs text-white truncate px-1">{item.name}</p>
            </div>
        </div>
    )

    if (isOverlay || isEditMode) return content

    return (
        <LibraryContextMenu
            item={item}
            onRename={onRename ? () => onRename(item) : undefined}
            onAddRef={onAddRef ? () => onAddRef(item) : undefined}
            onLoadMetadata={onLoadMetadata ? () => onLoadMetadata(item) : undefined}
        >
            {content}
        </LibraryContextMenu>
    )
}
