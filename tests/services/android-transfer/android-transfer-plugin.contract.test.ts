import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const PLUGIN = resolve(ROOT, 'src-tauri/plugins/nais-android-transfer')

async function source(path: string): Promise<string> {
    return readFile(resolve(PLUGIN, path), 'utf8')
}

describe('Phase 12 Android transfer scheduling plugin contract', () => {
    it('registers the tracked plugin without enabling the closed executor capability', async () => {
        const [cargo, lib, mobileCapability, runtimeCapabilities] = await Promise.all([
            readFile(resolve(ROOT, 'src-tauri/Cargo.toml'), 'utf8'),
            readFile(resolve(ROOT, 'src-tauri/src/lib.rs'), 'utf8'),
            readFile(resolve(ROOT, 'src-tauri/capabilities/mobile.json'), 'utf8'),
            readFile(resolve(ROOT, 'src/platform/capabilities.ts'), 'utf8'),
        ])

        expect(cargo).toContain('tauri-plugin-nais-android-transfer = { path = "plugins/nais-android-transfer" }')
        expect(lib).toContain('.plugin(tauri_plugin_nais_android_transfer::init())')
        expect(mobileCapability).toContain('"nais-android-transfer:default"')
        expect(runtimeCapabilities).toContain('secureLanSyncTransport: NO_SECURE_LAN_SYNC_CUTOVER')
        expect(runtimeCapabilities).toContain('lanBlobTransfer: NO_LAN_BLOB_TRANSFER')
        expect(runtimeCapabilities).toContain('r2BackgroundUpload: NO_NATIVE_R2_BACKGROUND')
    })

    it('keeps Android lifecycle source tracked outside generated projects', async () => {
        const [cargo, build, gradle, manifest] = await Promise.all([
            source('Cargo.toml'),
            source('build.rs'),
            source('android/build.gradle.kts'),
            source('android/src/main/AndroidManifest.xml'),
        ])

        expect(cargo).toContain('links = "tauri-plugin-nais-android-transfer"')
        expect(build).toContain('.android_path("android")')
        expect(gradle).toContain('androidx.work:work-runtime-ktx:2.10.5')
        expect(gradle).toContain('Apache-2.0')
        expect(gradle).not.toMatch(/software\.amazon|postgrest|gotrue|catalog/i)

        for (const permission of [
            'android.permission.POST_NOTIFICATIONS',
            'android.permission.RUN_USER_INITIATED_JOBS',
            'android.permission.FOREGROUND_SERVICE',
            'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
        ]) {
            expect(manifest).toContain(permission)
        }
        expect(manifest).toContain('android.permission.BIND_JOB_SERVICE')
        expect(manifest).toContain('NaisTransferJobService')
        expect(manifest).toContain('TransferActionReceiver')
        expect(manifest).toContain('androidx.work.impl.foreground.SystemForegroundService')
    })

    it('uses UIDT on API 34+ and a foreground WorkManager fallback on API 24-33', async () => {
        const [scheduler, jobService, worker, notifications] = await Promise.all([
            source('android/src/main/java/com/bluhair/naisblue/transfer/TransferScheduler.kt'),
            source('android/src/main/java/com/bluhair/naisblue/transfer/NaisTransferJobService.kt'),
            source('android/src/main/java/com/bluhair/naisblue/transfer/NaisTransferWorker.kt'),
            source('android/src/main/java/com/bluhair/naisblue/transfer/TransferNotifications.kt'),
        ])

        expect(scheduler).toContain('Build.VERSION_CODES.UPSIDE_DOWN_CAKE')
        expect(scheduler).toContain('.setUserInitiated(true)')
        expect(scheduler).toContain('.setEstimatedNetworkBytes(')
        expect(scheduler).toContain('WorkManager.getInstance')
        expect(scheduler).toContain('enqueueUniqueWork')
        expect(jobService).toContain('setNotification(')
        expect(jobService).toContain('jobFinished(')
        expect(jobService).toContain('onStopJob(')
        expect(worker).toContain('CoroutineWorker')
        expect(worker).toContain('setForeground(')
        expect(notifications).toContain('ACTION_PAUSE')
        expect(notifications).toContain('ACTION_RESUME')
        expect(notifications).toContain('ACTION_RETRY')
        expect(notifications).toContain('ACTION_CANCEL')

        const combined = `${scheduler}\n${jobService}\n${worker}`
        expect(combined).not.toMatch(/generation|novelai|nai_generate/i)
    })

    it('persists only bounded secret-free tickets and exposes recovery controls', async () => {
        const [rustTypes, rustCommands, kotlinModel, repository, validator, plugin] = await Promise.all([
            source('src/types.rs'),
            source('src/commands.rs'),
            source('android/src/main/java/com/bluhair/naisblue/transfer/TransferTicket.kt'),
            source('android/src/main/java/com/bluhair/naisblue/transfer/TransferTicketStore.kt'),
            source('android/src/main/java/com/bluhair/naisblue/transfer/TransferTicketValidator.kt'),
            source('android/src/main/java/com/bluhair/naisblue/transfer/AndroidTransferPlugin.kt'),
        ])

        expect(rustTypes).toContain('#[serde(deny_unknown_fields)]')
        expect(rustTypes).toContain('R2Upload')
        expect(rustTypes).toContain('LanBlob')
        expect(kotlinModel).toContain('R2_UPLOAD')
        expect(kotlinModel).toContain('LAN_BLOB')
        expect(`${rustTypes}\n${kotlinModel}`).not.toMatch(/generation/i)

        for (const forbidden of [
            'authorization',
            'signed url',
            'thumbnail',
            'base64',
            'absolute path',
            'image bytes',
        ]) {
            expect(validator.toLowerCase()).toContain(forbidden)
        }
        expect(repository).toContain('SharedPreferences')
        expect(repository).toContain('checkpointBytes')
        expect(repository).toContain('nextAttemptAtEpochMs')
        expect(repository).not.toMatch(/token|authorization|signedUrl|thumbnail|base64/i)

        for (const command of ['schedule', 'pause', 'resume', 'cancel', 'retry', 'checkpoint', 'status', 'recover']) {
            expect(rustCommands).toContain(`pub async fn ${command}`)
            expect(plugin).toContain(`fun ${command}(`)
        }
    })

    it('keeps explicit single-owner guards across UIDT recovery and WorkManager', async () => {
        const [scheduler, worker, repository, plugin, execution, manifest] = await Promise.all([
            source('android/src/main/java/com/bluhair/naisblue/transfer/TransferScheduler.kt'),
            source('android/src/main/java/com/bluhair/naisblue/transfer/NaisTransferWorker.kt'),
            source('android/src/main/java/com/bluhair/naisblue/transfer/TransferTicketStore.kt'),
            source('android/src/main/java/com/bluhair/naisblue/transfer/AndroidTransferPlugin.kt'),
            source('android/src/main/java/com/bluhair/naisblue/transfer/TransferExecution.kt'),
            source('android/src/main/AndroidManifest.xml'),
        ])

        expect(scheduler).toContain('ExistingWorkPolicy.KEEP')
        expect(scheduler).toContain('hasPendingUserInitiatedJob')
        expect(scheduler).toContain('getPendingJob(jobId(transferId))')
        expect(repository).toContain('sameIdentity(existing, ticket)')
        expect(repository).toContain('markInterrupted(')
        expect(repository).toContain('recoverableTickets()')
        expect(worker).toContain('catch (cancelled: CancellationException)')
        expect(worker).toContain('store.markInterrupted(id)')
        expect(plugin).toContain('override fun load(webView: WebView)')
        expect(plugin).toContain('allowUserInitiatedJob = false')
        expect(execution).toContain('ACTIVE_TRANSFERS.add(transferId)')
        expect(execution).toContain('ACTIVE_TRANSFERS.remove(transferId)')
        expect(manifest).not.toContain('android:process=')
    })
})
