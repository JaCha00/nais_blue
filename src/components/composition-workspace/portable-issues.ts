import type { PortableResourceIssue } from '@/platform/portable-resources'
import type { ReadonlyCompositionIssue } from './types'

/** Maps platform availability into the resolved-plan presentation contract. */
export function portableIssuesForResolvedPlan(
    issues: readonly PortableResourceIssue[],
): ReadonlyCompositionIssue[] {
    return issues.map(issue => ({
        code: issue.code,
        severity: 'error',
        messageKey: `${issue.message} ${issue.repairAction.label}`,
        fieldPath: issue.resourceId === 'output-destination'
            ? ['outputPolicy', 'destination']
            : ['resources', issue.resourceId ?? 'unknown'],
        actionId: issue.repairAction.kind,
        blocking: true,
        ...(issue.resourceId === undefined
            ? {}
            : { entityRef: { kind: issue.resourceId === 'output-destination' ? 'output' : 'resource', id: issue.resourceId } }),
    }))
}
