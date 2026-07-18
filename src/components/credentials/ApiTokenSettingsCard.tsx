import { KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'

export function ApiTokenSettingsCard() {
    const { t } = useTranslation()
    const token = useAuthStore(state => state.token)
    const token2 = useAuthStore(state => state.token2)
    const requestTokenEntry = useAuthStore(state => state.requestTokenEntry)

    return (
        <div className="space-y-4 rounded-panel border border-border bg-card p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h4 className="flex items-center gap-2 font-medium">
                        <KeyRound className="h-4 w-4 text-primary" aria-hidden="true" />
                        {t('settingsPage.api.token', 'NovelAI API 토큰')}
                    </h4>
                    <p className="mt-1 text-xs text-muted-foreground">
                        {t('settingsPage.api.localStorageDescription', '토큰은 이 PC의 앱 데이터에 저장되며, 앱을 다시 열어도 바로 사용할 수 있습니다.')}
                    </p>
                </div>
                <Button onClick={requestTokenEntry}>{t('settingsPage.api.manage', '토큰 관리')}</Button>
            </div>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
                {[token, token2].map((value, index) => (
                    <div key={index} className="rounded-control bg-muted/30 p-3">
                        <span className="font-medium">{t('settingsPage.api.slot', '토큰 {{slot}}', { slot: index + 1 })}</span>
                        <span className="ml-2 text-muted-foreground">
                            {value ? `•••• ${value.slice(-4)}` : t('settingsPage.api.notRegistered', '등록되지 않음')}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    )
}
