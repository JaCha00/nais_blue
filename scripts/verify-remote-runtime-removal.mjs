import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const root = process.cwd()
const gatePath = 'scripts/verify-remote-runtime-removal.mjs'

const SEARCH_TERMS = [
    'marketplace',
    'supabase',
    'market-auth',
    'oauth-callback',
    'signInWithDiscord',
    'VITE_SUPABASE',
    '@supabase/supabase-js',
    '@tauri-apps/plugin-deep-link',
    'tauri-plugin-deep-link',
    'nais2://',
    'onOpenUrl',
    'preset_likes',
    'preset_downloads',
]

// Historical sources are not shipped by Vite/Tauri. Runtime matches are
// limited to the compatibility classifiers that ignore old remote-only keys.
const HISTORICAL_ALLOWLIST = [
    'legacy/**',
]
const DOCUMENTATION_ALLOWLIST = [
    'docs/composition-v2/LEGACY_RUNTIME_ALLOWLIST.md',
    'docs/composition-v2/MARKETPLACE_REMOVAL.md',
]
const IGNORED_LEGACY_KEY_RUNTIME_ALLOWLIST = new Set([
    'src/domain/composition/migrations/legacy-stores-to-v2.ts',
    'src/lib/auto-backup.ts',
    'src/lib/indexed-db.ts',
])
const IGNORED_LEGACY_KEY_TEST_ALLOWLIST = [
    'tests/fixtures/legacy/**',
    'tests/migration/**',
]
function normalize(relativePath) {
    return relativePath.replaceAll('\\', '/')
}

function isAllowlisted(relativePath) {
    return relativePath === gatePath
        || relativePath === 'docs/composition-v2/LEGACY_RUNTIME_ALLOWLIST.md'
        || relativePath === 'docs/composition-v2/MARKETPLACE_REMOVAL.md'
        || relativePath.startsWith('legacy/')
        || IGNORED_LEGACY_KEY_RUNTIME_ALLOWLIST.has(relativePath)
        || relativePath.startsWith('tests/fixtures/legacy/')
        || relativePath.startsWith('tests/migration/')
}

async function runGit(args, options = {}) {
    const execute = promisify(execFile)
    const safeRoot = normalize(root)
    return execute('git', [
        '-c',
        `safe.directory=${safeRoot}`,
        ...args,
    ], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        ...options,
    })
}

async function listGitFiles(args) {
    const { stdout } = await runGit(['ls-files', ...args, '-z'])

    return stdout.split('\0').filter(Boolean).map(normalize)
}

async function listRepositoryFiles() {
    const [tracked, untracked] = await Promise.all([
        listGitFiles(['--cached']),
        listGitFiles(['--others', '--exclude-standard']),
    ])

    return {
        paths: [...new Set([...tracked, ...untracked])],
        tracked: new Set(tracked),
    }
}

async function readTrackedFileFromIndex(relativePath) {
    const { stdout } = await runGit(['show', `:${relativePath}`], { encoding: null })
    return stdout
}

function findMatches(relativePath, content) {
    const matches = []
    const lines = content.split(/\r?\n/)
    for (const [index, line] of lines.entries()) {
        const lowerLine = line.toLowerCase()
        const matchedTerms = SEARCH_TERMS.filter(term => lowerLine.includes(term.toLowerCase()))
        if (matchedTerms.length > 0) {
            matches.push({
                path: relativePath,
                line: index + 1,
                terms: matchedTerms,
                preview: line.trim().slice(0, 180),
            })
        }
    }
    return matches
}

const repositoryFiles = await listRepositoryFiles()
const matches = []
for (const relativePath of repositoryFiles.paths) {
    let bytes
    try {
        bytes = await readFile(path.join(root, relativePath))
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error
        if (!repositoryFiles.tracked.has(relativePath)) continue

        // An unstaged deletion must not make a local run cleaner than CI.
        // Read the tracked blob from the index so clean and dirty worktrees
        // enforce the same residue policy.
        bytes = await readTrackedFileFromIndex(relativePath)
    }
    if (bytes.includes(0)) continue
    matches.push(...findMatches(relativePath, bytes.toString('utf8')))
}

const allowed = matches.filter(match => isAllowlisted(match.path))
const forbidden = matches.filter(match => !isAllowlisted(match.path))
const trackedCodexToolingFiles = [...repositoryFiles.tracked]
    .filter(relativePath => relativePath.startsWith('.codex/'))

const tauriConfig = JSON.parse(await readFile(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'))
const releaseInputIsDistOnly = tauriConfig?.build?.frontendDist === '../dist'
const viteConfig = await readFile(path.join(root, 'vite.config.ts'), 'utf8')
const legacySourceIsNotPublicInput = !/publicDir\s*:\s*['"](?:\.\.\/)?legacy(?:\/|['"])/i.test(viteConfig)
const repositoryRootIsNotPublicInput = !/publicDir\s*:\s*['"](?:\.|\.\/)['"]/i.test(viteConfig)
const publicReleaseScript = await readFile(path.join(root, 'scripts/create-public-release.ps1'), 'utf8')
const publicSourceExcludesCodexTooling = /['"]\.codex['"]/i.test(publicReleaseScript)

console.log('Remote runtime removal search gate')
console.log(`Search terms (${SEARCH_TERMS.length}): ${SEARCH_TERMS.join(', ')}`)
console.log('Historical allowlist:', HISTORICAL_ALLOWLIST.join(', '))
console.log('Documentation allowlist:', DOCUMENTATION_ALLOWLIST.join(', '))
console.log('Ignored-key runtime allowlist:', [...IGNORED_LEGACY_KEY_RUNTIME_ALLOWLIST].join(', '))
console.log('Ignored-key test/fixture allowlist:', IGNORED_LEGACY_KEY_TEST_ALLOWLIST.join(', '))
console.log(`Tracked project-local Codex tooling files: ${trackedCodexToolingFiles.length}`)
console.log(`Allowlisted matches: ${allowed.length}`)
console.log(`Release frontend input: ${tauriConfig?.build?.frontendDist ?? '(missing)'}`)

if (
    !releaseInputIsDistOnly
    || !legacySourceIsNotPublicInput
    || !repositoryRootIsNotPublicInput
    || !publicSourceExcludesCodexTooling
    || trackedCodexToolingFiles.length > 0
) {
    console.error(
        'Release input must remain ../dist, Vite publicDir must not expose the repository root or legacy/**, '
        + 'public source staging must exclude .codex/**, and project-local Codex tooling must remain untracked.',
    )
    process.exit(1)
}

if (forbidden.length > 0) {
    console.error(`Forbidden matches: ${forbidden.length}`)
    for (const match of forbidden) {
        console.error(`${match.path}:${match.line} [${match.terms.join(', ')}] ${match.preview}`)
    }
    process.exit(1)
}

console.log('PASS: removed runtime, dependency, platform, CI and documentation references are absent.')
