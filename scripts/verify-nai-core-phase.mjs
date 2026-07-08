import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

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

check('image host is primary NAI host', /https:\/\/image\.novelai\.net/.test(endpoints))
check('upscale keeps api host exception', /https:\/\/api\.novelai\.net\/ai\/upscale/.test(endpoints))
check('payload builder exists exactly once', count(payload, /export function buildGenerateImagePayload/g) === 1)
check('payload computes Variety+ from model and resolution', /varietySigma/.test(payload) && /832 \* 1216/.test(payload) && /Math\.sqrt/.test(payload))
check('payload emits v4 prompt and negative prompt', /v4_prompt/.test(payload) && /v4_negative_prompt/.test(payload))
check('payload does not emit legacy_uc', !/legacy_uc\s*:/.test(payload))
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

const failed = checks.filter(item => !item.pass)
for (const item of checks) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}`)
}

if (failed.length > 0) {
  console.error(`\nNAI core phase verifier failed: ${failed.length}/${checks.length}`)
  process.exit(1)
}

console.log(`\nNAI core phase verifier passed: ${checks.length}/${checks.length}`)
