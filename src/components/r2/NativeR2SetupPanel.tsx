import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Loader2, PauseCircle, Play, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createR2ProfileV2, type R2ConflictPolicy, type R2ProfileV2, type R2PublicMode, type R2Transport } from '@/domain/r2/types'
import { runtimeCapabilities } from '@/platform/capabilities'
import {
    scanNativeR2Artifacts,
    storeNativeR2Credential,
    testNativeR2Connection,
    testNativeR2TemporaryObject,
} from '@/services/r2/native-r2-adapter'
import { type R2UploadMode } from '@/services/r2/r2-upload-coordinator'
import { getRuntimeR2UploadCoordinator, getRuntimeR2UploadRepository } from '@/services/r2/runtime'
import type { AssetProfile } from '@/types/asset-profile'

const DEFAULT_PROFILE_ID = 'asset-profile-default-r2'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="min-w-0 space-y-1.5">
            <Label>{label}</Label>
            {children}
        </div>
    )
}

function initialProfile(profile: AssetProfile): R2ProfileV2 {
    return createR2ProfileV2({
        id: DEFAULT_PROFILE_ID,
        name: 'Default R2',
        accountId: profile.r2.accountId ?? '',
        jurisdiction: null,
        endpoint: null,
        bucket: profile.r2.bucket ?? '',
        prefix: profile.r2.keyPrefix ?? '',
        credentialRef: 'r2-system-default',
        transport: 'native-s3',
        conflictPolicy: 'fail',
        publicMode: profile.r2.publicBaseUrl ? 'custom' : 'private',
        publicBaseUrl: profile.r2.publicBaseUrl ?? null,
    })
}

