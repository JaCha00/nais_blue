import { Channel, invoke, isTauri } from '@tauri-apps/api/core'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

import { isAndroidRuntime } from '@/platform/runtime'
import { NAI_ENDPOINTS } from '@/services/nai/endpoints'

export type NaiTransportKind = 'browser-fetch' | 'tauri-http-plugin' | 'android-rust-reqwest'
export type NaiGenerationEndpoint = 'standard' | 'stream'
export type NaiTransportStage =
    | 'dns-connect'
    | 'request-sent'
    | 'response-headers'
    | 'body-first-byte'
    | 'stream-heartbeat'

export type NaiProviderObservation =
    | { readonly stage: 'before-request' }
    | { readonly stage: 'possibly-dispatched' }
    | { readonly stage: 'response-started'; readonly status: number; readonly retryAfter: string | null }
    | { readonly stage: 'response-complete'; readonly status: number; readonly retryAfter: string | null }

export type NaiProviderObserver = (
    observation: NaiProviderObservation,
) => void | Promise<void>

export type NaiProviderFaultPoint =
    | 'before-request'
    | 'after-dispatch'
    | 'after-first-stream-chunk'
    | 'after-response-received'
    | 'after-spool-commit'

export type NaiProviderFaultInjector = (
    point: NaiProviderFaultPoint,
) => void | Promise<void>

export interface NaiTransportRequest {
    endpoint: NaiGenerationEndpoint
    token: string
    payload: string
    timeoutMs: number
    signal?: AbortSignal
    onStage?: (stage: NaiTransportStage) => void
    /** Awaited evidence seam; callers persist each observation before transport advances. */
    observer?: NaiProviderObserver
    /** Optional deterministic test seam; production requests leave it absent. */
    faultInjector?: NaiProviderFaultInjector
}

export interface NaiTransport {
    readonly kind: NaiTransportKind
    request: (request: NaiTransportRequest) => Promise<Response>
}

export class NaiTransportCancelledError extends Error {
    readonly kind = 'cancelled' as const
    readonly phase = 'transport-cancelled'

    constructor() {
        super('NovelAI request was cancelled')
        this.name = 'NaiTransportCancelledError'
    }
}

export class NaiTransportTimeoutError extends Error {
    readonly kind = 'timeout' as const
    readonly phase = 'transport-timeout'

    constructor(readonly timeoutMs: number) {
        super('NovelAI request timed out')
        this.name = 'NaiTransportTimeoutError'
    }
}

export class NaiTransportNetworkError extends Error {
    readonly kind = 'network' as const
    readonly phase = 'transport-network'

    constructor(cause?: unknown) {
        super('NovelAI network transport failed')
        this.name = 'NaiTransportNetworkError'
        if (cause !== undefined) (this as Error & { cause?: unknown }).cause = cause
    }
}

class RequestLifetime {
    private readonly controller = new AbortController()
    private readonly abortHandlers = new Set<(error: Error) => void>()
    private readonly rejection: Promise<never>
    private rejectRejection!: (error: Error) => void
    private timer: ReturnType<typeof setTimeout> | undefined
    private failureValue: Error | null = null
    private finished = false

    constructor(
        private readonly externalSignal: AbortSignal | undefined,
        timeoutMs: number,
    ) {
        this.rejection = new Promise<never>((_resolve, reject) => {
            this.rejectRejection = reject
        })
        void this.rejection.catch(() => undefined)

        if (externalSignal?.aborted) {
            this.fail(new NaiTransportCancelledError())
            return
        }

        externalSignal?.addEventListener('abort', this.handleExternalAbort, { once: true })
        this.timer = setTimeout(() => this.fail(new NaiTransportTimeoutError(timeoutMs)), timeoutMs)
    }

    get signal(): AbortSignal {
        return this.controller.signal
    }

    get failure(): Error | null {
        return this.failureValue
    }

    race<T>(promise: Promise<T>): Promise<T> {
        if (this.failureValue) return Promise.reject(this.failureValue)
        return Promise.race([promise, this.rejection])
    }

    cancel(): void {
        this.fail(new NaiTransportCancelledError())
    }

