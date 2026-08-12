import type {
    QueueBatchOrigin,
    QueueResourceRecord,
} from '@/domain/queue/types'
import { resolveGenerationFolder } from '@/domain/generation-folders'
import { DEFAULT_R2_PROFILE_ID } from '@/domain/r2/types'
import { buildSceneGenerationParams } from '@/lib/scene-generation/build-scene-params'
import type { SaveSceneResultContext } from '@/lib/scene-generation/save-scene-result'
import { getRotationCharacterFolderName } from '@/lib/scene-output-path'
import { useCharacterStore } from '@/stores/character-store'
import { useQueueStore } from '@/stores/queue-store'
import { useRotationStore } from '@/stores/character-rotation-store'
import { getScenePresetPathSegments, useSceneStore, type SceneCard, type ScenePreset } from '@/stores/scene-store'
import { useSettingsStore } from '@/stores/settings-store'
import { QueueExecutionError } from './durable-queue-coordinator'
import {
    getRuntimeQueueRepository,
    type CreateBatchAndEnqueueResult,
    type EnqueueGenerationJobInput,
} from './indexeddb-queue-repository'
import {
    encodeSceneJobSnapshot,
    type EncodedSceneJobSnapshot,
    type SceneQueueWorkflowSnapshot,
} from './scene-job-snapshot-codec'
import {
    dehydrateGenerationParams,
    getRuntimeQueueResourceMaterializer,
    type MaterializedQueueResource,
} from './queue-resource-materializer'
import { gateGenerationFolderAutoUpload, getDefaultR2Readiness } from '@/services/r2/readiness'

let sceneEnqueueInFlight: Promise<CreateBatchAndEnqueueResult | null> | null = null

// Queue Center passes explicit folder/scene/count tuples; this boundary keeps
// selection UI concerns out of snapshot creation and makes each job retain the
// correct output folder even when that folder is not currently active.
export interface SceneQueueTarget {
    readonly presetId: string
    readonly sceneId: string
    readonly count: number
}

interface ResolvedSceneQueueTarget {
    readonly target: SceneQueueTarget
    readonly preset: ScenePreset
    readonly scene: SceneCard
}

function normalizeSceneQueueTargets(targets: readonly SceneQueueTarget[]): SceneQueueTarget[] {
    const normalized = new Map<string, SceneQueueTarget>()
    for (const target of targets) {
        if (!Number.isFinite(target.count) || target.count <= 0) continue
        const count = Math.max(1, Math.floor(target.count))
        const key = `${target.presetId}:${target.sceneId}`
        const previous = normalized.get(key)
        normalized.set(key, {
            presetId: target.presetId,
            sceneId: target.sceneId,
            count: Math.min(999, (previous?.count ?? 0) + count),
        })
    }
    return [...normalized.values()]
}

export function enqueueCurrentSceneQueue(): Promise<CreateBatchAndEnqueueResult | null> {
    const sceneState = useSceneStore.getState()
    const presetId = sceneState.activePresetId
    const preset = sceneState.presets.find(candidate => candidate.id === presetId)
    if (presetId === null || preset === undefined) return Promise.resolve(null)
    const targets = sceneState.getQueuedScenes(presetId).map(scene => ({
        presetId,
        sceneId: scene.id,
        count: scene.queueCount,
    }))
    return enqueueSceneQueueTargets(targets, { origin: 'legacy-conversion' })
}

export function enqueueSceneQueueTargets(
    targets: readonly SceneQueueTarget[],
    options: { origin?: QueueBatchOrigin } = {},
): Promise<CreateBatchAndEnqueueResult | null> {
    const normalizedTargets = normalizeSceneQueueTargets(targets)
    if (normalizedTargets.length === 0) return Promise.resolve(null)
    sceneEnqueueInFlight ??= enqueueSceneQueueTargetsOnce(
        normalizedTargets,
        options.origin ?? 'fresh',
    ).finally(() => {
        sceneEnqueueInFlight = null
    })
    return sceneEnqueueInFlight
}

