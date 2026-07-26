import { useId } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { REMOTE_IMAGE_PROCESSING_POLICY_VERSION } from '@/services/privacy/remote-image-processing'
import { useSettingsStore } from '@/stores/settings-store'

interface RemoteImageProcessingConsentProps {
    className?: string
}

/**
 * Depends on the versioned settings acknowledgement and is shared by every UI
 * that calls public Hugging Face Spaces. The explicit checkbox explains the
 * data boundary and persists a reversible first-use decision.
 */
export function RemoteImageProcessingConsent({ className }: RemoteImageProcessingConsentProps) {
    const { t } = useTranslation()
    const checkboxId = useId()
    const consentVersion = useSettingsStore(state => state.remoteImageProcessingConsentVersion)
    const setConsentVersion = useSettingsStore(state => state.setRemoteImageProcessingConsentVersion)
    const accepted = consentVersion >= REMOTE_IMAGE_PROCESSING_POLICY_VERSION

    return (
        <div className={cn('rounded-control border border-border bg-muted/25 p-3', className)} role="note">
            <div className="flex items-start gap-2.5">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <div className="min-w-0 space-y-2">
                    <div>
                        <p className="text-sm font-medium">{t('smartTools.remoteProcessingTitle')}</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {t('smartTools.remoteProcessingDescription')}
                        </p>
                    </div>
                    <label htmlFor={checkboxId} className="flex min-h-11 cursor-pointer items-center gap-2 text-xs leading-relaxed">
                        <Checkbox
                            id={checkboxId}
                            checked={accepted}
                            onCheckedChange={checked => setConsentVersion(
                                checked === true ? REMOTE_IMAGE_PROCESSING_POLICY_VERSION : 0,
                            )}
                        />
                        <span>{t('smartTools.remoteProcessingConsent')}</span>
                    </label>
                </div>
            </div>
        </div>
    )
}
