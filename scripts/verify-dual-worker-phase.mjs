import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const checks = []
const check = (name, pass) => checks.push({ name, pass })

const sceneGeneration = read('src/hooks/useSceneGeneration.ts')
const buildSceneParams = read('src/lib/scene-generation/build-scene-params.ts')
const saveSceneResult = read('src/lib/scene-generation/save-scene-result.ts')
const sceneGenerationSurface = `${sceneGeneration}\n${buildSceneParams}\n${saveSceneResult}`
const authStore = read('src/stores/auth-store.ts')

check('scene generation helper files exist', /buildSceneGenerationParams/.test(buildSceneParams) && /saveSceneResult/.test(saveSceneResult))
check('scene generation reads active auth slots', /getActiveTokens\(\)/.test(sceneGeneration))
check('scene generation tracks running slots', /runningSceneSlots|runningSlots/.test(sceneGeneration))
check('scene generation starts per-slot workers', /workerLoop\(/.test(sceneGeneration) && /slot/.test(sceneGeneration))
check('scene workers honor session id', /generationSessionId/.test(sceneGeneration) && /sessionId/.test(sceneGeneration) && /isSessionAlive/.test(sceneGeneration))
check('scene workers gate API and save with session checks', (sceneGeneration.match(/isSessionAlive\(ctx\.sessionId\)/g) || []).length >= 5 && /canSave:\s*\(\)\s*=>\s*isSessionAlive\(ctx\.sessionId\)/.test(sceneGeneration))
check('scene workers honor cancellation state', /isCancelling/.test(sceneGeneration) && /setIsGenerating\(false\)/.test(sceneGeneration))
check('scene workers can pause a slot mid-run', /isSlotActive\(slot\)/.test(sceneGeneration))
check('scene workers refresh Anlas per slot', /refreshAnlas\(slot\)/.test(sceneGeneration))
check(
    'streaming mode is capped to one worker unless source edit forces zip',
    /const\s+sourceEditActive\s*=\s*Boolean\(useGenerationStore\.getState\(\)\.sourceImage\s*\|\|\s*useGenerationStore\.getState\(\)\.mask\)/.test(sceneGeneration) &&
    /const\s+workerTokens\s*=\s*streamingView\s*&&\s*!sourceEditActive\s*\?\s*tokens\.slice\(0,\s*1\)\s*:\s*tokens/.test(sceneGeneration)
)
check('scene generation preserves imageFormat', /imageFormat/.test(sceneGenerationSurface) && /image\/webp/.test(sceneGenerationSurface))
check('scene generation preserves char cache keys', /charCacheKeys/.test(sceneGenerationSurface))
check('scene generation preserves thumbnails/history pipeline', /createThumbnail/.test(sceneGenerationSurface) && /addToHistory/.test(sceneGenerationSurface))
check('scene generation preserves image load/release flow', /ensureImagesLoaded/.test(sceneGenerationSurface) && /releaseImageData/.test(sceneGenerationSurface))
check('scene generation keeps queue decrement boundary', /decrementFirstQueuedScene/.test(sceneGeneration))
check('auth store exposes active-token slot metadata', /getActiveTokens/.test(authStore) && /ActiveTokenEntry/.test(authStore))

const failed = checks.filter((entry) => !entry.pass)
for (const entry of checks) {
    console.log(`${entry.pass ? 'PASS' : 'FAIL'} ${entry.name}`)
}

if (failed.length > 0) {
    console.error(`\nPhase 5 dual-worker verification failed: ${failed.length} check(s).`)
    process.exit(1)
}

console.log(`\nPhase 5 dual-worker verification passed: ${checks.length} checks.`)