export function NativeR2SetupPanel({
    assetProfile,
    localRoot,
    onPersistAssetProfile,
}: {
    assetProfile: AssetProfile
    localRoot: string
    onPersistAssetProfile: (profile: AssetProfile) => void
}) {
    const [profile, setProfile] = useState(() => initialProfile(assetProfile))
    const [accessKeyId, setAccessKeyId] = useState('')
    const [secretAccessKey, setSecretAccessKey] = useState('')
    const [mode, setMode] = useState<R2UploadMode>('delta')
    const [busy, setBusy] = useState<string | null>(null)
    const [status, setStatus] = useState('설정을 저장한 뒤 연결을 확인하세요.')
    const [planSummary, setPlanSummary] = useState<string | null>(null)

    useEffect(() => {
        void getRuntimeR2UploadRepository().getProfile(DEFAULT_PROFILE_ID).then(saved => {
            if (saved) setProfile(saved)
        })
    }, [])

    const pathPreview = useMemo(() => {
        const prefix = profile.prefix.replace(/^\/+|\/+$/g, '')
        return [prefix, 'example.png'].filter(Boolean).join('/')
    }, [profile.prefix])

    const update = <K extends keyof R2ProfileV2>(key: K, value: R2ProfileV2[K]) => {
        setProfile(current => ({ ...current, [key]: value, updatedAt: new Date().toISOString() }))
    }

    const save = async () => {
        setBusy('save')
        try {
            await getRuntimeR2UploadRepository().putProfile(profile)
            onPersistAssetProfile({
                ...assetProfile,
                r2: {
                    ...assetProfile.r2,
                    enabled: true,
                    accountId: profile.accountId || undefined,
                    bucket: profile.bucket || undefined,
                    keyPrefix: profile.prefix || undefined,
                    publicBaseUrl: profile.publicBaseUrl || undefined,
                },
            })
            setStatus('R2 Profile v2와 Asset Profile의 non-secret projection을 저장했습니다.')
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'R2 profile 저장에 실패했습니다.')
        } finally {
            setBusy(null)
        }
    }

    const saveCredential = async () => {
        setBusy('credential')
        try {
            await storeNativeR2Credential({ credentialRef: profile.credentialRef, accessKeyId, secretAccessKey })
            setAccessKeyId('')
            setSecretAccessKey('')
            setStatus('OS credential vault에 R2 credential을 저장했습니다. Renderer read API는 제공되지 않습니다.')
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Credential 저장에 실패했습니다.')
        } finally {
            setBusy(null)
        }
    }

    const runConnectionTest = async () => {
        setBusy('connection')
        try {
            await testNativeR2Connection(profile)
            setStatus('Bucket 연결 테스트가 통과했습니다.')
        } catch (error) {
            setStatus(error instanceof Error ? error.message : '연결 테스트에 실패했습니다.')
        } finally {
            setBusy(null)
        }
    }

    const runTemporaryObjectTest = async () => {
        setBusy('temporary')
        try {
            const result = await testNativeR2TemporaryObject(profile)
            setStatus(result.put && result.head && result.deleted
                ? 'Temporary object put → head → delete가 모두 통과했습니다.'
                : 'Temporary object cleanup이 완료되지 않았습니다.')
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Temporary object 테스트에 실패했습니다.')
        } finally {
            setBusy(null)
        }
    }

    const startUpload = async () => {
        setBusy('upload')
        try {
            if (mode === 'current-session') {
                throw new Error('current-session은 generation output의 명시적 artifact set이 필요합니다. Directory scan은 delta/full-sync/dry-run에서만 사용하세요.')
            }
            const coordinator = getRuntimeR2UploadCoordinator()
            const artifacts = await scanNativeR2Artifacts(localRoot, profile.prefix)
            const plan = await coordinator.plan(profile, artifacts, mode)
            setPlanSummary(`${plan.total} objects · ${plan.alreadyCompleted} already complete · ${plan.jobs.length} planned`)
            if (mode !== 'dry-run') {
                await coordinator.enqueuePlan(plan)
                const summary = await coordinator.runUntilIdle(profile)
                setStatus(`Native upload: ${summary.succeeded} succeeded, ${summary.failed} failed, ${summary.queued} waiting.`)
            } else {
                const preview = await coordinator.previewConflicts(profile, plan)
                setStatus(`Dry-run: ${preview.missing} new, ${preview.alreadySame} same, ${preview.conflicts} conflicts, ${preview.overwrites} explicit overwrites, ${preview.suffixAvailable} suffix paths available. Remote objects were not changed.`)
            }
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Native upload가 실패했습니다.')
        } finally {
            setBusy(null)
        }
    }

    const foreground = runtimeCapabilities.r2ForegroundUpload
    const nativeEnabled = foreground.supported && profile.transport === 'native-s3'

    return (
        <section className="min-w-0 space-y-4 border-t border-border pt-4" aria-label="Native R2 guided setup" data-testid="native-r2-guided-setup">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                    <h3 className="text-sm font-semibold">Native R2 guided setup</h3>
                    <p className="mt-1 text-xs text-muted-foreground">Wrangler 없이 foreground upload · background worker는 아직 비지원</p>
                </div>
                <span className="inline-flex min-h-11 items-center gap-1.5 text-xs text-muted-foreground">
                    {nativeEnabled ? <ShieldCheck className="h-4 w-4 text-success" /> : <PauseCircle className="h-4 w-4" />}
                    {nativeEnabled ? 'foreground available' : 'unsupported'}
                </span>
            </div>

            {!foreground.supported && (
                <div className="border border-border bg-muted p-3 text-sm" role="status">
                    <div>{foreground.reason}</div>
                    <div className="mt-1 text-muted-foreground">{foreground.alternative}</div>
                </div>
            )}

            <ol className="grid min-w-0 gap-4 md:grid-cols-2">
                <li className="space-y-3"><Field label="1. Transport"><Select value={profile.transport} onValueChange={value => update('transport', value as R2Transport)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="native-s3">native-s3</SelectItem><SelectItem value="wrangler">wrangler</SelectItem><SelectItem value="relay" disabled>relay (unsupported)</SelectItem></SelectContent></Select></Field></li>
                <li className="grid gap-3 sm:grid-cols-2"><Field label="2. Account ID"><Input value={profile.accountId} onChange={event => update('accountId', event.target.value)} /></Field><Field label="Jurisdiction"><Input value={profile.jurisdiction ?? ''} placeholder="eu" onChange={event => update('jurisdiction', event.target.value || null)} /></Field><Field label="Custom endpoint"><Input value={profile.endpoint ?? ''} placeholder="https://<account>.r2.cloudflarestorage.com" onChange={event => update('endpoint', event.target.value || null)} /></Field></li>
                <li className="space-y-3"><Field label="3. Credential vault"><Select value="system"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="system">Operating-system vault</SelectItem></SelectContent></Select></Field><Field label="Credential reference"><Input value={profile.credentialRef} onChange={event => update('credentialRef', event.target.value)} /></Field><div className="grid gap-3 sm:grid-cols-2"><Input aria-label="R2 access key ID" type="password" autoComplete="off" value={accessKeyId} onChange={event => setAccessKeyId(event.target.value)} /><Input aria-label="R2 secret access key" type="password" autoComplete="off" value={secretAccessKey} onChange={event => setSecretAccessKey(event.target.value)} /></div><Button type="button" variant="outline" onClick={saveCredential} disabled={!nativeEnabled || !accessKeyId || !secretAccessKey || busy !== null}>{busy === 'credential' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Vault에 저장</Button></li>
                <li className="space-y-3"><div className="text-sm font-medium">4. Connection test</div><Button type="button" variant="outline" onClick={runConnectionTest} disabled={!nativeEnabled || busy !== null}>{busy === 'connection' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Bucket HEAD 확인</Button></li>
                <li className="grid gap-3 sm:grid-cols-2"><Field label="5. Bucket"><Input value={profile.bucket} onChange={event => update('bucket', event.target.value)} /></Field><Field label="Prefix"><Input value={profile.prefix} onChange={event => update('prefix', event.target.value)} /></Field></li>
                <li className="space-y-3"><div className="text-sm font-medium">6. Temporary object</div><Button type="button" variant="outline" onClick={runTemporaryObjectTest} disabled={!nativeEnabled || busy !== null}>{busy === 'temporary' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}put → head → delete</Button></li>
                <li className="space-y-1.5"><div className="text-sm font-medium">7. Path preview</div><div className="min-h-11 break-all border border-input bg-background px-3 py-2 font-mono text-sm">{pathPreview}</div></li>
                <li><Field label="8. Conflict policy"><Select value={profile.conflictPolicy} onValueChange={value => update('conflictPolicy', value as R2ConflictPolicy)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="fail">fail · conditional create only</SelectItem><SelectItem value="skip-same">skip-same · checksum metadata</SelectItem><SelectItem value="overwrite">overwrite · explicit replacement</SelectItem><SelectItem value="suffix">suffix · deterministic hash</SelectItem></SelectContent></Select></Field></li>
                <li className="grid gap-3 sm:grid-cols-2"><Field label="9. Public mode"><Select value={profile.publicMode} onValueChange={value => update('publicMode', value as R2PublicMode)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="private">private</SelectItem><SelectItem value="r2-dev">r2.dev</SelectItem><SelectItem value="custom">custom domain</SelectItem></SelectContent></Select></Field><Field label="Public base URL"><Input value={profile.publicBaseUrl ?? ''} onChange={event => update('publicBaseUrl', event.target.value || null)} /></Field></li>
                <li className="space-y-3"><div className="text-sm font-medium">10. Save</div><Button type="button" onClick={save} disabled={busy !== null}>{busy === 'save' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Profile 저장</Button></li>
            </ol>

            <div className="grid min-w-0 gap-3 border-t border-border pt-4 md:grid-cols-[180px_1fr_auto] md:items-end">
                <Field label="Upload mode"><Select value={mode} onValueChange={value => setMode(value as R2UploadMode)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="current-session">current-session</SelectItem><SelectItem value="delta">delta</SelectItem><SelectItem value="full-sync">full-sync</SelectItem><SelectItem value="dry-run">dry-run</SelectItem></SelectContent></Select></Field>
                <div className="min-w-0 text-xs text-muted-foreground"><div className="break-all">local root: {localRoot || '-'}</div>{planSummary && <div className="mt-1">{planSummary}</div>}</div>
                <Button type="button" onClick={startUpload} disabled={!nativeEnabled || !localRoot.trim() || busy !== null}>{busy === 'upload' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}{mode === 'dry-run' ? 'Preview' : 'Upload / resume'}</Button>
            </div>

            <div className="min-h-11 border border-border bg-muted px-3 py-2 text-sm" role="status" aria-live="polite">{status}</div>
        </section>
    )
}
