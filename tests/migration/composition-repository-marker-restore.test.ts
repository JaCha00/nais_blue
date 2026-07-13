import { describe, expect, it } from 'vitest'

import {
    compositionDocumentCounts,
    compositionDocumentHash,
    createCommittedCompositionRepositoryRecord,
} from '@/domain/composition/repository'
import type { CompositionDocument } from '@/domain/composition/types'
import { typeFixtureDocument } from '@/domain/composition/types.typecheck'
import { prepareBackupRestore } from '@/lib/auto-backup'

const NOW = '2026-07-12T00:00:00.000Z'

function document(): CompositionDocument {
    return structuredClone(typeFixtureDocument) as CompositionDocument
}

describe('Composition repository marker restore integrity', () => {
    it('rejects a legacy backup whose marker target does not match its committed document', () => {
        const value = document()
        const repository = createCommittedCompositionRepositoryRecord(value, {
            authority: 'v2',
            updatedAt: NOW,
            migrationMarker: {
                migrationId: 'migration:fixture',
                registryVersion: 1,
                sourceHash: 'sha256:source',
                sourceCounts: { stores: 1 },
                targetHash: compositionDocumentHash(value),
                targetCounts: compositionDocumentCounts(value),
                reportHash: 'sha256:report',
                committedAt: NOW,
            },
        }) as unknown as Record<string, any>
        repository.migrationMarker.targetCounts = { profiles: 999 }

        const prepared = prepareBackupRestore({
            _version: '2.3',
            _exportedAt: NOW,
            'nais2-composition-repository': repository,
        })

        expect(prepared.report.canRestore).toBe(false)
        expect(prepared.report.errors).toContainEqual(expect.objectContaining({
            code: 'E_COMPOSITION_REPOSITORY_INVALID',
            key: 'nais2-composition-repository',
        }))
        expect(prepared.restorePayload).not.toHaveProperty('nais2-composition-repository')
    })
})
