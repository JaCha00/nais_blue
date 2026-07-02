/**
 * Image utility functions for memory-efficient image handling
 */

import { writeFile, readFile, remove, mkdir, exists } from '@tauri-apps/plugin-fs'
import { appDataDir, join } from '@tauri-apps/api/path'

// ============================================
// Reference Image File Storage
// ============================================

let _referencesDir: string | null = null

/** Get (or create) the references directory: AppData/NAIS2/references/ */
export async function getReferencesDir(): Promise<string> {
    if (_referencesDir) return _referencesDir
    const appData = await appDataDir()
    const dir = await join(appData, 'references')
    if (!(await exists(dir))) {
        await mkdir(dir, { recursive: true })
    }
    _referencesDir = dir
    return dir
}

/** Save a base64 image to file. Returns the file path. */
export async function saveReferenceImage(id: string, base64: string): Promise<string> {
    const dir = await getReferencesDir()
    const filePath = await join(dir, `${id}.bin`)
    // Strip data URI prefix if present
    const raw = base64.includes(',') ? base64.split(',')[1] : base64
    const binary = Uint8Array.from(atob(raw), c => c.charCodeAt(0))
    await writeFile(filePath, binary)
    return filePath
}

/** Load a base64 image from file. Returns data URI string or null if not found. */
export async function loadReferenceImage(filePath: string): Promise<string | null> {
    try {
        if (!(await exists(filePath))) return null
        const data = await readFile(filePath)
        // Convert to base64
        let binary = ''
        const bytes = new Uint8Array(data)
        const chunkSize = 8192
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
        }
        return `data:image/png;base64,${btoa(binary)}`
    } catch (e) {
        console.error(`[image-utils] Failed to load reference image: ${filePath}`, e)
        return null
    }
}

/** Delete a reference image file. */
export async function deleteReferenceImage(filePath: string): Promise<void> {
    try {
        if (await exists(filePath)) {
            await remove(filePath)
        }
    } catch (e) {
        console.warn(`[image-utils] Failed to delete reference image: ${filePath}`, e)
    }
}

/** Save encoded vibe data to file. Returns file path. */
export async function saveEncodedVibe(id: string, encodedVibe: string): Promise<string> {
    const dir = await getReferencesDir()
    const filePath = await join(dir, `${id}_vibe.bin`)
    const binary = Uint8Array.from(atob(encodedVibe), c => c.charCodeAt(0))
    await writeFile(filePath, binary)
    return filePath
}

/** Load encoded vibe data from file. Returns raw base64 string or null. */
export async function loadEncodedVibe(filePath: string): Promise<string | null> {
    try {
        if (!(await exists(filePath))) return null
        const data = await readFile(filePath)
        const bytes = new Uint8Array(data)
        let binary = ''
        const chunkSize = 8192
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
        }
        return btoa(binary)
    } catch (e) {
        console.error(`[image-utils] Failed to load encoded vibe: ${filePath}`, e)
        return null
    }
}

// ============================================
// Thumbnail Generation
// ============================================

/**
 * Generate thumbnail from base64 image (max 256px, JPEG quality 0.7)
 * Memory-safe: properly releases canvas and image resources
 * 
 * @param base64Image - Full base64 image string (with data: prefix)
 * @param maxSize - Maximum dimension for thumbnail (default 256px)
 * @returns Promise resolving to thumbnail base64 string (~10-30KB)
 */
export const createThumbnail = (base64Image: string, maxSize = 256): Promise<string> => {
    return new Promise((resolve) => {
        const img = new Image()
        img.onload = () => {
            let canvas: HTMLCanvasElement | null = null
            try {
                canvas = document.createElement('canvas')
                const ctx = canvas.getContext('2d')

                if (!ctx) {
                    resolve(base64Image) // Fallback to original
                    return
                }

                // Calculate thumbnail dimensions maintaining aspect ratio
                let width = img.width
                let height = img.height
                if (width > height) {
                    if (width > maxSize) {
                        height = Math.round(height * maxSize / width)
                        width = maxSize
                    }
                } else {
                    if (height > maxSize) {
                        width = Math.round(width * maxSize / height)
                        height = maxSize
                    }
                }

                canvas.width = width
                canvas.height = height
                ctx.drawImage(img, 0, 0, width, height)

                // Use JPEG for smaller size (~10-30KB instead of 2-5MB)
                const thumbnail = canvas.toDataURL('image/jpeg', 0.7)
                resolve(thumbnail)
            } catch {
                resolve(base64Image) // Fallback to original on error
            } finally {
                // CRITICAL: Release canvas memory to prevent OOM
                if (canvas) {
                    canvas.width = 0
                    canvas.height = 0
                }
                // Help GC by clearing image reference
                img.src = ''
            }
        }
        img.onerror = () => {
            img.src = '' // Clear on error too
            resolve(base64Image) // Fallback to original
        }
        img.src = base64Image
    })
}
