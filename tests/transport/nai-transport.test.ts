import { describe, expect, it, vi } from 'vitest'

import {
    NaiTransportCancelledError,
    NaiTransportTimeoutError,
    createFetchNaiTransport,
    createRustNaiTransport,
    type NaiNativeTransportEvent,
    type NaiTransportRequest,
    type RustNaiTransportBindings,
} from '@/services/nai/transport'

const request = (overrides: Partial<NaiTransportRequest> = {}): NaiTransportRequest => ({
    endpoint: 'standard',
    token: 'synthetic-token',
    payload: '{"input":"synthetic"}',
    timeoutMs: 100,
    ...overrides,
})

describe('NaiTransport fetch adapters', () => {
    it('completes a standard response and reports bounded transport stages', async () => {
        const stages: string[] = []
        const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { 'content-type': 'application/zip' },
        }))
        const transport = createFetchNaiTransport('browser-fetch', fetchImpl)

        const response = await transport.request(request({ onStage: stage => stages.push(stage) }))

        expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
        expect(fetchImpl).toHaveBeenCalledTimes(1)
        expect(stages).toEqual([
            'dns-connect',
            'request-sent',
            'response-headers',
            'body-first-byte',
            'stream-heartbeat',
        ])
    })

    it('streams chunks with a first-byte marker and ongoing heartbeats', async () => {
        const stages: string[] = []
        const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array([1]))
                controller.enqueue(new Uint8Array([2, 3]))
                controller.close()
            },
        }), { status: 200 }))
        const transport = createFetchNaiTransport('tauri-http-plugin', fetchImpl)

        const response = await transport.request(request({
            endpoint: 'stream',
            onStage: stage => stages.push(stage),
        }))

        expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
        expect(stages.filter(stage => stage === 'body-first-byte')).toHaveLength(1)
        expect(stages.filter(stage => stage === 'stream-heartbeat')).toHaveLength(2)
    })

    it('rejects an already-cancelled request before fetch is called', async () => {
        const fetchImpl = vi.fn<typeof fetch>()
        const controller = new AbortController()
        controller.abort()
        const transport = createFetchNaiTransport('browser-fetch', fetchImpl)

        await expect(transport.request(request({ signal: controller.signal })))
            .rejects.toBeInstanceOf(NaiTransportCancelledError)
        expect(fetchImpl).not.toHaveBeenCalled()
    })

    it('passes cancellation to the active fetch and terminates even if fetch never settles', async () => {
        let receivedSignal: AbortSignal | undefined
        const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
            receivedSignal = init?.signal ?? undefined
            return new Promise<Response>(() => undefined)
        })
        const controller = new AbortController()
        const transport = createFetchNaiTransport('tauri-http-plugin', fetchImpl)
        const pending = transport.request(request({ signal: controller.signal }))

        await vi.waitFor(() => expect(receivedSignal).toBeDefined())
        controller.abort()

        await expect(pending).rejects.toBeInstanceOf(NaiTransportCancelledError)
        expect(receivedSignal?.aborted).toBe(true)
    })

    it('terminates a hung request with a typed timeout', async () => {
        const fetchImpl = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined))
        const transport = createFetchNaiTransport('browser-fetch', fetchImpl)

        await expect(transport.request(request({ timeoutMs: 10 })))
            .rejects.toBeInstanceOf(NaiTransportTimeoutError)
    })

    it('aborts an active response body and rejects the reader with a typed cancellation', async () => {
        let bodyCancelled = false
        const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new ReadableStream<Uint8Array>({
            pull() {
                return new Promise<void>(() => undefined)
            },
            cancel() {
                bodyCancelled = true
            },
        }), { status: 200 }))
        const controller = new AbortController()
        const transport = createFetchNaiTransport('browser-fetch', fetchImpl)
        const response = await transport.request(request({
            endpoint: 'stream',
            signal: controller.signal,
        }))
        const body = response.arrayBuffer()

        controller.abort()

        await expect(body).rejects.toBeInstanceOf(NaiTransportCancelledError)
        await vi.waitFor(() => expect(bodyCancelled).toBe(true))
    })

    it('terminates a hung streaming body with a typed timeout', async () => {
        let bodyCancelled = false
        const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new ReadableStream<Uint8Array>({
            pull() {
                return new Promise<void>(() => undefined)
            },
            cancel() {
                bodyCancelled = true
            },
        }), { status: 200 }))
        const transport = createFetchNaiTransport('browser-fetch', fetchImpl)
        const response = await transport.request(request({ endpoint: 'stream', timeoutMs: 10 }))

        await expect(response.arrayBuffer()).rejects.toBeInstanceOf(NaiTransportTimeoutError)
        await vi.waitFor(() => expect(bodyCancelled).toBe(true))
    })

    it('preserves a 429 response for the existing retry policy', async () => {
        const transport = createFetchNaiTransport(
            'browser-fetch',
            async () => new Response('rate limited', { status: 429 }),
        )

        const response = await transport.request(request())

        expect(response.status).toBe(429)
        expect(await response.text()).toBe('rate limited')
    })
})

