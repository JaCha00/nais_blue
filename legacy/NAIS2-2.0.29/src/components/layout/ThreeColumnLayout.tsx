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
import GlassSurface from '@/components/ui/GlassSurface'
import { Tip } from '@/components/ui/tooltip'
import {
    Home,
    Film,
    Globe,
    Images,
    Settings,
    Coins,
    Wand2,
    Zap,
    PanelLeft,
    PanelRight,
    NotebookPen,
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

export function ThreeColumnLayout({ children }: ThreeColumnLayoutProps) {
    const { t } = useTranslation()
    const location = useLocation()
    const { anlas, isVerified, slot1Enabled, anlas2, isVerified2, slot2Enabled, refreshAnlas, setSlotEnabled } = useAuthStore()
    const { leftSidebarVisible, rightSidebarVisible, toggleLeftSidebar, toggleRightSidebar } = useLayoutStore()

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

    // Calculate cached vs uncached vibes
    const uncachedVibeCount = vibeImages.filter(v => !v.encodedVibe).length
    const cachedVibeCount = vibeImages.length - uncachedVibeCount

    // Only calculate extra costs for uncached vibes
    const cost = calculateExtraCost(
        characterImages.length,
        uncachedVibeCount
    )

    // Refresh Anlas for whichever slots are verified
    useEffect(() => {
        if (isVerified) refreshAnlas(1)
        if (isVerified2) refreshAnlas(2)
    }, [isVerified, isVerified2, refreshAnlas])

    const navItems = [
        { path: '/', icon: Home, labelKey: 'nav.main' },
        { path: '/scenes', icon: Film, labelKey: 'nav.scenes' },
        { path: '/tools', icon: Wand2, labelKey: 'smartTools.title' },
        { path: '/prompts', icon: NotebookPen, labelKey: 'nav.promptEditor' },
        { path: '/web', icon: Globe, labelKey: 'nav.web' },
        { path: '/library', icon: Images, labelKey: 'nav.library' },
        { path: '/settings', icon: Settings, labelKey: 'nav.settings' },
    ]

    // Format Anlas number
    const formatAnlas = (value: number) => {
        return value.toLocaleString()
    }

    return (
        <div className="flex flex-col h-screen bg-background overflow-hidden">
            {/* Custom Title Bar - Only show on Windows (Mac uses native decorations) */}
            {!isMac && <CustomTitleBar />}

            {/* Main Layout */}
            <div className="flex flex-1 p-3 gap-3 overflow-hidden">
                {/* Left Panel - History (was right; visually swapped) */}
                <aside className={cn(
                    "w-[280px] flex-shrink-0 bg-card/50 backdrop-blur-sm rounded-2xl border border-border/50 overflow-hidden shadow-lg transition-all duration-200",
                    !rightSidebarVisible && "hidden"
                )}>
                    <HistoryPanel />
                </aside>

                {/* Right Panel (rendered later as last child) - Prompt Input
                    NOTE: leftSidebarVisible still controls the prompt panel
                    (state name kept for persistence compatibility). */}
                <aside className={cn(
                    "order-last w-[420px] xl:w-[460px] 2xl:w-[500px] flex-shrink-0 flex flex-col bg-card/50 backdrop-blur-sm rounded-2xl border border-border/50 overflow-hidden shadow-lg transition-all duration-200",
                    !leftSidebarVisible && "hidden"
                )}>
                    {/* Header - Preset Title & Anlas Display */}
                    <div className="h-14 flex items-center justify-between px-4">
                        {/* Preset Title + Dialog Trigger */}
                        <div className="flex items-center gap-2">
                            <h2 className="text-base font-semibold truncate max-w-[180px]">
                                {activePreset?.name || t('preset.default', '기본')}
                            </h2>
                            <PresetDropdown open={presetDialogOpen} onOpenChange={setPresetDialogOpen} />
                        </div>

                        {/* Anlas Display — pills are clickable to toggle that slot's
                            participation. Click during a generation to pause that slot,
                            click again to resume. */}
                        {isVerified && anlas ? (
                            <div className="flex items-center gap-2">
                                <Tip content={slot1Enabled
                                    ? t('settingsPage.api.clickToPause1', 'NAI 1 안라스 — 클릭하여 일시정지')
                                    : t('settingsPage.api.clickToResume1', 'NAI 1 일시정지됨 — 클릭하여 재개')}>
                                    <button
                                        type="button"
                                        onClick={() => setSlotEnabled(1, !slot1Enabled)}
                                        className={cn(
                                            'flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-all',
                                            slot1Enabled
                                                ? 'bg-gradient-to-r from-amber-500/20 to-yellow-500/20 border-amber-500/30 hover:border-amber-500/60'
                                                : 'bg-muted/30 border-border/50 opacity-50 hover:opacity-80'
                                        )}
                                    >
                                        <span className={cn('text-[10px] font-bold', slot1Enabled ? 'text-amber-500/80' : 'text-muted-foreground')}>1</span>
                                        <Coins className={cn('h-4 w-4', slot1Enabled ? 'text-amber-500' : 'text-muted-foreground')} />
                                        <span className={cn('text-sm font-semibold', slot1Enabled ? 'text-amber-500' : 'text-muted-foreground line-through')}>
                                            {formatAnlas(anlas.total)}
                                        </span>
                                    </button>
                                </Tip>
                                {isVerified2 && anlas2 && (
                                    <Tip content={slot2Enabled
                                        ? t('settingsPage.api.clickToPause2', 'NAI 2 안라스 — 클릭하여 일시정지')
                                        : t('settingsPage.api.clickToResume2', 'NAI 2 일시정지됨 — 클릭하여 재개')}>
                                        <button
                                            type="button"
                                            onClick={() => setSlotEnabled(2, !slot2Enabled)}
                                            className={cn(
                                                'flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-all',
                                                slot2Enabled
                                                    ? 'bg-gradient-to-r from-purple-500/20 to-pink-500/20 border-purple-500/30 hover:border-purple-500/60'
                                                    : 'bg-muted/30 border-border/50 opacity-50 hover:opacity-80'
                                            )}
                                        >
                                            <span className={cn('text-[10px] font-bold', slot2Enabled ? 'text-purple-500/80' : 'text-muted-foreground')}>2</span>
                                            <Coins className={cn('h-4 w-4', slot2Enabled ? 'text-purple-500' : 'text-muted-foreground')} />
                                            <span className={cn('text-sm font-semibold', slot2Enabled ? 'text-purple-500' : 'text-muted-foreground line-through')}>
                                                {formatAnlas(anlas2.total)}
                                            </span>
                                        </button>
                                    </Tip>
                                )}
                                {(cost > 0 || cachedVibeCount > 0) && (
                                    <div className={cn(
                                        "flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-bold animate-in fade-in slide-in-from-left-2 shadow-sm",
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
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 rounded-full">
                                <Coins className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm text-muted-foreground">
                                    {t('settingsPage.api.token')}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Prompt Panel */}
                    <PromptPanel />
                </aside>

                {/* Center Panel - Page Content (Rounded Box) */}
                <div className="flex-1 flex flex-col min-w-0 bg-card/30 backdrop-blur-sm rounded-2xl border border-border/50 overflow-hidden shadow-lg">
                    {/* Tab Navigation (Glass Surface) */}
                    <div className="shrink-0 flex items-center justify-center py-3 z-10 gap-2">
                        {/* Mac: Left sidebar toggle (now controls History on the left) */}
                        {isMac && (
                            <Tip content={t('layout.toggleLeftSidebar', 'Toggle Left Sidebar')}>
                                <button
                                    onClick={toggleRightSidebar}
                                    className={cn(
                                        "p-1.5 rounded-full transition-colors",
                                        "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                                        !rightSidebarVisible && "opacity-50"
                                    )}
                                >
                                    <PanelLeft className="h-4 w-4" />
                                </button>
                            </Tip>
                        )}
                        <GlassSurface
                            width="fit-content"
                            height={52}
                            borderRadius={30}
                            opacity={0.6}
                            blur={15}
                            borderWidth={0.5}
                            className="flex items-center px-2"
                        >
                            <AnimatedNavBar items={navItems} />
                        </GlassSurface>
                        {/* Mac: Right sidebar toggle (now controls Prompt on the right) */}
                        {isMac && (
                            <Tip content={t('layout.toggleRightSidebar', 'Toggle Right Sidebar')}>
                                <button
                                    onClick={toggleLeftSidebar}
                                    className={cn(
                                        "p-1.5 rounded-full transition-colors",
                                        "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                                        !leftSidebarVisible && "opacity-50"
                                    )}
                                >
                                    <PanelRight className="h-4 w-4" />
                                </button>
                            </Tip>
                        )}
                    </div>

                    {/* Page Content */}
                    <main className={cn(
                        "flex-1 relative",
                        (location.pathname === '/' || location.pathname === '/library') ? "p-0 overflow-hidden" : "p-4 overflow-y-auto"
                    )}>
                        {children}
                    </main>
                </div>

            </div>
        </div>
    )
}
