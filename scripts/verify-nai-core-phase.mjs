import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')
const count = (text, re) => (text.match(re) ?? []).length

const checks = []
function check(name, pass) {
  checks.push({ name, pass: Boolean(pass) })
}

const files = [
  'src/services/nai/endpoints.ts',
  'src/services/nai/presets.ts',
  'src/services/nai/payload.ts',
  'src/services/nai/stream.ts',
  'src/services/nai/refs.ts',
  'src/services/nai/adapter.ts',
  'src/services/nai/client.ts',
  'src/services/novelai-types.ts',
  'src/services/novelai-api.ts',
  'src/lib/generation-metadata.ts',
  'src-tauri/src/lib.rs',
]

for (const file of files) {
  check(`${file} exists`, existsSync(join(root, file)))
}

const endpoints = read('src/services/nai/endpoints.ts')
const payload = read('src/services/nai/payload.ts')
const stream = read('src/services/nai/stream.ts')
const refs = read('src/services/nai/refs.ts')
const adapter = read('src/services/nai/adapter.ts')
const client = read('src/services/nai/client.ts')
const facade = read('src/services/novelai-api.ts')
const metadata = read('src/lib/generation-metadata.ts')
const rust = read('src-tauri/src/lib.rs')
const sceneBuilder = read('src/lib/scene-generation/build-scene-params.ts')
const sceneGeneration = read('src/hooks/useSceneGeneration.ts')
const sceneSave = read('src/lib/scene-generation/save-scene-result.ts')
const generationStore = read('src/stores/generation-store.ts')
const styleLab = read('src/services/style-lab-generation.ts')
const types = read('src/services/novelai-types.ts')

function loadTsCommonJs(path, deps = {}) {
  const source = read(path)
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: path,
  })
  const module = { exports: {} }
  const require = specifier => {
    if (specifier in deps) return deps[specifier]
    throw new Error(`Unexpected verifier require from ${path}: ${specifier}`)
  }
  vm.runInNewContext(outputText, {
    exports: module.exports,
    module,
    require,
    console,
  }, { filename: path })
  return module.exports
}

function fixtureCheck(name, fn) {
  try {
    fn()
    check(name, true)
  } catch (error) {
    check(name, false)
    console.error(`Fixture failure (${name}): ${error instanceof Error ? error.message : String(error)}`)
  }
}

function assertPlainObject(actual, expected) {
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected)
}

function runPayloadFixtureChecks() {
  const presetsModule = loadTsCommonJs('src/services/nai/presets.ts')
  const payloadModule = loadTsCommonJs('src/services/nai/payload.ts', {
    '@/services/nai/presets': presetsModule,
  })
  const { buildGenerateImagePayload } = payloadModule
  const baseRequest = (overrides = {}) => ({
    prompt: '1girl, silver hair',
    negativePrompt: 'lowres',
    model: 'nai-diffusion-4-5-full',
    width: 832,
    height: 1216,
    steps: 28,
    cfgScale: 5,
    cfgRescale: 0,
    sampler: 'k_euler_ancestral',
    noiseSchedule: 'karras',
    seed: 1234567890,
    variety: false,
    qualityToggle: false,
    ucPreset: 4,
    characterPrompts: [],
    useCoords: false,
    ...overrides,
  })

  fixtureCheck('payload snapshot keeps input and v4 positive caption in sync', () => {
    const built = buildGenerateImagePayload(baseRequest())
    assert.equal(built.input, built.parameters.v4_prompt.caption.base_caption)
  })

  fixtureCheck('payload snapshot keeps negative prompt and v4 negative caption in sync', () => {
    const built = buildGenerateImagePayload(baseRequest({ qualityToggle: true, ucPreset: 0 }))
    assert.equal(built.parameters.negative_prompt, built.parameters.v4_negative_prompt.caption.base_caption)
    assert.equal(built.parameters.qualityToggle, true)
    assert.equal(built.parameters.ucPreset, 0)
  })

  fixtureCheck('payload snapshot omits top-level legacy_uc', () => {
    const built = buildGenerateImagePayload(baseRequest())
    assert.equal(Object.hasOwn(built.parameters, 'legacy_uc'), false)
  })

  fixtureCheck('payload snapshot centers disabled coords at midpoint', () => {
    const built = buildGenerateImagePayload(baseRequest({
      characterPrompts: [
        { prompt: 'girl A', negativePrompt: 'bad A', enabled: true, center: { x: 0.1, y: 0.9 } },
      ],
      useCoords: false,
    }))
    assertPlainObject(built.parameters.v4_prompt.caption.char_captions[0].centers[0], { x: 0.5, y: 0.5 })
    assertPlainObject(built.parameters.characterPrompts[0].center, { x: 0.5, y: 0.5 })
  })

  fixtureCheck('payload snapshot preserves enabled character coords', () => {
    const built = buildGenerateImagePayload(baseRequest({
      characterPrompts: [
        { prompt: 'girl A', negativePrompt: 'bad A', enabled: true, center: { x: 0.1, y: 0.9 } },
      ],
      useCoords: true,
    }))
    assertPlainObject(built.parameters.v4_prompt.caption.char_captions[0].centers[0], { x: 0.1, y: 0.9 })
    assertPlainObject(built.parameters.v4_negative_prompt.caption.char_captions[0].centers[0], { x: 0.1, y: 0.9 })
    assertPlainObject(built.parameters.characterPrompts[0].center, { x: 0.1, y: 0.9 })
  })

  fixtureCheck('payload snapshot emits vibe transfer fields', () => {
    const built = buildGenerateImagePayload(baseRequest(), {
      vibes: [{ strength: 0.6, encodedVibeBase64: 'encoded-vibe' }],
    })
    assert.deepEqual(built.parameters.reference_image_multiple, ['encoded-vibe'])
    assert.deepEqual(built.parameters.reference_strength_multiple, [0.6])
  })

  fixtureCheck('payload snapshot emits nested character reference legacy_uc false', () => {
    const built = buildGenerateImagePayload(baseRequest(), {
      characterReferences: [
        { referenceType: 'character&style', strength: 1, fidelity: 1, imageBase64: 'character-image' },
      ],
    })
    assert.equal(built.parameters.director_reference_descriptions[0].legacy_uc, false)
    assert.equal(Object.hasOwn(built.parameters, 'legacy_uc'), false)
  })

  fixtureCheck('payload snapshot emits img2img edit fields', () => {
    const built = buildGenerateImagePayload(baseRequest(), {
      i2i: {
        strength: 0.7,
        noise: 0.1,
        extraNoiseSeed: 123,
        colorCorrect: true,
        imageBase64: 'source-image',
      },
    })
    assert.equal(built.action, 'img2img')
    assert.equal(built.parameters.image, 'source-image')
    assert.equal(built.parameters.strength, 0.7)
    assert.equal(built.parameters.color_correct, true)
  })

  fixtureCheck('payload snapshot emits inpaint fields', () => {
    const built = buildGenerateImagePayload(baseRequest(), {
      i2i: {
        strength: 0.7,
        noise: 0.1,
        extraNoiseSeed: 123,
        colorCorrect: true,
        imageBase64: 'source-image',
        maskBase64: 'mask-image',
      },
    })
    assert.equal(built.action, 'infill')
    assert.equal(built.parameters.request_type, 'NativeInfillingRequest')
    assert.equal(built.parameters.image, 'source-image')
    assert.equal(built.parameters.mask, 'mask-image')
    assert.equal(built.parameters.inpaintImg2ImgStrength, 0.7)
  })
}

