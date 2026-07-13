import { CheckCircle2, CircleSlash2, Info } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { RuntimeCapability } from '@/platform/capabilities'

export interface CapabilityBadgeLabels {
    available: string
    unavailable: string
    alternative: string
}

const DEFAULT_LABELS: CapabilityBadgeLabels = {
    available: 'Available',
    unavailable: 'Unavailable on this platform',
    alternative: 'Alternative',
}

export function CapabilityBadge({
    label,
    capability,
    labels: labelsOverride,
    className,
}: {
    label: string
    capability: RuntimeCapability
    labels?: Partial<CapabilityBadgeLabels>
    className?: string
}) {
    const labels = { ...DEFAULT_LABELS, ...labelsOverride }
    const Icon = capability.supported ? CheckCircle2 : CircleSlash2
    return (
        <Badge
            variant="outline"
            className={cn(
                'max-w-full gap-1.5 whitespace-normal rounded-control px-2 py-1 text-left',
                capability.supported
                    ? 'border-success/40 text-success'
                    : 'border-warning/50 text-warning',
                className,
            )}
            role="status"
            aria-label={`${label}: ${capability.supported ? labels.available : labels.unavailable}`}
        >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">{label}</span>
        </Badge>
    )
}

/** Visible explanation for unsupported features; never silently substitutes behavior. */
export function CapabilityNotice({
    label,
    capability,
    labels: labelsOverride,
    reason,
    alternative,
    className,
}: {
    label: string
    capability: RuntimeCapability
    labels?: Partial<CapabilityBadgeLabels>
    reason?: string
    alternative?: string
    className?: string
}) {
    const labels = { ...DEFAULT_LABELS, ...labelsOverride }
    return (
        <section
            className={cn('min-w-0 border-l-2 px-3 py-2', capability.supported ? 'border-l-success' : 'border-l-warning bg-warning/5', className)}
            data-capability-supported={capability.supported ? 'true' : 'false'}
        >
            <CapabilityBadge label={label} capability={capability} labels={labels} />
            {!capability.supported && (
                <div className="mt-2 min-w-0 text-xs leading-relaxed text-muted-foreground">
                    <p className="break-words">{reason ?? capability.reason ?? labels.unavailable}</p>
                    <p className="mt-1 flex min-w-0 items-start gap-1.5 text-foreground">
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span className="min-w-0 break-words">
                            <strong>{labels.alternative}:</strong>{' '}
                            {alternative ?? capability.alternative}
                        </span>
                    </p>
                </div>
            )}
        </section>
    )
}
