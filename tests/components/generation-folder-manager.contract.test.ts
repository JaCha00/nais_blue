import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('GenerationFolderManagerDialog authority contract', () => {
    it('saves parent and editable fields through one atomic store action', () => {
        const source = readFileSync('src/components/generation-folders/GenerationFolderManagerDialog.tsx', 'utf8')

        expect(source).toContain('saveFolder(selected.id, parentId, {')
        expect(source).not.toContain('moveFolders([selected.id], parentId)')
        expect(source).not.toContain('updateFolder(selected.id, {')
    })
})