check('image host is primary NAI host', /https:\/\/image\.novelai\.net/.test(endpoints))
check('upscale keeps api host exception', /https:\/\/api\.novelai\.net\/ai\/upscale/.test(endpoints))
check('payload builder exists exactly once', count(payload, /export function buildGenerateImagePayload/g) === 1)
check('payload computes Variety+ from model and resolution', /varietySigma/.test(payload) && /832 \* 1216/.test(payload) && /Math\.sqrt/.test(payload))
check('payload emits v4 prompt and negative prompt', /v4_prompt/.test(payload) && /v4_negative_prompt/.test(payload))
check('payload source includes nested character reference legacy_uc false', /director_reference_descriptions/.test(payload) && /legacy_uc:\s*false/.test(payload))
check('stream parser reads msgpack frames', /getReader\(\)/.test(stream) && /msgpackDecode/.test(stream) && /readNaiImageStream/.test(stream))
check('stream parser cleans up reader and handles abort', /releaseLock/.test(stream) && /AbortSignal/.test(stream) && /reader\.cancel/.test(stream))
check('refs normalize source dimensions and mask format', /normalizeSourceForNai/.test(refs) && /width/.test(refs) && /height/.test(refs) && /normalizeInpaintMask/.test(refs))
check('refs normalize character references to NAI canvases', /1024/.test(refs) && /1536/.test(refs) && /1472/.test(refs))
check('adapter maps old GenerationParams through split type boundary', /GenerationParams/.test(adapter) && /..\/novelai-types/.test(adapter) && /export async function adaptGenerationParams/.test(adapter))
check('client uses shared payload builder', /buildGenerateImagePayload/.test(client))
check('account endpoints stay Rust invoke primary', /invoke<.*verify_token/s.test(client) && /invoke<.*get_anlas_balance/s.test(client))
check('facade delegates to nai client', /from '@\/services\/nai\/client'/.test(facade))
check('metadata exposes sentPayload redaction', /export function redactSentPayloadForMetadata/.test(metadata))
check('client redacts sentPayload before returning metadata summary', /redactSentPayloadForMetadata/.test(client))
check('Rust no longer calls old subscription host', !/https:\/\/api\.novelai\.net\/user\/subscription/.test(rust))
check(
  'scene generation passes quality and UC to GenerationParams',
  /qualityToggle:\s*genState\.qualityToggle/.test(sceneBuilder) &&
  /ucPreset:\s*genState\.ucPreset/.test(sceneBuilder)
)
check(
  'main scene and stylelab force source edit requests through zip',
  /const hasSourceEdit = Boolean\(generationParams\.sourceImage \|\| generationParams\.mask\)/.test(generationStore) &&
  /const hasSourceEdit = Boolean\(params\.sourceImage \|\| params\.mask\)/.test(sceneGeneration) &&
  /const hasSourceEdit = Boolean\(params\.sourceImage \|\| params\.mask\)/.test(styleLab)
)
check(
  'sent payload summaries reach history and sidecar metadata',
  /sentPayloadSummary\?: string/.test(types) &&
  /sentPayloadSummary: result\.sentPayloadSummary/.test(generationStore) &&
  /sentPayloadSummary: result\.sentPayloadSummary/.test(sceneGeneration) &&
  /sentPayloadSummary: params\.sentPayloadSummary/.test(metadata) &&
  /sentPayloadSummary: options\.sentPayloadSummary/.test(sceneSave)
)
check('payload parity scope records V4/V4.5 before V3 expansion', /verified parity scope is V4\/V4\.5/.test(payload) && /sm_dyn/.test(payload))

runPayloadFixtureChecks()

const failed = checks.filter(item => !item.pass)
for (const item of checks) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}`)
}

if (failed.length > 0) {
  console.error(`\nNAI core phase verifier failed: ${failed.length}/${checks.length}`)
  process.exit(1)
}

console.log(`\nNAI core phase verifier passed: ${checks.length}/${checks.length}`)
