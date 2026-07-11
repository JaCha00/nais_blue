import { useState, useRef, useEffect, useCallback, type MutableRefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
    closeBrowserView,
    hideBrowserView,
    isBrowserViewOpen,
    navigateBrowserView,
    openBrowserView,
    resizeBrowserView,
    showBrowserView,
    zoomBrowserView,
    type BrowserOpenTarget,
} from '@/platform/browser'
import { Store } from '@tauri-apps/plugin-store'
import {
    Globe,
    Home,
    ExternalLink,
    X,
    RefreshCw,
    Plus,
    Edit,
    ZoomIn,
    ZoomOut,
} from 'lucide-react'

interface QuickLink {
    name: string
    url: string
}

// Default quick links (safebooru removed)
const DEFAULT_QUICK_LINKS: QuickLink[] = [
    { name: 'Danbooru', url: 'https://hijiribe.donmai.us' },
    { name: 'novelai.app', url: 'https://novelai.app/' },
    { name: 'Google Translate', url: 'https://translate.google.co.kr/?sl=ko&tl=en&op=translate' },
]

const STORE_KEY = 'webview_quick_links'
const WEBVIEW_RESIZE_THROTTLE_MS = 80

interface WebViewRect {
    x: number
    y: number
    width: number
    height: number
}

const toWebViewRect = (rect: DOMRect): WebViewRect => ({
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
})

const resetEmbeddedBrowserState = (
    setIsBrowserOpen: (isOpen: boolean) => void,
    lastWebViewRectRef: MutableRefObject<WebViewRect | null>,
    lastResizeSentAtRef: MutableRefObject<number>,
) => {
    lastWebViewRectRef.current = null
    lastResizeSentAtRef.current = 0
    setIsBrowserOpen(false)
}

const hasMeaningfulRectChange = (previous: WebViewRect | null, next: WebViewRect) => (
    !previous ||
    Math.abs(previous.x - next.x) >= 1 ||
    Math.abs(previous.y - next.y) >= 1 ||
    Math.abs(previous.width - next.width) >= 2 ||
    Math.abs(previous.height - next.height) >= 2
)

