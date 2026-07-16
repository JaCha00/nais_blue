import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFile(resolve(process.cwd(), path), 'utf8')

describe('Organizer user-flow contract', () => {
    it('wires the organizer route, virtualized thumbnail browser, sibling navigation, and keyboard/touch/drag slots', async () => {
        const [page, app, layout] = await Promise.all([
            source('src/pages/Organizer.tsx'),
            source('src/App.tsx'),
            source('src/components/layout/ThreeColumnLayout.tsx'),
        ])

        for (const required of [
            'calculateFixedGridVirtualRange',
            'entries.slice(gridRange.start, gridRange.end)',
            "event.key === 'PageUp'",
            "event.key === 'PageDown'",
            "event.key === 'Enter'",
            'onDragStart',
            'onDrop',
            'onPointerUp',
            'Duplicate assignment is blocked',
            'Thumbnail grid size',
            "t('organizer.filenamePreview'",
            "t('organizer.conflictPreview'",
            'R2 key preview',
            'Copy / rename',
            'Organizer execution progress',
            "t('organizer.diagnostics'",
            'Optional R2 follow-up',
            'retryFailed',
            "t('organizer.description'",
            'consumeOrganizerHandoff',
        ]) expect(page).toContain(required)

        expect(app).toContain('path="/organizer"')
        expect(layout).toContain("path: '/organizer'")
    })

    it('keeps artifact authority portable and delegates every file/sidecar mutation to OutputWriter', async () => {
        const [types, repository, coordinator, page] = await Promise.all([
            source('src/domain/organizer/types.ts'),
            source('src/services/organizer/artifact-repository.ts'),
            source('src/services/organizer/distribution-coordinator.ts'),
            source('src/pages/Organizer.tsx'),
        ])

        expect(types).toContain('never stores raw absolute paths')
        expect(repository).toContain('cannot persist')
        expect(repository).toContain('assertArtifactOriginalUnchanged')
        expect(coordinator).toContain('new OutputWriter')
        expect(coordinator).toContain('artifactSidecarBytes')
        expect(coordinator).toContain('stripImageMetadata')
        expect(coordinator).toContain('enqueueR2FollowUp')
        expect(page).not.toContain('.writeFile(')
        expect(page).toContain('const bytes = await collectionAdapter.readEntry(entry)')
        expect(page).toContain('existing === null || existing.contentChecksum === contentChecksum')
        expect(page).toContain('`${JSON.stringify(entry.file)}\\n${contentChecksum}`')
        expect(`${types}\n${repository}\n${coordinator}`).not.toMatch(/\b(?:Electron|Sharp|better-sqlite3)\b/i)
    })
})
