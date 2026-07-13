import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8')

const checks = []
const check = (name, passed, detail = '') => {
    checks.push({ name, passed, detail })
}

const exists = (relativePath) => existsSync(join(root, relativePath))
const removedCatalogPath = `/${['market', 'place'].join('')}`

check('PromptEditor page exists', exists('src/pages/PromptEditor.tsx'))
check('prompt library store exists', exists('src/stores/prompt-library-store.ts'))

if (exists('src/App.tsx')) {
    const app = read('src/App.tsx')
    check('PromptEditor is lazy-loaded', /const\s+PromptEditor\s*=\s*lazy\(\(\)\s*=>\s*import\('@\/pages\/PromptEditor'\)\)/.test(app))
    check('/prompts route is registered', /<Route\s+path="\/prompts"\s+element=\{<PromptEditor\s*\/>\}/.test(app))
    check('StyleLab route preserved', /path="\/style-lab"/.test(app))
    check('removed remote catalog routes stay unregistered', !app.includes(`path="${removedCatalogPath}`))
}

if (exists('src/components/layout/ThreeColumnLayout.tsx')) {
    const layout = read('src/components/layout/ThreeColumnLayout.tsx')
    check('Prompt Editor nav item exists', /path:\s*'\/prompts'[\s\S]*labelKey:\s*'nav\.promptEditor'/.test(layout))
    check('Prompt Editor nav icon is imported', /NotebookPen/.test(layout))
    check('StyleLab nav item preserved', /path:\s*'\/style-lab'/.test(layout))
    check('removed remote catalog destination stays out of navigation', !layout.includes(`path: '${removedCatalogPath}'`))
}

if (exists('src/stores/prompt-library-store.ts')) {
    const store = read('src/stores/prompt-library-store.ts')
    check('prompt library store uses B IndexedDB storage', /indexedDBStorage/.test(store) && /createJSONStorage\(\(\)\s*=>\s*indexedDBStorage\)/.test(store))
    check('prompt library store avoids Phase 2 auto-backup coupling', !/auto-backup|attachStoreBackup/.test(store))
    check('legacy prompt editor migration is retained', /novelaiPromptEditorState/.test(store))
    check('fragment export import support is retained', /convertFragmentExport/.test(store))
}

if (exists('src/lib/indexed-db.ts')) {
    const indexedDb = read('src/lib/indexed-db.ts')
    check('prompt library participates in full export/import registry', /'nais2-prompt-library'/.test(indexedDb))
    const promptLibraryDirectSize = /getStoreSizes[\s\S]*'nais2-prompt-library'/.test(indexedDb)
    const promptLibrarySharedRegistrySize =
        /BACKUP_STORE_KEYS[\s\S]*'nais2-prompt-library'/.test(indexedDb) &&
        /getStoreSizes[\s\S]*BACKUP_STORE_KEYS/.test(indexedDb)
    check('prompt library size is visible in store-size diagnostics', promptLibraryDirectSize || promptLibrarySharedRegistrySize)
}

for (const locale of ['en', 'ja', 'ko']) {
    const localePath = `src/i18n/locales/${locale}.json`
    if (!exists(localePath)) {
        check(`${locale} locale exists`, false)
        continue
    }
    const parsed = JSON.parse(read(localePath))
    check(`${locale} nav.promptEditor locale exists`, typeof parsed.nav?.promptEditor === 'string' && parsed.nav.promptEditor.length > 0)
}

const failed = checks.filter((item) => !item.passed)

for (const item of checks) {
    const marker = item.passed ? 'PASS' : 'FAIL'
    console.log(`${marker} ${item.name}${item.detail ? ` - ${item.detail}` : ''}`)
}

if (failed.length > 0) {
    console.error(`\nPrompt Editor phase verification failed: ${failed.length} check(s).`)
    process.exit(1)
}

console.log('\nPrompt Editor phase verification passed.')