    fail(error: Error): void {
        if (this.finished || this.failureValue) return
        this.failureValue = error
        this.controller.abort(error)
        this.rejectRejection(error)
        for (const handler of this.abortHandlers) handler(error)
    }

    onAbort(handler: (error: Error) => void): () => void {
        this.abortHandlers.add(handler)
        if (this.failureValue) handler(this.failureValue)
        return () => this.abortHandlers.delete(handler)
    }

    normalize(error: unknown): Error {
        if (this.failureValue) return this.failureValue
        if (error instanceof NaiTransportCancelledError || error instanceof NaiTransportTimeoutError) return error
        if (error instanceof DOMException && error.name === 'AbortError') return new NaiTransportCancelledError()
        if (error instanceof Error && error.name === 'AbortError') return new NaiTransportCancelledError()
        return new NaiTransportNetworkError(error)
    }

    finish(): void {
        if (this.finished) return
        this.finished = true
        if (this.timer !== undefined) clearTimeout(this.timer)
        this.externalSignal?.removeEventListener('abort', this.handleExternalAbort)
        this.abortHandlers.clear()
    }

    private readonly handleExternalAbort = (): void => {
        this.fail(new NaiTransportCancelledError())
    }
}

function validateTimeout(timeoutMs: number): void {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error('NaiTransport timeout must be a positive finite duration')
    }
}

function endpointUrl(endpoint: NaiGenerationEndpoint): string {
    return endpoint === 'stream' ? NAI_ENDPOINTS.generateImageStream : NAI_ENDPOINTS.generateImage
}

function requestHeaders(request: NaiTransportRequest): Record<string, string> {
    return {
        'Content-Type': 'application/json',
        'User-Agent': 'NAI-Blue/1.0',
        Authorization: `Bearer ${request.token.trim()}`,
        ...(request.endpoint === 'stream' ? { Accept: 'application/x-msgpack' } : {}),
    }
}

async function observeProvider(
    lifetime: RequestLifetime,
    observer: NaiTransportRequest['observer'],
    observation: NaiProviderObservation,
): Promise<void> {
    if (lifetime.failure !== null) throw lifetime.failure
    if (observer === undefined) return
    await lifetime.race(Promise.resolve().then(() => observer(observation)))
}

async function observeResponse(
    response: Response,
    lifetime: RequestLifetime,
    endpoint: NaiGenerationEndpoint,
    onStage: NaiTransportRequest['onStage'],
    faultInjector: NaiTransportRequest['faultInjector'],
    observer: NaiTransportRequest['observer'],
): Promise<Response> {
    const responseObservation = {
        status: response.status,
        retryAfter: response.headers.get('Retry-After'),
    }
    if (!response.body) {
        await observeProvider(lifetime, observer, { stage: 'response-complete', ...responseObservation })
        lifetime.finish()
        return response
    }

    const reader = response.body.getReader()
    let firstByteSeen = false
    let released = false
    const removeAbortHandler = lifetime.onAbort(() => {
        void reader.cancel().catch(() => undefined)
    })
    const release = (): void => {
        if (released) return
        released = true
        removeAbortHandler()
        lifetime.finish()
        try {
            reader.releaseLock()
        } catch {
            // The stream owns the reader until completion or cancellation.
        }
    }

    const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                const { done, value } = await lifetime.race(reader.read())
                if (done) {
                    await observeProvider(lifetime, observer, { stage: 'response-complete', ...responseObservation })
                    if (faultInjector !== undefined) {
                        await faultInjector('after-response-received')
                    }
                    release()
                    controller.close()
                    return
                }
                if (!firstByteSeen) {
                    firstByteSeen = true
                    onStage?.('body-first-byte')
                    if (endpoint === 'stream' && faultInjector !== undefined) {
                        await faultInjector('after-first-stream-chunk')
                    }
                }
                onStage?.('stream-heartbeat')
                controller.enqueue(value)
            } catch (error) {
                const normalized = lifetime.normalize(error)
                release()
                controller.error(normalized)
            }
        },
        async cancel(reason) {
            lifetime.cancel()
            try {
                await reader.cancel(reason)
            } finally {
                release()
            }
        },
    })

    return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    })
}

