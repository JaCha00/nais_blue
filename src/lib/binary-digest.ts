/**
 * SHA-256 for binary artifacts.  This stays below queue/output/organizer so
 * every caller hashes exactly the bytes it intends to persist or publish.
 */
export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
    const source = new Uint8Array(bytes)
    const digest = await globalThis.crypto.subtle.digest('SHA-256', source.buffer)
    return `sha256:${[...new Uint8Array(digest)]
        .map(value => value.toString(16).padStart(2, '0'))
        .join('')}`
}
