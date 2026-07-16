import type { NativeR2ScannedArtifact, R2ProfileV2, UploadJob } from '@/domain/r2/types'
import { createRuntimeOutputPlatformAdapter } from '@/services/output/tauri-output-adapter'
import { getRuntimeR2UploadCoordinator, getRuntimeR2UploadRepository } from '@/services/r2/runtime'
import { IndexedDBArtifactRepository } from './artifact-repository'
import { TauriOrganizerCollectionAdapter } from './collection-adapter'
import { ArtifactDistributionCoordinator, type OrganizerR2FollowUpRuntime } from './distribution-coordinator'

let artifactRepository: IndexedDBArtifactRepository | null = null
let collectionAdapter: TauriOrganizerCollectionAdapter | null = null
let distributionCoordinator: ArtifactDistributionCoordinator | null = null

const runtimeR2FollowUp: OrganizerR2FollowUpRuntime = {
    getProfile(profileId: string): Promise<R2ProfileV2 | null> {
        return getRuntimeR2UploadRepository().getProfile(profileId)
    },
    async enqueue(profile: R2ProfileV2, artifact: NativeR2ScannedArtifact): Promise<readonly UploadJob[]> {
        const coordinator = getRuntimeR2UploadCoordinator()
        const plan = await coordinator.plan(profile, [artifact], 'current-session')
        return coordinator.enqueuePlan(plan)
    },
}

export function getRuntimeArtifactRepository(): IndexedDBArtifactRepository {
    artifactRepository ??= new IndexedDBArtifactRepository()
    return artifactRepository
}

export function getRuntimeOrganizerCollectionAdapter(): TauriOrganizerCollectionAdapter {
    collectionAdapter ??= new TauriOrganizerCollectionAdapter(createRuntimeOutputPlatformAdapter())
    return collectionAdapter
}

export function getRuntimeArtifactDistributionCoordinator(): ArtifactDistributionCoordinator {
    distributionCoordinator ??= new ArtifactDistributionCoordinator({
        repository: getRuntimeArtifactRepository(),
        platform: createRuntimeOutputPlatformAdapter(),
        r2: runtimeR2FollowUp,
    })
    return distributionCoordinator
}

export async function resetRuntimeOrganizerForTests(): Promise<void> {
    await artifactRepository?.close()
    artifactRepository = null
    collectionAdapter = null
    distributionCoordinator = null
}
