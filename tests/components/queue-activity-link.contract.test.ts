import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFile(resolve(process.cwd(), path), 'utf8')

describe('History Queue activity entry contract', () => {
    it('keeps the Queue summary in the visible History sidebar instead of the global header', async () => {
        const [layout, history] = await Promise.all([
            source('src/components/layout/ThreeColumnLayout.tsx'),
            source('src/components/layout/HistoryPanel.tsx'),
        ])

        expect(layout).not.toContain("import { QueueActivityLink } from './QueueActivityLink'")
        expect(history).toContain("import { QueueActivityLink } from './QueueActivityLink'")
        expect(history).toContain('<QueueActivityLink />')
        expect(layout).toContain('historyPanelIsDocked = isDesktopShell && !compositionWorkspaceOwnsRails')
        expect(layout).toContain('historyPanelIsDocked && rightSidebarVisible && <HistoryPanel />')
        expect(layout).toContain('rightSheetOpen && <HistoryPanel />')
    })

    it('shows all reserved-job counts and delegates details to Queue Center', async () => {
        const [link, repository] = await Promise.all([
            source('src/components/layout/QueueActivityLink.tsx'),
            source('src/services/queue/indexeddb-queue-repository.ts'),
        ])

        expect(link).toContain('to="/queue"')
        expect(link).toContain('data-testid="history-queue-activity"')
        expect(link).toContain('getActivitySummary()')
        expect(link).not.toContain('listJobProjections')
        expect(link).toContain('summary.processing')
        expect(link).toContain('summary.waiting')
        expect(link).toContain('summary.needsAttention')
        expect(link).toContain('onClick={closeSupportSheet}')
        expect(link).toContain('document.addEventListener(\'visibilitychange\', refreshWhenVisible)')
        expect(link).toContain('window.setInterval(refreshWhenVisible, QUEUE_ACTIVITY_REFRESH_MS)')
        expect(link).toContain('min-h-11')
        expect(repository).toContain('async getActivitySummary(): Promise<QueueActivitySummary>')
        expect(repository).toContain("transaction.objectStore('jobs').index('by-state-order')")
    })
})
