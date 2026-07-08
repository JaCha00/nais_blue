import { decode as msgpackDecode } from '@msgpack/msgpack'

const STREAM_MAX_MESSAGE_BYTES = 50_000_000

export interface NaiStreamEvent {
    eventType: string
    stepIx?: number
    imageBase64?: string
}

export interface NaiStreamHandlers {
    onEvent?: (event: NaiStreamEvent) => void
}

function binaryToBase64(data: Uint8Array): string {
    let binary = ''
    const chunkSize = 0x8000
    for (let i = 0; i < data.length; i += chunkSize) {
        binary += String.fromCharCode(...data.subarray(i, i + chunkSize))
    }
    return btoa(binary)
}

class StreamFrameBuffer {
    private chunks: Uint8Array[] = []
    private headOffset = 0
    length = 0

    append(chunk: Uint8Array): void {
        this.chunks.push(chunk)
        this.length += chunk.length
    }

    peekMessageLength(): number | null {
        if (this.length < 4) return null
        const header = this.readBytes(4, false)
        if (!header) return null
        return ((header[0] << 24) >>> 0) + (header[1] << 16) + (header[2] << 8) + header[3]
    }

    readMessage(length: number): Uint8Array | null {
        if (this.length < 4 + length) return null
        this.discard(4)
        return this.readBytes(length, true)
    }

    private discard(bytes: number): void {
        let remaining = bytes
        while (remaining > 0 && this.chunks.length > 0) {
            const first = this.chunks[0]
            const available = first.length - this.headOffset
            const consumed = Math.min(remaining, available)
            this.headOffset += consumed
            this.length -= consumed
            remaining -= consumed
            if (this.headOffset >= first.length) {
                this.chunks.shift()
                this.headOffset = 0
            }
        }
    }

    private readBytes(bytes: number, consume: boolean): Uint8Array | null {
        if (this.length < bytes) return null
        const result = new Uint8Array(bytes)
        let remaining = bytes
        let writeOffset = 0
        let chunkIndex = 0
        let offset = this.headOffset

        while (remaining > 0 && chunkIndex < this.chunks.length) {
            const chunk = this.chunks[chunkIndex]
            const available = chunk.length - offset
            const copied = Math.min(remaining, available)
            result.set(chunk.subarray(offset, offset + copied), writeOffset)
            writeOffset += copied
            remaining -= copied
            chunkIndex++
            offset = 0
        }

        if (consume) this.discard(bytes)
        return result
    }
}

export async function readNaiImageStream(
    body: ReadableStream<Uint8Array>,
    handlers: NaiStreamHandlers = {},
    signal?: AbortSignal,
): Promise<string> {
    const reader = body.getReader()
    const buffer = new StreamFrameBuffer()
    let finalImage: string | null = null

    const abortReader = async () => {
        try {
            await reader.cancel()
        } catch {
            // Reader cancellation is best effort after an upstream abort.
        }
    }

    if (signal?.aborted) {
        await abortReader()
        throw new DOMException('요청이 취소되었습니다.', 'AbortError')
    }

    const onAbort = () => {
        void abortReader()
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    try {
        while (true) {
            const { done, value } = await reader.read()
            if (value) {
                buffer.append(value)
                while (buffer.length >= 4) {
                    const length = buffer.peekMessageLength()
                    if (length === null) break
                    if (length <= 0 || length > STREAM_MAX_MESSAGE_BYTES) {
                        await reader.cancel()
                        throw new Error(`Invalid streaming message length: ${length}`)
                    }
                    const message = buffer.readMessage(length)
                    if (!message) break

                    const decoded = msgpackDecode(message) as Record<string, unknown>
                    if (decoded.error || decoded.message) {
                        await reader.cancel()
                        throw new Error(`API 오류: ${String(decoded.error ?? decoded.message)}`)
                    }

                    const eventType = String(decoded.event_type ?? decoded.event ?? 'unknown')
                    const stepIx = typeof decoded.step_ix === 'number' ? decoded.step_ix : undefined
                    const image = decoded.image instanceof Uint8Array ? binaryToBase64(decoded.image) : undefined

                    if (eventType === 'intermediate') {
                        handlers.onEvent?.({ eventType, stepIx, imageBase64: image })
                    } else if (eventType === 'final') {
                        finalImage = image ?? finalImage
                        handlers.onEvent?.({ eventType, stepIx, imageBase64: image })
                    }
                }
            }
            if (done) break
        }
    } finally {
        signal?.removeEventListener('abort', onAbort)
        try {
            reader.releaseLock()
        } catch {
            // Reader may already be released after cancel.
        }
    }

    if (signal?.aborted) {
        throw new DOMException('요청이 취소되었습니다.', 'AbortError')
    }

    if (!finalImage) {
        throw new Error('스트림에서 이미지 데이터를 찾을 수 없음')
    }
    return finalImage
}
