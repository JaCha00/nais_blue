import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { createEmptyGenerationBatchSummary } from '@/domain/queue/summary'
import {
    deriveDraftActivityStatus,
    resolveGuidedActivityTargetNode,
} from '@/presentation/activity/activity-status'

const source = (path: string) => readFile(resolve(process.cwd(), path), 'utf8')

describe('My Work draft activity status', () => {
    it('resumes terminal work at its result surface', () => {
        expect(resolveGuidedActivityTargetNode('review', 'completed')).toBe('result')
        expect(resolveGuidedActivityTargetNode('review', 'failed')).toBe('result')
        expect(resolveGuidedActivityTargetNode('review', 'cancelled')).toBe('result')
        expect(resolveGuidedActivityTargetNode('review', 'needs-attention')).toBe('result')
        expect(resolveGuidedActivityTargetNode('prompt', 'draft')).toBe('prompt')
        expect(resolveGuidedActivityTargetNode('review', 'queued')).toBe('review')
    })

    it('derives off-screen Guided completion only when every durable job succeeded', () => {
        const succeededBase = createEmptyGenerationBatchSummary('batch:done')
        const succeeded = {
            ...succeededBase,
            total: 2,
            completed: 2,
            states: { ...succeededBase.states, succeeded: 2 },
        }

        expect(deriveDraftActivityStatus('queued', succeeded)).toBe('completed')

        const failedBase = createEmptyGenerationBatchSummary('batch:failed')
        const failed = {
            ...failedBase,
            total: 2,
            completed: 2,
            states: { ...failedBase.states, succeeded: 1, failed: 1 },
        }

        expect(deriveDraftActivityStatus('queued', failed)).toBe('failed')

        const blocked = {
            ...failedBase,
            total: 1,
            states: { ...failedBase.states, blocked: 1 },
        }
        const cancelled = {
            ...failedBase,
            total: 1,
            completed: 1,
            states: { ...failedBase.states, cancelled: 1 },
        }
        expect(deriveDraftActivityStatus('queued', blocked)).toBe('needs-attention')
        expect(deriveDraftActivityStatus('queued', cancelled)).toBe('cancelled')
        expect(deriveDraftActivityStatus('review', succeeded)).toBe('review')
        expect(deriveDraftActivityStatus('queued', null)).toBe('queued')
    })

    it('shares one activity presentation and refresh owner across both app shells', async () => {
        const [activity, guidedShell, advancedShell] = await Promise.all([
            source('src/presentation/activity/MyWorkActivity.tsx'),
            source('src/presentation/workflow/GuidedShell.tsx'),
            source('src/components/layout/ThreeColumnLayout.tsx'),
        ])

        expect(guidedShell).toContain('<MyWorkActivity')
        expect(guidedShell).toContain('<MyWorkActivityRefreshOwner />')
        expect(guidedShell).not.toContain('function DraftActivityRows')
        expect(guidedShell).not.toContain('function CredentialActivityRows')
        expect(advancedShell).toContain('<MyWorkActivity headingIsDecorative />')
        expect(advancedShell).toContain('<MyWorkActivityRefreshOwner />')
        expect(activity).toContain('getBatchProjectionMeta(draft.lastSnapshotId)')
        expect(activity).toContain('<QueueActivityLinkView')
        expect(activity).toContain('summary={readModel.queue}')
        expect(activity).toContain("queueTarget = '/queue'")
        expect(activity).toContain('to={queueTarget}')
        expect(guidedShell).toContain('queueTarget="/guided-preview/task/batch/queue"')
        expect(activity.match(/window\.setInterval\(/g)).toHaveLength(1)
    })
})