async function enqueueSceneQueueTargetsOnce(
    targets: readonly SceneQueueTarget[],
    origin: QueueBatchOrigin,
): Promise<CreateBatchAndEnqueueResult | null> {
    const sceneState = useSceneStore.getState()
    const selected: ResolvedSceneQueueTarget[] = targets.flatMap(target => {
        const preset = sceneState.presets.find(candidate => candidate.id === target.presetId)
        const scene = preset?.scenes.find(candidate => candidate.id === target.sceneId)
        return preset === undefined || scene === undefined ? [] : [{ target, preset, scene }]
    })
    if (selected.length === 0) return null
    const operationId = useQueueStore.getState().beginEnqueueOperation('scene')

    const settings = useSettingsStore.getState()
    const needsR2 = selected.some(({ scene }) => {
        const folder = resolveGenerationFolder(settings.generationFolders, scene.generationFolderId, {
            directory: settings.sceneSavePath,
            useAbsolutePath: settings.useAbsoluteScenePath,
        })
        return folder?.r2.autoUpload === true
    })
    const r2Readiness = needsR2 ? await getDefaultR2Readiness() : null
    const baseR2Profile = r2Readiness?.status === 'ready' ? r2Readiness.profile : null
    const rotation = useRotationStore.getState()
    const rotationCharacterId = rotation.active && rotation.snapshot
        ? rotation.characterIds[rotation.currentIndex]
        : undefined
    const materializer = getRuntimeQueueResourceMaterializer()
    const resourceCache = new Map<string, Promise<MaterializedQueueResource>>()
    const resources = new Map<string, QueueResourceRecord>()
    const prepared: EncodedSceneJobSnapshot[] = []

    try {
        for (const { target, preset, scene } of selected) {
            const resolvedFolder = resolveGenerationFolder(
                settings.generationFolders,
                scene.generationFolderId,
                {
                    directory: settings.sceneSavePath,
                    useAbsolutePath: settings.useAbsoluteScenePath,
                    r2Bucket: baseR2Profile?.bucket,
                    r2Prefix: baseR2Profile?.prefix,
                },
            )
            const generationFolder = gateGenerationFolderAutoUpload(
                resolvedFolder,
                r2Readiness?.status === 'ready',
            )
            const saveContext: SaveSceneResultContext = {
                activePresetId: preset.id,
                sceneSavePath: settings.sceneSavePath,
                ...(rotationCharacterId === undefined ? {} : { rotationCharacterId }),
                ...(rotationCharacterId === undefined
                    ? {}
                    : {
                        rotationCharacterFolderName: getRotationCharacterFolderName(
                            rotationCharacterId,
                            rotation.currentIndex,
                        ) ?? undefined,
                    }),
            }
            const outputContext: SceneQueueWorkflowSnapshot['outputContext'] = {
                useAbsoluteScenePath: generationFolder?.useAbsolutePath ?? settings.useAbsoluteScenePath,
                metadataMode: generationFolder?.r2.autoUpload
                    ? 'strip-and-sidecar'
                    : scene.metadataMode ?? settings.metadataMode,
                presetName: preset.name || 'Default',
                presetPathSegments: getScenePresetPathSegments(sceneState.presets, preset.id),
                sceneName: '',
                ...(generationFolder === null
                    ? {}
                    : {
                        generationFolderId: generationFolder.id,
                        generationFolderPath: generationFolder.path,
                        directory: generationFolder.directory,
                        capabilityFallbackDirectory: generationFolder.useAbsolutePath
                            ? 'NAIS_Scene'
                            : generationFolder.directory,
                        autoR2UploadProfileId: generationFolder.r2.autoUpload
                            ? DEFAULT_R2_PROFILE_ID
                            : null,
                        r2Bucket: generationFolder.r2.bucket,
                        r2Prefix: generationFolder.r2.prefix,
                    }),
            }
            for (let count = 0; count < target.count; count += 1) {
                const built = await buildSceneGenerationParams(scene, {
                    requestId: `durable-enqueue:${preset.id}:${scene.id}:${count}`,
                    now: new Date(),
                    presetId: preset.id,
                    generationFolder,
                })
                sceneState.recordSceneCompositionResult(scene.id, {
                    mode: built.mode,
                    ...(built.planHash === null ? {} : { planHash: built.planHash }),
                    warnings: built.warnings,
                    errors: built.errors,
                })
                if (!built.success) {
                    throw new QueueExecutionError('fatal', 'Scene composition plan is invalid')
                }
                const dehydrated = await dehydrateGenerationParams(built.params, materializer, resourceCache)
                for (const record of dehydrated.records) resources.set(record.id, record)
                prepared.push(encodeSceneJobSnapshot({
                    scene: { id: scene.id, name: scene.name },
                    params: built.params,
                    finalPrompt: built.finalPrompt,
                    mimeType: built.mimeType,
                    saveContext,
                    outputContext: { ...outputContext, sceneName: scene.name },
                    streaming: settings.useStreaming,
                    sequenceCommitProposal: built.sequenceCommitProposal,
                    planHash: built.planHash,
                }, dehydrated))
            }
        }
    } finally {
        useCharacterStore.getState().releaseImageData()
    }

    const batchId = `scene-batch-${operationId}`
    const createdAt = new Date().toISOString()
    const jobs: EnqueueGenerationJobInput[] = prepared.map((item, ordinal) => ({
        id: `scene-job-${operationId}-${ordinal}`,
        batchId,
        workflow: 'scene',
        sceneId: item.sceneId,
        createdAt,
        priority: 0,
        ordinal,
        snapshot: item.snapshot,
        compositionPlanHash: item.compositionPlanHash,
        maxAttempts: 3,
        idempotencyKey: `scene-enqueue-${operationId}-${ordinal}`,
    }))
    const result = await getRuntimeQueueRepository().createBatchAndEnqueue({
        batch: {
            id: batchId,
            workflow: 'scene',
            createdAt,
            failurePolicy: 'continue',
            origin,
            idempotencyKey: `scene-enqueue-${operationId}`,
        },
        jobs,
        resources: [...resources.values()],
    })
    useQueueStore.getState().completeEnqueueOperation('scene', operationId)
    return result
}
