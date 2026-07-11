import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { useRef, useCallback, useEffect, PointerEvent } from "react"
import { useTranslation } from "react-i18next"
import { Download, Grid3X3, Minus, Plus } from "lucide-react"
import { save } from "@tauri-apps/plugin-dialog"
import { writeFile } from "@tauri-apps/plugin-fs"
import { toast } from "@/components/ui/use-toast"
import { useToolsStore } from '@/stores/tools-store'

interface MosaicDialogProps {
    sourceImage: string | null
    isOpen: boolean
    onClose: () => void
}

export function MosaicDialog({
    sourceImage,
    isOpen,
    onClose
}: MosaicDialogProps) {
    const { t } = useTranslation()
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const activePointerIdRef = useRef<number | null>(null)


    // Persisted state
    const {
        mosaicPixelSize: pixelSize,
        setMosaicPixelSize: setPixelSize,
        mosaicBrushSize: brushSize,
        setMosaicBrushSize: setBrushSize
    } = useToolsStore()

    // Track which grid cells have been mosaicked to prevent stacking
    const mosaickedCellsRef = useRef<Set<string>>(new Set())
    // Store original image pixels
    const originalImageDataRef = useRef<ImageData | null>(null)


    // Initialize canvas when dialog opens or image changes
    useEffect(() => {
        if (!isOpen) {
            activePointerIdRef.current = null
            return
        }
        if (!sourceImage) return

        // Small delay to ensure canvas is rendered
        const timer = setTimeout(() => {
            const canvas = canvasRef.current
            if (!canvas) {
                console.log("Canvas not ready")
                return
            }

            const ctx = canvas.getContext('2d')
            if (!ctx) {
                console.log("Context not ready")
                return
            }

            const img = new Image()
            img.crossOrigin = 'anonymous'
            img.onload = () => {
                console.log("Image loaded:", img.width, img.height)
                // Set canvas size to match image
                canvas.width = img.width
                canvas.height = img.height

                // Draw original image
                ctx.drawImage(img, 0, 0)

                // Store original image data for reference
                originalImageDataRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height)

                // Clear mosaicked regions tracking
                mosaickedCellsRef.current.clear()
            }
            img.onerror = (e) => {
                console.error("Image load error", e)
            }
            img.src = sourceImage
        }, 100)

        return () => clearTimeout(timer)
    }, [isOpen, sourceImage])

    const getCellKey = (cellX: number, cellY: number): string => {
        return `${cellX},${cellY}`
    }

    const applyMosaicToRegion = useCallback((clientX: number, clientY: number) => {
        const canvas = canvasRef.current
        if (!canvas || !originalImageDataRef.current) return

        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const rect = canvas.getBoundingClientRect()
        const scaleX = canvas.width / rect.width
        const scaleY = canvas.height / rect.height

        const centerX = (clientX - rect.left) * scaleX
        const centerY = (clientY - rect.top) * scaleY

        const halfBrush = brushSize / 2
        const startX = Math.max(0, centerX - halfBrush)
        const startY = Math.max(0, centerY - halfBrush)
        const endX = Math.min(canvas.width, centerX + halfBrush)
        const endY = Math.min(canvas.height, centerY + halfBrush)

        // Calculate grid-aligned positions
        const gridStartX = Math.floor(startX / pixelSize) * pixelSize
        const gridStartY = Math.floor(startY / pixelSize) * pixelSize

        const originalData = originalImageDataRef.current

        for (let py = gridStartY; py < endY; py += pixelSize) {
            for (let px = gridStartX; px < endX; px += pixelSize) {
                const cellX = Math.floor(px / pixelSize)
                const cellY = Math.floor(py / pixelSize)
                const cellKey = getCellKey(cellX, cellY)

                // Skip if this cell was already mosaicked
                if (mosaickedCellsRef.current.has(cellKey)) continue

                // Get the average color from the ORIGINAL image data
                const sampleX = Math.min(Math.floor(px), canvas.width - 1)
                const sampleY = Math.min(Math.floor(py), canvas.height - 1)
                const pixelIndex = (sampleY * canvas.width + sampleX) * 4

                const r = originalData.data[pixelIndex]
                const g = originalData.data[pixelIndex + 1]
                const b = originalData.data[pixelIndex + 2]
                const a = originalData.data[pixelIndex + 3]

                // Draw mosaic block
                ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`
                ctx.fillRect(px, py, pixelSize, pixelSize)

                // Mark this cell as mosaicked
                mosaickedCellsRef.current.add(cellKey)
            }
        }
    }, [pixelSize, brushSize])

    const handlePointerDown = useCallback((e: PointerEvent<HTMLCanvasElement>) => {
        if (activePointerIdRef.current !== null || (e.pointerType === 'mouse' && e.button !== 0)) return

        e.preventDefault()
        activePointerIdRef.current = e.pointerId
        e.currentTarget.setPointerCapture(e.pointerId)
        applyMosaicToRegion(e.clientX, e.clientY)
    }, [applyMosaicToRegion])

    const handlePointerMove = useCallback((e: PointerEvent<HTMLCanvasElement>) => {
        if (activePointerIdRef.current !== e.pointerId) return

        e.preventDefault()
        applyMosaicToRegion(e.clientX, e.clientY)
    }, [applyMosaicToRegion])

    const handlePointerEnd = useCallback((e: PointerEvent<HTMLCanvasElement>) => {
        if (activePointerIdRef.current !== e.pointerId) return

        activePointerIdRef.current = null
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId)
        }
    }, [])

    const handleReset = useCallback(() => {
        if (!canvasRef.current || !sourceImage) return

        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const img = new Image()
        img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height)
            ctx.drawImage(img, 0, 0)
            originalImageDataRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height)
            mosaickedCellsRef.current.clear()
        }
        img.src = sourceImage
    }, [sourceImage])

    const handleSaveAs = async () => {
        if (!canvasRef.current) return

        try {
            const filePath = await save({
                defaultPath: `mosaic_${Date.now()}.png`,
                filters: [{ name: 'PNG Image', extensions: ['png'] }]
            })

            if (!filePath) return

            const dataUrl = canvasRef.current.toDataURL('image/png')
            const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '')
            const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0))

            await writeFile(filePath, binaryData)

            toast({ title: t('common.saved', '저장되었습니다'), variant: 'success' })
            onClose()
        } catch (e) {
            console.error("Failed to save image", e)
            toast({ title: t('common.saveFailed', '저장 실패'), variant: 'destructive' })
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="flex h-[85dvh] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-5xl flex-col gap-3 overflow-hidden p-3 sm:w-[calc(100vw-2rem)] sm:p-6">
                <DialogHeader className="shrink-0 pr-10">
                    <DialogTitle className="flex min-w-0 items-center gap-2 text-lg sm:text-xl">
                        <Grid3X3 className="h-5 w-5" />
                        <span className="min-w-0 truncate">{t('smartTools.mosaicEditor', '모자이크 편집기')}</span>
                    </DialogTitle>
                    <DialogDescription>
                        {t('smartTools.mosaicEditorTouchDesc', '이미지 위를 드래그하여 모자이크를 적용하세요.')}
                    </DialogDescription>
                </DialogHeader>

                {/* Controls */}
                <div className="grid shrink-0 gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] xl:items-end">
                    <div className="min-w-0 space-y-1">
                        <Label className="text-sm">{t('smartTools.pixelSize', '픽셀 크기')}</Label>
                        <div className="flex min-w-0 items-center gap-2">
                            <Minus className="h-3 w-3 text-muted-foreground" />
                            <Slider
                                value={[pixelSize]}
                                onValueChange={(v) => setPixelSize(v[0])}
                                min={5}
                                max={30}
                                step={1}
                                aria-label={t('smartTools.pixelSize', '픽셀 크기')}
                                className="min-w-0 flex-1"
                            />
                            <Plus className="h-3 w-3 text-muted-foreground" />
                            <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">{pixelSize}</span>
                        </div>
                    </div>
                    <div className="min-w-0 space-y-1">
                        <Label className="text-sm">{t('smartTools.brushSize', '브러쉬 크기')}</Label>
                        <div className="flex min-w-0 items-center gap-2">
                            <Minus className="h-3 w-3 text-muted-foreground" />
                            <Slider
                                value={[brushSize]}
                                onValueChange={(v) => setBrushSize(v[0])}
                                min={20}
                                max={150}
                                step={5}
                                aria-label={t('smartTools.brushSize', '브러쉬 크기')}
                                className="min-w-0 flex-1"
                            />
                            <Plus className="h-3 w-3 text-muted-foreground" />
                            <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">{brushSize}</span>
                        </div>
                    </div>
                    <Button variant="outline" size="sm" className="w-full xl:w-auto" onClick={handleReset}>
                        {t('smartTools.reset', '초기화')}
                    </Button>
                </div>

                {/* Canvas Container */}
                <div
                    ref={containerRef}
                    className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-muted/50 p-2 sm:p-4"
                >
                    <canvas
                        ref={canvasRef}
                        className="touch-none cursor-crosshair"
                        style={{
                            imageRendering: 'pixelated',
                            maxWidth: '100%',
                            maxHeight: '100%',
                            width: 'auto',
                            height: 'auto',
                            objectFit: 'contain'
                        }}
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerEnd}
                        onPointerCancel={handlePointerEnd}
                        onLostPointerCapture={handlePointerEnd}
                    />
                </div>

                <DialogFooter className="shrink-0 gap-2 [&>button]:w-full sm:justify-end sm:[&>button]:w-auto">
                    <Button variant="outline" onClick={onClose}>
                        {t('common.cancel', '취소')}
                    </Button>
                    <Button onClick={handleSaveAs}>
                        <Download className="h-4 w-4 mr-2" />
                        {t('library.download', '저장')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
