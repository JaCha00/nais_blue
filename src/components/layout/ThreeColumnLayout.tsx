import { ReactNode, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { PromptPanel } from './PromptPanel'
import { HistoryPanel } from './HistoryPanel'
import { AnimatedNavBar } from './AnimatedNavBar'
import { CustomTitleBar } from './CustomTitleBar'
import { LAYOUT_SHEET_EVENTS } from './layout-events'
import { PresetDropdown } from '@/components/preset/PresetDropdown'
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
    Coins,
    Wand2,
    NotebookPen,
    FlaskConical,
    Zap,
    PanelLeft,
    PanelRight,
    Package,
    ListTodo,
    FolderKanban,
} from 'lucide-react'

interface ThreeColumnLayoutProps {
    children: ReactNode
}

import { calculateExtraCost } from '@/lib/anlas-calculator'
import { useCharacterStore } from '@/stores/character-store'
import { usePresetStore } from '@/stores/preset-store'
import { useLayoutStore } from '@/stores/layout-store'
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
    const { anlas, isVerified, anlas2, isVerified2, slot2Enabled, refreshAnlas, setSlotEnabled, getActiveTokens } = useAuthStore()
    const { leftSidebarVisible, rightSidebarVisible, toggleLeftSidebar, toggleRightSidebar } = useLayoutStore()
    const [leftSheetOpen, setLeftSheetOpen] = useState(false)
    const [rightSheetOpen, setRightSheetOpen] = useState(false)
    const isDesktopShell = useMediaQuery('(min-width: 1536px)')
    const compositionWorkspaceOwnsRails = location.pathname === '/'
        || location.pathname === '/scenes'
        || location.pathname.startsWith('/scenes/')
    const supportPanelsAreDocked = isDesktopShell && !compositionWorkspaceOwnsRails

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
        const openPromptSheet = () => setLeftSheetOpen(true)
        const openHistorySheet = () => setRightSheetOpen(true)

        window.addEventListener(LAYOUT_SHEET_EVENTS.OPEN_PROMPT, openPromptSheet)
        window.addEventListener(LAYOUT_SHEET_EVENTS.OPEN_HISTORY, openHistorySheet)
        return () => {
            window.removeEventListener(LAYOUT_SHEET_EVENTS.OPEN_PROMPT, openPromptSheet)
            window.removeEventListener(LAYOUT_SHEET_EVENTS.OPEN_HISTORY, openHistorySheet)
        }
    }, [])

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
        { path: '/prompts', icon: NotebookPen, labelKey: 'nav.promptEditor' },
        { path: '/asset-modules', icon: Package, labelKey: 'nav.assetModuleStudio', fallbackLabel: 'Asset Studio' },
        { path: '/style-lab', icon: FlaskConical, labelKey: 'nav.styleLab' },
        { path: '/queue', icon: ListTodo, labelKey: 'nav.queue', fallbackLabel: 'Queue Center' },
        { path: '/organizer', icon: FolderKanban, labelKey: 'nav.organizer', fallbackLabel: 'Organizer' },
        { path: '/web', icon: Globe, labelKey: 'nav.web' },
        { path: '/library', icon: Images, labelKey: 'nav.library' },
        { path: '/settings', icon: Settings, labelKey: 'nav.settings' },
    ]

    // Format Anlas number
    const formatAnlas = (value: number) => {
        return value.toLocaleString()
    }

    const handleLeftPanelToggle = () => {
        if (supportPanelsAreDocked) {
            toggleLeftSidebar()
        } else {
            setLeftSheetOpen(true)
        }
    }

    const handleRightPanelToggle = () => {
        if (supportPanelsAreDocked) {
            toggleRightSidebar()
        } else {
            setRightSheetOpen(true)
        }
    }

    const promptPanelContent = (
        <>
            <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2 sm:px-4">
                <div className="flex min-w-0 items-center gap-2">
                    <h2 className="min-w-0 max-w-40 truncate text-base font-semibold">
                        {activePreset?.name || t('preset.default', '기본')}
                    </h2>
                    <PresetDropdown open={presetDialogOpen} onOpenChange={setPresetDialogOpen} />
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
                                            'flex min-h-11 min-w-0 items-center gap-1 rounded-control border px-2 py-2 transition-colors duration-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card sm:gap-2 sm:px-3',
                                            isSlot2
                                                ? 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20'
                                                : 'border-warning/40 bg-warning/10 text-warning hover:bg-warning/20'
                                        )}
                                    >
                                        <span className="text-xs font-semibold">
                                            {entry.slot}
                                        </span>
                                        <Coins className="h-4 w-4 shrink-0" aria-hidden="true" />
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
                                    className="flex min-h-11 min-w-0 items-center gap-1 rounded-control border border-border bg-muted px-2 py-2 text-muted-foreground transition-colors duration-standard hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card sm:gap-2 sm:px-3"
                                >
                                    <span className="text-xs font-semibold">2</span>
                                    <Coins className="h-4 w-4 shrink-0" aria-hidden="true" />
                                    <span className="min-w-0 truncate text-xs font-semibold line-through sm:text-sm">
                                        {formatAnlas(anlas2.total)}
                                    </span>
                                </button>
                            </Tip>
                        )}
                        {(cost > 0 || cachedVibeCount > 0) && (
                            <div className={cn(
                                "flex items-center gap-1 rounded-control border px-2 py-1 text-xs font-semibold animate-in fade-in slide-in-from-left-2 motion-reduce:animate-none",
                                cost > 0
                                    ? "border-destructive/30 bg-destructive/10 text-destructive"
                                    : "border-primary/30 bg-primary/10 text-primary"
                            )}>
                                {cost > 0 && <span>-{cost}</span>}
                                {cachedVibeCount > 0 && (
                                    <Zap className="h-3 w-3" fill="currentColor" aria-hidden="true" />
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex min-h-11 min-w-0 items-center gap-2 rounded-control border border-border bg-muted px-3 py-2">
                        <Coins className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="min-w-0 truncate text-sm text-muted-foreground">
                            {t('settingsPage.api.token')}
                        </span>
                    </div>
                )}
            </div>

            <PromptPanel />
        </>
    )

    return (
        <div
            className="flex h-screen flex-col overflow-hidden bg-background"
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

            {/* DESIGN.md workspace shell: border-first depth, compact spacing, and docking only at 1536px. */}
            <div className="flex min-w-0 flex-1 gap-2 overflow-hidden p-2 sm:gap-3 sm:p-3">
                <aside
                    id="nais2-prompt-dock"
                    className={cn(
                        "hidden min-h-0 w-[420px] flex-shrink-0 flex-col overflow-hidden rounded-panel border border-border bg-card 2xl:flex 2xl:w-[500px]",
                        (!leftSidebarVisible || compositionWorkspaceOwnsRails) && "2xl:hidden"
                    )}
                >
                    {promptPanelContent}
                </aside>

                <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-panel border border-border bg-canvas">
                    {/* The compact row keeps navigation primary; utility dialogs wrap below it on phones so every control stays in normal flow. */}
                    <div className="z-10 flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-2 py-1 sm:flex-nowrap sm:px-3">
                        <Tip content={t('layout.toggleLeftSidebar', 'Toggle Left Sidebar')}>
                            <button
                                type="button"
                                onClick={handleLeftPanelToggle}
                                className={cn(
                                    "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-transparent transition-colors duration-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
                                    "text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground",
                                    supportPanelsAreDocked && !leftSidebarVisible && "opacity-50"
                                )}
                                aria-label={t('layout.toggleLeftSidebar', 'Toggle Left Sidebar')}
                                aria-expanded={supportPanelsAreDocked ? leftSidebarVisible : leftSheetOpen}
                                aria-controls={supportPanelsAreDocked ? 'nais2-prompt-dock' : 'nais2-prompt-sheet'}
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
                                    "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-transparent transition-colors duration-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
                                    "text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground",
                                    supportPanelsAreDocked && !rightSidebarVisible && "opacity-50"
                                )}
                                aria-label={t('layout.toggleRightSidebar', 'Toggle Right Sidebar')}
                                aria-expanded={supportPanelsAreDocked ? rightSidebarVisible : rightSheetOpen}
                                aria-controls={supportPanelsAreDocked ? 'nais2-history-dock' : 'nais2-history-sheet'}
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
                        "hidden min-h-0 w-[280px] flex-shrink-0 overflow-hidden rounded-panel border border-border bg-card 2xl:block",
                        (!rightSidebarVisible || compositionWorkspaceOwnsRails) && "2xl:hidden"
                    )}
                >
                    <HistoryPanel />
                </aside>
            </div>

            <Sheet open={leftSheetOpen} onOpenChange={setLeftSheetOpen}>
                <SheetContent
                    id="nais2-prompt-sheet"
                    side="left"
                    className="flex !w-full !max-w-none flex-col gap-0 sm:!w-[420px] sm:!max-w-[420px]"
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

            <Sheet open={rightSheetOpen} onOpenChange={setRightSheetOpen}>
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
                        <HistoryPanel />
                    </div>
                </SheetContent>
            </Sheet>
        </div>
    )
}
