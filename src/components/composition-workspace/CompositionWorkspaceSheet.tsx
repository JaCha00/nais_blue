import type { ReactNode, RefObject } from 'react'
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

export interface CompositionWorkspaceSheetProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    description?: string
    side?: 'left' | 'right' | 'bottom'
    level?: 'primary' | 'secondary'
    className?: string
    contentClassName?: string
    testId?: string
    closeLabel?: string
    returnFocusRef?: RefObject<HTMLElement>
    children: ReactNode
}

/**
 * Composition sheet contract. Radix supplies the focus trap; the optional
 * return ref handles controlled launches that do not use a Radix trigger.
 */
export function CompositionWorkspaceSheet({
    open,
    onOpenChange,
    title,
    description,
    side = 'right',
    level = 'primary',
    className,
    contentClassName,
    testId = 'composition-workspace-sheet',
    closeLabel,
    returnFocusRef,
    children,
}: CompositionWorkspaceSheetProps) {
    return (
        <Sheet open={open} onOpenChange={onOpenChange} modal>
            <SheetContent
                side={side}
                className={cn(
                    'flex max-h-dvh min-w-0 flex-col overflow-hidden',
                    'pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(1rem,env(safe-area-inset-top))]',
                    side === 'bottom'
                        ? 'max-h-[min(88dvh,52rem)] rounded-t-panel'
                        : 'sm:max-w-[26rem]',
                    level === 'secondary' && 'z-[60] sm:max-w-[30rem]',
                    className,
                )}
                data-testid={testId}
                closeLabel={closeLabel}
                onCloseAutoFocus={event => {
                    if (!returnFocusRef?.current) return
                    event.preventDefault()
                    returnFocusRef.current.focus()
                }}
            >
                <SheetHeader className="shrink-0 border-b border-border pb-3">
                    <SheetTitle className="break-words">{title}</SheetTitle>
                    {description && <SheetDescription className="break-words">{description}</SheetDescription>}
                </SheetHeader>
                <div className={cn('min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pt-3', contentClassName)}>
                    {children}
                </div>
            </SheetContent>
        </Sheet>
    )
}
