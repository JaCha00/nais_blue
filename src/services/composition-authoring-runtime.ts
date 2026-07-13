import {
    CompositionRepository,
    type CompositionRepositoryStorage,
} from '@/domain/composition/repository'
import {
    compareAndSetIndexedDBItem,
    getIndexedDBItemStrict,
    setIndexedDBItemStrict,
} from '@/lib/indexed-db'

/**
 * Production repository boundary for Composition v2 authoring.
 *
 * Keeping this adapter outside the domain makes browser/desktop persistence a
 * replaceable capability while every authoring write still goes through the
 * repository compare-and-set contract.
 */
export function createCompositionAuthoringStorage(): CompositionRepositoryStorage {
    return {
        getItem: getIndexedDBItemStrict,
        setItem: setIndexedDBItemStrict,
        compareAndSet: compareAndSetIndexedDBItem,
    }
}

export function createCompositionAuthoringRepository(): CompositionRepository {
    return new CompositionRepository(createCompositionAuthoringStorage())
}
