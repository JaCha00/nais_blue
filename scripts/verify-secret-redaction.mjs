import { spawnSync } from 'node:child_process'

const result = spawnSync(
    process.execPath,
    [
        'node_modules/vitest/vitest.mjs',
        'run',
        'tests/migration/secret-redaction.test.ts',
        'tests/components/backup-restore-ui.contract.test.ts',
    ],
    { cwd: process.cwd(), stdio: 'inherit' },
)

if (result.error) throw result.error
process.exit(result.status ?? 1)
