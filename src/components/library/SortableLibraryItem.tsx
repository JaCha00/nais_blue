import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { LibraryItem as LibraryItemType } from '@/stores/library-store'
import { LibraryItem } from './LibraryItem'

interface SortableLibraryItemProps {
    item: LibraryItemType
    onRename: (item: LibraryItemType) => void
    onAddRef: (item: LibraryItemType) => void
    onLoadMetadata: (item: LibraryItemType) => void
    onEditImage: (item: LibraryItemType) => void
    onOpenTools?: () => void
    folderLabel?: string
    onImageClick?: (imageUrl: string) => void
    isEditMode?: boolean
    isSelected?: boolean
    onSelectionClick?: (e: React.MouseEvent) => void
    disabled?: boolean
}

export function SortableLibraryItem({ item, onRename, onAddRef, onLoadMetadata, onEditImage, onOpenTools, folderLabel, onImageClick, isEditMode, isSelected, onSelectionClick, disabled }: SortableLibraryItemProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: item.id, disabled })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.0 : 1,
    }

    return (
        <div ref={setNodeRef} style={style} {...(disabled ? {} : { ...attributes, ...listeners })} id={item.id} className="w-full h-full">
            <LibraryItem 
                item={item} 
                onRename={onRename} 
                onAddRef={onAddRef} 
                onLoadMetadata={onLoadMetadata} 
                onEditImage={onEditImage}
                onOpenTools={onOpenTools}
                folderLabel={folderLabel}
                onImageClick={onImageClick}
                isEditMode={isEditMode}
                isSelected={isSelected}
                onSelectionClick={onSelectionClick}
            />
        </div>
    )
}
