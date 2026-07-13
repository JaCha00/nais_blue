import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
    effectiveMainCompositionMode,
    effectiveSceneCompositionMode,
    effectiveStyleLabCompositionMode,
} from '@/lib/composition-authority'
import {
    applyCompositionAuthorityFeatureFlag,
    inspectCompositionAuthority,
    type CompositionAuthorityInspection,
} from '@/lib/composition-migration-startup'
import { reportDiagnostic } from '@/services/diagnostics/error-registry'
import { useGenerationStore } from '@/stores/generation-store'
import { useSceneStore } from '@/stores/scene-store'

function display(value: string | number | null): string {
    return value === null ? '—' : String(value)
}

export function CompositionAuthorityPanel() {
    const mainRequestedMode = useGenerationStore(state => state.compositionMode)
    const sceneRequestedMode = useSceneStore(state => state.sceneCompositionMode)
    const styleLabRequestedMode = useGenerationStore(state => state.styleLabCompositionMode)
    const [inspection, setInspection] = useState<CompositionAuthorityInspection | null>(null)
    const [loading, setLoading] = useState(true)
    const [rollingBack, setRollingBack] = useState(false)
    const [operationMessage, setOperationMessage] = useState<string | null>(null)

    const refresh = useCallback(async () => {
        setLoading(true)
        try {
            setInspection(await inspectCompositionAuthority())
        } catch (error) {
            const event = reportDiagnostic(error, {
                operation: 'composition.authority-inspection',
                stage: 'inspect',
                category: 'persistence',
                severity: 'error',
                recoverable: true,
            })
            setOperationMessage(`Authority inspection failed (${event.code}).`)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void refresh()
    }, [refresh])

    const rollbackToLegacy = async () => {
        setRollingBack(true)
        setOperationMessage(null)
        try {
            await applyCompositionAuthorityFeatureFlag('legacy')
            await refresh()
            setOperationMessage('Legacy authority is active. The committed v2 document was retained.')
        } catch (error) {
            const event = reportDiagnostic(error, {
                operation: 'composition.authority-rollback',
                stage: 'rollback-authority',
                category: 'persistence',
                severity: 'error',
                recoverable: true,
            })
            setOperationMessage(`Legacy rollback failed (${event.code}).`)
        } finally {
            setRollingBack(false)
        }
    }

    const workflows = [
        {
            name: 'Main',
            requested: mainRequestedMode,
            effective: effectiveMainCompositionMode(mainRequestedMode),
        },
        {
            name: 'Scene',
            requested: sceneRequestedMode,
            effective: effectiveSceneCompositionMode(sceneRequestedMode),
        },
        {
            name: 'Style Lab',
            requested: styleLabRequestedMode,
            effective: effectiveStyleLabCompositionMode(styleLabRequestedMode),
        },
    ]
    const alreadyLegacy = inspection?.persistedAuthority === 'legacy'
        && inspection.runtimeAuthority === 'legacy'

    return (
        <section aria-labelledby="composition-authority-title" className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 id="composition-authority-title" className="font-semibold">Composition Authority</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Production authority is repository-verified. V2 activation remains release-gated.
                    </p>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-11"
                    onClick={() => { void refresh() }}
                    disabled={loading || rollingBack}
                >
                    <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    Refresh
                </Button>
            </div>

            <dl className="grid gap-x-4 gap-y-2 rounded-control bg-muted p-3 text-xs sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)]">
                <dt className="font-medium">Persisted authority</dt>
                <dd className="break-all font-mono">{loading ? 'Loading…' : display(inspection?.persistedAuthority ?? null)}</dd>
                <dt className="font-medium">Process runtime authority</dt>
                <dd className="break-all font-mono">{display(inspection?.runtimeAuthority ?? null)}</dd>
                <dt className="font-medium">Configured startup preference</dt>
                <dd className="break-all font-mono">{display(inspection?.configuredAuthority ?? null)}</dd>
                <dt className="font-medium">Repository revision / hash</dt>
                <dd className="break-all font-mono">
                    {display(inspection?.repositoryRevision ?? null)} / {display(inspection?.repositoryHash ?? null)}
                </dd>
                <dt className="font-medium">Migration status</dt>
                <dd className="break-all font-mono">{display(inspection?.migrationStatus ?? null)}</dd>
                <dt className="font-medium">Startup verification</dt>
                <dd className="break-all font-mono">{display(inspection?.startupVerificationTimestamp ?? null)}</dd>
                <dt className="font-medium">Last startup result</dt>
                <dd className="break-all font-mono">{display(inspection?.lastStartup?.resultStatus ?? null)}</dd>
            </dl>

            {inspection?.fallbackReason && (
                <div role="alert" className="flex gap-2 rounded-control border border-destructive p-3 text-xs text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="break-all">Authority fallback recorded: {inspection.fallbackReason}</span>
                </div>
            )}

            <div className="overflow-x-auto rounded-control border border-border">
                <table className="w-full min-w-[360px] text-left text-xs">
                    <thead className="bg-muted">
                        <tr>
                            <th className="p-2 font-medium">Workflow</th>
                            <th className="p-2 font-medium">Requested mode</th>
                            <th className="p-2 font-medium">Effective mode</th>
                        </tr>
                    </thead>
                    <tbody>
                        {workflows.map(workflow => (
                            <tr key={workflow.name} className="border-t border-border">
                                <th scope="row" className="p-2 font-medium">{workflow.name}</th>
                                <td className="p-2 font-mono">{workflow.requested}</td>
                                <td className="p-2 font-mono">{workflow.effective}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                <p className="max-w-2xl text-xs text-muted-foreground">
                    Rollback changes authority only. Canonical v2 data and migration archives remain available for a verified forward migration.
                </p>
                <Button
                    type="button"
                    variant="destructive"
                    className="min-h-11"
                    disabled={loading || rollingBack || alreadyLegacy}
                    onClick={() => { void rollbackToLegacy() }}
                >
                    <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    {rollingBack ? 'Rolling back…' : alreadyLegacy ? 'Legacy active' : 'Rollback to legacy'}
                </Button>
            </div>
            {operationMessage && (
                <p role="status" className="text-xs text-muted-foreground">{operationMessage}</p>
            )}
        </section>
    )
}
