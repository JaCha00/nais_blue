import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')

const checks = []
const check = (name, pass) => checks.push({ name, Boolean: Boolean(pass), pass: Boolean(pass) })

const settingsStore = read('src/stores/settings-store.ts')
const settingsPage = read('src/pages/Settings.tsx')
const styleLabGeneration = read('src/services/style-lab-generation.ts')
const toolsMode = read('src/pages/ToolsMode.tsx')
const sceneGeneration = read('src/hooks/useSceneGeneration.ts')
const sceneDetail = read('src/pages/SceneDetail.tsx')
const sceneOutputPath = read('src/lib/scene-output-path.ts')
const sceneStore = read('src/stores/scene-store.ts')
const historyPanel = read('src/components/layout/HistoryPanel.tsx')
const ko = read('src/i18n/locales/ko.json')
const en = read('src/i18n/locales/en.json')
const ja = read('src/i18n/locales/ja.json')

check(
    'settings store defines category-specific output folders',
    /savePath:\s*'NAIS_Output'/.test(settingsStore) &&
    /sceneSavePath:\s*'NAIS_Scene'/.test(settingsStore) &&
    /styleLabSavePath:\s*'nais-style'/.test(settingsStore) &&
    /toolsSavePath:\s*'nais-tools'/.test(settingsStore)
)

check(
    'settings store persists absolute flags and setters per output folder',
    /useAbsoluteScenePath:\s*boolean/.test(settingsStore) &&
    /useAbsoluteStyleLabPath:\s*boolean/.test(settingsStore) &&
    /useAbsoluteToolsPath:\s*boolean/.test(settingsStore) &&
    /setSceneSavePath/.test(settingsStore) &&
    /setStyleLabSavePath/.test(settingsStore) &&
    /setToolsSavePath/.test(settingsStore)
)

check(
    'StyleLab saves to nais-style path setting instead of main output',
    /styleLabSavePath/.test(styleLabGeneration) &&
    /useAbsoluteStyleLabPath/.test(styleLabGeneration) &&
    /styleLabSavePath\s*\|\|\s*'nais-style'/.test(styleLabGeneration) &&
    !/savePath\s*\|\|\s*'NAIS_Output'/.test(styleLabGeneration)
)

check(
    'Tools mode saves to nais-tools path setting instead of main output',
    /toolsSavePath/.test(toolsMode) &&
    /useAbsoluteToolsPath/.test(toolsMode) &&
    /toolsSavePath\s*\|\|\s*'nais-tools'/.test(toolsMode) &&
    !/savePath\s*\|\|\s*'NAIS_Output'/.test(toolsMode)
)

check(
    'Scene mode uses scene output path setting instead of main output root',
    /sceneSavePath/.test(sceneGeneration) &&
    /useAbsoluteScenePath/.test(sceneOutputPath) &&
    /sceneSavePath/.test(sceneDetail) &&
    !/const savePath = useSettingsStore/.test(sceneGeneration)
)

check(
    'Scene rename uses the dedicated scene output root',
    /sceneSavePath/.test(sceneStore) &&
    /useAbsoluteScenePath/.test(sceneStore) &&
    !/join\(savePath,\s*'NAIS_Scene'/.test(sceneStore)
)

check(
    'History panel loads Scene images from the dedicated scene root',
    /sceneSavePath/.test(historyPanel) &&
    /useAbsoluteScenePath/.test(historyPanel) &&
    !/join\(savePath,\s*sceneBaseDir/.test(historyPanel) &&
    !/const sceneBaseDir\s*=\s*'NAIS_Scene'/.test(historyPanel)
)

check(
    'Settings page exposes editable category output folders',
    /localSceneSavePath/.test(settingsPage) &&
    /localStyleLabSavePath/.test(settingsPage) &&
    /localToolsSavePath/.test(settingsPage) &&
    /handleSaveScenePath/.test(settingsPage) &&
    /handleSaveStyleLabPath/.test(settingsPage) &&
    /handleSaveToolsPath/.test(settingsPage)
)

for (const [locale, body] of Object.entries({ ko, en, ja })) {
    check(
        `${locale} output directory locale keys exist`,
        /"outputFolders"/.test(body) &&
        /"main"/.test(body) &&
        /"scene"/.test(body) &&
        /"styleLab"/.test(body) &&
        /"tools"/.test(body)
    )
}

const failed = checks.filter(item => !item.pass)
for (const item of checks) {
    console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}`)
}

if (failed.length > 0) {
    console.error(`\nOutput directory verification failed: ${failed.length}/${checks.length}`)
    process.exit(1)
}

console.log(`\nOutput directory verification passed: ${checks.length}/${checks.length}`)
