import { describe, expect, it } from 'vitest'
import { detectImageMimeType, imageDataUrlFromBytes } from '@/services/trash/image-data-url'

describe('trash image data URL', () => {
    it('keeps JPEG and WebP MIME types when opening archived metadata', () => {
        expect(detectImageMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), 'image.png')).toBe('image/jpeg')
        expect(detectImageMimeType(new Uint8Array([
            0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
        ]), 'image.png')).toBe('image/webp')
        expect(imageDataUrlFromBytes(new Uint8Array([0xff, 0xd8, 0xff]), 'image.jpg')).toMatch(/^data:image\/jpeg;base64,/)
    })
})
