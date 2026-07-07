import { ReactNode, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { PromptPanel } from './PromptPanel'
import { HistoryPanel } from './HistoryPanel'
import { AnimatedNavBar } from './AnimatedNavBar'
import { CustomTitleBar } from './CustomTitleBar'
import { PresetDropdown } from '@/components/preset/PresetDropdown'
import { useAuthStore } from '@/stores/auth-store'
import { SHORTCUT_EVENTS } from '@/hooks/useShortcuts'
import { Tip } from '@/components/ui/tooltip'
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
    Store,
    Package,
} from 'lucide-react'

interface ThreeColumnLayoutProps {
    children: ReactNode
}

import { calculateExtraCost } from '@/lib/anlas-calculator'
import { useCharacterStore } from '@/stores/character-store'
import { usePresetStore } from '@/stores/preset-store'
import { useLayoutStore } from '@/stores/layout-store'

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

    // Get generation params for cost calculation
    const { characterImages, vibeImages } = useCharacterStore()

    // Get active preset for header display
    const { presets, activePresetId } = usePresetStore()
    const activePreset = presets.find(p => p.id === activePresetId)

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
        { path: '/marketplace', icon: Store, labelKey: 'nav.marketplace' },
        { path: '/web', icon: Globe, labelKey: 'nav.web' },
        { path: '/library', icon: Images, labelKey: 'nav.library' },
        { path: '/settings', icon: Settings, labelKey: 'nav.settings' },
    ]

    // Format Anlas number
    const formatAnlas = (value: number) => {
        return value.toLocaleString()
    }

    const handleLeftPanelToggle = () => {
        if (isDesktopShell) {
            toggleLeftSidebar()
        } else {
            setLeftSheetOpen(true)
        }
    }

    const handleRightPanelToggle = () => {
        if (isDesktopShell) {
            toggleRightSidebar()
        } else {
            setRightSheetOpen(true)
        }
    }

    const promptPanelContent = (
        <>
            <div className="flex min-h-14 items-center justify-between gap-2 px-3 py-2 sm:px-4">
                <div className="flex min-w-0 items-center gap-2">
                    <h2 className="min-w-0 max-w-[180px] truncate text-base font-semibold">
                        {activePreset?.name || t('preset.default', '기본')}
                    </h2>
                    <PresetDropdown open={presetDialogOpen} onOpenChange={setPresetDialogOpen} />
                </div>

                {activeTokenBalances.length > 0 ? (
                    <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
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
                                        onClick={() => setSlotEnabled(entry.slot, false)}
                                        className={cn(
                                            'flex min-w-0 items-center gap-1 rounded-full border px-2 py-1.5 transition-all sm:gap-1.5 sm:px-3',
                                            isSlot2
                                                ? 'bg-gradient-to-r from-purple-500/20 to-pink-500/20 border-purple-500/30 hover:border-purple-500/60'
                                                : 'bg-gradient-to-r from-amber-500/20 to-yellow-500/20 border-amber-500/30 hover:border-amber-500/60'
                                        )}
                                    >
                                        <span className={cn('text-[10px] font-bold', isSlot2 ? 'text-purple-500/80' : 'text-amber-500/80')}>
                                            {entry.slot}
                                        </span>
                                        <Coins className={cn('h-4 w-4 shrink-0', isSlot2 ? 'text-purple-500' : 'text-amber-500')} />
                                        <span className={cn('min-w-0 truncate text-xs font-semibold sm:text-sm', isSlot2 ? 'text-purple-500' : 'text-amber-500')}>
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
                                    onClick={() => setSlotEnabled(2, true)}
                                    className="flex min-w-0 items-center gap-1 rounded-full border bg-muted/30 border-border/50 px-2 py-1.5 opacity-60 transition-all hover:opacity-90 sm:gap-1.5 sm:px-3"
                                >
                                    <span className="text-[10px] font-bold text-muted-foreground">2</span>
                                    <Coins className="h-4 w-4 shrink-0 text-muted-foreground" />
                                    <span className="min-w-0 truncate text-xs font-semibold text-muted-foreground line-through sm:text-sm">
                                        {formatAnlas(anlas2.total)}
                                    </span>
                                </button>
                            </Tip>
                        )}
                        {(cost > 0 || cachedVibeCount > 0) && (
                            <div className={cn(
                                "flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-bold shadow-sm animate-in fade-in slide-in-from-left-2",
                                cost > 0
                                    ? "bg-destructive/10 border-destructive/30 text-destructive"
                                    : "bg-blue-500/10 border-blue-500/30 text-blue-500"
                            )}>
                                {cost > 0 && <span>-{cost}</span>}
                                {cachedVibeCount > 0 && (
                                    <Zap className={cn("h-3 w-3", cost === 0 && "ml-0.5")} fill="currentColor" />
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex min-w-0 items-center gap-2 rounded-full bg-muted/50 px-3 py-1.5">
                        <Coins className="h-4 w-4 shrink-0 text-muted-foreground" />
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
        <div className="flex flex-col h-screen bg-background overflow-hidden">
            {/* Custom Title Bar - Only show on Windows (Mac uses native decorations) */}
            {!isMac && <CustomTitleBar />}

            {/* Main Layout */}
            <div className="flex min-w-0 flex-1 gap-2 overflow-hidden p-2 sm:gap-3 sm:p-3">
                {/* DESIGN.md responsive shell: side panels leave the frame below xl so center content stays primary. */}
                <aside className={cn(
                    "hidden w-[420px] flex-shrink-0 flex-col overflow-hidden rounded-2xl border border-border/50 bg-card/50 shadow-lg backdrop-blur-sm transition-all duration-200 2xl:flex 2xl:w-[500px]",
                    !leftSidebarVisible && "2xl:hidden"
                )}>
                    {promptPanelContent}
                </aside>

                {/* Center Panel - Page Content (Rounded Box) */}
                <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/50 bg-card/30 shadow-lg backdrop-blur-sm">
                    {/* Tab Navigation (Glass Surface) */}
                    <div className="z-10 flex shrink-0 items-center gap-2 px-2 py-2 sm:px-3 sm:py-3">
                        <Tip content={t('layout.toggleLeftSidebar', 'Toggle Left Sidebar')}>
                            <button
                                onClick={handleLeftPanelToggle}
                                className={cn(
                                    "shrink-0 rounded-full p-2 transition-colors",
                                    "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                                    isDesktopShell && !leftSidebarVisible && "opacity-50"
                                )}
                                aria-label={t('layout.toggleLeftSidebar', 'Toggle Left Sidebar')}
                            >
                                <PanelLeft className="h-4 w-4" />
                            </button>
                        </Tip>
                        <div className="min-w-0 flex-1">
                            <div className="flex h-12 min-w-0 items-center rounded-full border border-border/50 bg-card/50 px-1 sm:px-2">
                                <AnimatedNavBar items={navItems} />
                            </div>
                        </div>
                        <Tip content={t('layout.toggleRightSidebar', 'Toggle Right Sidebar')}>
                            <button
                                onClick={handleRightPanelToggle}
                                className={cn(
                                    "shrink-0 rounded-full p-2 transition-colors",
                                    "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                                    isDesktopShell && !rightSidebarVisible && "opacity-50"
                                )}
                                aria-label={t('layout.toggleRightSidebar', 'Toggle Right Sidebar')}
                            >
                                <PanelRight className="h-4 w-4" />
                            </button>
                        </Tip>
                    </div>

                    {/* Page Content */}
                    <main className={cn(
                        "flex-1 relative",
                        (location.pathname === '/' || location.pathname === '/library') ? "p-0 overflow-hidden" : "overflow-y-auto p-2 sm:p-4"
                    )}>
                        {children}
                    </main>
                </div>

                {/* Right Panel - History Only (Rounded Box) */}
                <aside className={cn(
                    "hidden w-[280px] flex-shrink-0 overflow-hidden rounded-2xl border border-border/50 bg-card/50 shadow-lg backdrop-blur-sm transition-all duration-200 2xl:block",
                    !rightSidebarVisible && "2xl:hidden"
                )}>
                    <HistoryPanel />
                </aside>
            </div>

            <Sheet open={leftSheetOpen} onOpenChange={setLeftSheetOpen}>
                <SheetContent side="left" className="flex !w-[min(92vw,420px)] !max-w-none flex-col p-3">
                    <SheetHeader className="sr-only">
                        <SheetTitle>{t('layout.toggleLeftSidebar', 'Toggle Left Sidebar')}</SheetTitle>
                    </SheetHeader>
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/50 bg-card/95 shadow-lg">
                        {promptPanelContent}
                    </div>
                </SheetContent>
            </Sheet>

            <Sheet open={rightSheetOpen} onOpenChange={setRightSheetOpen}>
                <SheetContent side="right" className="flex !w-[min(88vw,360px)] !max-w-none flex-col p-3">
                    <SheetHeader className="sr-only">
                        <SheetTitle>{t('layout.toggleRightSidebar', 'Toggle Right Sidebar')}</SheetTitle>
                    </SheetHeader>
                    <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border/50 bg-card/95 shadow-lg">
                        <HistoryPanel />
                    </div>
                </SheetContent>
            </Sheet>
        </div>
    )
}
