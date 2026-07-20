import { ReactNode, useEffect, useState } from 'react'
import { onBackButtonPress } from '@tauri-apps/api/app'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { PromptPanel } from './PromptPanel'
import { HistoryPanel } from './HistoryPanel'
import { AnimatedNavBar } from './AnimatedNavBar'
import { CustomTitleBar } from './CustomTitleBar'
import { PresetDropdown } from '@/components/preset/PresetDropdown'
import { PresetDraftControls } from '@/components/preset/PresetDraftControls'
import { DiagnosticDrawer } from '@/components/diagnostics/DiagnosticDrawer'
import { ProductGuidance } from '@/components/guidance/ProductGuidance'
import { useAuthStore } from '@/stores/auth-store'
import { SHORTCUT_EVENTS } from '@/hooks/useShortcuts'
import { Tip } from '@/components/ui/tooltip'
import { toast } from '@/components/ui/use-toast'
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet'
import {
    Home,
    Film,
    Globe,
    Images,
    Settings,
    Wand2,
    FlaskConical,
    Zap,
    PanelLeft,
    PanelRight,
    ListTodo,
    CloudUpload,
    Trash2,
} from 'lucide-react'

interface ThreeColumnLayoutProps {
    children: ReactNode
}

import { calculateExtraCost } from '@/lib/anlas-calculator'
import { useCharacterStore } from '@/stores/character-store'
import { usePresetStore } from '@/stores/preset-store'
import { useLayoutStore } from '@/stores/layout-store'
import { useGenerationStore } from '@/stores/generation-store'
import { useSceneStore } from '@/stores/scene-store'
import { isAndroidRuntime, isMobileRuntime } from '@/platform/runtime'

// Check if running on Mac (works in browser and Tauri WebView)
const isMac = navigator.platform.toUpperCase().includes('MAC') ||
    navigator.userAgent.toUpperCase().includes('MAC')

function useMediaQuery(query: string) {
    const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

    useEffect(() => {
        const mediaQuery = window.matchMedia(query)
        const syncMatches = () => setMatches(mediaQuery.matches)

        syncMatches()
        mediaQuery.addEventListener('change', syncMatches)
        return () => mediaQuery.removeEventListener('change', syncMatches)
    }, [query])

    return matches
}

