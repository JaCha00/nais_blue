import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout'
import { Toaster } from '@/components/ui/toaster'
import { DiagnosticsSurface } from '@/components/diagnostics/DiagnosticsSurface'
import { ApiTokenDialog } from '@/components/credentials/ApiTokenDialog'
import { TooltipProvider } from '@/components/ui/tooltip'
import { RuntimeProviders } from '@/components/runtime/RuntimeProviders'
import MainMode from '@/pages/MainMode'

const SceneMode = lazy(() => import('@/pages/SceneMode'))
const SceneDetail = lazy(() => import('@/pages/SceneDetail'))
const WebView = lazy(() => import('@/pages/WebView'))
const Library = lazy(() => import('@/pages/Library'))
const Settings = lazy(() => import('@/pages/Settings'))
const ToolsMode = lazy(() => import('@/pages/ToolsMode'))
const PromptEditor = lazy(() => import('@/pages/PromptEditor'))
const AssetModuleStudio = lazy(() => import('@/pages/AssetModuleStudio'))
const StyleLab = lazy(() => import('@/pages/StyleLab'))
const QueueCenter = lazy(() => import('@/pages/QueueCenter'))
const Organizer = lazy(() => import('@/pages/Organizer'))

function RouteLoadingFallback() {
    return (
        <div className="flex h-full min-h-[320px] items-center justify-center" role="status" aria-label="Loading">
            <div className="h-6 w-6 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin" />
        </div>
    )
}

function AppContent() {
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
                    <Route path="/queue" element={<QueueCenter />} />
                    <Route path="/organizer" element={<Organizer />} />
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
                <RuntimeProviders>
                    <AppContent />
                    <ApiTokenDialog />
                    <Toaster />
                    <DiagnosticsSurface />
                </RuntimeProviders>
            </BrowserRouter>
        </TooltipProvider>
    )
}

export default App
