import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
    FixtureLoadError,
    FixturePathError,
    loadFixtureJson,
    loadFixtureText,
    resolveFixturePath,
} from './fixture-loader'

const temporaryDirectories: string[] = []

async function temporaryDirectory(label: string): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), `nais2-${label}-`))
    temporaryDirectories.push(directory)
    return directory
}

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
        force: true,
        recursive: true,
    })))
})

describe('fixture loader', () => {
    it('loads UTF-8 text and BOM-prefixed JSON below an explicit root', async () => {
        const root = await temporaryDirectory('fixtures')
        await mkdir(join(root, 'payload'), { recursive: true })
        await writeFile(join(root, 'payload', 'sample.txt'), 'fixture text', 'utf8')
        await writeFile(join(root, 'payload', 'sample.json'), '\uFEFF{"model":"fixture-model"}', 'utf8')

        await expect(loadFixtureText('payload/sample.txt', { root })).resolves.toBe('fixture text')
        await expect(loadFixtureJson<{ model: string }>('payload/sample.json', { root })).resolves.toEqual({
            model: 'fixture-model',
        })
    })

    it('rejects traversal and both POSIX and Windows absolute paths', async () => {
        const root = await temporaryDirectory('root')
        const windowsAbsolute = ['C:', 'Users', 'fixture-user', 'payload.json'].join('\\')

        expect(() => resolveFixturePath('../payload.json', root)).toThrow(FixturePathError)
        expect(() => resolveFixturePath('nested/../../payload.json', root)).toThrow(FixturePathError)
        expect(() => resolveFixturePath('/tmp/payload.json', root)).toThrow(FixturePathError)
        expect(() => resolveFixturePath(windowsAbsolute, root)).toThrow(FixturePathError)
        expect(() => resolveFixturePath('', root)).toThrow(FixturePathError)
    })

    it('reports missing and invalid JSON fixtures with their safe relative names', async () => {
        const root = await temporaryDirectory('errors')
        await writeFile(join(root, 'invalid.json'), '{invalid', 'utf8')

        await expect(loadFixtureText('missing.json', { root })).rejects.toMatchObject({
            name: 'FixtureLoadError',
            message: expect.stringContaining('missing.json'),
        })
        await expect(loadFixtureJson('invalid.json', { root })).rejects.toBeInstanceOf(FixtureLoadError)
    })

    it('rejects a symlink or junction that resolves outside the fixture root', async () => {
        const root = await temporaryDirectory('symlink-root')
        const outside = await temporaryDirectory('symlink-outside')
        await writeFile(join(outside, 'outside.json'), '{}', 'utf8')

        try {
            await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code
            if (code === 'EPERM' || code === 'EACCES') return
            throw error
        }

        await expect(loadFixtureJson('linked/outside.json', { root })).rejects.toBeInstanceOf(FixturePathError)
    })
})
