export const NAI_IMAGE_HOST = 'https://image.novelai.net'
export const NAI_API_HOST = 'https://api.novelai.net'

export const NAI_ENDPOINTS = {
    generateImage: `${NAI_IMAGE_HOST}/ai/generate-image`,
    generateImageStream: `${NAI_IMAGE_HOST}/ai/generate-image-stream`,
    encodeVibe: `${NAI_IMAGE_HOST}/ai/encode-vibe`,
    augmentImage: `${NAI_IMAGE_HOST}/ai/augment-image`,
    userData: `${NAI_IMAGE_HOST}/user/data`,
    userInfo: `${NAI_IMAGE_HOST}/user/information`,
    subscription: `${NAI_IMAGE_HOST}/user/subscription`,
    upscale: 'https://api.novelai.net/ai/upscale',
} as const
