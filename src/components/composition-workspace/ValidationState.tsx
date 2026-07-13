import {
    AlertCircle,
    AlertTriangle,
    CheckCircle2,
    CircleDashed,
    LoaderCircle,
    ShieldAlert,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CompositionValidationSummary } from './types'

export interface ValidationStateProps {
    validation: CompositionValidationSummary
    className?: string
    compact?: boolean
}

const DEFAULT_LABELS: Record<CompositionValidationSummary['severity'], string> = {
    valid: 'Valid',
    warning: 'Warning',
    error: 'Error',
    loading: 'Validating',
    conflict: 'Conflict',
    disabled: 'Disabled',
}

export function ValidationState({ validation, className, compact = false }: ValidationStateProps) {
    const label = validation.label ?? DEFAULT_LABELS[validation.severity]
    const count = validation.severity === 'error'
        ? validation.errorCount
        : validation.severity === 'warning'
            ? validation.warningCount
            : undefined
    const Icon = validation.severity === 'valid'
        ? CheckCircle2
        : validation.severity === 'warning'
            ? AlertTriangle
            : validation.severity === 'error'
                ? AlertCircle
                : validation.severity === 'conflict'
                    ? ShieldAlert
                    : validation.severity === 'loading'
                        ? LoaderCircle
                        : CircleDashed

    return (
        <span
            className={cn(
                'inline-flex min-w-0 items-center gap-1 text-xs font-medium',
                validation.severity === 'valid' && 'text-success',
                validation.severity === 'warning' && 'text-warning',
                validation.severity === 'error' && 'text-destructive',
                validation.severity === 'conflict' && 'text-destructive',
                (validation.severity === 'loading' || validation.severity === 'disabled') && 'text-muted-foreground',
                className,
            )}
            role="status"
            aria-live={validation.severity === 'error' || validation.severity === 'conflict' ? 'assertive' : 'polite'}
            data-severity={validation.severity}
        >
            <Icon
                className={cn('h-4 w-4 shrink-0', validation.severity === 'loading' && 'animate-spin motion-reduce:animate-none')}
                aria-hidden="true"
            />
            {!compact && <span className="min-w-0 truncate">{label}</span>}
            {count !== undefined && count > 0 && <span aria-label={`${count}`}>{count}</span>}
            {compact && <span className="sr-only">{label}{count ? ` ${count}` : ''}</span>}
        </span>
    )
}
