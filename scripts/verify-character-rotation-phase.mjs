import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const checks = []
const check = (name, condition) => {
  checks.push({ name, passed: Boolean(condition) })
}
const includesAll = (content, values) => values.every((value) => content.includes(value))
const excludesAll = (content, values) => values.every((value) => !content.includes(value))

const rotationStore = read('src/stores/character-rotation-store.ts')
const compatibilityExport = read('src/lib/character-rotation.ts')
const sceneGeneration = read('src/hooks/useSceneGeneration.ts')
const buildSceneParams = read('src/lib/scene-generation/build-scene-params.ts')
const saveSceneResult = read('src/lib/scene-generation/save-scene-result.ts')
const sceneOutputPath = read('src/lib/scene-output-path.ts')
const sceneStore = read('src/stores/scene-store.ts')
const sceneDetail = read('src/pages/SceneDetail.tsx')
const sceneMode = read('src/pages/SceneMode.tsx')
const promptPanel = read('src/components/layout/PromptPanel.tsx')
const rotationDialog = read('src/components/scene/CharacterRotationDialog.tsx')
const rotationStatusBar = read('src/components/scene/RotationStatusBar.tsx')
const indexedDb = read('src/lib/indexed-db.ts')

check('rotation store exists at requested store boundary', includesAll(rotationStore, [
  'export const useRotationStore',
  "name: 'nais2-character-rotation'",
  'createJSONStorage(() => indexedDBStorage)',
  'partialize:',
]))
check('rotation store exposes explicit status state machine', includesAll(rotationStore, [
  "'idle'",
  "'arming_pass'",
  "'generating_pass'",
  "'paused'",
  "'resting'",
  "'completed'",
  'flagsForStatus',
]))
check('rotation store tracks resumable rotation session data', includesAll(rotationStore, [
  'characterIds',
  'pinnedCharacterIds',
  'queueCounts',
  'enabledStates',
  'snapshot',
  'resumeSavedSession',
  'discardSavedSession',
]))
check('rotation store restores queues and uses B scene session primitive', includesAll(rotationStore, [
  'function startPass',
  'setQueueCount',
  'initGenerationProgress',
  'startNewGenerationSession',
]))
check('rotation store implements worker and completion transitions', includesAll(rotationStore, [
  'onWorkerConfirmed',
  "status !== 'arming_pass'",
  "status: 'generating_pass'",
  'onPassComplete',
  'pauseForInterruption',
  'useSceneStore.subscribe',
]))
check('rotation store includes rest scheduler behavior', includesAll(rotationStore, [
  'restEnabled',
  'workMinutes',
  'restMinutes',
  'restUntil',
  '_enterRestIfDue',
  'scheduleRestEnd',
  'endRest',
]))
check('legacy lib rotation path re-exports the store only', includesAll(compatibilityExport, [
  "export * from '@/stores/character-rotation-store'",
]))

check('scene generation imports requested rotation store', sceneGeneration.includes("import { useRotationStore } from '@/stores/character-rotation-store'"))
check('scene generation confirms worker spawn through store action', includesAll(sceneGeneration, [
  'onWorkerConfirmed()',
  'workerLoop(activeToken.slot',
]))
check('scene generation freezes rotation character into worker context', includesAll(sceneGeneration, [
  'rotationCharacterId?: string',
  'rotationCharacterFolderName?: string',
  'getRotationCharacterFolderName(rotationCharacterId, rotation.currentIndex)',
]))
check('scene generation no longer mutates awaitingWorker directly', !sceneGeneration.includes("useRotationStore.setState({ awaitingWorker: false })"))

check('scene params exclude pinned prompts per scene', includesAll(buildSceneParams, [
  "from '@/stores/character-rotation-store'",
  'useRotationStore',
  'scene.excludePinned',
  'excludedPinnedIds',
  'pinnedCharacterIds',
]))