export function createFetchNaiTransport(
    kind: Exclude<NaiTransportKind, 'android-rust-reqwest'>,
    fetchImpl: typeof fetch,
): NaiTransport {
    return {
        kind,
        async request(request) {
            validateTimeout(request.timeoutMs)
            const lifetime = new RequestLifetime(request.signal, request.timeoutMs)
            let preservePreparationError = false
            try {
                await observeProvider(lifetime, request.observer, { stage: 'before-request' })
                if (request.faultInjector !== undefined) {
                    preservePreparationError = true
                    await request.faultInjector('before-request')
                    preservePreparationError = false
                    if (request.signal?.aborted) throw new NaiTransportCancelledError()
                }
                await observeProvider(lifetime, request.observer, { stage: 'possibly-dispatched' })
                request.onStage?.('dns-connect')
                const pending = fetchImpl(endpointUrl(request.endpoint), {
                    method: 'POST',
                    headers: requestHeaders(request),
                    body: request.payload,
                    signal: lifetime.signal,
                })
                request.onStage?.('request-sent')
                const observedPending = lifetime.race(pending)
                void observedPending.catch(() => undefined)
                if (request.faultInjector !== undefined) {
                    await request.faultInjector('after-dispatch')
                }
                const response = await observedPending
                request.onStage?.('response-headers')
                await observeProvider(lifetime, request.observer, {
                    stage: 'response-started',
                    status: response.status,
                    retryAfter: response.headers.get('Retry-After'),
                })
                return observeResponse(
                    response,
                    lifetime,
                    request.endpoint,
                    request.onStage,
                    request.faultInjector,
                    request.observer,
                )
            } catch (error) {
                const normalized = preservePreparationError && lifetime.failure === null
                    ? error
                    : lifetime.normalize(error)
                lifetime.finish()
                throw normalized
            }
        },
    }
}

export type NaiNativeTransportEvent =
    | { type: 'dns-connect' }
    | { type: 'request-sent' }
    | { type: 'response-headers', status: number, contentType?: string | null }
    | { type: 'body-chunk', bytesBase64: string }
    | { type: 'end' }
    | { type: 'cancelled' }
    | { type: 'timeout' }
    | { type: 'error', kind: 'network' | 'transport' }

export interface RustNaiChannel<T> {
    onmessage: (message: T) => void
}

export interface RustNaiTransportBindings {
    createChannel: <T>(onmessage: (message: T) => void) => RustNaiChannel<T>
    invoke: <T>(command: string, args: Record<string, unknown>) => Promise<T>
}

const defaultRustBindings: RustNaiTransportBindings = {
    createChannel: onmessage => new Channel(onmessage),
    invoke: (command, args) => invoke(command, args),
}

let requestCounter = 0

function nativeRequestId(): string {
    const uuid = globalThis.crypto?.randomUUID?.()
    return uuid ?? `nai-request-${Date.now()}-${++requestCounter}`
}

function decodeNativeBodyChunk(value: string): Uint8Array {
    const binary = globalThis.atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
    }
    return bytes
}

