import { CloudUpload, FileJson, LockKeyhole, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DEFAULT_R2_PROFILE_ID } from '@/domain/r2/types'
import type { SingleImageMetadataMode } from '@/domain/workflow/single-image-draft'
import {
    DEFAULT_RIGHTS_OWNER,
    MAX_RIGHTS_OWNER_LENGTH,
    isRightsEffectiveDate,
    isRightsOwner,
} from '@/domain/workflow/bluehair-rights-policy'
import { useDefaultR2Readiness } from '@/hooks/useDefaultR2Readiness'

const MODES: readonly SingleImageMetadataMode[] = [
    'embedded',
    'sidecar-only',
    'strip-and-sidecar',
]

export function GuidedMetadataPolicy({
    value,
    disabled,
    autoR2UploadProfileId,
    deleteOriginalAfterRelease,
    rightsXmpEnabled,
    rightsOwner,
    rightsEffectiveDate,
    onChange,
    onAutoR2UploadProfileIdChange,
    onDeleteOriginalAfterReleaseChange,
    onRightsXmpEnabledChange,
    onRightsOwnerChange,
    onRightsEffectiveDateChange,
}: {
    value: SingleImageMetadataMode
    disabled: boolean
    autoR2UploadProfileId?: string | null
    deleteOriginalAfterRelease?: boolean
    rightsXmpEnabled?: boolean
    rightsOwner?: string
    rightsEffectiveDate?: string | null
    onChange(value: SingleImageMetadataMode): void
    onAutoR2UploadProfileIdChange(profileId: string | null): void
    onDeleteOriginalAfterReleaseChange(value: boolean): void
    onRightsXmpEnabledChange(value: boolean): void
    onRightsOwnerChange(value: string): void
    onRightsEffectiveDateChange(value: string | null): void
}) {
    const { t } = useTranslation()
    const r2State = useDefaultR2Readiness()

    const descriptions: Record<SingleImageMetadataMode, string> = {
        embedded: t('guided.metadata.embeddedHelp', '편집 정보를 이미지 안에 유지합니다. 개인 보관과 다시 불러오기에 편리해요.'),
        'sidecar-only': t('guided.metadata.sidecarHelp', '이미지는 받은 상태로 두고 편집 정보를 로컬 .nai-blue.json에도 저장합니다.'),
        'strip-and-sidecar': t('guided.metadata.cleanHelp', '공유용 이미지는 정화하고, 원본 생성 정보는 로컬 .nai-blue.json에 분리합니다.'),
        'strip-only': t('guided.metadata.stripOnlyHelp', '이미지 메타데이터를 제거하지만 복구용 sidecar를 남기지 않는 기존 설정입니다.'),
    }
    const selectable = value === 'strip-only' ? [...MODES, 'strip-only' as const] : MODES
    const effectiveRightsOwner = rightsOwner ?? DEFAULT_RIGHTS_OWNER
    const rightsOwnerInvalid = rightsXmpEnabled === true && !isRightsOwner(effectiveRightsOwner)
    const rightsDateInvalid = rightsXmpEnabled === true && !isRightsEffectiveDate(rightsEffectiveDate)

    return (
        <section className="border-y border-border/55 py-5" aria-labelledby="guided-metadata-policy-heading">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(14rem,0.8fr)] sm:items-end">
                <div>
                    <h2 id="guided-metadata-policy-heading" className="flex items-center gap-2 text-sm font-semibold">
                        <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
                        {t('guided.metadata.title', '이미지 메타데이터')}
                    </h2>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {t('guided.metadata.description', '이번 작업의 이미지와 프롬프트 정보를 어떻게 보관할지 정하세요.')}
                    </p>
                </div>
                <select
                    value={value}
                    disabled={disabled}
                    onChange={event => {
                        const mode = event.target.value as SingleImageMetadataMode
                        if (mode !== 'strip-and-sidecar') {
                            onAutoR2UploadProfileIdChange(null)
                            onDeleteOriginalAfterReleaseChange(false)
                            onRightsXmpEnabledChange(false)
                        }
                        onChange(mode)
                    }}
                    className="min-h-11 w-full border-x-0 border-y border-input bg-background px-3 text-sm focus:border-primary focus:outline-none"
                    aria-label={t('guided.metadata.title', '이미지 메타데이터')}
                >
                    {selectable.map(mode => (
                        <option key={mode} value={mode}>
                            {mode === 'embedded'
                                ? t('guided.metadata.embedded', '이미지에 포함')
                                : mode === 'sidecar-only'
                                    ? t('guided.metadata.sidecar', '이미지 유지 + sidecar')
                                    : mode === 'strip-and-sidecar'
                                        ? t('guided.metadata.clean', '공유용 정화 + sidecar · 권장')
                                        : t('guided.metadata.stripOnly', '정화만 · 비권장')}
                        </option>
                    ))}
                </select>
            </div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">{descriptions[value]}</p>
            {value === 'strip-and-sidecar' && (
                <>
                    <ol className="mt-3 grid gap-2 border-t border-border/45 pt-3 text-xs leading-5 text-muted-foreground sm:grid-cols-3">
                        <li><span className="mr-1 font-mono text-primary">1</span>{t('guided.metadata.stepPreserve', '생성 정보를 sidecar로 준비')}</li>
                        <li><span className="mr-1 font-mono text-primary">2</span>{t('guided.metadata.stepClean', '청크·픽셀 은닉 정보 제거')}</li>
                        <li><span className="mr-1 font-mono text-primary">3</span>{t('guided.metadata.stepCommit', '이미지와 sidecar를 함께 검증')}</li>
                    </ol>

                    <details className="mt-4 border-t border-border/45 pt-3">
                        <summary className="cursor-pointer select-none text-xs font-semibold text-foreground marker:text-primary">
                            {t('guided.metadata.rightsTitle', '권리 XMP · 선택')}
                        </summary>
                        <div className="mt-3 grid gap-3">
                            <label className="flex min-h-11 items-start gap-3 text-sm font-medium">
                                <Checkbox
                                    className="mt-0.5"
                                    checked={rightsXmpEnabled === true}
                                    disabled={disabled}
                                    onCheckedChange={checked => onRightsXmpEnabledChange(checked === true)}
                                />
                                <span>
                                    {t('guided.metadata.rightsEnable', '정화 이미지에 소유권 XMP 표시')}
                                    <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">
                                        {t('guided.metadata.rightsHelp', '소유자, 저작권, 사용 조건을 XMP로 넣습니다. 프롬프트는 계속 private sidecar에만 남습니다.')}
                                    </span>
                                </span>
                            </label>
                            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem] sm:items-end">
                                <label className="grid gap-1 text-xs font-medium">
                                    <span>{t('guided.metadata.rightsOwner', 'XMP 소유자명')}</span>
                                    <input
                                        type="text"
                                        value={effectiveRightsOwner}
                                        maxLength={MAX_RIGHTS_OWNER_LENGTH}
                                        disabled={disabled || rightsXmpEnabled !== true}
                                        aria-invalid={rightsOwnerInvalid}
                                        onChange={event => onRightsOwnerChange(event.target.value)}
                                        className="min-h-11 border-x-0 border-y border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-55"
                                    />
                                </label>
                                <label className="grid gap-1 text-xs font-medium">
                                    <span>{t('guided.metadata.rightsDate', '권리 효력 시작일')}</span>
                                    <input
                                        type="date"
                                        value={rightsEffectiveDate ?? ''}
                                        disabled={disabled || rightsXmpEnabled !== true}
                                        aria-invalid={rightsDateInvalid}
                                        onChange={event => onRightsEffectiveDateChange(event.target.value || null)}
                                        className="min-h-11 border-x-0 border-y border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-55"
                                    />
                                </label>
                            </div>
                        </div>
                        <p className={rightsOwnerInvalid || rightsDateInvalid
                            ? 'mt-2 text-xs leading-5 text-destructive'
                            : 'mt-2 text-xs leading-5 text-muted-foreground'}>
                            {rightsOwnerInvalid
                                ? t('guided.metadata.rightsOwnerRequired', '소유자명을 앞뒤 공백 없이 한 줄로 입력해 주세요.')
                                : rightsDateInvalid
                                    ? t('guided.metadata.rightsDateRequired', '날짜를 직접 입력해야 설정 검토를 진행할 수 있어요.')
                                    : t('guided.metadata.rightsFieldsHelp', '기본 소유자명은 bluehair.blue이며 직접 변경할 수 있습니다. 날짜는 자동으로 채우지 않습니다.')}
                        </p>
                    </details>

                    <div className="mt-4 grid gap-3 border-t border-border/45 pt-4 sm:grid-cols-2">
                        <div className={r2State.status === 'ready' ? '' : 'text-muted-foreground opacity-55'}>
                            <label className="flex min-h-11 items-start gap-3 text-sm font-medium">
                                <Checkbox
                                    className="mt-0.5"
                                    checked={autoR2UploadProfileId === DEFAULT_R2_PROFILE_ID}
                                    disabled={disabled || r2State.status !== 'ready'}
                                    onCheckedChange={checked => onAutoR2UploadProfileIdChange(
                                        checked === true ? DEFAULT_R2_PROFILE_ID : null,
                                    )}
                                />
                                <span>
                                    {t('guided.metadata.autoR2', '검증 후 R2에 자동 업로드')}
                                    <span className="mt-1 block text-xs font-normal leading-5">
                                        {r2State.status === 'ready'
                                            ? t('guided.metadata.r2Ready', '{{bucket}} 프로필을 이번 작업에 사용합니다.', { bucket: r2State.profile.bucket })
                                            : r2State.status === 'loading'
                                                ? t('guided.metadata.r2Checking', '저장된 R2 프로필을 확인하고 있어요.')
                                                : t('guided.metadata.r2Unavailable', 'R2 설정과 API 키가 준비되어야 선택할 수 있어요.')}
                                    </span>
                                </span>
                            </label>
                            {r2State.status === 'unavailable' && (
                                <Button asChild type="button" variant="outline" size="sm" className="mt-2 min-h-10 opacity-100">
                                    <Link to="/guided-preview/task/library/r2">
                                        <CloudUpload className="mr-2 h-4 w-4" aria-hidden="true" />
                                        {t('guided.metadata.r2Cta', 'R2 업로드 설정하기')}
                                    </Link>
                                </Button>
                            )}
                        </div>

                        <label className="flex min-h-11 items-start gap-3 text-sm font-medium">
                            <Checkbox
                                className="mt-0.5"
                                checked={deleteOriginalAfterRelease === true}
                                disabled={disabled}
                                onCheckedChange={checked => onDeleteOriginalAfterReleaseChange(checked === true)}
                            />
                            <span>
                                {t('guided.metadata.deleteOriginal', '검증 성공 후 정화 전 원본 폐기')}
                                <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">
                                    {t('guided.metadata.deleteOriginalHelp', '기본값은 보관입니다. 정화·sidecar 저장과 선택한 업로드까지 성공한 뒤에만 원본을 폐기합니다.')}
                                </span>
                            </span>
                        </label>
                    </div>
                </>
            )}
            <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                {autoR2UploadProfileId === DEFAULT_R2_PROFILE_ID
                    ? <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    : <FileJson className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                {autoR2UploadProfileId === DEFAULT_R2_PROFILE_ID && r2State.status === 'ready'
                    ? r2State.profile.publicMode === 'private'
                        ? t('guided.metadata.privateUpload', '비공개 프로필에는 정화 이미지와 private sidecar를 함께 업로드합니다.')
                        : t('guided.metadata.publicUpload', '공개 프로필에는 정화된 이미지만 업로드하고, 프롬프트 sidecar는 로컬에 남깁니다.')
                    : t('guided.metadata.localOnly', '자동 업로드를 선택하지 않으면 이미지와 sidecar는 로컬에만 저장합니다.')}
            </p>
        </section>
    )
}
