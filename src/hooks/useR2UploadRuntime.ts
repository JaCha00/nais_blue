import { useEffect } from 'react'

import { runtimeCapabilities } from '@/platform/capabilities'
import { reportDiagnostic } from '@/services/diagnostics/error-registry'
import { nativeR2CredentialStatus } from '@/services/r2/native-r2-adapter'
import { getRuntimeR2UploadCoordinator, getRuntimeR2UploadRepository } from '@/services/r2/runtime'

/** Foreground-only Phase 09 runtime. Background scheduling remains unsupported. */
export function useR2UploadRuntime(): void {
    useEffect(() => {
        if (!runtimeCapabilities.r2ForegroundUpload.supported) return
        let cancelled = false
        void (async () => {
            const repository = getRuntimeR2UploadRepository()
            const coordinator = getRuntimeR2UploadCoordinator()
            await coordinator.recoverAfterRestart()
            while (!cancelled) {
                const profiles = await repository.listProfiles()
                for (const profile of profiles) {
                    if (cancelled) break
                    if (profile.transport !== 'native-s3') continue
                    const credential = await nativeR2CredentialStatus(profile.credentialRef).catch(() => null)
                    if (!credential?.available) continue
                    await coordinator.runUntilIdle(profile)
                }
                if (!cancelled) await new Promise(resolve => window.setTimeout(resolve, 1_000))
            }
        })().catch(error => {
            reportDiagnostic(error, { operation: 'r2.foreground-resume', stage: 'startup' })
        })
        return () => {
            cancelled = true
        }
    }, [])
}
