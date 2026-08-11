import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import {
    ArrowRight,
    Clock3,
    Images,
    Image as ImageIcon,
    Library,
    Settings2,
    TextCursorInput,
    type LucideIcon,
} from 'lucide-react'

import { getWorkflowDraftRepository } from '@/adapters/workflow/indexeddb-workflow-draft-repository'
import { createSingleImageDraft, type WorkflowDraft } from '@/domain/workflow/single-image-draft'
import { cn } from '@/lib/utils'
import { generateRandomSeed } from '@/lib/utils'
import { resolveGuidedActivityTargetNode } from '@/presentation/activity/activity-status'
import {
    GUIDED_DRAFTS_CHANGED_EVENT,
    announceGuidedDraftChange,
} from './guided-draft-events'

interface GuidedChoice {
    id: 'A' | 'B' | 'C' | 'D' | 'E'
    icon: LucideIcon
    title: string
    description: string
}

function ChoiceRow({ choice, busy, openLabel, onSelect }: { choice: GuidedChoice; busy: boolean; openLabel: string; onSelect(): void }) {
    const Icon = choice.icon
    return (
        <button
            type="button"
            onClick={onSelect}
            disabled={busy}
            className={cn(
                'guided-choice-row group flex min-h-24 w-full items-center gap-4 border-b border-border/45 px-3 text-left last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4',
                busy && 'cursor-progress opacity-65',
            )}
        >
            <span className="w-6 shrink-0 font-mono text-sm font-semibold text-primary">{choice.id}</span>
            <Icon className="h-5 w-5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden="true" />
            <span className="min-w-0 flex-1 py-4">
                <span className="block break-words text-base font-semibold leading-snug text-foreground">{choice.title}</span>
                <span className="mt-1.5 block break-words text-sm leading-relaxed text-muted-foreground">{choice.description}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2 text-sm font-semibold text-primary opacity-70 transition-opacity duration-standard group-hover:opacity-100 group-focus-visible:opacity-100 sm:opacity-0">
                <span className="hidden sm:inline">{openLabel}</span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-fast group-hover:translate-x-1" aria-hidden="true" />
            </span>
        </button>
    )
}

