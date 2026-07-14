import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
    AlertTriangle,
    CheckCircle2,
    KeyRound,
    Loader2,
    LockKeyhole,
    RefreshCw,
    ShieldCheck,
    Trash2,
    UnlockKeyhole,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/use-toast'
import { cleanupLegacyCredentialBackups } from '@/services/credentials/legacy-credential-cleanup'
import { useAuthStore, type ApiSlot } from '@/stores/auth-store'
import { cn } from '@/lib/utils'

function errorTranslationKey(code: ReturnType<typeof useAuthStore.getState>['vaultErrorCode']): string | null {
    if (code === null) return null
    return `credentialVault.errors.${code}`
}

export function CredentialVaultDialog() {
    const { t } = useTranslation()
    const auth = useAuthStore()
    const [passphrase, setPassphrase] = useState('')
    const [slotSecrets, setSlotSecrets] = useState<Record<ApiSlot, string>>({ 1: '', 2: '' })
    const [deleteSlot, setDeleteSlot] = useState<ApiSlot | null>(null)
    const [cleanupConfirmation, setCleanupConfirmation] = useState(false)
    const [cleanupSummary, setCleanupSummary] = useState<string | null>(null)

    const clearInputs = () => {
        setPassphrase('')
        setSlotSecrets({ 1: '', 2: '' })
    }

    const handleOpenChange = (open: boolean) => {
        if (!open) clearInputs()
        auth.setVaultDialogOpen(open)
    }

    const handleUnlock = async () => {
        const candidate = passphrase
        setPassphrase('')
        const success = await auth.unlockVault(candidate)
        if (success) {
            toast({ title: t('credentialVault.unlocked'), variant: 'success' })
        }
    }

    const handleRegister = async (slot: ApiSlot) => {
        const candidate = slotSecrets[slot]
        setSlotSecrets(current => ({ ...current, [slot]: '' }))
        const success = await auth.verifyAndSave(candidate, slot)
        toast(success
            ? { title: t('credentialVault.saved'), variant: 'success' }
            : { title: t('credentialVault.verificationFailed'), variant: 'destructive' })
    }

    const handleReverify = async (slot: ApiSlot) => {
        const success = await auth.reverifyCredential(slot)
        toast(success
            ? { title: t('credentialVault.reverified'), variant: 'success' }
            : { title: t('credentialVault.verificationFailed'), variant: 'destructive' })
    }

    const handleDelete = async () => {
        if (deleteSlot === null) return
        try {
            await auth.deleteCredential(deleteSlot)
            setDeleteSlot(null)
            toast({ title: t('credentialVault.deleted'), variant: 'success' })
        } catch {
            toast({
                title: t('credentialVault.errors.operation-failed'),
                variant: 'destructive',
            })
        }
    }

    const handleSlotEnabled = async (slot: ApiSlot, enabled: boolean) => {
        try {
            await auth.setSlotEnabled(slot, enabled)
        } catch {
            toast({
                title: t('credentialVault.errors.operation-failed'),
                variant: 'destructive',
            })
        }
    }

    const handleCleanup = async () => {
        try {
            const result = await cleanupLegacyCredentialBackups()
            const summary = t('credentialVault.cleanupResult', {
                inspected: result.inspected,
                deleted: result.deleted,
                failed: result.failed,
            })
            setCleanupSummary(summary)
            toast({
                title: result.failed === 0
                    ? t('credentialVault.cleanupComplete')
                    : t('credentialVault.cleanupIncomplete'),
                description: summary,
                variant: result.failed === 0 ? 'success' : 'destructive',
            })
        } catch {
            toast({
                title: t('credentialVault.cleanupIncomplete'),
                variant: 'destructive',
            })
        }
    }

    const statusKey = auth.vaultStatus === 'unlocked'
        ? 'credentialVault.status.unlocked'
        : auth.vaultStatus === 'unlocking'
            ? 'credentialVault.status.unlocking'
            : auth.vaultStatus === 'unavailable'
                ? 'credentialVault.status.unavailable'
                : auth.vaultStatus === 'error'
                    ? 'credentialVault.status.error'
                    : 'credentialVault.status.locked'
    const translatedError = errorTranslationKey(auth.vaultErrorCode)

    return (
        <>
            <Dialog open={auth.vaultDialogOpen} onOpenChange={handleOpenChange}>
                <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 pr-10">
                            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
                            {t('credentialVault.title')}
                        </DialogTitle>
                        <DialogDescription>{t('credentialVault.description')}</DialogDescription>
                    </DialogHeader>

                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-border bg-muted/30 p-3">
                        <div className="flex items-center gap-2 text-sm font-medium">
                            {auth.vaultStatus === 'unlocked'
                                ? <UnlockKeyhole className="h-4 w-4 text-success" aria-hidden="true" />
                                : <LockKeyhole className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                            {t(statusKey)}
                        </div>
                        {auth.vaultStatus === 'unlocked' && (
                            <Button variant="outline" onClick={() => void auth.lockVault()}>
                                <LockKeyhole className="h-4 w-4" aria-hidden="true" />
                                {t('credentialVault.lock')}
                            </Button>
                        )}
                    </div>

                    {auth.credentialMigrationStatus === 'legacy-pending' && (
                        <div className="rounded-control border border-warning/40 bg-warning/10 p-3 text-sm text-warning" role="alert">
                            <p className="font-medium">{t('credentialVault.migrationRequired')}</p>
                            <p className="mt-1 text-xs">{t('credentialVault.migrationRequiredDescription')}</p>
                        </div>
                    )}

                    {translatedError !== null && (
                        <div className="rounded-control border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
                            {t(translatedError)}
                        </div>
                    )}

                    {auth.vaultStatus !== 'unlocked' ? (
                        <div className="space-y-3">
                            <label className="text-sm font-medium" htmlFor="credential-vault-passphrase">
                                {t('credentialVault.passphrase')}
                            </label>
                            <Input
                                id="credential-vault-passphrase"
                                type="password"
                                autoComplete="current-password"
                                value={passphrase}
                                onChange={event => setPassphrase(event.target.value)}
                                disabled={auth.vaultStatus === 'unavailable' || auth.vaultStatus === 'unlocking'}
                            />
                            <Button
                                className="w-full"
                                onClick={() => void handleUnlock()}
                                disabled={passphrase.length === 0 || auth.vaultStatus === 'unavailable' || auth.vaultStatus === 'unlocking'}
                            >
                                {auth.vaultStatus === 'unlocking'
                                    ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                                    : <KeyRound className="h-4 w-4" aria-hidden="true" />}
                                {auth.vaultExists ? t('credentialVault.unlock') : t('credentialVault.create')}
                            </Button>
                            <p className="text-xs text-muted-foreground">{t('credentialVault.passphraseSessionOnly')}</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {([1, 2] as const).map(slot => {
                                const ref = slot === 2 ? auth.slot2CredentialRef : auth.slot1CredentialRef
                                const enabled = slot === 2 ? auth.slot2Enabled : auth.slot1Enabled
                                const verified = slot === 2 ? auth.isVerified2 : auth.isVerified
                                const tier = slot === 2 ? auth.tier2 : auth.tier
                                return (
                                    <section key={slot} className="space-y-3 rounded-panel border border-border bg-card p-4">
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                            <div className="min-w-0">
                                                <h3 className="font-medium">{t(`credentialVault.slot${slot}`)}</h3>
                                                <p className="mt-1 text-xs text-muted-foreground">
                                                    {ref === null
                                                        ? t('credentialVault.notRegistered')
                                                        : t('credentialVault.lastFour', { lastFour: ref.lastFour })}
                                                </p>
                                            </div>
                                            {ref !== null && (
                                                <div className="flex items-center gap-2">
                                                    {verified && <CheckCircle2 className="h-4 w-4 text-success" aria-label={t('credentialVault.verified')} />}
                                                    <span className="text-xs text-muted-foreground">{tier ?? t('credentialVault.tierUnknown')}</span>
                                                    <Switch
                                                        checked={enabled}
                                                        onChange={event => void handleSlotEnabled(slot, event.target.checked)}
                                                        aria-label={t('credentialVault.slotEnabled', { slot })}
                                                    />
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex flex-col gap-2 sm:flex-row">
                                            <Input
                                                type="password"
                                                autoComplete="new-password"
                                                placeholder={t('credentialVault.secretPlaceholder')}
                                                value={slotSecrets[slot]}
                                                onChange={event => setSlotSecrets(current => ({
                                                    ...current,
                                                    [slot]: event.target.value,
                                                }))}
                                            />
                                            <Button
                                                onClick={() => void handleRegister(slot)}
                                                disabled={slotSecrets[slot].trim().length === 0 || auth.isLoading}
                                            >
                                                {ref === null ? t('credentialVault.register') : t('credentialVault.replace')}
                                            </Button>
                                        </div>

                                        {ref !== null && (
                                            <div className="flex flex-wrap gap-2">
                                                <Button variant="outline" onClick={() => void handleReverify(slot)} disabled={auth.isLoading}>
                                                    <RefreshCw className={cn('h-4 w-4', auth.isLoading && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
                                                    {t('credentialVault.reverify')}
                                                </Button>
                                                <Button variant="outline" onClick={() => setDeleteSlot(slot)} disabled={auth.isLoading}>
                                                    <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                                                    {t('credentialVault.delete')}
                                                </Button>
                                            </div>
                                        )}
                                    </section>
                                )
                            })}
                        </div>
                    )}

                    <div className="rounded-control border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                        <div className="flex gap-2">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                            <div>
                                <p className="font-medium">{t('credentialVault.legacyBackupWarning')}</p>
                                <p className="mt-1 text-xs">{t('credentialVault.legacyBackupWarningDescription')}</p>
                            </div>
                        </div>
                        <Button variant="outline" className="mt-3" onClick={() => setCleanupConfirmation(true)}>
                            {t('credentialVault.cleanupAction')}
                        </Button>
                        {cleanupSummary !== null && <p className="mt-2 text-xs">{cleanupSummary}</p>}
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => handleOpenChange(false)}>
                            {t('common.close', 'Close')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <ConfirmDialog
                open={deleteSlot !== null}
                onOpenChange={open => { if (!open) setDeleteSlot(null) }}
                title={t('credentialVault.deleteConfirmation')}
                description={t('credentialVault.deleteConfirmationDescription')}
                confirmText={t('credentialVault.delete')}
                variant="destructive"
                onConfirm={handleDelete}
            />
            <ConfirmDialog
                open={cleanupConfirmation}
                onOpenChange={setCleanupConfirmation}
                title={t('credentialVault.cleanupConfirmation')}
                description={t('credentialVault.cleanupConfirmationDescription')}
                confirmText={t('credentialVault.cleanupAction')}
                variant="destructive"
                onConfirm={handleCleanup}
            />
        </>
    )
}
