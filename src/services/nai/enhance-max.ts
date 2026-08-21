/** Shared provider limits used by the Enhance MAX UI and request boundary. */
export const NAI_ENHANCE_MAX_PIXELS = 3_145_728
export const NAI_ENHANCE_MAX_EXPOSE_PIXELS = 0.8 * NAI_ENHANCE_MAX_PIXELS

export function canUseEnhanceMaxForPixels(width: number, height: number): boolean {
    return Number.isFinite(width)
        && Number.isFinite(height)
        && width > 0
        && height > 0
        && width * height < NAI_ENHANCE_MAX_EXPOSE_PIXELS
}

export function calculateEnhanceMaxScale(width: number, height: number): number {
    return canUseEnhanceMaxForPixels(width, height)
        ? Math.sqrt(NAI_ENHANCE_MAX_PIXELS / (width * height))
        : 1
}
