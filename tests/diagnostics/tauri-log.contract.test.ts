import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('production diagnostic file logging contract', () => {
    it('writes only the redacted structured target with bounded rotation', async () => {
        const source = await readFile(resolve(process.cwd(), 'src-tauri/src/lib.rs'), 'utf8')

        expect(source).toContain('fn record_diagnostic_event')
        expect(source).toContain('contains_unredacted_diagnostic_payload')
        expect(source).toContain('target: "nais2_diagnostic"')
        expect(source).toContain('.clear_targets()')
        expect(source).toContain('TargetKind::LogDir')
        expect(source).toContain('.max_file_size(1_000_000)')
        expect(source).toContain('RotationStrategy::KeepSome(5)')
        expect(source).toContain('metadata.target() == "nais2_diagnostic"')
    })
})
