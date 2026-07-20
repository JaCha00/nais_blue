import { IndexedDBArtifactRepository } from './artifact-repository'

let artifactRepository: IndexedDBArtifactRepository | null = null

export function getRuntimeArtifactRepository(): IndexedDBArtifactRepository {
    artifactRepository ??= new IndexedDBArtifactRepository()
    return artifactRepository
}

export async function resetRuntimeOrganizerForTests(): Promise<void> {
    await artifactRepository?.close()
    artifactRepository = null
}
