import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const checks = []
const check = (name, pass, detail = '') => {
    checks.push({ name, pass, detail })
}

const authStore = read('src/stores/auth-store.ts')
const settings = read('src/pages/Settings.tsx')
const layout = read('src/components/layout/ThreeColumnLayout.tsx')
const removedCatalogPath = `/${['market', 'place'].join('')}`

check('auth store exports ApiSlot', /export type ApiSlot = 1 \| 2/.test(authStore))
check('auth store keeps slot 1 compatibility fields', /token:\s*string/.test(authStore) && /isVerified:\s*boolean/.test(authStore) && /anlas:\s*AnlasInfo \| null/.test(authStore))
check('auth store adds slot 2 persisted fields', /token2:\s*string/.test(authStore) && /isVerified2:\s*boolean/.test(authStore) && /anlas2:\s*AnlasInfo \| null/.test(authStore))
check('auth store adds slot enable flags', /slot1Enabled:\s*boolean/.test(authStore) && /slot2Enabled:\s*boolean/.test(authStore))
check('auth store keeps IndexedDB persistence', /createJSONStorage\(\(\) => indexedDBStorage\)/.test(authStore))
check('auth store exposes active-token helpers', /refreshAllAnlas/.test(authStore) && /setSlotEnabled/.test(authStore) && /getActiveTokens/.test(authStore))
check('auth store persists dual slot metadata without Anlas balances',
    /token2:\s*state\.token2/.test(authStore) &&
    /slot2Enabled:\s*state\.slot2Enabled/.test(authStore) &&
    !/anlas:\s*state\.anlas/.test(authStore) &&
    !/anlas2:\s*state\.anlas2/.test(authStore)
)
check('auth store uses Zustand version 2 migration', /version:\s*2/.test(authStore) && /migrate:\s*\(persistedState,\s*version\)/.test(authStore) && /version < 2/.test(authStore))
check('auth migration defaults both slot flags', /slot1Enabled:\s*typeof state\.slot1Enabled === 'boolean'/.test(authStore) && /slot2Enabled:\s*typeof state\.slot2Enabled === 'boolean'/.test(authStore))
check('slot 1 verify remains backward compatible', /verifyAndSave:\s*\(token:\s*string,\s*slot\?:\s*ApiSlot\)/.test(authStore) && /verifyAndSave:\s*async\s*\(token,\s*slot = 1\)/.test(authStore))

check('Settings reads both token slots', /token2/.test(settings) && /isVerified2/.test(settings) && /slot2Enabled/.test(settings))
check('Settings API section renders shared slot cards', /<ApiSlotCard slot=\{1\} \/>/.test(settings) && /<ApiSlotCard slot=\{2\} \/>/.test(settings))
check('Settings ApiSlotCard verifies the selected slot', /function ApiSlotCard/.test(settings) && /verifyAndSave\(apiToken,\s*slot\)/.test(settings))
check('Settings ApiSlotCard can toggle and clear slots', /setSlotEnabled\(slot,/.test(settings) && /clearToken\(slot\)/.test(settings))
check('Settings keeps Gemini controls', /GeminiIcon/.test(settings) && /settingsPage\.api\.geminiKey/.test(settings))

check('layout bases Anlas pills on active tokens helper', /getActiveTokens/.test(layout) && /activeTokens/.test(layout))
check('layout reads dual slot balances', /anlas2/.test(layout) && /slot2Enabled/.test(layout))
check('layout refreshes both slots', /refreshAnlas\(1\)/.test(layout) && /refreshAnlas\(2\)/.test(layout))
check('layout keeps Style Lab and excludes the removed remote catalog', /\/style-lab/.test(layout) && !layout.includes(removedCatalogPath))

const generationStore = read('src/stores/generation-store.ts')
check('main generation explicitly selects slot 1 token', /find\(\(entry\) => entry\.slot === 1\)/.test(generationStore) && /const token = slot1Token\?\.token/.test(generationStore))
check('main generation refreshes slot 1 balance after success', /refreshAnlas\(1\)/.test(generationStore))

const failed = checks.filter((entry) => !entry.pass)
for (const entry of checks) {
    const status = entry.pass ? 'PASS' : 'FAIL'
    console.log(`${status} ${entry.name}${entry.detail ? ` - ${entry.detail}` : ''}`)
}

if (failed.length > 0) {
    console.error(`\nPhase 4 dual API verification failed: ${failed.length} check(s).`)
    process.exit(1)
}

console.log(`\nPhase 4 dual API verification passed: ${checks.length} checks.`)
