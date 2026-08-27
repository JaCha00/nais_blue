import type { PortableResourceIssue } from '@/platform/portable-resources'
import type { ReadonlyCompositionIssue } from './types'

/** Maps platform availability into the resolved-plan presentation contract. */
export function portableIssuesForResolvedPlan(
    issues: readonly PortableResourceIssue[],
): ReadonlyCompositionIssue[] {
    return issues.map(issue => ({
        code: issue.code,
        severity: 'error',
        messageKey: `composition.issue.${portableIssueKey(issue.code)}`,
        repairHintKey: `composition.repair.${portableRepairKey(issue.code)}`,
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

function portableIssueKey(code: PortableResourceIssue['code']): string {
    switch (code) {
        case 'E_PORTABLE_PATH_INVALID': return 'portablePathInvalid'
        case 'E_PORTABLE_PATH_ROOT_UNSUPPORTED': return 'portablePathRootUnsupported'
        case 'E_PORTABLE_PATH_TOKEN_MISSING': return 'portablePathTokenMissing'
        case 'E_PORTABLE_PATH_PLATFORM_MISMATCH': return 'portablePathPlatformMismatch'
    }
}

function portableRepairKey(code: PortableResourceIssue['code']): string {
    switch (code) {
        case 'E_PORTABLE_PATH_INVALID': return 'repairPortableLocation'
        case 'E_PORTABLE_PATH_ROOT_UNSUPPORTED': return 'copyPortableToAppData'
        case 'E_PORTABLE_PATH_TOKEN_MISSING': return 'locatePortableResource'
        case 'E_PORTABLE_PATH_PLATFORM_MISMATCH': return 'replacePortableLocation'
    }
}