export default function WebView() {
    const { t } = useTranslation()
    const [url, setUrl] = useState('https://hijiribe.donmai.us')
    const [inputUrl, setInputUrl] = useState(url)
    const [isLoading, setIsLoading] = useState(false)
    const [isBrowserOpen, setIsBrowserOpen] = useState(false)
    const [quickLinks, setQuickLinks] = useState<QuickLink[]>(DEFAULT_QUICK_LINKS)
    const [isEditMode, setIsEditMode] = useState(false)
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
    const [newLinkName, setNewLinkName] = useState('')
    const [newLinkUrl, setNewLinkUrl] = useState('')
    const browserAreaRef = useRef<HTMLDivElement>(null)
    const rafRef = useRef<number | null>(null)
    const pendingResizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const lastResizeSentAtRef = useRef(0)
    const lastWebViewRectRef = useRef<WebViewRect | null>(null)
    const storeRef = useRef<Store | null>(null)
    const [zoomLevel, setZoomLevel] = useState(1.0)

    // Zoom function for buttons
    const handleZoom = useCallback(async (delta: number) => {
        if (!isBrowserOpen) return
        const newZoom = Math.max(0.25, Math.min(3.0, zoomLevel + delta))
        setZoomLevel(newZoom)
        try {
            await zoomBrowserView(newZoom)
        } catch (error) {
            console.error('Zoom failed:', error)
        }
    }, [isBrowserOpen, zoomLevel])

    const handleZoomReset = useCallback(async () => {
        setZoomLevel(1.0)
        try {
            await zoomBrowserView(1.0)
        } catch (error) {
            console.error('Zoom reset failed:', error)
        }
    }, [])

    // Hide WebView when dialog opens (z-index fix)
    useEffect(() => {
        if (isAddDialogOpen && isBrowserOpen) {
            hideBrowserView().catch(() => { })
        } else if (!isAddDialogOpen && isBrowserOpen) {
            showBrowserView().catch(() => { })
        }
    }, [isAddDialogOpen, isBrowserOpen])

    // Initialize store and load quick links
    useEffect(() => {
        const initStore = async () => {
            try {
                storeRef.current = await Store.load('webview-settings.json')
                const savedLinks = await storeRef.current.get<QuickLink[]>(STORE_KEY)
                if (savedLinks && savedLinks.length > 0) {
                    setQuickLinks(savedLinks)
                }
            } catch (error) {
                console.error('Failed to load quick links:', error)
            }
        }
        initStore()
    }, [])

    // Save quick links when changed
    const saveQuickLinks = useCallback(async (links: QuickLink[]) => {
        try {
            if (storeRef.current) {
                await storeRef.current.set(STORE_KEY, links)
                await storeRef.current.save()
            }
        } catch (error) {
            console.error('Failed to save quick links:', error)
        }
    }, [])

    const addQuickLink = () => {
        if (!newLinkName.trim() || !newLinkUrl.trim()) return

        let urlToAdd = newLinkUrl.trim()
        if (!urlToAdd.startsWith('http://') && !urlToAdd.startsWith('https://')) {
            urlToAdd = 'https://' + urlToAdd
        }

        const newLinks = [...quickLinks, { name: newLinkName.trim(), url: urlToAdd }]
        setQuickLinks(newLinks)
        saveQuickLinks(newLinks)

        setNewLinkName('')
        setNewLinkUrl('')
        setIsAddDialogOpen(false)
    }

    const removeQuickLink = (index: number) => {
        const newLinks = quickLinks.filter((_, i) => i !== index)
        setQuickLinks(newLinks)
        saveQuickLinks(newLinks)
    }

    const sendWebViewResize = useCallback((nextRect: WebViewRect) => {
        lastResizeSentAtRef.current = Date.now()
        lastWebViewRectRef.current = nextRect
        void resizeBrowserView(nextRect).catch(() => {
            // Native child webview can disappear during page transitions.
        })
    }, [])

    // Resize WebView through one RAF read and one throttled IPC write.
    const updateWebViewSize = useCallback((options?: { immediate?: boolean }) => {
        if (!isBrowserOpen || !browserAreaRef.current) return

        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current)
        }

        rafRef.current = requestAnimationFrame(async () => {
            const rect = browserAreaRef.current?.getBoundingClientRect()
            if (!rect) return

            const nextRect = toWebViewRect(rect)
            if (!hasMeaningfulRectChange(lastWebViewRectRef.current, nextRect)) {
                return
            }

            if (pendingResizeTimerRef.current) {
                clearTimeout(pendingResizeTimerRef.current)
                pendingResizeTimerRef.current = null
            }

            const elapsed = Date.now() - lastResizeSentAtRef.current
            const delay = options?.immediate
                ? 0
                : Math.max(0, WEBVIEW_RESIZE_THROTTLE_MS - elapsed)

            if (delay === 0) {
                sendWebViewResize(nextRect)
                return
            }

            pendingResizeTimerRef.current = setTimeout(() => {
                sendWebViewResize(nextRect)
                pendingResizeTimerRef.current = null
            }, delay)
        })
    }, [isBrowserOpen, sendWebViewResize])

    // Check if browser exists and restore on mount
    useEffect(() => {
        const checkAndRestoreBrowser = async () => {
            try {
                const isOpen = await isBrowserViewOpen()
                if (isOpen) {
                    await showBrowserView()
                    setIsBrowserOpen(true)
                    setTimeout(() => {
                        if (browserAreaRef.current) {
                            sendWebViewResize(toWebViewRect(browserAreaRef.current.getBoundingClientRect()))
                        }
                    }, 50)
                }
            } catch (error) {
                console.error('Failed to check browser state:', error)
            }
        }
        checkAndRestoreBrowser()
    }, [sendWebViewResize])

    // The observed browser area covers window drags and shell/sidebar changes.
    useEffect(() => {
        if (!isBrowserOpen) return

        const resizeObserver = new ResizeObserver(() => updateWebViewSize())
        if (browserAreaRef.current) {
            resizeObserver.observe(browserAreaRef.current)
        }

        return () => {
            resizeObserver.disconnect()
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current)
            }
            if (pendingResizeTimerRef.current) {
                clearTimeout(pendingResizeTimerRef.current)
                pendingResizeTimerRef.current = null
            }
        }
    }, [isBrowserOpen, updateWebViewSize])

    // Hide browser when visibility changes
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.hidden && isBrowserOpen) {
                hideBrowserView().catch(() => { })
            } else if (!document.hidden && isBrowserOpen) {
                showBrowserView().catch(() => { })
                updateWebViewSize()
            }
        }

        document.addEventListener('visibilitychange', handleVisibilityChange)
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange)
        }
    }, [isBrowserOpen, updateWebViewSize])

    // Hide browser when leaving the page
    useEffect(() => {
        return () => {
            hideBrowserView().catch(() => { })
        }
    }, [])

    const commitBrowserOpenResult = useCallback((result: BrowserOpenTarget, rect?: DOMRect) => {
        if (result === 'external') {
            resetEmbeddedBrowserState(setIsBrowserOpen, lastWebViewRectRef, lastResizeSentAtRef)
            return
        }

        if (rect) {
            lastWebViewRectRef.current = toWebViewRect(rect)
            lastResizeSentAtRef.current = Date.now()
        }
        setIsBrowserOpen(true)
    }, [])

    const openBrowserWindow = useCallback(async (targetUrl: string) => {
        setIsLoading(true)
        try {
            const browserArea = browserAreaRef.current
            if (!browserArea) return

            const rect = browserArea.getBoundingClientRect()
            const result = await openBrowserView(targetUrl, toWebViewRect(rect))
            commitBrowserOpenResult(result, rect)
        } catch (error) {
            console.error('Failed to open browser:', error)
        } finally {
            setIsLoading(false)
        }
    }, [commitBrowserOpenResult])

    const closeBrowser = async () => {
        try {
            await closeBrowserView()
            resetEmbeddedBrowserState(setIsBrowserOpen, lastWebViewRectRef, lastResizeSentAtRef)
        } catch (error) {
            console.error('Failed to close browser:', error)
        }
    }

    const handleNavigate = async (e: React.FormEvent) => {
        e.preventDefault()
        let newUrl = inputUrl
        if (!newUrl.startsWith('http://') && !newUrl.startsWith('https://')) {
            newUrl = 'https://' + newUrl
        }
        setUrl(newUrl)

        if (isBrowserOpen) {
            try {
                const result = await navigateBrowserView(newUrl)
                commitBrowserOpenResult(result)
            } catch (error) {
                await openBrowserWindow(newUrl)
            }
        } else {
            await openBrowserWindow(newUrl)
        }
    }

    const handleQuickLink = async (linkUrl: string) => {
        if (isEditMode) return

        setUrl(linkUrl)
        setInputUrl(linkUrl)

        if (isBrowserOpen) {
            try {
                const result = await navigateBrowserView(linkUrl)
                commitBrowserOpenResult(result)
            } catch (error) {
                await openBrowserWindow(linkUrl)
            }
        } else {
            await openBrowserWindow(linkUrl)
        }
    }

    return (
        <div className="flex flex-col h-full gap-3 p-4">
            {/* Browser Controls */}
            <Card glass>
                <CardContent className="p-3">
                    <form onSubmit={handleNavigate} className="flex items-center gap-2">
                        <div className="flex gap-1">
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 rounded-lg"
                                aria-label={t('web.home', '홈 URL')}
                                onClick={() => {
                                    setUrl('https://hijiribe.donmai.us')
                                    setInputUrl('https://hijiribe.donmai.us')
                                }}
                            >
                                <Home className="h-4 w-4" />
                            </Button>
                            {isBrowserOpen && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-9 w-9 rounded-lg text-destructive"
                                    onClick={closeBrowser}
                                    aria-label={t('web.close', '닫기')}
                                >
                                    <X className="h-4 w-4" />
                                </Button>
                            )}
                        </div>

                        <div className="relative min-w-0 flex-1">
                            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                value={inputUrl}
                                onChange={(e) => setInputUrl(e.target.value)}
                                placeholder={t('web.urlPlaceholder')}
                                aria-label={t('web.urlPlaceholder', 'URL')}
                                className="pl-10 h-9 text-sm rounded-xl"
                            />
                        </div>

                        <Button
                            type="submit"
                            size="sm"
                            className="rounded-xl px-4"
                            disabled={isLoading}
                        >
                            {isLoading ? (
                                <RefreshCw className="h-4 w-4 animate-spin" />
                            ) : (
                                <>
                                    <ExternalLink className="h-4 w-4 mr-1" />
                                    {t('web.open')}
                                </>
                            )}
                        </Button>
                    </form>
                </CardContent>
            </Card>

            {/* Quick Links */}
            <div className="flex flex-wrap gap-2 items-center">
                {quickLinks.map((link, index) => (
                    <div key={`${link.name}-${index}`} className="group flex min-w-0 items-center gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="max-w-[calc(100vw-8rem)] min-w-0 rounded-xl text-sm sm:max-w-none"
                            onClick={() => handleQuickLink(link.url)}
                            disabled={isLoading || isEditMode}
                        >
                            <Globe className="mr-1.5 h-3 w-3 shrink-0" />
                            <span className="min-w-0 truncate">{link.name}</span>
                        </Button>
                        {isEditMode && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-11 w-11 shrink-0 rounded-xl bg-destructive p-0 text-destructive-foreground hover:bg-destructive/80"
                                onClick={() => removeQuickLink(index)}
                                aria-label={`${t('common.delete', '삭제')}: ${link.name}`}
                            >
                                <X className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
                ))}

                {/* Add button */}
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-sm rounded-xl"
                    onClick={() => setIsAddDialogOpen(true)}
                >
                    <Plus className="h-3 w-3 mr-1" />
                    {t('web.add')}
                </Button>

                {/* Edit mode toggle */}
                <Button
                    type="button"
                    variant={isEditMode ? "destructive" : "ghost"}
                    size="sm"
                    className="text-sm rounded-xl"
                    onClick={() => setIsEditMode(!isEditMode)}
                    aria-pressed={isEditMode}
                >
                    <Edit className="h-3 w-3 mr-1" />
                    {isEditMode ? t('web.done') : t('web.edit')}
                </Button>

                {isBrowserOpen && (
                    <>
                        {/* Zoom controls */}
                        <div className="flex items-center gap-1 ml-auto">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 rounded-lg"
                                onClick={() => handleZoom(-0.1)}
                                title="Zoom Out (Ctrl+-)"
                            >
                                <ZoomOut className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="text-xs rounded-lg px-2 h-7 min-w-[50px]"
                                onClick={handleZoomReset}
                                title="Reset Zoom (Ctrl+0)"
                            >
                                {Math.round(zoomLevel * 100)}%
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 rounded-lg"
                                onClick={() => handleZoom(0.1)}
                                title="Zoom In (Ctrl++)"
                            >
                                <ZoomIn className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                        <Button
                            variant="destructive"
                            size="sm"
                            className="text-sm rounded-xl"
                            onClick={closeBrowser}
                        >
                            <X className="h-3 w-3 mr-1.5" />
                            {t('web.close')}
                        </Button>
                    </>
                )}
            </div>

            {/* Browser Area */}
            <div
                ref={browserAreaRef}
                className="flex-1 rounded-xl overflow-hidden relative min-h-[400px]"
                style={{ backgroundColor: isBrowserOpen ? 'transparent' : undefined }}
            >
                {!isBrowserOpen && (
                    <Card glass className="h-full">
                        <CardContent className="p-6 h-full flex flex-col items-center justify-center text-center">
                            <Globe className="h-16 w-16 text-muted-foreground/50 mb-4" />
                            <h2 className="text-xl font-semibold mb-2">
                                {t('web.title')}
                            </h2>
                            <p className="max-w-md text-muted-foreground [text-wrap:balance]">
                                {t('web.description')}
                            </p>
                        </CardContent>
                    </Card>
                )}
            </div>

            {/* Add Quick Link Dialog */}
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{t('web.addLink')}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">{t('web.linkName')}</label>
                            <Input
                                value={newLinkName}
                                onChange={(e) => setNewLinkName(e.target.value)}
                                placeholder={t('web.linkNamePlaceholder')}
                                className="rounded-xl"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">{t('web.linkUrl')}</label>
                            <Input
                                value={newLinkUrl}
                                onChange={(e) => setNewLinkUrl(e.target.value)}
                                placeholder={t('web.linkUrlPlaceholder')}
                                className="rounded-xl"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsAddDialogOpen(false)} className="rounded-xl">
                            {t('common.cancel')}
                        </Button>
                        <Button onClick={addQuickLink} className="rounded-xl" disabled={!newLinkName.trim() || !newLinkUrl.trim()}>
                            {t('web.add')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
