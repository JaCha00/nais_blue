import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const checks = []
const check = (name, condition) => {
  checks.push({ name, passed: Boolean(condition) })
}
const includesAll = (content, values) => values.every((value) => content.includes(value))

const libRs = read('src-tauri/src/lib.rs')
const tauriConfig = JSON.parse(read('src-tauri/tauri.conf.json'))
const defaultCapability = JSON.parse(read('src-tauri/capabilities/default.json'))
const releaseScript = read('scripts/create-public-release.ps1')
const retiredUrlPluginKey = ['deep', 'link'].join('-')
const retiredUrlPluginRustModule = ['tauri', 'plugin', 'deep', 'link'].join('_')

check('tagger state tracks exactly one Tauri sidecar child', includesAll(libRs, [
  'use std::sync::{Arc, Mutex};',
  'use tauri::AppHandle;',
  'use tauri::{LogicalPosition, LogicalSize, Manager, RunEvent, Url};',
  'use tauri_plugin_shell::{process::CommandChild, ShellExt};',
  'pub struct TaggerState(pub Arc<Mutex<Option<CommandChild>>>);',
]))
check('tagger commands are exposed without replacing B commands', includesAll(libRs, [
  '#[tauri::command]',
  'async fn check_tagger_binary() -> bool',
  'async fn start_tagger(app: AppHandle) -> Result<(), String>',
  'start_tagger,',
  'check_tagger_binary,',
  'augment_image,',
  'zoom_embedded_browser,',
]))
check('tagger starts the configured sidecar on port 8002', includesAll(libRs, [
  'command.args(["--port", "8002"])',
  'child_guard.is_some()',
  '*child_guard = Some(child);',
]) && /app\s*\.\s*shell\(\)\s*\.\s*sidecar\("tagger-server"\)/.test(libRs))
check('tagger state is managed after shell plugin setup', includesAll(libRs, [
  'let tagger_state = TaggerState(Arc::new(Mutex::new(None)));',
  'let tagger_state_for_exit = tagger_state.clone();',
  '.plugin(tauri_plugin_shell::init())',
  '.manage(tagger_state)',
]))
check('exit handler kills only the tracked child handle', includesAll(libRs, [
  'RunEvent::Exit',
  'tagger_state_for_exit',
  'child.take()',
  'child_process.kill()',
]) && !libRs.includes('tagger-server.exe'))
check('B Tauri plugin chain is preserved', includesAll(libRs, [
  'tauri_plugin_single_instance::init',
  'tauri_plugin_updater::Builder::new().build()',
  'tauri_plugin_process::init()',
]) && !libRs.includes(retiredUrlPluginRustModule))

check('Tauri bundle declares the tagger sidecar binary', Array.isArray(tauriConfig.bundle?.externalBin) &&
  tauriConfig.bundle.externalBin.includes('binaries/tagger-server'))
check('Tauri sidecar executable exists for Windows cargo checks', existsSync(join(root,
  'src-tauri/binaries/tagger-server-x86_64-pc-windows-msvc.exe',
)))
check('Tauri updater is preserved without the retired URL callback config',
  JSON.stringify(tauriConfig).includes(
    'https://github.com/JaCha00/nais2-integration-complete/releases/latest/download/latest.json',
  ) && tauriConfig.plugins?.[retiredUrlPluginKey] === undefined)

const permissions = defaultCapability.permissions ?? []
const shellExecute = permissions.find((permission) => permission?.identifier === 'shell:allow-execute')
check('capabilities rely on externalBin sidecar without shell execute permission', !shellExecute &&
  tauriConfig.bundle?.externalBin?.includes('binaries/tagger-server'))
check('retired URL callback capability is absent',
  !permissions.includes(`${retiredUrlPluginKey}:default`))

check('release script verifies tagger-server.exe in release build output', includesAll(releaseScript, [
  "$taggerServerExe = Join-Path $buildRelease 'tagger-server.exe'",
  'Test-Path -LiteralPath $taggerServerExe',
  'Required tagger sidecar is missing from release directory',
]))
check('release script keeps tagger executable out of the public source zip', releaseScript.includes("'*.exe'") &&
  !releaseScript.includes('Copy-RequiredFile -Source $taggerServerExe') &&
  !releaseScript.includes("Role = 'tagger"))

const failed = checks.filter((item) => !item.passed)
for (const item of checks) {
  console.log(`${item.passed ? 'PASS' : 'FAIL'} ${item.name}`)
}

if (failed.length > 0) {
  console.error(`\n${failed.length} tagger sidecar integration check(s) failed.`)
  process.exit(1)
}

console.log(`\n${checks.length} tagger sidecar integration checks passed.`)
