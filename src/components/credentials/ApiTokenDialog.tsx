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
import { useAuthStore, type ApiSlot } from '@/stores/auth-store'

/** Direct local token management keeps registration and activation in one dialog. */
export function ApiTokenDialog() {
    const { t } = useTranslation()
    const auth = useAuthStore()
    const [slotSecrets, setSlotSecrets] = useState<Record<ApiSlot, string>>({ 1: '', 2: '' })
    const [deleteSlot, setDeleteSlot] = useState<ApiSlot | null>(null)

    const close = () => {
        setSlotSecrets({ 1: '', 2: '' })
        auth.setTokenDialogOpen(false)
    }

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
        <>
            <Dialog open={auth.tokenDialogOpen} onOpenChange={open => open ? auth.setTokenDialogOpen(true) : close()}>
                <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 pr-10">
                            <KeyRound className="h-5 w-5 text-primary" aria-hidden="true" />
                            {t('settingsPage.api.token', 'NovelAI API 토큰')}
                        </DialogTitle>
                        <DialogDescription>
                            {t('settingsPage.api.localStorageDescription', '토큰은 이 PC의 앱 데이터에 저장되며, 앱을 다시 열어도 바로 사용할 수 있습니다.')}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        {([1, 2] as const).map(slot => {
                            const token = slot === 2 ? auth.token2 : auth.token
                            const enabled = slot === 2 ? auth.slot2Enabled : auth.slot1Enabled
                            const verified = slot === 2 ? auth.isVerified2 : auth.isVerified
                            const tier = slot === 2 ? auth.tier2 : auth.tier
                            return (
                                <section key={slot} className="space-y-3 rounded-panel border border-border bg-card p-4">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <div>
                                            <h3 className="font-medium">{t('settingsPage.api.slot', '토큰 {{slot}}', { slot })}</h3>
                                            <p className="mt-1 text-xs text-muted-foreground">
                                                {token ? `•••• ${token.slice(-4)}` : t('settingsPage.api.notRegistered', '등록되지 않음')}
                                            </p>
                                        </div>
                                        {token && (
                                            <div className="flex items-center gap-2">
                                                {verified && <CheckCircle2 className="h-4 w-4 text-success" aria-label={t('settingsPage.api.verified', '확인됨')} />}
                                                <span className="text-xs text-muted-foreground">{tier ?? '-'}</span>
                                                <Switch checked={enabled} onChange={event => void auth.setSlotEnabled(slot, event.target.checked)} />
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
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={close}>{t('common.close', '닫기')}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <ConfirmDialog
                open={deleteSlot !== null}
                onOpenChange={open => { if (!open) setDeleteSlot(null) }}
                title={t('settingsPage.api.deleteConfirmation', 'API 토큰을 삭제할까요?')}
                description={t('settingsPage.api.deleteDescription', '이 토큰을 사용하는 생성 작업은 더 이상 시작할 수 없습니다.')}
                confirmText={t('common.delete', '삭제')}
                variant="destructive"
                onConfirm={deleteSelected}
            />
        </>
    )
}
