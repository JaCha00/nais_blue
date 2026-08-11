import { useMemo, useState } from 'react'
import { Check, ClipboardCopy, FileSearch } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { openNativeFileDialog } from '@/platform/native-file-dialog'

export type GuidedAgentTemplateId = 'polish' | 'rework' | 'reference'

export interface GuidedAgentPromptInput {
    templateId: GuidedAgentTemplateId
    presetName: string
    presetId: string
    revision: number
    workspacePath: string
    goal: string
    referencePath: string
}

export function renderGuidedAgentPrompt(input: GuidedAgentPromptInput): string {
    const target = `프리셋 "${input.presetName}" (ID: ${input.presetId})`
    const workspace = input.workspacePath || 'NAIS blue Agent Workspace'
    const common = [
        '당신은 NAIS blue의 로컬 프롬프트 편집 에이전트입니다.',
        `작업 폴더: ${workspace}`,
        `대상: ${target}`,
        `현재 snapshot revision: ${input.revision}`,
        '',
        'snapshot.json을 읽고 request.example.json 형식을 지켜 request.json 하나만 작성하세요.',
        'baseRevision은 snapshot revision과 같게 두고, action.type은 preset.patch를 사용하세요.',
        '확정 전에는 status를 draft로 유지하고 JSON이 완성되면 ready로 바꾸세요.',
        '토큰, 이미지 원본, Base64 또는 계약에 없는 필드는 request.json에 넣지 마세요.',
        '',
    ]
    const goal = input.goal.trim() || '주제와 캐릭터 정체성은 유지하면서 더 명확하고 일관된 프롬프트로 다듬어 주세요.'

    if (input.templateId === 'rework') {
        return [...common,
            '[템플릿: 구조 재작성]',
            `요청: ${goal}`,
            'basePrompt에는 핵심 주제와 구도를, additionalPrompt에는 분위기와 스타일을, detailPrompt에는 조명·재질·세부 요소를 분리하세요.',
            'negativePrompt에는 실제로 피해야 할 요소만 남기고 중복 태그를 제거하세요.',
            '최종 결과는 preset.patch 한 건으로 적용하세요.',
        ].join('\n')
    }
    if (input.templateId === 'reference') {
        return [...common,
            '[템플릿: 참조 파일 반영]',
            `참조 파일: ${input.referencePath || '[파일을 먼저 지정하세요]'}`,
            `요청: ${goal}`,
            '참조 파일에서 프롬프트 또는 생성 메타데이터만 읽고, 이미지 바이트나 Base64는 request.json에 복사하지 마세요.',
            '참조 내용은 대상 프리셋의 네 프롬프트 영역에 맞게 정리한 뒤 preset.patch 한 건으로 적용하세요.',
        ].join('\n')
    }
    return [...common,
        '[템플릿: 가볍게 다듬기]',
        `요청: ${goal}`,
        '기존 주제, 인물 수, 구도와 핵심 스타일은 유지하세요.',
        '중복·충돌 태그를 정리하고 각 프롬프트 영역의 역할만 명확하게 나눈 뒤 preset.patch 한 건으로 적용하세요.',
    ].join('\n')
}

