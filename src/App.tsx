import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout'
import { Toaster } from '@/components/ui/toaster'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useSceneGeneration } from '@/hooks/useSceneGeneration'
import { useUpdateChecker } from '@/hooks/useUpdateChecker'
import { useShortcuts } from '@/hooks/useShortcuts'
import { useWindowResizePerformanceMode } from '@/hooks/useWindowResizePerformanceMode'
import MainMode from '@/pages/MainMode'
import { useMarketAuthStore } from '@/stores/market-auth-store'

const SceneMode = lazy(() => import('@/pages/SceneMode'))
const SceneDetail = lazy(() => import('@/pages/SceneDetail'))
const WebView = lazy(() => import('@/pages/WebView'))
const Library = lazy(() => import('@/pages/Library'))
const Settings = lazy(() => import('@/pages/Settings'))
const ToolsMode = lazy(() => import('@/pages/ToolsMode'))
const PromptEditor = lazy(() => import('@/pages/PromptEditor'))
const AssetModuleStudio = lazy(() => import('@/pages/AssetModuleStudio'))
const StyleLab = lazy(() => import('@/pages/StyleLab'))
const Marketplace = lazy(() => import('@/pages/Marketplace'))
const MarketplaceDetail = lazy(() => import('@/pages/MarketplaceDetail'))

function RouteLoadingFallback() {
    return (
        <div className="flex h-full min-h-[320px] items-center justify-center" role="status" aria-label="Loading">
            <div className="h-6 w-6 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin" />
        </div>
    )
}

function AppContent() {
    // Scene generation hook at App level - persists across page navigation
    useSceneGeneration()
    useUpdateChecker()
    useShortcuts()
    useWindowResizePerformanceMode()

    // Initialize marketplace auth on app mount
    const initMarketAuth = useMarketAuthStore(s => s.init)
    useEffect(() => {
        initMarketAuth()
    }, [initMarketAuth])

    // Disable right-click globally except for allowed elements
    useEffect(() => {
        const handleContextMenu = (e: MouseEvent) => {
            // Check if the target or any parent has data-allow-context-menu attribute
            let element = e.target as HTMLElement | null
            while (element) {
                if (element.hasAttribute('data-allow-context-menu')) {
                    return // Allow context menu
                }
                element = element.parentElement
            }
            e.preventDefault() // Block context menu
        }

        document.addEventListener('contextmenu', handleContextMenu)
        return () => document.removeEventListener('contextmenu', handleContextMenu)
    }, [])

    return (
        <ThreeColumnLayout>
            <Suspense fallback={<RouteLoadingFallback />}>
                <Routes>
                    <Route path="/" element={<MainMode />} />
                    <Route path="/scenes" element={<SceneMode />} />
                    <Route path="/scenes/:id" element={<SceneDetail />} />
                    <Route path="/tools" element={<ToolsMode />} />
                    <Route path="/prompts" element={<PromptEditor />} />
                    <Route path="/asset-modules" element={<AssetModuleStudio />} />
                    <Route path="/style-lab" element={<StyleLab />} />
                    <Route path="/marketplace" element={<Marketplace />} />
                    <Route path="/marketplace/:id" element={<MarketplaceDetail />} />
                    <Route path="/web" element={<WebView />} />
                    <Route path="/library" element={<Library />} />
                    <Route path="/settings" element={<Settings />} />
                </Routes>
            </Suspense>
        </ThreeColumnLayout>
    )
}

function App() {
    return (
        <TooltipProvider delayDuration={300}>
            <BrowserRouter>
                <AppContent />
                <Toaster />
            </BrowserRouter>
        </TooltipProvider>
    )
}

export default App
