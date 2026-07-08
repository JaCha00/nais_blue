import { existsSync, readFileSync } from 'node:fs'
import JSZip from 'jszip'

function readToken() {
  const envToken = process.env.NAI_TOKEN?.trim()
  if (envToken) return envToken
  if (!existsSync('.env')) return ''

  const env = readFileSync('.env', 'utf8')
  const match = env.match(/^\s*NAI_TOKEN\s*=\s*(.+?)\s*$/m)
  return match?.[1]?.replace(/^["']|["']$/g, '').trim() ?? ''
}

const token = readToken()
const allowGenerate = process.env.NAI_SMOKE_GENERATE === '1'

if (!token) {
  console.log('SKIP smoke:nai-endpoints - NAI_TOKEN is not set.')
  process.exit(0)
}

const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
}

async function checkSubscription() {
  const response = await fetch('https://image.novelai.net/user/subscription', { headers })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`subscription failed ${response.status}: ${text.slice(0, 200)}`)
  }
  return { subscription: 'ok' }
}

function buildTinyGeneratePayload() {
  const prompt = 'single apple on a plain white table, simple lighting'
  const negative = 'lowres, bad quality, text, watermark'

  return {
    input: prompt,
    model: 'nai-diffusion-4-5-curated',
    action: 'generate',
    parameters: {
      params_version: 3,
      width: 512,
      height: 512,
      n_samples: 1,
      seed: 170707,
      sampler: 'k_euler',
      steps: 1,
      scale: 5,
      negative_prompt: negative,
      cfg_rescale: 0,
      noise_schedule: 'native',
      legacy: false,
      legacy_v3_extend: false,
      dynamic_thresholding: false,
      skip_cfg_above_sigma: null,
      add_original_image: true,
      prefer_brownian: true,
      ucPreset: 4,
      use_coords: false,
      qualityToggle: false,
      autoSmea: false,
      controlnet_strength: 1,
      normalize_reference_strength_multiple: true,
      inpaintImg2ImgStrength: 1,
      deliberate_euler_ancestral_bug: false,
      image_format: 'png',
      v4_prompt: {
        caption: {
          base_caption: prompt,
          char_captions: [],
        },
        use_coords: false,
        use_order: true,
      },
      v4_negative_prompt: {
        caption: {
          base_caption: negative,
          char_captions: [],
        },
      },
      characterPrompts: [],
    },
  }
}

async function checkGenerateImage() {
  const payload = buildTinyGeneratePayload()
  const response = await fetch('https://image.novelai.net/ai/generate-image', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`generate-image failed ${response.status}: ${text.slice(0, 500)}`)
  }

  const zip = await JSZip.loadAsync(await response.arrayBuffer())
  const fileName = Object.keys(zip.files)[0]
  if (!fileName) throw new Error('generate-image returned an empty ZIP')

  const image = await zip.files[fileName].async('uint8array')
  const isPng = image[0] === 0x89 && image[1] === 0x50 && image[2] === 0x4e && image[3] === 0x47
  if (!isPng) throw new Error(`generate-image returned non-PNG data in ${fileName}`)

  return {
    endpoint: 'generate-image',
    model: payload.model,
    action: payload.action,
    width: payload.parameters.width,
    height: payload.parameters.height,
    steps: payload.parameters.steps,
    fileName,
    bytes: image.length,
    pngSignature: 'ok',
  }
}

const result = await checkSubscription()
if (!allowGenerate) {
  console.log(JSON.stringify({ ...result, generate: 'skipped; set NAI_SMOKE_GENERATE=1' }, null, 2))
  process.exit(0)
}

console.log(JSON.stringify({ ...result, generate: await checkGenerateImage() }, null, 2))
