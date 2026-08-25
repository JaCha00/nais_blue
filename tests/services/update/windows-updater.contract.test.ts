import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Windows updater install-directory contract', () => {
    it('passes the running executable directory to NSIS and leaves app shutdown to Tauri', async () => {
        const [rust, hooks, tauriConfig] = await Promise.all([
            readFile(resolve(process.cwd(), 'src-tauri/src/lib.rs'), 'utf8'),
            readFile(resolve(process.cwd(), 'src-tauri/nsis/installer-hooks.nsh'), 'utf8'),
            readFile(resolve(process.cwd(), 'src-tauri/tauri.conf.json'), 'utf8'),
        ])

        expect(rust).toContain('std::env::current_exe()')
        expect(rust).toContain('.installer_arg(format!("/D={install_directory}"))')
        expect(JSON.parse(tauriConfig).bundle.windows.nsis.installMode).toBe('perMachine')
        expect(hooks).toContain('taskkill /F /T /IM tagger-server.exe')
        expect(hooks).not.toContain('taskkill /F /T /IM NAI-Blue.exe')
    })
})
