import {
    ensureTaggerServer,
    LOCAL_TAGGER_BASE_URL,
} from '@/services/local-tagger-server'

export type R2DeployMode = 'current-session' | 'delta' | 'full-sync' | 'dry-run'
export type R2UploaderKind = 'wrangler' | 's3'
export type R2DeployJobStatus = 'queued' | 'planning' | 'running' | 'completed' | 'failed' | 'cancelled'
export type R2DeployItemStatus = 'planned' | 'uploaded' | 'skipped' | 'failed' | 'cancelled'
export type R2RemoteStatus = 'present' | 'missing' | 'unknown' | 'skipped'

export interface R2DeployFileSpec {
    path: string
    key?: string
    content_type?: string
    kind?: string
}

export interface R2DeployRequest {
    mode: R2DeployMode
    bucket: string
    key_prefix?: string
    local_root?: string
    files?: R2DeployFileSpec[]
    include_patterns?: string[]
    exclude_patterns?: string[]
    manifest_path?: string
    uploader?: R2UploaderKind
    wrangler_command?: string | string[]
    wrangler_cwd?: string
    wrangler_config?: string
    wrangler_env?: string
    wrangler_profile?: string
    jurisdiction?: string
    remote?: boolean
    cache_control?: string
    storage_class?: string
    command_timeout_seconds?: number
    dry_run_limit?: number
    stop_on_error?: boolean
}

export interface R2DeployStartResponse {
    job_id: string
    status: R2DeployJobStatus
    message: string
}

export interface R2DeployJobItemResult {
    key: string
    path: string
    status: R2DeployItemStatus
    size: number
    content_type: string
    message?: string | null
}

export interface R2DeployJobResponse {
    job_id: string
    status: R2DeployJobStatus
    mode: R2DeployMode
    bucket: string
    key_prefix: string
    total: number
    completed: number
    failed: number
    skipped: number
    cancel_requested: boolean
    current_key?: string | null
    message: string
    error?: string | null
    started_at: string
    updated_at: string
    finished_at?: string | null
    results: R2DeployJobItemResult[]
}

export interface R2ScopeCheckParams {
    local_root: string
    bucket: string
    key_prefix?: string
    mode?: R2DeployMode
    include_patterns?: string[]
    exclude_patterns?: string[]
    manifest_path?: string
    remote_probe?: boolean
    remote_probe_limit?: number
    wrangler_command?: string
    wrangler_cwd?: string
    wrangler_config?: string
    wrangler_env?: string
    wrangler_profile?: string
    jurisdiction?: string
    remote?: boolean
}

export interface R2ScopeCheckItem {
    key: string
    path: string
    size: number
    content_type: string
    manifest_status: 'uploaded' | 'changed' | 'new'
    remote_status: R2RemoteStatus
}

export interface R2ScopeCheckResponse {
    bucket: string
    key_prefix: string
    local_root: string
    total_local: number
    planned: number
    manifest_uploaded: number
    manifest_missing_or_changed: number
    remote_checked: number
    remote_present: number
    remote_missing: number
    remote_unknown: number
    truncated: boolean
    credential_hint: string
    items: R2ScopeCheckItem[]
}

export interface R2DeployPollOptions {
    intervalMs?: number
    timeoutMs?: number
}

const R2_DEPLOY_URL = `${LOCAL_TAGGER_BASE_URL}/asset/r2/deploy`
const R2_JOBS_URL = `${LOCAL_TAGGER_BASE_URL}/asset/r2/jobs`
const R2_SCOPE_CHECK_URL = `${LOCAL_TAGGER_BASE_URL}/asset/r2/scope-check`

/**
 * Starts a local R2 deployment job through `src-tauri/python/r2_deploy.py`.
 * Credentials are deliberately absent from this contract: callers should use
 * Wrangler login/profile state or a future Tauri Secure Settings bridge, while
 * asset-profile JSON stores only non-secret bucket and key-prefix settings.
 */
export async function startR2DeployJob(
    request: R2DeployRequest,
): Promise<R2DeployStartResponse> {
    await ensureTaggerServer()

    const response = await fetch(R2_DEPLOY_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
    })

    if (!response.ok) {
        throw new Error(`R2 deploy start failed with HTTP ${response.status}: ${await readR2Error(response)}`)
    }

    return await response.json() as R2DeployStartResponse
}

