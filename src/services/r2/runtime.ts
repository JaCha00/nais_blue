import { IndexedDBR2UploadRepository } from './indexeddb-r2-upload-repository'
import { R2UploadCoordinator } from './r2-upload-coordinator'

let repository: IndexedDBR2UploadRepository | null = null
let coordinator: R2UploadCoordinator | null = null

export function getRuntimeR2UploadRepository(): IndexedDBR2UploadRepository {
    repository ??= new IndexedDBR2UploadRepository()
    return repository
}

export function getRuntimeR2UploadCoordinator(): R2UploadCoordinator {
    coordinator ??= new R2UploadCoordinator(getRuntimeR2UploadRepository())
    return coordinator
}
