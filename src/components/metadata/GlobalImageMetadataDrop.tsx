import { useEffect, useRef, useState } from 'react'
import { ImagePlus, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'

import { toast } from '@/components/ui/use-toast'
import { parseMetadataFromFile } from '@/lib/metadata-parser'
import {
    applyMetadataPreview,
    createMetadataApplyPreview,
} from '@/services/output/metadata-apply'
import { useLayoutStore } from '@/stores/layout-store'
import { usePresetStore } from '@/stores/preset-store'
import {
    dispatchGuidedGlobalPromptImport,
} from '@/presentation/workflow/guided-draft-events'
import {
    guidedPromptImportFromMetadata,
} from '@/presentation/workflow/guided-prompt-import'

const MAX_GLOBAL_IMAGE_BYTES = 50 * 1024 * 1024
const LOCAL_FILE_DROP_SELECTOR = '[data-local-file-drop]'

export type GlobalImageDropTarget =
    | { readonly kind: 'single'; readonly draftId: string }
    | { readonly kind: 'batch'; readonly draftId: string }
    | { readonly kind: 'advanced' }

export function resolveGlobalImageDropTarget(pathname: string): GlobalImageDropTarget {
    const single = /^\/guided-preview\/work\/([^/]+)(?:\/|$)/u.exec(pathname)
    if (single) return { kind: 'single', draftId: single[1] }
    const batch = /^\/guided-preview\/batch\/([^/]+)(?:\/|$)/u.exec(pathname)
    if (batch) return { kind: 'batch', draftId: batch[1] }
    return { kind: 'advanced' }
}

export function isGlobalMetadataImageCandidate(
    file: Pick<File, 'name' | 'size' | 'type'>,
): boolean {
    const mime = file.type.toLowerCase()
    const supportedMime = mime === 'image/png' || mime === 'image/webp' || mime === 'image/jpeg'
    return Number.isSafeInteger(file.size)
        && file.size > 0
        && file.size <= MAX_GLOBAL_IMAGE_BYTES
        && (supportedMime || /\.(?:png|webp|jpe?g)$/iu.test(file.name))
}

function hasDraggedFiles(dataTransfer: DataTransfer | null): boolean {
    return dataTransfer !== null && Array.from(dataTransfer.types).includes('Files')
}

/** Explicit local upload/edit surfaces own file drops before the app-wide metadata importer. */
export function isLocalFileDropTarget(target: EventTarget | null): boolean {
    return target !== null
        && typeof (target as Element).closest === 'function'
        && (target as Element).closest(LOCAL_FILE_DROP_SELECTOR) !== null
}

/** App-owned metadata drop target; explicit local drop zones keep precedence. */
export function GlobalImageMetadataDrop() {
    const { t } = useTranslation()
    const location = useLocation()
    const navigate = useNavigate()
    const pathnameRef = useRef(location.pathname)
    const dragDepthRef = useRef(0)
    const busyRef = useRef(false)
    const [phase, setPhase] = useState<'idle' | 'dragging' | 'loading'>('idle')

    useEffect(() => {
        pathnameRef.current = location.pathname
    }, [location.pathname])

    useEffect(() => {
        let disposed = false

        const resetDrag = () => {
            dragDepthRef.current = 0
            if (!busyRef.current && !disposed) setPhase('idle')
        }
        const handleDragEnter = (event: DragEvent) => {
            if (isLocalFileDropTarget(event.target)) {
                resetDrag()
                return
            }
            if (event.defaultPrevented || !hasDraggedFiles(event.dataTransfer)) return
            event.preventDefault()
            dragDepthRef.current += 1
            if (!busyRef.current) setPhase('dragging')
        }
        const handleDragOver = (event: DragEvent) => {
            if (isLocalFileDropTarget(event.target)) {
                resetDrag()
                return
            }
            if (event.defaultPrevented || !hasDraggedFiles(event.dataTransfer)) return
            event.preventDefault()
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
        }
        const handleDragLeave = (event: DragEvent) => {
            if (isLocalFileDropTarget(event.target)) {
                resetDrag()
                return
            }
            if (event.defaultPrevented || !hasDraggedFiles(event.dataTransfer)) return
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
            if (dragDepthRef.current === 0 && !busyRef.current) setPhase('idle')
        }
        const handleDrop = (event: DragEvent) => {
            if (isLocalFileDropTarget(event.target)) {
                resetDrag()
                return
            }
            if (event.defaultPrevented || busyRef.current) return
            const file = Array.from(event.dataTransfer?.files ?? [])
                .find(isGlobalMetadataImageCandidate)
            if (!file) {
                if (hasDraggedFiles(event.dataTransfer)) {
                    event.preventDefault()
                    toast({
                        title: t('metadata.invalidFile', '잘못된 파일'),
                        description: t('metadata.globalImageOnly', 'PNG, WebP 또는 JPEG 이미지 한 장을 놓아 주세요.'),
                        variant: 'destructive',
                    })
                }
                resetDrag()
                return
            }

            event.preventDefault()
            const target = resolveGlobalImageDropTarget(pathnameRef.current)
            busyRef.current = true
            dragDepthRef.current = 0
            setPhase('loading')

            void parseMetadataFromFile(file).then(async metadata => {
                if (metadata === null) throw new TypeError('No prompt metadata was found')
                const imported = guidedPromptImportFromMetadata(metadata, file.name)
                if (imported === null) throw new TypeError('No prompt metadata was found')

                if (target.kind === 'single' || target.kind === 'batch') {
                    const handled = dispatchGuidedGlobalPromptImport({
                        kind: target.kind,
                        draftId: target.draftId,
                        value: imported,
                    })
                    if (!handled) throw new Error('The active Guided draft did not accept the import')
                    return
                }

                const presetId = usePresetStore.getState().activePresetId
                const preview = createMetadataApplyPreview(metadata, {
                    targetPresetId: presetId,
                    prompts: true,
                    parameters: false,
                    resolution: false,
                    seed: false,
                    characterPrompts: true,
                    vibeTransfer: false,
                })
                await applyMetadataPreview(preview)
                navigate('/advanced')
                useLayoutStore.getState().openSupportSheet('prompt')
                toast({
                    title: t('metadata.globalApplied', '프롬프트를 불러왔어요.'),
                    description: t('metadata.globalAdvanced', '고급 생성의 프롬프트 작성 화면으로 이동했어요.'),
                    variant: 'success',
                })
            }).catch(() => {
                toast({
                    title: t('metadata.noData', '메타데이터 없음'),
                    description: t('metadata.globalNoPrompt', '이 이미지에서 불러올 프롬프트 메타데이터를 찾지 못했어요.'),
                    variant: 'destructive',
                })
            }).finally(() => {
                busyRef.current = false
                if (!disposed) setPhase('idle')
            })
        }

        window.addEventListener('dragenter', handleDragEnter)
        window.addEventListener('dragover', handleDragOver)
        window.addEventListener('dragleave', handleDragLeave)
        window.addEventListener('drop', handleDrop)
        window.addEventListener('blur', resetDrag)
        document.addEventListener('drop', resetDrag, true)
        return () => {
            disposed = true
            window.removeEventListener('dragenter', handleDragEnter)
            window.removeEventListener('dragover', handleDragOver)
            window.removeEventListener('dragleave', handleDragLeave)
            window.removeEventListener('drop', handleDrop)
            window.removeEventListener('blur', resetDrag)
            document.removeEventListener('drop', resetDrag, true)
        }
    }, [navigate, t])

    if (phase === 'idle') return null
    return (
        <div className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center bg-scrim/70 p-4" role="status" aria-live="polite">
            <div className="w-full max-w-md rounded-panel border-2 border-primary bg-card p-6 text-center shadow-overlay sm:p-8">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-panel bg-accent text-primary">
                    {phase === 'loading'
                        ? <LoaderCircle className="h-7 w-7 animate-spin" aria-hidden="true" />
                        : <ImagePlus className="h-7 w-7" aria-hidden="true" />}
                </div>
                <p className="text-lg font-semibold text-foreground">
                    {phase === 'loading'
                        ? t('metadata.globalReading', '메타데이터를 읽고 있어요…')
                        : t('metadata.dropToLoad', '이미지를 드롭하여 메타데이터 불러오기')}
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {t('metadata.globalDropHelp', '현재 초안을 유지한 채 프롬프트 작성 단계로 이동합니다.')}
                </p>
            </div>
        </div>
    )
}
