import { KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'

export function CredentialVaultSettingsCard() {
    const { t } = useTranslation()
    const {
        vaultStatus,
        slot1CredentialRef,
        slot2CredentialRef,
        requestCredentialUnlock,
    } = useAuthStore()

    return (
        <div className="space-y-4 rounded-panel border border-border bg-card p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h4 className="flex items-center gap-2 font-medium">
                        <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
                        {t('credentialVault.title')}
                    </h4>
                    <p className="mt-1 text-xs text-muted-foreground">{t('credentialVault.description')}</p>
                </div>
                <Button onClick={requestCredentialUnlock}>
                    {vaultStatus === 'unlocked'
                        ? <KeyRound className="h-4 w-4" aria-hidden="true" />
                        : <LockKeyhole className="h-4 w-4" aria-hidden="true" />}
                    {t('credentialVault.manage')}
                </Button>
            </div>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
                <div className="rounded-control bg-muted/30 p-3">
                    <span className="font-medium">{t('credentialVault.slot1')}</span>
                    <span className="ml-2 text-muted-foreground">
                        {slot1CredentialRef === null
                            ? t('credentialVault.notRegistered')
                            : t('credentialVault.lastFour', { lastFour: slot1CredentialRef.lastFour })}
                    </span>
                </div>
                <div className="rounded-control bg-muted/30 p-3">
                    <span className="font-medium">{t('credentialVault.slot2')}</span>
                    <span className="ml-2 text-muted-foreground">
                        {slot2CredentialRef === null
                            ? t('credentialVault.notRegistered')
                            : t('credentialVault.lastFour', { lastFour: slot2CredentialRef.lastFour })}
                    </span>
                </div>
            </div>
        </div>
    )
}
