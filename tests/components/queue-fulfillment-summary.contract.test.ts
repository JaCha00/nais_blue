import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('Queue fulfillment summary contract', () => {
    it('loads the full generation run only on detail open or explicit refresh', async () => {
        const source = await readFile(resolve(process.cwd(), 'src/pages/QueueCenter.tsx'), 'utf8')
        const pollingStart = source.indexOf('const refresh = useCallback')
        const fulfillmentStart = source.indexOf('const loadFulfillment = useCallback')
        const pollingSource = source.slice(pollingStart, fulfillmentStart)

        expect(pollingStart).toBeGreaterThan(-1)
        expect(fulfillmentStart).toBeGreaterThan(pollingStart)
        expect(pollingSource).not.toContain('getRuntimeGenerationRun')
        expect(source.slice(fulfillmentStart)).toContain('getRuntimeGenerationRun(selectedBatchId)')
        expect(source).toContain('data-testid="queue-fulfillment-summary"')
        expect(source).toContain('onToggle={event =>')
        expect(source).toContain("t('queue.fulfillment.refresh', 'Refresh stages')")
        expect(source).toContain('fulfillment.issues.length > 0')
        expect(source).toContain("'retry-scene-link'")
    })
})