check('scene output path helper owns normal and rotation directories', includesAll(sceneOutputPath, [
  'resolveSceneOutputPath',
  'getRotationCharacterFolderName',
  "request.sceneSavePath || 'NAIS_Scene'",
  'const pathSegments = [sceneRoot, safePresetName',
  'safeCharacterName ? [safeCharacterName] : []',
  'MEDIA_STORAGE_BASE_DIRECTORY',
]))
check('scene output path uses explicit rotation request fields', includesAll(sceneOutputPath, [
  'rotationCharacterId?: string',
  'rotationCharacterFolderName?: string',
  'request.rotationCharacterFolderName',
]) && !sceneOutputPath.includes("useRotationStore"))
check('scene result saving delegates disk path construction', includesAll(saveSceneResult, [
  "import { resolveSceneOutputPath } from '@/lib/scene-output-path'",
  'resolveSceneOutputPath({',
  'writeGeneratedFile(outputPath.writePath',
  'fullPath = outputPath.fullPath',
]))
check('scene result saving passes frozen rotation folder fields', includesAll(saveSceneResult, [
  'rotationCharacterId: ctx.rotationCharacterId',
  'rotationCharacterFolderName: ctx.rotationCharacterFolderName',
]))

check('scene store schema includes excludePinned', includesAll(sceneStore, [
  'excludePinned?: boolean',
  'excludePinned: false',
  'updateSceneSettings: (presetId: string, sceneId: string, settings: { width?: number, height?: number, excludePinned?: boolean })',
]))
check('scene store normalizes imported excludePinned flag', (sceneStore.match(/excludePinned: Boolean/g) || []).length >= 4)
check('scene store migrates old scene records', includesAll(sceneStore, [
  'Migration for pre-rotation scene records',
  'typeof scene.excludePinned',
  'scene.excludePinned = false',
]))
check('scene rename does not scan rotation character subfolders this phase', excludesAll(sceneStore, [
  'readDir(presetFolderPath)',
  'oldNestedPath',
  'newNestedPath',
]))
check('scene detail opens latest image parent or rotation scene folder', includesAll(sceneDetail, [
  'getLatestSceneImageParentPath',
  'findSceneFolderUnderPreset',
  'readDir(presetPath)',
  'openPath(latestImageParent)',
]))

check('scene mode exposes rotation dialog and status bar', includesAll(sceneMode, [
  'CharacterRotationDialog',
  'RotationStatusBar',
  'showRotationDialog',
  "import { useRotationStore } from '@/stores/character-rotation-store'",
]))
check('scene mode exposes per-scene pinned opt-out', includesAll(sceneMode, [
  'excludePinned',
  'onToggleExcludePinned',
  'UserMinus',
  'UserCheck',
  '고정 캐릭터 제외',
]))
check('rotation dialog exposes rest scheduler controls', includesAll(rotationDialog, [
  '휴식 스케줄러',
  'setRestConfig',
  'restEnabled',
  'workMinutes',
  'restMinutes',
  'Switch',
]))
check('rotation status bar renders resting state and skip action', includesAll(rotationStatusBar, [
  'resting',
  'restUntil',
  'formatDuration',
  'endRest',
  '지금 재개',
]))
check('prompt panel stops rotation through rotation store', includesAll(promptPanel, [
  'rotationActive',
  "useRotationStore.getState().stop({ reason: 'prompt panel stop', keepSnapshot: true })",
  '중단하고 나중에 이어서',
]))
check('rotation UI distinguishes stop/resume from full cancel', includesAll(rotationDialog + rotationStatusBar, [
  '중단하고 나중에 이어서',
  '완전 취소',
  'keepSnapshot: true',
  '로테이션 완전 취소',
]))
check('rotation store participates in full backup registry', includesAll(indexedDb, [
  "'nais2-character-rotation'",
  'Rotation snapshots must survive app restarts and full backups.',
]))

const failed = checks.filter((item) => !item.passed)
for (const item of checks) {
  console.log(`${item.passed ? 'PASS' : 'FAIL'} ${item.name}`)
}

if (failed.length > 0) {
  console.error(`\n${failed.length} character rotation integration check(s) failed.`)
  process.exit(1)
}

console.log(`\n${checks.length} character rotation integration checks passed.`)
