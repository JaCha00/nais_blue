export const PRODUCT_GUIDANCE_OPEN_EVENT = 'nais:product-guidance:open'

const AUTH_CODES = new Set(['AUTH_UNAUTHORIZED'])
const OUTPUT_CODES = new Set(['LOCAL_IO_FAILED', 'IMAGE_PROCESSING_FAILED'])
const R2_CODES = new Set(['R2_AUTH_FAILED', 'R2_UPLOAD_FAILED', 'R2_CONFLICT', 'SYNC_FAILED'])
const QUEUE_CODES = new Set([
    'NETWORK_UNAVAILABLE',
    'RATE_LIMITED',
    'NOVELAI_API_FAILURE',
    'RESPONSE_DECODE_FAILED',
    'OPERATION_CANCELLED',
    'OPERATION_TIMEOUT',
    'OPERATION_STALLED',
])

export type DiagnosticGuideSection = 'credential' | 'output' | 'r2' | 'queue' | 'advanced'

/** Diagnostic codes remain stable identifiers; only their guide destination is localized. */
export function guideSectionForDiagnosticCode(code: string): DiagnosticGuideSection {
    if (AUTH_CODES.has(code)) return 'credential'
    if (OUTPUT_CODES.has(code)) return 'output'
    if (R2_CODES.has(code)) return 'r2'
    if (QUEUE_CODES.has(code)) return 'queue'
    return 'advanced'
}

export function openProductGuidance(diagnosticCode?: string): void {
    window.dispatchEvent(new CustomEvent(PRODUCT_GUIDANCE_OPEN_EVENT, {
        detail: diagnosticCode === undefined ? {} : { diagnosticCode },
    }))
}