export function createRustNaiTransport(
    bindings: RustNaiTransportBindings = defaultRustBindings,
): NaiTransport {
    return {
        kind: 'android-rust-reqwest',
        async request(request) {
            validateTimeout(request.timeoutMs)
            const lifetime = new RequestLifetime(request.signal, request.timeoutMs)
            let preservePreparationError = false
            try {
                await observeProvider(lifetime, request.observer, { stage: 'before-request' })
                if (request.faultInjector !== undefined) {
                    preservePreparationError = true
                    await request.faultInjector('before-request')
                    preservePreparationError = false
                    if (request.signal?.aborted) throw new NaiTransportCancelledError()
                }
                await observeProvider(lifetime, request.observer, { stage: 'possibly-dispatched' })
                const requestId = nativeRequestId()
                let responseResolved = false
                let nativeComplete = false
                let bodyController: ReadableStreamDefaultController<Uint8Array> | null = null
                let resolveResponse!: (response: Response) => void
                let rejectResponse!: (error: Error) => void
                const responsePromise = new Promise<Response>((resolve, reject) => {
                    resolveResponse = resolve
                    rejectResponse = reject
                })
                const body = new ReadableStream<Uint8Array>({
                    start(controller) {
                        bodyController = controller
                    },
                    cancel() {
                        lifetime.cancel()
                    },
                })

                const rejectNative = (error: Error): void => {
                    nativeComplete = true
                    if (!responseResolved) rejectResponse(error)
                    lifetime.fail(error)
                }

                const onEvent = bindings.createChannel<NaiNativeTransportEvent>(event => {
                    if (event.type === 'dns-connect' || event.type === 'request-sent') {
                        request.onStage?.(event.type)
                        return
                    }
                    if (event.type === 'response-headers') {
                        if (responseResolved) return
                        responseResolved = true
                        request.onStage?.('response-headers')
                        const response = new Response(body, {
                            status: event.status,
                            headers: event.contentType ? { 'content-type': event.contentType } : undefined,
                        })
                        void observeProvider(lifetime, request.observer, {
                            stage: 'response-started',
                            status: event.status,
                            // The current Rust event does not expose Retry-After.
                            retryAfter: null,
                        }).then(() => resolveResponse(response)).catch(error => {
                            rejectNative(error instanceof Error ? error : new NaiTransportNetworkError(error))
                        })
                        return
                    }
                    if (event.type === 'body-chunk') {
                        if (nativeComplete || lifetime.failure) return
                        try {
                            bodyController?.enqueue(decodeNativeBodyChunk(event.bytesBase64))
                        } catch {
                            rejectNative(new NaiTransportNetworkError())
                        }
                        return
                    }
                    if (event.type === 'end') {
                        nativeComplete = true
                        if (!lifetime.failure) bodyController?.close()
                        return
                    }
                    if (event.type === 'timeout') {
                        rejectNative(new NaiTransportTimeoutError(request.timeoutMs))
                        return
                    }
                    if (event.type === 'cancelled') {
                        rejectNative(new NaiTransportCancelledError())
                        return
                    }
                    const error = new NaiTransportNetworkError()
                    nativeComplete = true
                    if (!responseResolved) rejectResponse(error)
                    lifetime.fail(error)
                })
                lifetime.onAbort(() => {
                    if (nativeComplete) return
                    void bindings.invoke<boolean>('cancel_nai_request', { requestId }).catch(() => undefined)
                })

                void bindings.invoke<void>('nai_generate_request', {
                    requestId,
                    endpoint: request.endpoint,
                    token: request.token,
                    payload: request.payload,
                    timeoutMs: request.timeoutMs,
                    onEvent,
                }).catch(() => {
                    if (nativeComplete || lifetime.failure) return
                    const error = new NaiTransportNetworkError()
                    nativeComplete = true
                    if (!responseResolved) rejectResponse(error)
                    lifetime.fail(error)
                })

                const observedResponse = lifetime.race(responsePromise)
                void observedResponse.catch(() => undefined)
                if (request.faultInjector !== undefined) {
                    await request.faultInjector('after-dispatch')
                }
                const response = await observedResponse
                return observeResponse(
                    response,
                    lifetime,
                    request.endpoint,
                    request.onStage,
                    request.faultInjector,
                    request.observer,
                )
            } catch (error) {
                const normalized = preservePreparationError && lifetime.failure === null
                    ? error
                    : lifetime.normalize(error)
                lifetime.finish()
                throw normalized
            }
        },
    }
}

const browserTransport = createFetchNaiTransport('browser-fetch', (input, init) => {
    const browserFetch = typeof window !== 'undefined' && typeof window.fetch === 'function'
        ? window.fetch.bind(window)
        : globalThis.fetch.bind(globalThis)
    return browserFetch(input, init)
})

const tauriHttpTransport = createFetchNaiTransport('tauri-http-plugin', tauriFetch)
const androidRustTransport = createRustNaiTransport()

export function getRuntimeNaiTransport(): NaiTransport {
    if (!isTauri()) return browserTransport
    return isAndroidRuntime ? androidRustTransport : tauriHttpTransport
}

export function getNaiAuxiliaryFetch(): typeof fetch {
    if (isTauri()) return tauriFetch
    return typeof window !== 'undefined' && typeof window.fetch === 'function'
        ? window.fetch.bind(window)
        : globalThis.fetch.bind(globalThis)
}
