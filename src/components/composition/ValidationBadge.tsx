import { AlertCircle, AlertTriangle, CheckCircle2, CircleDashed, Undo2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { CompositionEngineIssue, DeepReadonly } from '@/domain/composition'
import type { MainCompositionMode } from '@/lib/composition/main-adapter'

interface ValidationBadgeProps {
    mode: MainCompositionMode
    warnings: readonly DeepReadonly<CompositionEngineIssue>[]
    errors: readonly DeepReadonly<CompositionEngineIssue>[]
    hasPlan: boolean
    className?: string
}

export function ValidationBadge({
    mode,
    warnings,
    errors,
    hasPlan,
    className,
}: ValidationBadgeProps) {
    const { t } = useTranslation()

    if (mode === 'legacy') {
        return (
            <Badge
                variant="secondary"
                className={cn('gap-1', className)}
                role="status"
                data-testid="main-composition-validation"
            >
                <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                {t('composition.validation.legacy', 'Legacy')}
            </Badge>
        )
    }

    if (errors.length > 0) {
        return (
            <Badge
                variant="destructive"
                className={cn('gap-1', className)}
                role="status"
                aria-live="polite"
                data-testid="main-composition-validation"
            >
                <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                {t('composition.validation.errors', '{{count}} errors', { count: errors.length })}
            </Badge>
        )
    }

    if (warnings.length > 0) {
        return (
            <Badge
                variant="outline"
                className={cn('gap-1 border-warning/40 bg-warning/10 text-warning', className)}
                role="status"
                aria-live="polite"
                data-testid="main-composition-validation"
            >
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                {t('composition.validation.warnings', '{{count}} warnings', { count: warnings.length })}
            </Badge>
        )
    }

    if (hasPlan) {
        return (
            <Badge
                variant="outline"
                className={cn('gap-1 border-success/40 bg-success/10 text-success', className)}
                role="status"
                aria-live="polite"
                data-testid="main-composition-validation"
            >
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                {t('composition.validation.valid', 'Valid')}
            </Badge>
        )
    }

    return (
        <Badge
            variant="secondary"
            className={cn('gap-1', className)}
            role="status"
            data-testid="main-composition-validation"
        >
            <CircleDashed className="h-3.5 w-3.5" aria-hidden="true" />
            {t('composition.validation.pending', 'Not resolved')}
        </Badge>
    )
}
