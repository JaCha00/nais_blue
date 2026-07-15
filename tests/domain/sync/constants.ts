export const NOW = '2026-07-15T00:00:00.000Z'
export const LATER = '2026-07-15T00:00:01.000Z'

export function wrappedImageCanary(padded = false): string {
    const bytes = [
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ...Array.from({ length: 240 }, (_entry, index) => 0x20 + (index % 95)),
    ]
    const encoded = btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
    const payload = padded ? encoded : encoded.replace(/=+$/, '')
    return payload.match(/.{1,5}/g)?.join(' ') ?? payload
}
