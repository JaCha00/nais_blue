import { describe, expect, it, vi } from 'vitest'

import { renameLibraryFiles } from '@/services/library/library-file-renamer'

function fakeFileSystem(initialPaths: readonly string[]) {
    const files = new Set(initialPaths.map(path => path.toLowerCase()))
    const moves: Array<readonly [string, string]> = []
    return {
        files,
        moves,
        exists: async (path: string) => files.has(path.toLowerCase()),
        rename: vi.fn(async (source: string, destination: string) => {
            const sourceKey = source.toLowerCase()
            const destinationKey = destination.toLowerCase()
            if (!files.has(sourceKey) || (sourceKey !== destinationKey && files.has(destinationKey))) {
                throw new Error('rename failed')
            }
            files.delete(sourceKey)
            files.add(destinationKey)
            moves.push([source, destination])
        }),
    }
}

describe('Library file renaming', () => {
    it('applies an indexed pattern and keeps image and sidecar names together', async () => {
        const fs = fakeFileSystem([
            'C:\\Library\\first.webp',
            'C:\\Library\\first.nai-blue.json',
            'C:\\Library\\second.png',
        ])

        const results = await renameLibraryFiles([
            { id: '1', name: 'first', path: 'C:\\Library\\first.webp', sidecarPath: 'C:\\Library\\first.nai-blue.json' },
            { id: '2', name: 'second', path: 'C:\\Library\\second.png' },
        ], 'set_{index:000}', fs)

        expect(results).toEqual([
            { id: '1', name: 'set_001', path: 'C:\\Library\\set_001.webp', sidecarPath: 'C:\\Library\\set_001.nai-blue.json' },
            { id: '2', name: 'set_002', path: 'C:\\Library\\set_002.png', sidecarPath: undefined },
        ])
        expect(fs.moves).toEqual([
            ['C:\\Library\\first.webp', 'C:\\Library\\set_001.webp'],
            ['C:\\Library\\first.nai-blue.json', 'C:\\Library\\set_001.nai-blue.json'],
            ['C:\\Library\\second.png', 'C:\\Library\\set_002.png'],
        ])
    })

    it('adds a suffix instead of overwriting an existing file', async () => {
        const fs = fakeFileSystem(['C:\\Library\\old.png', 'C:\\Library\\new.png'])

        const [result] = await renameLibraryFiles([
            { id: '1', name: 'old', path: 'C:\\Library\\old.png' },
        ], 'new', fs)

        expect(result).toMatchObject({ name: 'new-2', path: 'C:\\Library\\new-2.png' })
        expect(fs.files.has('c:\\library\\new.png')).toBe(true)
    })

    it('rolls earlier moves back when a later file cannot be renamed', async () => {
        const fs = fakeFileSystem(['C:\\Library\\first.png', 'C:\\Library\\second.png'])
        let forwardMoves = 0
        fs.rename.mockImplementation(async (source: string, destination: string) => {
            if (!destination.includes('first') && forwardMoves++ === 1) throw new Error('locked')
            const sourceKey = source.toLowerCase()
            const destinationKey = destination.toLowerCase()
            if (!fs.files.has(sourceKey)) throw new Error('missing')
            fs.files.delete(sourceKey)
            fs.files.add(destinationKey)
        })

        await expect(renameLibraryFiles([
            { id: '1', name: 'first', path: 'C:\\Library\\first.png' },
            { id: '2', name: 'second', path: 'C:\\Library\\second.png' },
        ], 'renamed_{index}', fs)).rejects.toThrow('이미지 파일 이름을 변경하지 못했습니다')
        expect(fs.files.has('c:\\library\\first.png')).toBe(true)
        expect(fs.files.has('c:\\library\\renamed_1.png')).toBe(false)
    })
})
