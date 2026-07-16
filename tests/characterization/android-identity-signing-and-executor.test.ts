import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (path: string): string => readFileSync(join(root, path), 'utf8')

/**
 * These fixtures link the Tauri identity, generated-Gradle patch, APK verifier,
 * and tracked Android plugin after the Phase 12 migration. Keeping the final
 * values explicit makes any partial application-ID or signing rollback fail.
 */
describe('current Android identity, signing, and transfer executor', () => {
    it('uses one final identity for both signed release and debug APKs', () => {
        const policy = JSON.parse(read('android-release-policy.json')) as {
            applicationId: string
            debugApplicationIdSuffix: string
        }
        const tauri = JSON.parse(read('src-tauri/tauri.conf.json')) as { identifier: string }
        const signingPatch = read('scripts/patch-android-signing.mjs')
        const verifier = read('scripts/verify-android-apk.mjs')

        expect(policy.applicationId).toBe('com.bluhair.naisblue')
        expect(policy.debugApplicationIdSuffix).toBe('')
        expect(tauri.identifier).toBe(policy.applicationId)
        expect(signingPatch).not.toContain('applicationIdSuffix = "${debugApplicationIdSuffix}"')
        expect(signingPatch).toContain("const debugSuffix = readOption('--debug-suffix', '')")
        expect(verifier).toContain('`${policy.applicationId}${policy.debugApplicationIdSuffix}`')
    })

    it('keeps keystore material process-scoped and outside tracked Gradle files', () => {
        const signingPatch = read('scripts/patch-android-signing.mjs')
        const prepareRelease = read('scripts/prepare-android-release.mjs')

        for (const name of ['ANDROID_KEYSTORE_PATH', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']) {
            expect(signingPatch).toContain(`System.getenv("${name}")`)
        }
        expect(prepareRelease).toContain("requiredEnvironment('ANDROID_KEYSTORE_PATH')")
        expect(prepareRelease).not.toContain("requiredEnvironment('ANDROID_KEY_PASSWORD')")
        expect(prepareRelease).not.toContain('writeFileSync')
    })

    it('uses the current plugin namespace and installs the Cloudflare executor with a closed fallback', () => {
        const gradle = read('src-tauri/plugins/nais-android-transfer/android/build.gradle.kts')
        const execution = read(
            'src-tauri/plugins/nais-android-transfer/android/src/main/java/com/bluhair/naisblue/transfer/TransferExecution.kt',
        )
        const notifications = read(
            'src-tauri/plugins/nais-android-transfer/android/src/main/java/com/bluhair/naisblue/transfer/TransferNotifications.kt',
        )
        const plugin = read(
            'src-tauri/plugins/nais-android-transfer/android/src/main/java/com/bluhair/naisblue/transfer/AndroidTransferPlugin.kt',
        )

        expect(gradle).toContain('namespace = "com.bluhair.naisblue.transfer"')
        expect(execution).toContain('package com.bluhair.naisblue.transfer')
        expect(execution).toContain('TransferOutcome.Blocked(ERROR_EXECUTOR_UNAVAILABLE)')
        expect(plugin).toContain('installIfAbsent(CloudflareTransferExecutor(activity))')
        expect(notifications).toContain('"com.bluhair.naisblue.transfer.PAUSE"')
        expect(notifications).toContain('"com.bluhair.naisblue.transfer.CANCEL"')
    })
})