export function GuidedHome() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const [drafts, setDrafts] = useState<readonly WorkflowDraft[]>([])
    const [creating, setCreating] = useState(false)
    const [createError, setCreateError] = useState(false)
    const resumeDraft = drafts[0]
    const resumeNode = resumeDraft === undefined
        ? null
        : resolveGuidedActivityTargetNode(resumeDraft.currentNodeId, resumeDraft.status)
    const resumeHref = resumeDraft === undefined
        ? null
        : resumeDraft.kind === 'batch-image'
            ? `/guided-preview/batch/${resumeDraft.id}/${resumeNode}`
            : `/guided-preview/work/${resumeDraft.id}/${resumeNode}`

    useEffect(() => {
        let active = true
        const refresh = () => {
            void getWorkflowDraftRepository().list().then(items => {
                if (active) setDrafts(items)
            }).catch(() => {
                if (active) setDrafts([])
            })
        }
        refresh()
        window.addEventListener(GUIDED_DRAFTS_CHANGED_EVENT, refresh)
        return () => {
            active = false
            window.removeEventListener(GUIDED_DRAFTS_CHANGED_EVENT, refresh)
        }
    }, [])

    const startSingleImageDraft = async () => {
        setCreating(true)
        setCreateError(false)
        try {
            const now = new Date().toISOString()
            const draft = createSingleImageDraft({
                id: `guided-single-${crypto.randomUUID()}`,
                now,
                seed: generateRandomSeed(),
            })
            const result = await getWorkflowDraftRepository().commit({
                expectedRevision: null,
                draft,
            })
            if (result.status !== 'committed') throw new Error('Draft ID already exists')
            announceGuidedDraftChange()
            navigate(`/guided-preview/work/${draft.id}/model`)
        } catch {
            setCreateError(true)
        } finally {
            setCreating(false)
        }
    }
    const choices: GuidedChoice[] = [
        {
            id: 'A',
            icon: ImageIcon,
            title: t('guided.home.single.title', '이미지를 한 장 정성스럽게 만들고 싶어요'),
            description: t('guided.home.single.description', '모델부터 최종 설정까지 차근차근 정해요.'),
        },
        {
            id: 'B',
            icon: Images,
            title: t('guided.home.batch.title', '이미지를 여러 장 만들고 싶어요'),
            description: t('guided.home.batch.description', '같은 설정, 랜덤 프롬프트, 씬 작업 중에서 골라요.'),
        },
        {
            id: 'C',
            icon: TextCursorInput,
            title: t('guided.home.prompt.title', '프롬프트를 상세하게 가다듬고 싶어요'),
            description: t('guided.home.prompt.description', '로컬 AI 에이전트와 안전하게 수정하고 비교해요.'),
        },
        {
            id: 'D',
            icon: Library,
            title: t('guided.home.library.title', '생성한 이미지를 관리하고 싶어요'),
            description: t('guided.home.library.description', '정리, 편집, 메타데이터, R2 업로드를 안내해요.'),
        },
        {
            id: 'E',
            icon: Settings2,
            title: t('guided.home.environment.title', '작업 환경을 구성하고 싶어요'),
            description: t('guided.home.environment.description', '계정, 저장 위치, 화면과 백업을 설정해요.'),
        },
    ]

    return (
        <div className="mx-auto flex min-h-full w-full max-w-[var(--guided-content-max)] items-center px-4 py-7 sm:px-6 lg:px-10">
            <div className="grid w-full items-center gap-8 min-[900px]:grid-cols-[minmax(19rem,0.74fr)_minmax(30rem,1fr)] min-[900px]:gap-10">
                <section aria-labelledby="guided-welcome-title">
                    <p className="mb-2 text-sm font-semibold text-primary">NAIS blue · Guided</p>
                    <h1 id="guided-welcome-title" className="guided-display max-w-[12ch] text-foreground">
                        {t('guided.home.welcome', '어서오세요!')}
                    </h1>
                    <p className="mt-3 max-w-[34ch] text-base leading-snug text-muted-foreground">
                        {t('guided.home.question', '어떤 작업을 하고 싶은지부터 함께 정해볼게요.')}
                    </p>
                    <p className="mt-2 text-sm leading-snug text-muted-foreground">
                        {t('guided.home.autosave', '선택한 내용은 자동으로 저장됩니다.')}
                    </p>
                    {resumeHref !== null && (
                        <button
                            type="button"
                            className="guided-choice-row mt-5 flex min-h-16 w-full max-w-sm items-center gap-3 border-y border-border/50 px-2 py-3 text-left hover:text-primary focus-ring"
                            onClick={() => navigate(resumeHref)}
                        >
                            <Clock3 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                            <span className="min-w-0 flex-1">
                                <span className="block text-sm font-semibold">
                                    {t('guided.home.resume', '이어서 작업하기')}
                                </span>
                                <span className="mt-1 block break-words text-xs leading-snug text-muted-foreground">
                                    {t('guided.home.draftCount', '저장된 초안 {{count}}개', { count: drafts.length })}
                                </span>
                            </span>
                            <ArrowRight className="h-4 w-4" aria-hidden="true" />
                        </button>
                    )}
                </section>

                <nav aria-label={t('guided.home.choices', '작업 선택')} className="border-y border-border/40">
                    {choices.map(choice => (
                        <ChoiceRow
                            key={choice.id}
                            choice={choice}
                            busy={creating}
                            openLabel={t('guided.home.open', '시작')}
                            onSelect={() => {
                                if (choice.id === 'A') void startSingleImageDraft()
                                else if (choice.id === 'B') navigate('/guided-preview/guide/batch')
                                else if (choice.id === 'C') navigate('/guided-preview/guide/prompt')
                                else if (choice.id === 'D') navigate('/guided-preview/guide/library')
                                else navigate('/guided-preview/guide/environment')
                            }}
                        />
                    ))}
                    {createError && (
                        <p className="px-2 py-3 text-xs text-destructive" role="alert">
                            {t('guided.home.createError', '새 초안을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.')}
                        </p>
                    )}
                </nav>
            </div>
        </div>
    )
}
