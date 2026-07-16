import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface CompositionWorkspaceLayoutProps {
    commandBar: ReactNode
    moduleStack: ReactNode
    workspace: ReactNode
    inspector: ReactNode
    mobileDock?: ReactNode
    className?: string
    workspaceClassName?: string
    workspaceLabel?: string
    desktopRails?: boolean
}

/** 2xl rails and compact canvas-first shell; sheets are mounted by the owning page. */
export function CompositionWorkspaceLayout({
    commandBar,
    moduleStack,
    workspace,
    inspector,
    mobileDock,
    className,
    workspaceClassName,
    workspaceLabel = 'Composition workspace',
    desktopRails = true,
}: CompositionWorkspaceLayoutProps) {
    return (
        <div
            className={cn('flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden', className)}
            data-testid="composition-workspace-layout"
        >
            {commandBar !== null && commandBar !== undefined && (
                <div className="hidden shrink-0 p-2 sm:p-3 md:block">{commandBar}</div>
            )}
            <div className={cn(
                'grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-3 px-2 sm:px-3',
                desktopRails && '2xl:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)_minmax(18rem,24rem)]',
                mobileDock ? 'pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-3' : 'pb-3',
            )}>
                <div className={cn('hidden min-h-0 min-w-0', desktopRails && '2xl:block')}>{moduleStack}</div>
                <section
                    className={cn('min-h-0 min-w-0 overflow-hidden', workspaceClassName)}
                    aria-label={workspaceLabel}
                    data-testid="composition-workspace-canvas"
                >
                    {workspace}
                </section>
                <div className={cn('hidden min-h-0 min-w-0', desktopRails && '2xl:block')}>{inspector}</div>
            </div>
            {mobileDock && <div className="md:hidden">{mobileDock}</div>}
        </div>
    )
}
