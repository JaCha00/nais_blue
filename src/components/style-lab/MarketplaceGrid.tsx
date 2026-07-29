import { toNativeAssetUrl } from '@/platform/asset-url'
import {
    EyeOff,
    GitCompareArrows,
    Heart,
    ImagePlus,
    Library,
    Sparkles,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type {
    MarketplaceShelfItem,
    PreferenceProjection,
} from '@/domain/style-lab'
import { formatWeightedPromptTags } from '@/lib/style-lab'
import { cn } from '@/lib/utils'
import type { StyleCombination } from '@/stores/style-lab-store'

interface MarketplaceGridProps {
    items: readonly MarketplaceShelfItem[]
    combinations: readonly StyleCombination[]
    projections: Readonly<Record<string, PreferenceProjection>>
    likedIds: ReadonlySet<string>
    collectedIds: ReadonlySet<string>
    hiddenIds: ReadonlySet<string>
    comparisonTrayIds: readonly string[]
    disabled?: boolean
    onLike: (comboId: string) => void
    onCollect: (comboId: string) => void
    onHide: (comboId: string) => void
    onApply: (comboId: string) => void
    onCompare: (comboId: string) => void
    onPreview: (comboId: string) => void
}

function previewSource(combo: StyleCombination): string | null {
    if (combo.previewImage) return combo.previewImage
    if (combo.previewPath && !combo.previewPath.startsWith('memory://')) return toNativeAssetUrl(combo.previewPath)
    return combo.previewThumbnail ?? null
}

/** Marketplace cards explain the policy role and expose only semantic actions. */
export function MarketplaceGrid({
    items,
    combinations,
    projections,
    likedIds,
    collectedIds,
    hiddenIds,
    comparisonTrayIds,
    disabled,
    onLike,
    onCollect,
    onHide,
    onApply,
    onCompare,
    onPreview,
}: MarketplaceGridProps) {
    const { t } = useTranslation()
    const combinationsById = new Map(combinations.map(combo => [combo.id, combo]))

    return (
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {items.map(item => {
                const combo = combinationsById.get(item.comboId)
                if (!combo) return null
                const source = previewSource(combo)
                const projection = projections[combo.id]
                const liked = likedIds.has(combo.id)
                const collected = collectedIds.has(combo.id)
                const hidden = hiddenIds.has(combo.id)
                const comparing = comparisonTrayIds.includes(combo.id)
                return (
                    <Card key={combo.id} className="min-w-0 overflow-hidden border-border/60 bg-card/70">
                        <div className="relative aspect-[4/3] bg-muted/30">
                            {source ? (
                                <img src={source} alt={t('styleLab.card.previewAlt')} className="h-full w-full object-cover" />
                            ) : (
                                <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                                    <ImagePlus className="h-8 w-8" />
                                    <span className="text-xs">{t('styleLab.card.noPreview')}</span>
                                </div>
                            )}
                            <div className="absolute inset-x-2 top-2 flex items-start justify-between gap-2">
                                <Badge variant="secondary" className="bg-popover/95">
                                    {t(`styleLab.market.buckets.${item.bucket}`)}
                                </Badge>
                                {combo.previewContextId && (
                                    <Badge variant="outline" className="bg-popover/95">
                                        {t('styleLab.market.verified')}
                                    </Badge>
                                )}
                            </div>
                        </div>
                        <CardContent className="min-w-0 space-y-3 p-3">
                            <div className="space-y-1">
                                <p className="text-sm font-medium text-foreground">
                                    {t(`styleLab.market.reasons.${item.reason}`)}
                                </p>
                                <p className="line-clamp-3 break-words font-mono text-xs leading-5 text-muted-foreground">
                                    {formatWeightedPromptTags(combo.tags)}
                                </p>
                            </div>
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>{t('styleLab.common.generationShort')} {combo.generation}</span>
                                <span>{projection ? `${projection.evidence.toFixed(1)} · σ ${projection.sigma.toFixed(2)}` : '—'}</span>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                <Button
                                    size="sm"
                                    variant={liked ? 'default' : 'outline'}
                                    className="rounded-xl"
                                    disabled={disabled}
                                    title={t('styleLab.market.like')}
                                    onClick={() => onLike(combo.id)}
                                >
                                    <Heart className={cn('h-4 w-4', liked && 'fill-current')} />
                                </Button>
                                <Button
                                    size="sm"
                                    variant={collected ? 'default' : 'outline'}
                                    className="rounded-xl"
                                    disabled={disabled}
                                    title={t('styleLab.market.collect')}
                                    onClick={() => onCollect(combo.id)}
                                >
                                    <Library className="h-4 w-4" />
                                </Button>
                                <Button
                                    size="sm"
                                    variant={hidden ? 'default' : 'outline'}
                                    className="rounded-xl"
                                    disabled={disabled}
                                    title={t(hidden ? 'styleLab.market.unhide' : 'styleLab.market.hide')}
                                    onClick={() => onHide(combo.id)}
                                >
                                    <EyeOff className="h-4 w-4" />
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="rounded-xl"
                                    disabled={disabled}
                                    title={t('styleLab.market.apply')}
                                    onClick={() => onApply(combo.id)}
                                >
                                    <Sparkles className="h-4 w-4" />
                                </Button>
                                <Button
                                    size="sm"
                                    variant={comparing ? 'default' : 'outline'}
                                    className="rounded-xl"
                                    disabled={disabled}
                                    title={t('styleLab.market.compare')}
                                    onClick={() => onCompare(combo.id)}
                                >
                                    <GitCompareArrows className="h-4 w-4" />
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="rounded-xl"
                                    disabled={disabled || combo.isPreviewing}
                                    title={t('styleLab.market.preview')}
                                    onClick={() => onPreview(combo.id)}
                                >
                                    <ImagePlus className="h-4 w-4" />
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                )
            })}
        </div>
    )
}
