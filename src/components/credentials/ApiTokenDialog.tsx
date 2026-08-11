import { useState } from 'react'
import { CheckCircle2, KeyRound, RefreshCw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

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
import { cn } from '@/lib/utils'
import { runtimeCapabilities } from '@/platform/capabilities'
import { useAuthStore, type ApiSlot } from '@/stores/auth-store'

/** Shared inline authority used by both the dialog and the Guided credential task. */
export function ApiTokenManager() {
    const { t } = useTranslation()
    const auth = useAuthStore()
    const [slotSecrets, setSlotSecrets] = useState<Record<ApiSlot, string>>({ 1: '', 2: '' })
    const [deleteSlot, setDeleteSlot] = useState<ApiSlot | null>(null)

    const saveSlot = async (slot: ApiSlot) => {
        const candidate = slotSecrets[slot]
        const success = await auth.verifyAndSave(candidate, slot)
        if (success) setSlotSecrets(current => ({ ...current, [slot]: '' }))
        toast(success
            ? { title: t('settingsPage.api.saved', 'API 토큰을 저장했습니다.'), variant: 'success' }
            : { title: t('settingsPage.api.verificationFailed', 'API 토큰을 확인하지 못했습니다.'), variant: 'destructive' })
    }

    const deleteSelected = async () => {
        if (deleteSlot === null) return
        await auth.deleteCredential(deleteSlot)
        setDeleteSlot(null)
        toast({ title: t('settingsPage.api.deleted', 'API 토큰을 삭제했습니다.'), variant: 'success' })
    }

    return (
        <div className="border-y border-border/60" data-testid="api-token-manager">
            {([1, 2] as const).map(slot => {
                const token = slot === 2 ? auth.token2 : auth.token
                const enabled = slot === 2 ? auth.slot2Enabled : auth.slot1Enabled
                const verified = slot === 2 ? auth.isVerified2 : auth.isVerified
                const tier = slot === 2 ? auth.tier2 : auth.tier
                return (
                    <section key={slot} className="space-y-3 border-t border-border/45 px-1 py-5 first:border-t-0 sm:px-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h3 className="font-medium">{t('settingsPage.api.slot', '토큰 {{slot}}', { slot })}</h3>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    {token ? `•••• ${token.slice(-4)}` : t('settingsPage.api.notRegistered', '등록되지 않음')}
                                </p>
                            </div>
                            {token && (
                                <div className="flex min-h-11 items-center gap-2">
                                    {verified && <CheckCircle2 className="h-4 w-4 text-success" aria-label={t('settingsPage.api.verified', '확인됨')} />}
                                    <span className="text-sm text-muted-foreground">{tier ?? '-'}</span>
                                    <Switch
                                        checked={enabled}
                                        onChange={event => void auth.setSlotEnabled(slot, event.target.checked)}
                                        aria-label={t('settingsPage.api.slotEnabled', '토큰 {{slot}} 사용', { slot })}
                                    />
                                </div>
                            )}
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <Input
                                type="password"
                                autoComplete="off"
                                placeholder={t('settingsPage.api.tokenPlaceholder', 'NovelAI API 토큰 입력')}
                                value={slotSecrets[slot]}
                                onChange={event => setSlotSecrets(current => ({ ...current, [slot]: event.target.value }))}
                                aria-label={t('settingsPage.api.slotTokenInput', '토큰 {{slot}} 입력', { slot })}
                            />
                            <Button onClick={() => void saveSlot(slot)} disabled={!slotSecrets[slot].trim() || auth.isLoading}>
                                {token ? t('common.replace', '교체') : t('common.save', '저장')}
                            </Button>
                        </div>
                        {token && (
                            <div className="flex flex-wrap gap-2">
                                <Button variant="outline" onClick={() => void auth.reverifyCredential(slot)} disabled={auth.isLoading}>
                                    <RefreshCw className={cn('h-4 w-4', auth.isLoading && 'animate-spin')} />
                                    {t('settingsPage.api.reverify', '다시 확인')}
                                </Button>
                                <Button variant="outline" onClick={() => setDeleteSlot(slot)} disabled={auth.isLoading}>
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                    {t('common.delete', '삭제')}
                                </Button>
                            </div>
                        )}
                    </section>
                )
            })}
            <ConfirmDialog
                open={deleteSlot !== null}
                onOpenChange={open => { if (!open) setDeleteSlot(null) }}
                title={t('settingsPage.api.deleteConfirmation', 'API 토큰을 삭제할까요?')}
                description={t('settingsPage.api.deleteDescription', '이 토큰을 사용하는 생성 작업은 더 이상 시작할 수 없습니다.')}
                confirmText={t('common.delete', '삭제')}
                variant="destructive"
                onConfirm={deleteSelected}
            />
        </div>
    )
}

/** Direct token management keeps registration and activation in one dialog. */
export function ApiTokenDialog() {
    const { t } = useTranslation()
    const auth = useAuthStore()

    const close = () => auth.setTokenDialogOpen(false)

    return (
        <Dialog open={auth.tokenDialogOpen} onOpenChange={open => open ? auth.setTokenDialogOpen(true) : close()}>
            <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 pr-10">
                        <KeyRound className="h-5 w-5 text-primary" aria-hidden="true" />
                        {t('settingsPage.api.token', 'NovelAI API 토큰')}
                    </DialogTitle>
                    <DialogDescription>
                        {runtimeCapabilities.novelAiCredentialVault.supported
                            ? t('settingsPage.api.secureStorageDescription', '토큰은 운영체제의 보안 자격 증명 저장소에 보관되어, 앱을 다시 열어도 사용할 수 있습니다.')
                            : t('settingsPage.api.sessionStorageDescription', '이 환경에서는 토큰이 현재 실행 중인 세션에만 보관됩니다. 앱이나 탭을 닫으면 다시 입력해야 합니다.')}
                    </DialogDescription>
                </DialogHeader>
                <ApiTokenManager />
                <DialogFooter>
                    <Button variant="outline" onClick={close}>{t('common.close', '닫기')}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
