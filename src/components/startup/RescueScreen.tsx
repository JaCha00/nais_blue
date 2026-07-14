import { useState } from 'react'
import { AlertTriangle, Download, FolderOpen, Power, RefreshCw } from 'lucide-react'

import type { DiagnosticEvent } from '@/domain/diagnostics/types'
import { closeApplicationWithFlush } from '@/lib/indexed-db'
import { downloadDiagnosticsExport } from '@/services/diagnostics/exporter'
import { useDiagnosticsStore } from '@/stores/diagnostics-store'

interface RescueScreenProps {
    diagnostic: DiagnosticEvent
    onRetry: () => Promise<void>
}

async function exitApplication(): Promise<void> {
    const { invoke, isTauri } = await import('@tauri-apps/api/core')
    if (isTauri()) {
        await invoke('exit_app')
        return
    }
    window.close()
}

export function RescueScreen({ diagnostic, onRetry }: RescueScreenProps) {
    const [retrying, setRetrying] = useState(false)
    const [retryMessage, setRetryMessage] = useState<string | null>(null)

    const handleRetry = async () => {
        if (retrying) return
        setRetrying(true)
        setRetryMessage(null)
        try {
            await onRetry()
        } catch {
            setRetryMessage('데이터베이스를 아직 열 수 없습니다. 진단 파일과 백업 위치를 확인하세요.')
            setRetrying(false)
        }
    }

    const handleExport = () => {
        downloadDiagnosticsExport(useDiagnosticsStore.getState().events)
    }

    const handleExit = async () => {
        await closeApplicationWithFlush({ exit: exitApplication })
    }

    return (
        <main className="min-h-dvh bg-background px-3 py-8 text-foreground sm:px-6" data-startup-mode="rescue">
            <section className="mx-auto flex w-full max-w-2xl flex-col gap-6 rounded-panel border bg-card p-4 sm:p-6" role="alert" aria-labelledby="rescue-title">
                <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-destructive" aria-hidden="true" />
                    <div className="min-w-0">
                        <h1 id="rescue-title" className="text-xl font-semibold">안전 복구 모드</h1>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            앱 데이터베이스를 열 수 없어 편집·생성·저장 기능을 시작하지 않았습니다.
                            빈 초기 상태를 기존 데이터 위에 저장하지 않습니다.
                        </p>
                    </div>
                </div>

                <div className="rounded-control border border-destructive/40 bg-destructive/10 p-3 text-sm">
                    <p className="font-medium">{diagnostic.userSummary}</p>
                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                        {diagnostic.code} · {diagnostic.eventId}
                    </p>
                </div>

                <div className="flex gap-3 rounded-control border bg-muted/40 p-3">
                    <FolderOpen className="mt-0.5 h-5 w-5 shrink-0 text-info" aria-hidden="true" />
                    <div className="min-w-0 text-sm leading-6">
                        <h2 className="font-semibold">백업 위치</h2>
                        <p className="text-muted-foreground">
                            데스크톱: Pictures/NAIS_Backup/full · Android: AppData/NAIS_Backup/full
                        </p>
                        <p className="text-muted-foreground">
                            스토어별 스냅샷은 NAIS_Backup/&lt;store-key&gt;에 있습니다.
                        </p>
                    </div>
                </div>

                {retryMessage && <p className="text-sm text-destructive" role="status">{retryMessage}</p>}

                <div className="grid gap-3 sm:grid-cols-3">
                    <button
                        type="button"
                        className="min-h-11 rounded-control bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-45"
                        onClick={() => { void handleRetry() }}
                        disabled={retrying}
                        aria-label="데이터베이스 다시 시도"
                    >
                        <RefreshCw className="mr-2 inline h-4 w-4" aria-hidden="true" />
                        {retrying ? '다시 확인 중' : '다시 시도'}
                    </button>
                    <button
                        type="button"
                        className="min-h-11 rounded-control border border-input bg-background px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={handleExport}
                        aria-label="진단 파일 내보내기"
                    >
                        <Download className="mr-2 inline h-4 w-4" aria-hidden="true" />
                        진단 내보내기
                    </button>
                    <button
                        type="button"
                        className="min-h-11 rounded-control border border-input bg-background px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => { void handleExit() }}
                        aria-label="앱 안전 종료"
                    >
                        <Power className="mr-2 inline h-4 w-4" aria-hidden="true" />
                        안전 종료
                    </button>
                </div>
            </section>
        </main>
    )
}
