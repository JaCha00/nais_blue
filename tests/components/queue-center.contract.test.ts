import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { calculateFixedVirtualRange } from '@/lib/virtualization/fixed-range'

const source = (path: string) => readFile(resolve(process.cwd(), path), 'utf8')

describe('Queue Center 10,000-job UI contract', () => {
    it('keeps the mounted row window bounded at the top, middle, and end', () => {
        const cases = [
            calculateFixedVirtualRange({ itemCount: 10_000, scrollTop: 0, viewportHeight: 640, rowHeight: 96, overscan: 5 }),
            calculateFixedVirtualRange({ itemCount: 10_000, scrollTop: 480_000, viewportHeight: 640, rowHeight: 96, overscan: 5 }),
            calculateFixedVirtualRange({ itemCount: 10_000, scrollTop: 960_000, viewportHeight: 640, rowHeight: 96, overscan: 5 }),
        ]
        for (const range of cases) {
            expect(range.start).toBeGreaterThanOrEqual(0)
            expect(range.end).toBeLessThanOrEqual(10_000)
            expect(range.end - range.start).toBeLessThanOrEqual(18)
        }
        expect(cases[0]).toEqual({ start: 0, end: 12 })
        expect(cases[2]).toEqual({ start: 9994, end: 10_000 })
    })

    it('uses projection-only pagination, fixed virtualization, ARIA positions, and keyboard focus', async () => {
        const [page, app, layout, nav] = await Promise.all([
            source('src/pages/QueueCenter.tsx'),
            source('src/App.tsx'),
            source('src/components/layout/ThreeColumnLayout.tsx'),
            source('src/components/layout/AnimatedNavBar.tsx'),
        ])
        expect(page).toContain('listJobProjections')
        expect(page).toContain("statusFilter === 'all' ? {} : { states: [statusFilter] }")
        expect(page).toContain("document.visibilityState === 'visible'")
        expect(page).toContain("document.addEventListener('visibilitychange', refreshWhenVisible)")
        expect(page).toContain('summary.states.failed > 0')
        expect(page).toContain('if (selectedBatch === null || !hasRetryableFailures) return')
        expect(page).toContain('disabled={busy || !hasRetryableFailures}')
        expect(page).not.toContain("jobs.some(job => job.state === 'failed')")
        expect(page).toContain('calculateFixedVirtualRange')
        expect(page).toContain('filteredJobs.slice(windowRange.start, windowRange.end)')
        expect(page).toContain('aria-setsize={filteredJobs.length}')
        expect(page).toContain('aria-posinset={index + 1}')
        expect(page).toContain("event.key === 'ArrowDown'")
        expect(page).toContain("event.key === 'Home'")
        expect(page).toContain('min-h-11')
        expect(app).toContain('path="/queue"')
        expect(layout).toContain("path: '/queue'")
        expect(nav).toContain("const MOBILE_PRIMARY_PATHS = new Set(['/', '/scenes', '/tools', '/library'])")
    })

    it('exposes every required state plus pause, cancel, skip, retry, policy, progress, ETA, and diagnostics', async () => {
        const page = await source('src/pages/QueueCenter.tsx')
        for (const required of [
            'queued', 'running', 'succeeded', 'failed', 'cancelled', 'skipped', 'blocked',
            'pause-on-fatal', 'stop-on-first-error', 'retryFailedJobs', 'cancelBatch',
            'skipJob', 'openDrawer', 'throughput', 'eta', 'Total queue progress',
            'failureSummary',
        ]) {
            expect(page).toContain(required)
        }
        expect(page).toContain('safe-area-inset-bottom')
        expect(page).toContain('data-testid="queue-center-ready"')
        expect(page).toContain('data-testid="legacy-queue-migration"')
        expect(page).toContain('enqueueCurrentSceneQueue()')
        expect(page).toContain('keeps the legacy counts for rollback')
        expect(page).toContain("t('queue.executionMode', 'Execution method')")
        expect(page).toContain("t('queue.executionCurrent', 'Safe background execution')")
        expect(page).toContain("t('queue.executionPrevious', 'Previous execution method')")
    })
})
