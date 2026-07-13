import type { CompositionAuthority } from '@/domain/composition/repository'
import { parseCompositionDocument } from '@/domain/composition/schema'
import type { CompositionDocument } from '@/domain/composition/types'

let runtimeAuthority: CompositionAuthority = 'legacy'
let runtimeDocument: CompositionDocument | null = null

/** Fail-closed process authority; startup is the only code that enables v2. */
export function setRuntimeCompositionAuthority(authority: CompositionAuthority): void {
    runtimeAuthority = authority
    if (authority === 'legacy') runtimeDocument = null
}

export function getRuntimeCompositionAuthority(): CompositionAuthority {
    return runtimeAuthority
}

/** Installs the repository-verified document used by every v2 workflow. */
export function setRuntimeCompositionDocument(document: CompositionDocument | null): void {
    runtimeDocument = document === null ? null : parseCompositionDocument(document)
}

export function getRuntimeCompositionDocument(): CompositionDocument | null {
    return runtimeAuthority === 'v2' && runtimeDocument !== null
        ? parseCompositionDocument(runtimeDocument)
        : null
}

export function effectiveMainCompositionMode<T extends 'legacy' | 'shadow' | 'v2'>(mode: T): T | 'legacy' {
    return runtimeAuthority === 'v2' ? mode : 'legacy'
}

export function effectiveSceneCompositionMode<T extends 'legacy' | 'shadow' | 'v2'>(mode: T): T | 'legacy' {
    return runtimeAuthority === 'v2' ? mode : 'legacy'
}

export function effectiveStyleLabCompositionMode<T extends 'legacy' | 'v2'>(mode: T): T | 'legacy' {
    return runtimeAuthority === 'v2' ? mode : 'legacy'
}
