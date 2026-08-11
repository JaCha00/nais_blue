import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRightLeft } from 'lucide-react'

import { Input } from '@/components/ui/input'
import type { AnlasPricingBasis } from '@/domain/queue/anlas-cost-consent'

const RESOLUTION_GRID = 64
const MIN_RESOLUTION_SIDE = 64
const MAX_RESOLUTION_SIDE = 8_192

export function normalizeGuidedResolutionSide(value: number, fallback: number): number {
    if (!Number.isFinite(value)) return fallback
    return Math.min(
        MAX_RESOLUTION_SIDE,
        Math.max(MIN_RESOLUTION_SIDE, Math.round(value / RESOLUTION_GRID) * RESOLUTION_GRID),
    )
}

interface GuidedResolutionDetailsProps {
    readonly width: number
    readonly height: number
    readonly steps: number
    readonly imageCount: number
    readonly estimatedAnlas: number | null
    readonly pricingBasis: AnlasPricingBasis
    readonly disabled?: boolean
    readonly onChange: (width: number, height: number) => void
}

export function GuidedResolutionDetails({
    width,
    height,
    steps,
    imageCount,
    estimatedAnlas,
    pricingBasis,
    disabled = false,
    onChange,
}: GuidedResolutionDetailsProps) {
    const { t } = useTranslation()
    const [widthInput, setWidthInput] = useState(String(width))
    const [heightInput, setHeightInput] = useState(String(height))

    useEffect(() => setWidthInput(String(width)), [width])
    useEffect(() => setHeightInput(String(height)), [height])

    const commit = () => {
        const nextWidth = normalizeGuidedResolutionSide(Number(widthInput), width)
        const nextHeight = normalizeGuidedResolutionSide(Number(heightInput), height)
        setWidthInput(String(nextWidth))
        setHeightInput(String(nextHeight))
        if (nextWidth !== width || nextHeight !== height) onChange(nextWidth, nextHeight)
    }

    const swap = () => {
        setWidthInput(String(height))
        setHeightInput(String(width))
        if (width !== height) onChange(height, width)
    }

    const withinOpusFreeBoundary = width * height <= 1_048_576 && steps <= 28
    const costReason = estimatedAnlas === null
        ? t('guided.resolutionDetails.pending', '값을 입력하면 현재 Steps와 함께 예상 비용을 계산해 드려요.')
        : pricingBasis === 'all-active-opus' && withinOpusFreeBoundary
        ? t('guided.resolutionDetails.free', '1024² 이하 · Steps 28 이하라 현재 기본 생성 비용은 0 Anlas예요.')
        : t('guided.resolutionDetails.paid', '픽셀 면적과 Steps가 함께 계산돼요. 둘 중 하나를 높이면 예상 비용도 늘어납니다.')

    return (
        <section className="border-y border-border/60 py-5" aria-labelledby="guided-resolution-details-title">
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
                <div>
                    <h3 id="guided-resolution-details-title" className="text-base font-semibold">
                        {t('guided.resolutionDetails.title', '세부 해상도')}
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        {t('guided.resolutionDetails.description', '가로와 세로를 직접 입력할 수 있어요. 값은 NAI 규격에 맞춰 64픽셀 단위로 정리됩니다.')}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={swap}
                    disabled={disabled}
                    className="inline-flex min-h-11 items-center gap-2 border-b border-transparent px-2 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                >
                    <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />
                    {t('guided.resolutionDetails.swap', '가로·세로 바꾸기')}
                </button>
            </div>

            <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-3 sm:max-w-xl">
                <label className="min-w-0 text-sm font-medium">
                    {t('guided.resolutionDetails.width', '가로')}
                    <Input
                        type="number"
                        inputMode="numeric"
                        min={MIN_RESOLUTION_SIDE}
                        max={MAX_RESOLUTION_SIDE}
                        step={RESOLUTION_GRID}
                        value={widthInput}
                        disabled={disabled}
                        onChange={event => setWidthInput(event.target.value)}
                        onBlur={commit}
                        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
                        className="mt-2 rounded-none border-x-0 border-t-0 bg-transparent px-1 font-mono text-lg"
                        aria-label={t('guided.resolutionDetails.widthPixels', '가로 픽셀')}
                    />
                </label>
                <span className="pb-3 text-sm text-muted-foreground" aria-hidden="true">×</span>
                <label className="min-w-0 text-sm font-medium">
                    {t('guided.resolutionDetails.height', '세로')}
                    <Input
                        type="number"
                        inputMode="numeric"
                        min={MIN_RESOLUTION_SIDE}
                        max={MAX_RESOLUTION_SIDE}
                        step={RESOLUTION_GRID}
                        value={heightInput}
                        disabled={disabled}
                        onChange={event => setHeightInput(event.target.value)}
                        onBlur={commit}
                        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
                        className="mt-2 rounded-none border-x-0 border-t-0 bg-transparent px-1 font-mono text-lg"
                        aria-label={t('guided.resolutionDetails.heightPixels', '세로 픽셀')}
                    />
                </label>
            </div>

            <div className="mt-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-t border-border/45 pt-4" aria-live="polite">
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{costReason}</p>
                <p className="whitespace-nowrap text-right">
                    <span className="font-mono text-lg font-semibold text-primary">
                        {estimatedAnlas === null ? '—' : estimatedAnlas.toLocaleString()} Anlas
                    </span>
                    <span className="ml-2 text-sm text-muted-foreground">
                        {t('guided.resolutionDetails.quote', '{{count}}장 · Steps {{steps}}', { count: imageCount, steps })}
                    </span>
                </p>
            </div>
        </section>
    )
}