export function GuidedAgentPromptComposer({
    presetName,
    presetId,
    revision,
    workspacePath,
}: {
    presetName: string
    presetId: string
    revision: number
    workspacePath: string
}) {
    const { t } = useTranslation()
    const [templateId, setTemplateId] = useState<GuidedAgentTemplateId>('polish')
    const [goal, setGoal] = useState('')
    const [referencePath, setReferencePath] = useState('')
    const [copied, setCopied] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const prompt = useMemo(() => renderGuidedAgentPrompt({
        templateId,
        presetName,
        presetId,
        revision,
        workspacePath,
        goal,
        referencePath,
    }), [goal, presetId, presetName, referencePath, revision, templateId, workspacePath])
    const referenceRequired = templateId === 'reference'

    const chooseReference = async () => {
        setError(null)
        try {
            const selected = await openNativeFileDialog({
                multiple: false,
                directory: false,
                title: t('guided.promptTasks.agent.composer.chooseFileTitle', 'AI가 참고할 파일 선택'),
            })
            if (typeof selected === 'string') setReferencePath(selected)
        } catch {
            setError(t('guided.promptTasks.agent.composer.fileError', '파일을 선택하지 못했어요.'))
        }
    }

    const copy = async () => {
        if (referenceRequired && !referencePath) return
        setError(null)
        try {
            await navigator.clipboard.writeText(prompt)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1_800)
        } catch {
            setError(t('guided.promptTasks.agent.composer.copyError', '클립보드에 복사하지 못했어요. 직접 선택해 복사해 주세요.'))
        }
    }

    return (
        <section className="border-y border-border/70 py-5" data-testid="guided-agent-prompt-composer">
            <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-semibold">
                    {t('guided.promptTasks.agent.composer.template', '프롬프트 템플릿')}
                    <select
                        value={templateId}
                        onChange={event => {
                            setTemplateId(event.target.value as GuidedAgentTemplateId)
                            setCopied(false)
                        }}
                        className="mt-2 min-h-12 w-full border-x-0 border-y border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        <option value="polish">{t('guided.promptTasks.agent.composer.polish', '기존 프롬프트 가볍게 다듬기')}</option>
                        <option value="rework">{t('guided.promptTasks.agent.composer.rework', '네 영역으로 구조 재작성')}</option>
                        <option value="reference">{t('guided.promptTasks.agent.composer.reference', '이미지·JSON·문서 참고하기')}</option>
                    </select>
                </label>
                <label className="text-sm font-semibold">
                    {t('guided.promptTasks.agent.composer.goal', '이번에 바꿀 방향 · 선택')}
                    <Input value={goal} onChange={event => setGoal(event.target.value)} className="mt-2 text-base" placeholder={t('guided.promptTasks.agent.composer.goalPlaceholder', '예: 야간 조명을 강조하고 중복 태그 정리')} />
                </label>
            </div>
            {referenceRequired && (
                <div className="mt-4 border-y border-border/55 py-4">
                    <p className="text-sm font-semibold">{t('guided.promptTasks.agent.composer.referenceFile', '변수 · 참조 파일')}</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{t('guided.promptTasks.agent.composer.referenceHelp', '선택한 실제 파일 경로가 아래 고정 템플릿의 참조 파일 변수에 자동으로 들어갑니다.')}</p>
                    <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row">
                        <Input value={referencePath} readOnly className="min-w-0 flex-1 text-sm" placeholder={t('guided.promptTasks.agent.composer.noFile', '아직 선택한 파일 없음')} />
                        <Button type="button" variant="outline" onClick={() => void chooseReference()}>
                            <FileSearch className="mr-2 h-4 w-4" aria-hidden="true" />{t('guided.promptTasks.agent.composer.chooseFile', '파일 지정')}
                        </Button>
                    </div>
                </div>
            )}
            <label className="mt-5 block text-sm font-semibold">
                {t('guided.promptTasks.agent.composer.preview', 'AI에게 붙여넣을 프롬프트')}
                <Textarea value={prompt} readOnly className="mt-2 min-h-72 whitespace-pre-wrap font-mono text-sm leading-6" data-allow-context-menu />
            </label>
            <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button type="button" onClick={() => void copy()} disabled={referenceRequired && !referencePath}>
                    {copied ? <Check className="mr-2 h-4 w-4" aria-hidden="true" /> : <ClipboardCopy className="mr-2 h-4 w-4" aria-hidden="true" />}
                    {copied ? t('guided.promptTasks.agent.composer.copied', '복사했어요') : t('guided.promptTasks.agent.composer.copy', '프롬프트 복사')}
                </Button>
                <span className="text-sm text-muted-foreground">{t('guided.promptTasks.agent.composer.autoVariables', '프리셋 ID·revision·작업 폴더는 자동으로 채워집니다.')}</span>
            </div>
            {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}
        </section>
    )
}
