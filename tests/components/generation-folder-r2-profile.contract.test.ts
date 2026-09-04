import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('generation folder R2 profile UI contract', () => {
    it.each([
        'src/components/generation-folders/GenerationFolderPicker.tsx',
        'src/components/library/LibraryImageWorkflowDialog.tsx',
    ])('queries and gates readiness for the resolved profile in %s', sourcePath => {
        const source = readFileSync(sourcePath, 'utf8')

        expect(source).toContain('preliminary')
        expect(source).toContain('requestedProfileId')
        expect(source).toContain('useDefaultR2Readiness(')
        expect(source).toContain("r2State.profile?.id === requestedProfileId")
    })

    it('does not offer default-profile setup for an explicitly cleared profile', () => {
        const source = readFileSync('src/components/library/LibraryImageWorkflowDialog.tsx', 'utf8')

        expect(source).toContain('!r2Ready && requestedProfileId !== null')
    })

    it('derives manager preview and save gating from its internal selected folder', () => {
        const source = readFileSync('src/components/generation-folders/GenerationFolderManagerDialog.tsx', 'utf8')

        expect(source).toContain('selectedPreliminary')
        expect(source).toContain('selectedProfileId')
        expect(source).toContain('useDefaultR2Readiness(selectedProfileId, open && selectedProfileId !== null)')
        expect(source).toContain('matchR2Readiness(selectedProfileId, r2State)')
        expect(source).toContain('r2Bucket: selectedR2Profile?.bucket')
        expect(source).toContain('r2Prefix: selectedR2Profile?.prefix')
        expect(source).toContain('autoUpload: r2Ready ? autoUpload : false')
    })
})
