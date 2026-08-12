import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ExternalUrlLink } from '@/components/ui/external-url-link'
import { Input } from '@/components/ui/input'
import { runtimeCapabilities } from '@/platform/capabilities'
import { useAuthStore } from '@/stores/auth-store'

const NOVELAI_TOKEN_GUIDE_URL = 'https://docs.novelai.net/en/text/usersettings/account/'

export function GuidedCredentialGate({ children }: { children: ReactNode }) {
    const { t } = useTranslation()
    const initialized = useAuthStore(state => state.isCredentialStateInitialized)
    const token1 = useAuthStore(state => state.token)
    const token2 = useAuthStore(state => state.token2)
    const isLoading = useAuthStore(state => state.isLoading)
    const authError = useAuthStore(state => state.authError)
    const verifyAndSave = useAuthStore(state => state.verifyAndSave)
    const [candidate, setCandidate] = useState('')
    const credentialsPersist = runtimeCapabilities.novelAiCredentialVault.supported

    if (!initialized) {
        return (
            <div className="flex min-h-full items-center justify-center" role="status">
                <LoaderCircle className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
                <span className="ml-3 text-sm text-muted-foreground">
                    {t('guided.credential.loading', '저장된 연결 정보를 확인하고 있어요.')}
                </span>
            </div>
        )
    }

    if (token1.length > 0 || token2.length > 0) return children

    const submit = async (event: FormEvent) => {
        event.preventDefault()
        if (await verifyAndSave(candidate, 1)) setCandidate('')
    }

    return (
        <div className="mx-auto flex min-h-full w-full max-w-[var(--guided-content-max)] items-center px-4 py-10 sm:px-6 lg:px-10">
            <div className="grid w-full gap-8 min-[900px]:grid-cols-[minmax(18rem,0.72fr)_minmax(28rem,1fr)] min-[900px]:gap-12">
                <section className="border-b border-border/45 px-2 pb-8 min-[900px]:border-b-0 min-[900px]:border-r min-[900px]:pb-0 min-[900px]:pr-12">
                    <KeyRound className="h-7 w-7 text-primary" aria-hidden="true" />
                    <p className="mt-6 text-sm font-semibold uppercase tracking-[0.14em] text-primary">
                        {credentialsPersist
                            ? t('guided.credential.eyebrow', '시작 전 한 번만')
                            : t('guided.credential.eyebrowSession', '이 세션을 시작하기 전')}
                    </p>
                    <h1 className="mt-3 max-w-[12ch] text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
                        {t('guided.credential.title', 'NovelAI와 연결할게요.')}
                    </h1>
                    <p className="mt-3 max-w-[34ch] text-base leading-relaxed text-muted-foreground">
                        {credentialsPersist
                            ? t('guided.credential.descriptionDesktop', '이미지를 만들려면 Persistent API Token이 필요해요. 토큰은 운영체제의 보안 저장소에 보관되어 앱을 다시 열어도 이어갈 수 있어요.')
                            : t('guided.credential.descriptionSession', '이미지를 만들려면 Persistent API Token이 필요해요. 이 환경에서는 현재 세션에만 보관되므로 앱이나 탭을 닫으면 다시 입력해 주세요.')}
                    </p>
                </section>

                <section className="px-2 py-2 min-[900px]:py-0" aria-labelledby="guided-token-form-title">
                    <div className="flex items-start gap-3">
                        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                        <div>
                            <h2 id="guided-token-form-title" className="text-base font-semibold">
                                {t('guided.credential.formTitle', 'Persistent API Token 등록')}
                            </h2>
                            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                                {t('guided.credential.formHelp', 'NovelAI 설정 → Account → Get Persistent API Token에서 만들고 복사하세요.')}
                            </p>
                        </div>
                    </div>

                    <form className="mt-6 space-y-3" onSubmit={event => void submit(event)}>
                        <label htmlFor="guided-novelai-token" className="text-sm font-medium text-foreground">
                            {t('guided.credential.tokenLabel', 'NovelAI API Token')}
                        </label>
                        <Input
                            id="guided-novelai-token"
                            type="password"
                            autoComplete="off"
                            value={candidate}
                            onChange={event => setCandidate(event.target.value)}
                            placeholder={t('guided.credential.placeholder', '토큰을 여기에 붙여넣으세요')}
                            disabled={isLoading}
                        />
                        {authError !== null && (
                            <p className="text-xs text-destructive" role="alert">
                                {t('guided.credential.error', '토큰을 확인하지 못했어요. 값과 네트워크 연결을 확인해 주세요.')}
                            </p>
                        )}
                        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between">
                            <ExternalUrlLink
                                href={NOVELAI_TOKEN_GUIDE_URL}
                                className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline focus-ring"
                            >
                                {t('guided.credential.openGuide', '공식 발급 안내 보기')}
                                <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
                            </ExternalUrlLink>
                            <Button type="submit" disabled={candidate.trim().length === 0 || isLoading}>
                                {isLoading && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                                {t('guided.credential.connect', '확인하고 연결')}
                            </Button>
                        </div>
                    </form>

                    <p className="mt-7 border-t border-border/50 pt-4 text-sm leading-relaxed text-muted-foreground">
                        {t('guided.credential.r2Later', 'R2 연결은 이미지 업로드가 필요할 때 별도로 안내해 드려요.')}
                    </p>
                </section>
            </div>
        </div>
    )
}
