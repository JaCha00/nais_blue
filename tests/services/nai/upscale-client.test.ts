import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NAI_ENDPOINTS } from '@/services/nai/endpoints'
import { upscaleImage } from '@/services/nai/client'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }))

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])

async function zipWithImage(): Promise<Uint8Array> {
    const zip = new JSZip()
    zip.file('readme.txt', 'not the image')
    zip.file('image0.png', PNG_BYTES)
    return zip.generateAsync({ type: 'uint8array' })
}

describe('NovelAI upscale client', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('posts V5 multipart upscale requests to the image host and extracts image*.png from the ZIP', async () => {
        let requestBody: FormData | undefined
        const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
            requestBody = init?.body as FormData
            return new Response(await zipWithImage(), { status: 200 })
        })
        vi.stubGlobal('fetch', fetchMock)

        const result = await upscaleImage(' token ', `data:image/png;base64,${btoa('source')}`, 512, 512)

        expect(result).toEqual({
            success: true,
            imageData: btoa(String.fromCharCode(...PNG_BYTES)),
        })
        expect(fetchMock).toHaveBeenCalledWith(NAI_ENDPOINTS.upscale, expect.objectContaining({
            method: 'POST',
            headers: { Authorization: 'Bearer token' },
        }))
        expect(NAI_ENDPOINTS.upscale).toBe('https://image.novelai.net/ai/upscale')
        expect(requestBody).toBeInstanceOf(FormData)
        expect(await (requestBody?.get('image') as Blob).text()).toBe('source')
        expect(JSON.parse(await (requestBody?.get('request') as Blob).text())).toEqual({
            image: 'image',
            model: 'nai-diffusion-5-curated',
            declared_blur_sigma: 0,
        })
    })

    it('rejects inputs above the 3MP local contract before transport', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)

        const result = await upscaleImage('token', `data:image/png;base64,${btoa('source')}`, 2048, 1537)

        expect(result.success).toBe(false)
        expect(result.error).toContain('3MP')
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('rejects non-PNG data URLs before transport', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)

        const result = await upscaleImage('token', `data:image/jpeg;base64,${btoa('source')}`, 512, 512)

        expect(result.success).toBe(false)
        expect(result.error).toContain('PNG')
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('rejects ZIP responses without an image*.png entry', async () => {
        const zip = new JSZip()
        zip.file('readme.txt', 'not an image')
        vi.stubGlobal('fetch', vi.fn(async () => new Response(
            await zip.generateAsync({ type: 'uint8array' }),
            { status: 200 },
        )))

        const result = await upscaleImage('token', `data:image/png;base64,${btoa('source')}`, 512, 512)

        expect(result.success).toBe(false)
        expect(result.error).toBeTruthy()
    })
})
