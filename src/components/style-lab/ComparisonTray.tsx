import { GitCompareArrows, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { formatWeightedPromptTags } from '@/lib/style-lab'
import type { StyleCombination } from '@/stores/style-lab-store'

interface ComparisonTrayProps {
    comboIds: readonly string[]
    combinations: readonly StyleCombination[]
    disabled?: boolean
    onRemove: (comboId: string) => void
    onClear: () => void
    onCompare: () => void
}

/** Two selected candidates can enter Arena only through a recorded fair exposure. */
export function ComparisonTray({
    comboIds,
    combinations,
    disabled,
    onRemove,
    onClear,
    onCompare,
}: ComparisonTrayProps) {
    const { t } = useTranslation()
    if (comboIds.length === 0) return null
    const combinationsById = new Map(combinations.map(combo => [combo.id, combo]))
    const selected = comboIds
        .map(id => combinationsById.get(id))
        .filter((combo): combo is StyleCombination => combo !== undefined)

    return (
        <Card className="sticky bottom-3 z-20 border-primary/30 bg-card shadow-overlay">
            <CardContent className="flex min-w-0 flex-col gap-3 p-3 lg:flex-row lg:items-center">
                <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                    {selected.map(combo => (
                        <Badge key={combo.id} variant="secondary" className="max-w-full gap-1 py-1.5 pl-2 pr-1">
                            <span className="max-w-[260px] truncate">{formatWeightedPromptTags(combo.tags)}</span>
                            <button
                                type="button"
                                className="rounded-full p-0.5 hover:bg-background/70"
                                onClick={() => onRemove(combo.id)}
                                aria-label={t('styleLab.market.removeFromComparison')}
                            >
                                <X className="h-3 w-3" />
                            </button>
                        </Badge>
                    ))}
                    <span className="self-center text-xs text-muted-foreground">
                        {t('styleLab.market.comparisonCount', { count: selected.length })}
                    </span>
                </div>
                <div className="flex gap-2">
                    <Button size="sm" variant="ghost" className="rounded-xl" onClick={onClear} disabled={disabled}>
                        <Trash2 className="mr-1.5 h-4 w-4" />{t('styleLab.market.clearComparison')}
                    </Button>
                    <Button size="sm" className="rounded-xl" onClick={onCompare} disabled={disabled || selected.length !== 2}>
                        <GitCompareArrows className="mr-1.5 h-4 w-4" />{t('styleLab.market.compareNow')}
                    </Button>
                </div>
            </CardContent>
        </Card>
    )
}