export function ThreeColumnLayout({ children }: ThreeColumnLayoutProps) {
    const { t } = useTranslation()
    const location = useLocation()
    const { anlas, isVerified, anlas2, isVerified2, slot2Enabled, refreshAnlas, setSlotEnabled, getActiveTokens, requestTokenEntry } = useAuthStore()
    const {
        leftSidebarVisible,
        rightSidebarVisible,
        supportSheet,
        toggleLeftSidebar,
        toggleRightSidebar,
        openSupportSheet,
        closeSupportSheet,
    } = useLayoutStore()
    const leftSheetOpen = supportSheet === 'prompt'
    const rightSheetOpen = supportSheet === 'history'
    const isDesktopShell = useMediaQuery('(min-width: 1536px)')
    const compositionWorkspaceOwnsRails = location.pathname === '/'
        || location.pathname === '/scenes'
        || location.pathname.startsWith('/scenes/')
    const promptPanelIsDocked = isDesktopShell
    const historyPanelIsDocked = isDesktopShell && !compositionWorkspaceOwnsRails
    const mainIsGenerating = useGenerationStore(state => state.isGenerating)
    const sceneIsGenerating = useSceneStore(state => state.isGenerating)

    // Get generation params for cost calculation
    const { characterImages, vibeImages } = useCharacterStore()

    // Get active preset for header display
    const { presets, activePresetId } = usePresetStore()
    const activePreset = presets.find(p => p.id === activePresetId)

    const handleSlotEnabled = async (slot: 1 | 2, enabled: boolean) => {
        try {
            await setSlotEnabled(slot, enabled)
        } catch {
            toast({
                title: t('credentialVault.errors.operation-failed'),
                variant: 'destructive',
            })
        }
    }

    // Preset dialog state (for shortcut support)
    const [presetDialogOpen, setPresetDialogOpen] = useState(false)

    // 프리셋 다이얼로그 단축키 이벤트 수신
    useEffect(() => {
        const handleOpenPreset = () => setPresetDialogOpen(prev => !prev)

        window.addEventListener(SHORTCUT_EVENTS.OPEN_PRESET_DIALOG, handleOpenPreset)
        return () => {
            window.removeEventListener(SHORTCUT_EVENTS.OPEN_PRESET_DIALOG, handleOpenPreset)
        }
    }, [])

    useEffect(() => {
        if (!isDesktopShell && leftSheetOpen && (mainIsGenerating || sceneIsGenerating)) {
            closeSupportSheet()
        }
    }, [closeSupportSheet, isDesktopShell, leftSheetOpen, mainIsGenerating, sceneIsGenerating])

    useEffect(() => {
        if (!isAndroidRuntime || (!leftSheetOpen && !rightSheetOpen)) return

        let disposed = false
        let unregister: (() => Promise<void>) | undefined

        // Tauri's Android app plugin owns the native Back dispatcher; registering only while a
        // support sheet is open lets Back close that sheet, then restores normal Activity behavior.
        void onBackButtonPress(() => {
            closeSupportSheet()
        }).then((listener) => {
            if (disposed) void listener.unregister()
            else unregister = () => listener.unregister()
        })

        return () => {
            disposed = true
            if (unregister) void unregister()
        }
    }, [closeSupportSheet, leftSheetOpen, rightSheetOpen])

    // Calculate cached vs uncached vibes (only enabled ones)
    const enabledVibes = vibeImages.filter(v => v.enabled !== false)
    const uncachedVibeCount = enabledVibes.filter(v => !v.encodedVibe).length
    const cachedVibeCount = enabledVibes.length - uncachedVibeCount

    // Count only enabled character images
    const enabledCharCount = characterImages.filter(c => c.enabled !== false).length

    // Only calculate extra costs for enabled uncached vibes and enabled characters
    const cost = calculateExtraCost(
        enabledCharCount,
        uncachedVibeCount
    )
    const activeTokens = getActiveTokens()
    const activeTokenBalances = activeTokens
        .map((entry) => ({
            ...entry,
            anlas: entry.slot === 2 ? anlas2 : anlas,
        }))
        .filter((entry) => Boolean(entry.anlas))

    // Refresh verified slots independently; slot 1 preserves B's original
    // balance behavior while slot 2 is opt-in for the dual-worker phase.
    useEffect(() => {
        if (isVerified) refreshAnlas(1)
        if (isVerified2) refreshAnlas(2)
    }, [isVerified, isVerified2, refreshAnlas])

    const navItems = [
        { path: '/', icon: Home, labelKey: 'nav.main' },
        { path: '/scenes', icon: Film, labelKey: 'nav.scenes' },
        { path: '/tools', icon: Wand2, labelKey: 'smartTools.title' },
        { path: '/style-lab', icon: FlaskConical, labelKey: 'nav.styleLab' },
        { path: '/queue', icon: ListTodo, labelKey: 'nav.queue', fallbackLabel: 'Queue Center' },
        { path: '/r2', icon: CloudUpload, labelKey: 'nav.r2Upload', fallbackLabel: 'R2 Upload' },
        { path: '/trash', icon: Trash2, labelKey: 'nav.trash', fallbackLabel: '휴지통' },
        { path: '/web', icon: Globe, labelKey: 'nav.web' },
        { path: '/library', icon: Images, labelKey: 'nav.library' },
        { path: '/settings', icon: Settings, labelKey: 'nav.settings' },
    ]

    // Format Anlas number
    const formatAnlas = (value: number) => {
        return value.toLocaleString()
    }

    const handleLeftPanelToggle = () => {
        if (promptPanelIsDocked) {
            toggleLeftSidebar()
        } else {
            openSupportSheet('prompt')
        }
    }

    const handleRightPanelToggle = () => {
        if (historyPanelIsDocked) {
            toggleRightSidebar()
        } else {
            openSupportSheet('history')
        }
    }

    const promptPanelContent = (
        <>
            <div className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-5">
                <div className="flex min-w-0 items-center gap-2">
                    <h2 className="min-w-0 max-w-40 truncate text-base font-semibold">
                        {activePreset?.name || t('preset.default', '기본')}
                    </h2>
                    <PresetDropdown open={presetDialogOpen} onOpenChange={setPresetDialogOpen} />
                    <PresetDraftControls />
                </div>

                {activeTokenBalances.length > 0 ? (
                    <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                        {activeTokenBalances.map((entry) => {
                            const isSlot2 = entry.slot === 2
                            return (
                                <Tip
                                    key={entry.slot}
                                    content={isSlot2
                                        ? t('settingsPage.api.clickToPause2')
                                        : t('settingsPage.api.clickToPause1')}
                                >
                                    <button
                                        type="button"
                                        onClick={() => void handleSlotEnabled(entry.slot, false)}
                                        className={cn(
                                            'flex min-h-11 min-w-0 items-center gap-2 rounded-control px-2 py-2 transition-colors duration-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card sm:px-3',
                                            isSlot2
                                                ? 'bg-primary/10 text-primary hover:bg-primary/20'
                                                : 'bg-warning/10 text-warning hover:bg-warning/20'
                                        )}
                                    >
                                        <span className="h-2 w-2 shrink-0 rounded-full bg-current" aria-hidden="true" />
                                        <span className="sr-only">{t('settingsPage.api.token')} {entry.slot}</span>
                                        <span className="min-w-0 truncate text-xs font-semibold sm:text-sm">
                                            {formatAnlas(entry.anlas!.total)}
                                        </span>
                                    </button>
                                </Tip>
                            )
                        })}
                        {isVerified2 && anlas2 && !slot2Enabled && (
                            <Tip content={t('settingsPage.api.clickToResume2')}>
                                <button
                                    type="button"
                                    onClick={() => void handleSlotEnabled(2, true)}
                                    className="flex min-h-11 min-w-0 items-center gap-2 rounded-control bg-muted px-2 py-2 text-muted-foreground transition-colors duration-standard hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card sm:px-3"
                                >
                                    <span className="h-2 w-2 shrink-0 rounded-full bg-current opacity-50" aria-hidden="true" />
                                    <span className="sr-only">{t('settingsPage.api.token')} 2</span>
                                    <span className="min-w-0 truncate text-xs font-semibold line-through sm:text-sm">
                                        {formatAnlas(anlas2.total)}
                                    </span>
                                </button>
                            </Tip>
                        )}
                        {(cost > 0 || cachedVibeCount > 0) && (
                            <div className={cn(
                                "flex items-center gap-1 rounded-control px-2 py-1 text-xs font-semibold animate-in fade-in slide-in-from-left-2 motion-reduce:animate-none",
                                cost > 0
                                    ? "bg-destructive/10 text-destructive"
                                    : "bg-primary/10 text-primary"
                            )}>
                                {cost > 0 && <span>-{cost}</span>}
                                {cachedVibeCount > 0 && (
                                    <Zap className="h-3 w-3" fill="currentColor" aria-hidden="true" />
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={requestTokenEntry}
                        className="flex min-h-11 min-w-0 items-center gap-2 rounded-control bg-muted px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        <span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden="true" />
                        <span className="min-w-0 truncate text-sm text-muted-foreground">
                            {t('settingsPage.api.token')}
                        </span>
                    </button>
                )}
            </div>

            <PromptPanel />
        </>
    )

    return (
        <div
            className={cn(
                "flex h-screen flex-col overflow-hidden bg-background",
                isAndroidRuntime && "android-landscape-safe-inline",
            )}
            style={isMobileRuntime ? {
                // Some Android WebViews report zero CSS safe-area insets despite edge-to-edge system bars.
                // Runtime fallbacks keep the shell clear of status/navigation controls while iOS keeps native insets.
                paddingTop: isAndroidRuntime
                    ? 'max(1.5rem, env(safe-area-inset-top))'
                    : 'env(safe-area-inset-top)',
                paddingBottom: isAndroidRuntime
                    ? 'max(3.5rem, env(safe-area-inset-bottom))'
                    : 'env(safe-area-inset-bottom)',
            } : undefined}
        >
            {/* Custom Title Bar - Only show on Windows (Mac uses native decorations) */}
            {!isMac && !isMobileRuntime && <CustomTitleBar />}

            {/* Three opaque surface tones carry the workspace hierarchy; only form controls draw edges. */}
            <div className="flex min-w-0 flex-1 gap-3 overflow-hidden p-3">
                <aside
                    id="nais2-prompt-dock"
                    className={cn(
                        "hidden min-h-0 w-[420px] flex-shrink-0 flex-col overflow-hidden rounded-panel bg-card 2xl:flex min-[1800px]:w-[500px]",
                        !leftSidebarVisible && "2xl:hidden"
                    )}
                >
                    {promptPanelContent}
                </aside>

                <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-panel bg-canvas">
                    {/* The compact row keeps navigation primary; utility dialogs wrap below it on phones so every control stays in normal flow. */}
                    <div className="z-10 flex shrink-0 flex-wrap items-center gap-2 bg-card px-3 py-2 sm:flex-nowrap">
                        <Tip content={t('layout.toggleLeftSidebar', 'Toggle Left Sidebar')}>
                            <button
                                type="button"
                                onClick={handleLeftPanelToggle}
                                className={cn(
                                    "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control transition-colors duration-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
                                    "text-muted-foreground hover:bg-accent hover:text-foreground",
                                    promptPanelIsDocked && !leftSidebarVisible && "opacity-50"
                                )}
                                aria-label={t('layout.toggleLeftSidebar', 'Toggle Left Sidebar')}
                                aria-expanded={promptPanelIsDocked ? leftSidebarVisible : leftSheetOpen}
                                aria-controls={promptPanelIsDocked ? 'nais2-prompt-dock' : 'nais2-prompt-sheet'}
                            >
                                <PanelLeft className="h-4 w-4" aria-hidden="true" />
                            </button>
                        </Tip>
                        <div className="flex min-w-0 flex-1 items-center">
                            <AnimatedNavBar items={navItems} />
                        </div>
                        <Tip content={t('layout.toggleRightSidebar', 'Toggle Right Sidebar')}>
                            <button
                                type="button"
                                onClick={handleRightPanelToggle}
                                className={cn(
                                    "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control transition-colors duration-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
                                    "text-muted-foreground hover:bg-accent hover:text-foreground",
                                    historyPanelIsDocked && !rightSidebarVisible && "opacity-50"
                                )}
                                aria-label={t('layout.toggleRightSidebar', 'Toggle Right Sidebar')}
                                aria-expanded={historyPanelIsDocked ? rightSidebarVisible : rightSheetOpen}
                                aria-controls={historyPanelIsDocked ? 'nais2-history-dock' : 'nais2-history-sheet'}
                            >
                                <PanelRight className="h-4 w-4" aria-hidden="true" />
                            </button>
                        </Tip>
                        <div className="ml-auto flex basis-full shrink-0 items-center justify-end gap-2 sm:basis-auto">
                            <ProductGuidance />
                            <DiagnosticDrawer />
                        </div>
                    </div>

                    {/* Page Content */}
                    <main className={cn(
                        "relative min-h-0 min-w-0 flex-1",
                        (location.pathname === '/' || location.pathname === '/library') ? "p-0 overflow-hidden" : "overflow-y-auto p-2 sm:p-4"
                    )}>
                        {children}
                    </main>
                </div>

                <aside
                    id="nais2-history-dock"
                    className={cn(
                        "hidden min-h-0 w-[280px] flex-shrink-0 overflow-hidden rounded-panel bg-card 2xl:block",
                        (!rightSidebarVisible || compositionWorkspaceOwnsRails) && "2xl:hidden"
                    )}
                >
                    {/* Only the visible History surface mounts its disk scan and
                        queue-summary poller; the responsive Sheet owns the other case. */}
                    {historyPanelIsDocked && rightSidebarVisible && <HistoryPanel />}
                </aside>
            </div>

            <Sheet
                modal={false}
                open={leftSheetOpen}
                onOpenChange={(open) => open ? openSupportSheet('prompt') : closeSupportSheet()}
            >
                <SheetContent
                    id="nais2-prompt-sheet"
                    side="left"
                    showOverlay={false}
                    className="flex !w-full !max-w-none flex-col gap-0 border-r border-border sm:!w-[420px] sm:!max-w-[min(70vw,720px)] sm:!min-w-[360px] sm:resize-x sm:overflow-auto"
                    style={isMobileRuntime ? {
                        paddingTop: 'max(1rem, env(safe-area-inset-top))',
                        paddingRight: 'max(1rem, env(safe-area-inset-right))',
                        paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
                        paddingLeft: 'max(1rem, env(safe-area-inset-left))',
                    } : undefined}
                >
                    <SheetHeader className="sr-only">
                        <SheetTitle>{t('prompt.title', '프롬프트')}</SheetTitle>
                    </SheetHeader>
                    {/* PromptPanel owns its header, so this reserve keeps that header clear of Sheet's close target. */}
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden [&>div:first-child]:pr-16">
                        {promptPanelContent}
                    </div>
                </SheetContent>
            </Sheet>

            <Sheet
                open={rightSheetOpen}
                onOpenChange={(open) => open ? openSupportSheet('history') : closeSupportSheet()}
            >
                <SheetContent
                    id="nais2-history-sheet"
                    side="right"
                    className="flex !w-full !max-w-none flex-col gap-0 sm:!w-[400px] sm:!max-w-[400px]"
                    style={isMobileRuntime ? {
                        paddingTop: 'max(1rem, env(safe-area-inset-top))',
                        paddingRight: 'max(1rem, env(safe-area-inset-right))',
                        paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
                        paddingLeft: 'max(1rem, env(safe-area-inset-left))',
                    } : undefined}
                >
                    <SheetHeader className="sr-only">
                        <SheetTitle>{t('history.title', '기록')}</SheetTitle>
                    </SheetHeader>
                    <div className="min-h-0 flex-1 overflow-hidden [&>div>div:first-child]:pr-16">
                        {rightSheetOpen && <HistoryPanel />}
                    </div>
                </SheetContent>
            </Sheet>
        </div>
    )
}