export async function getR2DeployJob(jobId: string): Promise<R2DeployJobResponse> {
    await ensureTaggerServer()

    const response = await fetch(`${R2_JOBS_URL}/${encodeURIComponent(jobId)}`, {
        method: 'GET',
    })

    if (!response.ok) {
        throw new Error(`R2 deploy status failed with HTTP ${response.status}: ${await readR2Error(response)}`)
    }

    return await response.json() as R2DeployJobResponse
}

export async function cancelR2DeployJob(jobId: string): Promise<R2DeployJobResponse> {
    await ensureTaggerServer()

    const response = await fetch(`${R2_JOBS_URL}/${encodeURIComponent(jobId)}/cancel`, {
        method: 'POST',
    })

    if (!response.ok) {
        throw new Error(`R2 deploy cancel failed with HTTP ${response.status}: ${await readR2Error(response)}`)
    }

    return await response.json() as R2DeployJobResponse
}

export async function checkR2DeployScope(
    params: R2ScopeCheckParams,
): Promise<R2ScopeCheckResponse> {
    await ensureTaggerServer()

    const query = toScopeCheckQuery(params)
    const response = await fetch(`${R2_SCOPE_CHECK_URL}?${query}`, {
        method: 'GET',
    })

    if (!response.ok) {
        throw new Error(`R2 scope check failed with HTTP ${response.status}: ${await readR2Error(response)}`)
    }

    return await response.json() as R2ScopeCheckResponse
}

export async function pollR2DeployJob(
    jobId: string,
    options: R2DeployPollOptions = {},
): Promise<R2DeployJobResponse> {
    const intervalMs = options.intervalMs ?? 1000
    const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000
    const startedAt = Date.now()

    while (true) {
        const job = await getR2DeployJob(jobId)
        if (isTerminalR2DeployStatus(job.status)) {
            return job
        }

        if (Date.now() - startedAt >= timeoutMs) {
            throw new Error(`R2 deploy polling timed out after ${timeoutMs}ms`)
        }

        await sleep(intervalMs)
    }
}

export function isTerminalR2DeployStatus(status: R2DeployJobStatus): boolean {
    return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function toScopeCheckQuery(params: R2ScopeCheckParams): string {
    const query = new URLSearchParams()

    appendString(query, 'local_root', params.local_root)
    appendString(query, 'bucket', params.bucket)
    appendString(query, 'key_prefix', params.key_prefix)
    appendString(query, 'mode', params.mode)
    appendString(query, 'include_patterns', params.include_patterns?.join(','))
    appendString(query, 'exclude_patterns', params.exclude_patterns?.join(','))
    appendString(query, 'manifest_path', params.manifest_path)
    appendBoolean(query, 'remote_probe', params.remote_probe)
    appendNumber(query, 'remote_probe_limit', params.remote_probe_limit)
    appendString(query, 'wrangler_command', params.wrangler_command)
    appendString(query, 'wrangler_cwd', params.wrangler_cwd)
    appendString(query, 'wrangler_config', params.wrangler_config)
    appendString(query, 'wrangler_env', params.wrangler_env)
    appendString(query, 'wrangler_profile', params.wrangler_profile)
    appendString(query, 'jurisdiction', params.jurisdiction)
    appendBoolean(query, 'remote', params.remote)

    return query.toString()
}

async function readR2Error(response: Response): Promise<string> {
    const text = await response.text()
    if (!text) {
        return 'empty response body'
    }

    try {
        const payload = JSON.parse(text) as { detail?: unknown }
        return formatErrorDetail(payload.detail) || text
    } catch {
        return text
    }
}

function formatErrorDetail(detail: unknown): string {
    if (typeof detail === 'string') {
        return detail
    }

    if (Array.isArray(detail)) {
        return detail.map(formatErrorDetail).filter(Boolean).join('; ')
    }

    if (hasValidationMessage(detail) && typeof detail.msg === 'string') {
        return detail.msg
    }

    if (detail && typeof detail === 'object') {
        return JSON.stringify(detail)
    }

    return ''
}

function hasValidationMessage(value: unknown): value is { msg: unknown } {
    return typeof value === 'object' && value !== null && 'msg' in value
}

function appendString(query: URLSearchParams, key: string, value: string | undefined): void {
    if (value !== undefined && value !== '') {
        query.set(key, value)
    }
}

function appendBoolean(query: URLSearchParams, key: string, value: boolean | undefined): void {
    if (value !== undefined) {
        query.set(key, String(value))
    }
}

function appendNumber(query: URLSearchParams, key: string, value: number | undefined): void {
    if (value !== undefined) {
        query.set(key, String(value))
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms))
}
