import { useEffect } from 'react'
import { check, Update } from '@tauri-apps/plugin-updater'
import { getVersion } from '@tauri-apps/api/app'
import { useTranslation } from 'react-i18next'
import { toast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Download, RefreshCw, Sparkles } from 'lucide-react'
import { useUpdateStore, setCurrentUpdateObject, installPendingUpdate } from '@/stores/update-store'

// Compare semver versions: returns 1 if a > b, -1 if a < b, 0 if equal
function compareVersions(a: string, b: string): number {
    const partsA = a.replace(/^v/, '').split('.').map(Number)
    const partsB = b.replace(/^v/, '').split('.').map(Number)
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
        const numA = partsA[i] || 0
        const numB = partsB[i] || 0
        if (numA > numB) return 1
        if (numA < numB) return -1
    }
    return 0
}

export function useUpdateChecker() {
    const { t } = useTranslation()
    const {
        pendingUpdate,
        isDownloading,
        setPendingUpdate,
        setIsDownloading,
        setDownloadProgress,
        clearPendingUpdate
    } = useUpdateStore()

    // Function to download update (but not install)
    const downloadUpdate = async (update: Update) => {
        setIsDownloading(true)
        try {
            toast({
                title: t('update.downloading', '다운로드 중...'),
                description: t('update.pleaseWait', '잠시만 기다려주세요'),
            })

            // Download only (not install)
            let totalBytes = 0
            let downloadedBytes = 0
            let lastReportedPercent = -1
            let lastUpdateTime = 0
            const THROTTLE_MS = 100 // Limit updates to every 100ms

            await update.download((event) => {
                if (event.event === 'Started' && event.data.contentLength) {
                    totalBytes = event.data.contentLength
                } else if (event.event === 'Progress') {
                    downloadedBytes += event.data.chunkLength
                    if (totalBytes > 0) {
                        const percent = Math.round((downloadedBytes / totalBytes) * 100)
                        const now = Date.now()
                        
                        // Only update if percent changed AND throttle time passed (or 100% complete)
                        if (percent !== lastReportedPercent && 
                            (percent === 100 || now - lastUpdateTime >= THROTTLE_MS)) {
                            lastReportedPercent = percent
                            lastUpdateTime = now
                            setDownloadProgress(percent)
                        }
                    }
                }
            })

            // Store the update object for later installation (mark as downloaded)
            setCurrentUpdateObject(update, true)
            setPendingUpdate({
                version: update.version,
                downloadedAt: Date.now(),
            })

            // Show toast with install option
            toast({
                title: t('update.downloadComplete', '다운로드 완료'),
                description: t('update.readyToInstall', '업데이트를 설치할 준비가 되었습니다. 작업을 저장한 후 설치하세요.'),
                action: (
                    <Button
                        size="sm"
                        onClick={async () => {
                            try {
                                await installPendingUpdate()
                            } catch (e) {
                                console.error('Install failed:', e)
                                toast({
                                    title: t('update.failed', '설치 실패'),
                                    description: String(e),
                                    variant: 'destructive',
                                })
                            }
                        }}
                    >
                        <Sparkles className="h-4 w-4 mr-1" />
                        {t('update.installNow', '지금 설치')}
                    </Button>
                ),

            })
        } catch (error) {
            console.error('Download failed:', error)
            toast({
                title: t('update.failed', '업데이트 실패'),
                description: String(error),
                variant: 'destructive',
            })
        } finally {
            setIsDownloading(false)
        }
    }

    useEffect(() => {
        const checkForUpdates = async () => {
            try {
                // First, check if pendingUpdate is outdated (already installed)
                if (pendingUpdate) {
                    const currentVersion = await getVersion()
                    if (compareVersions(currentVersion, pendingUpdate.version) >= 0) {
                        // Current version is same or newer than pending, clear it
                        console.log(`[Update] Clearing outdated pendingUpdate: ${pendingUpdate.version} (current: ${currentVersion})`)
                        clearPendingUpdate()
                        return // No need to check for updates, we just updated
                    }
                }

                const update = await check()
                if (update) {
                    // Check if we already have this version downloaded
                    if (pendingUpdate && pendingUpdate.version === update.version) {
                        // Store update object but mark as NOT downloaded in this session
                        // installPendingUpdate will use downloadAndInstall() to be safe
                        setCurrentUpdateObject(update, false)
                        toast({
                            title: t('update.readyToInstall', '업데이트 설치 준비됨'),
                            description: t('update.version', { version: update.version }),
                            action: (
                                <Button
                                    size="sm"
                                    onClick={async () => {
                                        try {
                                            await installPendingUpdate()
                                        } catch (e) {
                                            console.error('Install failed:', e)
                                            toast({
                                                title: t('update.failed', '설치 실패'),
                                                description: String(e),
                                                variant: 'destructive',
                                            })
                                        }
                                    }}
                                >
                                    <Sparkles className="h-4 w-4 mr-1" />
                                    {t('update.installNow', '지금 설치')}
                                </Button>
                            ),
                        })
                        return
                    }

                    // New update available, show download option
                    toast({
                        title: t('update.available', '업데이트 사용 가능'),
                        description: t('update.version', { version: update.version }),
                        action: (
                            <Button
                                size="sm"
                                onClick={() => downloadUpdate(update)}
                                disabled={isDownloading}
                            >
                                {isDownloading ? (
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Download className="h-4 w-4" />
                                )}
                            </Button>
                        ),
                    })
                }
            } catch (error) {
                console.log('Update check skipped (dev mode or offline):', error)
            }
        }

        // Check for updates after a short delay on app start
        const timer = setTimeout(checkForUpdates, 3000)
        return () => clearTimeout(timer)
    }, [t, pendingUpdate])

    return {
        isDownloading,
        pendingUpdate,
        downloadUpdate,
    }
}
