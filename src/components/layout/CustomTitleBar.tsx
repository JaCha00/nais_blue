import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { PanelLeft, PanelRight, Minus, Square, X, Maximize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { flushAllPendingWrites } from '@/lib/indexed-db'
import { useLayoutStore } from '@/stores/layout-store'
import { Tip } from '@/components/ui/tooltip'

const TITLEBAR_INTERACTIVE_SELECTOR = [
    'button',
    'a',
    'input',
    'textarea',
    'select',
    '[role="button"]',
    '[data-titlebar-no-drag="true"]',
].join(',')

function isInteractiveTitlebarTarget(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest(TITLEBAR_INTERACTIVE_SELECTOR))
}

export function CustomTitleBar() {
    const { t } = useTranslation()
    const [isMaximized, setIsMaximized] = useState(false)
    // Browser dev smoke tests run outside Tauri; native window APIs exist only in the Tauri webview.
    const appWindow = isTauri() ? getCurrentWindow() : null

    const {
        leftSidebarVisible,
        rightSidebarVisible,
        toggleLeftSidebar,
        toggleRightSidebar
    } = useLayoutStore()

    useEffect(() => {
        if (!appWindow) return
        let resizeTimer: ReturnType<typeof setTimeout> | null = null

        appWindow.isMaximized().then(setIsMaximized)

        const unlisten = appWindow.onResized(() => {
            if (resizeTimer) {
                clearTimeout(resizeTimer)
            }

            resizeTimer = setTimeout(() => {
                void appWindow.isMaximized().then(setIsMaximized)
                resizeTimer = null
            }, 150)
        })

        return () => {
            if (resizeTimer) {
                clearTimeout(resizeTimer)
            }
            unlisten.then(fn => fn())
        }
    }, [appWindow])

    if (!appWindow) return null

    const handleMinimize = async () => {
        await appWindow.minimize()
    }

    const handleMaximize = async () => {
        await appWindow.toggleMaximize()
    }

    const handleClose = async () => {
        // IndexedDB owns debounced Zustand persistence. Flush first, then ask
        // Rust to exit the app directly so close-request interception cannot
        // recursively swallow the custom titlebar close action.
        try {
            await flushAllPendingWrites()
        } catch (error) {
            console.warn('[Window] Close flush failed; exiting anyway:', error)
        }
        await invoke('exit_app')
    }

    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0 || e.detail !== 1 || isInteractiveTitlebarTarget(e.target)) return

        e.preventDefault()
        void appWindow.startDragging().catch(error => {
            console.warn('[Window] Failed to start titlebar drag:', error)
        })
    }

    const handleDoubleClick = (e: React.MouseEvent) => {
        if (isInteractiveTitlebarTarget(e.target)) return

        e.preventDefault()
        void appWindow.toggleMaximize()
    }

    return (
        <div
            className="relative z-50 flex h-8 shrink-0 select-none items-center justify-between bg-background"
            onMouseDown={handleMouseDown}
            onDoubleClick={handleDoubleClick}
        >
            {/* Drag Region */}
            <div
                className="flex h-full min-w-0 flex-1 cursor-default items-center px-3 text-xs font-medium text-muted-foreground/70"
                data-tauri-drag-region
            >
                <span className="truncate" data-tauri-drag-region>
                    NAIS2
                </span>
            </div>

            {/* Controls */}
            <div className="flex h-full" data-titlebar-no-drag="true">
                {/* Left Sidebar Toggle */}
                <Tip content={t('layout.toggleLeftSidebar', 'Toggle Left Sidebar')} side="bottom">
                    <button
                        onClick={toggleLeftSidebar}
                        className={cn(
                            "h-full w-10 flex items-center justify-center",
                            "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                            "transition-colors",
                            !leftSidebarVisible && "text-muted-foreground/50"
                        )}
                        data-titlebar-no-drag="true"
                        aria-label="Toggle Left Sidebar"
                    >
                        <PanelLeft className="h-4 w-4" />
                    </button>
                </Tip>

                {/* Right Sidebar Toggle */}
                <Tip content={t('layout.toggleRightSidebar', 'Toggle Right Sidebar')} side="bottom">
                    <button
                        onClick={toggleRightSidebar}
                        className={cn(
                            "h-full w-10 flex items-center justify-center",
                            "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                            "transition-colors",
                            !rightSidebarVisible && "text-muted-foreground/50"
                        )}
                        data-titlebar-no-drag="true"
                        aria-label="Toggle Right Sidebar"
                    >
                        <PanelRight className="h-4 w-4" />
                    </button>
                </Tip>

                {/* Separator */}
                <div className="w-px h-4 my-auto bg-border/50 mx-1" />

                {/* Minimize */}
                <button
                    onClick={handleMinimize}
                    className={cn(
                        "h-full w-[46px] flex items-center justify-center",
                        "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                        "transition-colors"
                    )}
                    data-titlebar-no-drag="true"
                    aria-label="Minimize"
                >
                    <Minus className="h-4 w-4" />
                </button>

                {/* Maximize/Restore */}
                <button
                    onClick={handleMaximize}
                    className={cn(
                        "h-full w-[46px] flex items-center justify-center",
                        "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                        "transition-colors"
                    )}
                    data-titlebar-no-drag="true"
                    aria-label={isMaximized ? "Restore" : "Maximize"}
                >
                    {isMaximized ? <Maximize2 className="h-4 w-4" /> : <Square className="h-3.5 w-3.5" />}
                </button>

                {/* Close */}
                <button
                    onClick={handleClose}
                    className={cn(
                        "h-full w-[46px] flex items-center justify-center",
                        "text-muted-foreground hover:text-white hover:bg-red-500",
                        "transition-colors"
                    )}
                    data-titlebar-no-drag="true"
                    aria-label="Close"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>
        </div>
    )
}
