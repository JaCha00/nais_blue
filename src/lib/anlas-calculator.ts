import type { AnlasPricingBasis } from '@/domain/queue/anlas-cost-consent'

export const OPUS_FREE_PIXEL_LIMIT = 1_048_576
export const OPUS_FREE_STEPS_LIMIT = 28
export const MAX_BILLABLE_PIXEL_LIMIT = 3_145_728

const BASE_COST_PER_PIXEL = 2.951823174884865e-6
const STEP_COST_PER_PIXEL = 5.753298233447344e-7
const V5_PAID_COST_MULTIPLIER = 1.5

function isV5AnlasModel(model: string): boolean {
    return model.startsWith('nai-diffusion-5-')
}

export interface BaseGenerationAnlasInput {
    readonly model: string
    readonly width: number
    readonly height: number
    readonly steps: number
    /** Number of samples in one NovelAI request, not the number of queued requests. */
    readonly imageCount: number
    readonly pricingBasis: AnlasPricingBasis
}

export function resolveAnlasPricingBasis(input: {
    readonly model: string
    readonly activeCredentialsAreOpus: boolean
}): AnlasPricingBasis {
    return input.activeCredentialsAreOpus && !isV5AnlasModel(input.model)
        ? 'all-active-opus'
        : 'paid'
}

function assertPositiveSafeInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new RangeError(`${name} must be a positive safe integer`)
    }
}

/**
 * Estimates base NovelAI image-generation cost.
 *
 * Paid unit observed in NovelAI's production UI. Resolution and Steps are
 * billed together, with the quoted pixel area capped at 3,145,728 pixels.
 * An eligible Opus request waives only its first image.
 */
export function calculateAnlasCost(input: BaseGenerationAnlasInput): number {
    const { model, width, height, steps, imageCount, pricingBasis } = input
    if (typeof model !== 'string' || model.trim().length === 0) {
        throw new TypeError('model must be a non-empty string')
    }
    assertPositiveSafeInteger(width, 'width')
    assertPositiveSafeInteger(height, 'height')
    assertPositiveSafeInteger(steps, 'steps')
    assertPositiveSafeInteger(imageCount, 'imageCount')
    if (pricingBasis !== 'all-active-opus' && pricingBasis !== 'paid') {
        throw new TypeError('pricingBasis must be all-active-opus or paid')
    }

    const pixels = width * height
    if (!Number.isSafeInteger(pixels)) {
        throw new RangeError('resolution and steps exceed the safe estimation range')
    }

    const billablePixels = Math.min(pixels, MAX_BILLABLE_PIXEL_LIMIT)
    const floatingBaseEstimate = BASE_COST_PER_PIXEL * billablePixels
        + STEP_COST_PER_PIXEL * billablePixels * steps
    const paidUnit = Math.max(2, Math.ceil(
        isV5AnlasModel(model)
            ? floatingBaseEstimate * V5_PAID_COST_MULTIPLIER
            : floatingBaseEstimate,
    ))
    if (!Number.isSafeInteger(paidUnit)) {
        throw new RangeError('estimated Anlas exceeds the safe integer range')
    }

    const effectivePricingBasis = resolveAnlasPricingBasis({
        model,
        activeCredentialsAreOpus: pricingBasis === 'all-active-opus',
    })
    const opusFreeFirstImage = effectivePricingBasis === 'all-active-opus'
        && pixels <= OPUS_FREE_PIXEL_LIMIT
        && steps <= OPUS_FREE_STEPS_LIMIT
    const total = paidUnit * (imageCount - Number(opusFreeFirstImage))
    if (!Number.isSafeInteger(total)) {
        throw new RangeError('estimated Anlas exceeds the safe integer range')
    }
    return total
}
