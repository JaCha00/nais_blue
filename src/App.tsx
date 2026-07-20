import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom'
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout'
import { Toaster } from '@/components/ui/toaster'
import { DiagnosticsSurface } from '@/components/diagnostics/DiagnosticsSurface'
import { ApiTokenDialog } from '@/components/credentials/ApiTokenDialog'
import { TooltipProvider } from '@/components/ui/tooltip'
import { RuntimeProviders } from '@/components/runtime/RuntimeProviders'
import MainMode from '@/pages/MainMode'
import { useTrashStore } from '@/stores/trash-store'
import { pruneExpiredTrashItems } from '@/services/trash/asset-trash-service'

const SceneMode = lazy(() => import('@/pages/SceneMode'))
const SceneDetail = lazy(() => import('@/pages/SceneDetail'))
const WebView = lazy(() => import('@/pages/WebView'))
const Library = lazy(() => import('@/pages/Library'))
const Settings = lazy(() => import('@/pages/Settings'))
const ToolsMode = lazy(() => import('@/pages/ToolsMode'))
const StyleLab = lazy(() => import('@/pages/StyleLab'))
const QueueCenter = lazy(() => import('@/pages/QueueCenter'))
const R2Upload = lazy(() => import('@/pages/R2Upload'))
const Trash = lazy(() => import('@/pages/Trash'))

function RouteLoadingFallback() {
    return (
        <div className="flex h-full min-h-[320px] items-center justify-center" role="status" aria-label="Loading">
            <div className="h-6 w-6 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin" />
        </div>
    )
}

/**
 * Depends on the persisted trash journal and runs beside the app router so
 * expiration is enforced at startup, not only when a user visits /trash.
 * Re-running after hydration or a new deletion is harmless and removes only
 * entries whose 30-day deadline has actually elapsed.
 */
function TrashRetentionSweep() {
    const items = useTrashStore(state => state.items)
    const removeMany = useTrashStore(state => state.removeMany)

    useEffect(() => {
        let disposed = false
        void pruneExpiredTrashItems(items).then(expiredIds => {
            if (!disposed && expiredIds.length > 0) removeMany(expiredIds)
        })
        return () => { disposed = true }
    }, [items, removeMany])

    return null
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
                    <Route path="/style-lab" element={<StyleLab />} />
                    <Route path="/queue" element={<QueueCenter />} />
                    <Route path="/r2" element={<R2Upload />} />
                    <Route path="/trash" element={<Trash />} />
                    <Route path="/web" element={<WebView />} />
                    <Route path="/library" element={<Library />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
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
                    <TrashRetentionSweep />
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