class FakeChannel<T> {
    constructor(readonly onmessage: (message: T) => void) {}

    emit(message: T): void {
        this.onmessage(message)
    }
}

describe('NaiTransport Android Rust adapter', () => {
    it('consumes JSON body chunks on the ordered mobile event channel before end', async () => {
        const bindings: RustNaiTransportBindings = {
            createChannel: onmessage => new FakeChannel(onmessage),
            invoke: async (command, args) => {
                if (command !== 'nai_generate_request') return false as never
                expect(args).not.toHaveProperty('onBody')
                const event = args.onEvent as FakeChannel<NaiNativeTransportEvent>
                event.emit({ type: 'response-headers', status: 200, contentType: 'application/zip' })
                event.emit({
                    type: 'body-chunk',
                    bytesBase64: 'AQID',
                })
                event.emit({ type: 'end' })
                return undefined as never
            },
        }
        const transport = createRustNaiTransport(bindings)

        const response = await transport.request(request())

        expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    })

    it.each(['standard', 'stream'] as const)(
        'assembles a %s channel response without exposing a general URL',
        async endpoint => {
            const invocations: string[] = []
            const endpointArguments: unknown[] = []
            const bindings: RustNaiTransportBindings = {
                createChannel: onmessage => new FakeChannel(onmessage),
                invoke: async (command, args) => {
                    invocations.push(command)
                    if (command !== 'nai_generate_request') return false as never
                    endpointArguments.push(args.endpoint)
                    expect(args).not.toHaveProperty('url')
                    expect(args).not.toHaveProperty('onBody')
                    const event = args.onEvent as FakeChannel<NaiNativeTransportEvent>
                    event.emit({ type: 'dns-connect' })
                    event.emit({ type: 'request-sent' })
                    event.emit({ type: 'response-headers', status: 200, contentType: 'application/zip' })
                    event.emit({ type: 'body-chunk', bytesBase64: 'AQI=' })
                    event.emit({ type: 'body-chunk', bytesBase64: 'Aw==' })
                    event.emit({ type: 'end' })
                    return undefined as never
                },
            }
            const transport = createRustNaiTransport(bindings)

            const response = await transport.request(request({ endpoint }))

            expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
            expect(invocations).toEqual(['nai_generate_request'])
            expect(endpointArguments).toEqual([endpoint])
        },
    )

    it('invokes native cancellation when a channel response is in flight', async () => {
        const invocations: string[] = []
        const bindings: RustNaiTransportBindings = {
            createChannel: onmessage => new FakeChannel(onmessage),
            invoke: async (command, args) => {
                invocations.push(command)
                if (command === 'cancel_nai_request') return true as never
                const event = args.onEvent as FakeChannel<NaiNativeTransportEvent>
                event.emit({ type: 'dns-connect' })
                event.emit({ type: 'request-sent' })
                event.emit({ type: 'response-headers', status: 200, contentType: 'application/x-msgpack' })
                return new Promise<never>(() => undefined)
            },
        }
        const controller = new AbortController()
        const transport = createRustNaiTransport(bindings)
        const response = await transport.request(request({
            endpoint: 'stream',
            signal: controller.signal,
        }))
        const body = response.arrayBuffer()

        controller.abort()

        await expect(body).rejects.toBeInstanceOf(NaiTransportCancelledError)
        await vi.waitFor(() => expect(invocations).toContain('cancel_nai_request'))
    })
})
