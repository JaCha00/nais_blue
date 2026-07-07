import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const evidenceDir = path.resolve('.superloopy/sessions/nais2-responsive-stylelab-20260707/evidence/frontend')
const port = 5178
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx'

function quoteWindowsArg(arg) {
    if (/^[A-Za-z0-9_:./=-]+$/.test(arg)) return arg
    return `"${arg.replace(/"/g, '\\"')}"`
}

function prepareCommand(command, args) {
    if (process.platform !== 'win32') return { command, args }
    return {
        command: 'cmd.exe',
        args: ['/d', '/s', '/c', [command, ...args.map(quoteWindowsArg)].join(' ')],
    }
}

function output(command, args) {
    const prepared = prepareCommand(command, args)
    const result = spawnSync(prepared.command, prepared.args, { encoding: 'utf8' })
    if (result.status !== 0) throw new Error(result.stderr || result.stdout)
    return result.stdout.trim()
}

function findPlaywrightEntrypoint() {
    output(npxCommand, ['--yes', 'playwright', '--version'])
    const npxRoot = path.join(output(npmCommand, ['config', 'get', 'cache']), '_npx')
    const candidates = []

    for (const runDir of readdirSync(npxRoot, { withFileTypes: true })) {
        if (!runDir.isDirectory()) continue
        const entrypoint = path.join(npxRoot, runDir.name, 'node_modules', 'playwright', 'index.mjs')
        if (existsSync(entrypoint)) {
            candidates.push({ entrypoint, modifiedAt: statSync(entrypoint).mtimeMs })
        }
    }

    candidates.sort((a, b) => b.modifiedAt - a.modifiedAt)
    if (!candidates[0]) throw new Error('Playwright package was not found in npx cache')
    return candidates[0].entrypoint
}

function run(command, args) {
    const prepared = prepareCommand(command, args)
    return spawn(prepared.command, prepared.args, { stdio: ['ignore', 'pipe', 'pipe'] })
}

async function waitForReady(child) {
    let logs = ''
    child.stdout.on('data', chunk => {
        logs += chunk.toString()
    })
    child.stderr.on('data', chunk => {
        logs += chunk.toString()
    })

    const started = Date.now()
    while (Date.now() - started < 30000) {
        if (logs.toLowerCase().includes('ready in')) return
        await new Promise(resolve => setTimeout(resolve, 250))
    }

    throw new Error(`Vite did not become ready:\n${logs}`)
}

function closeServer(child) {
    if (!child || child.exitCode !== null) return
    if (process.platform === 'win32' && child.pid) {
        spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
        return
    }
    child.kill()
}

async function main() {
    mkdirSync(evidenceDir, { recursive: true })
    const { chromium } = await import(pathToFileURL(findPlaywrightEntrypoint()).href)
    const server = run(npmCommand, ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'])

    try {
        await waitForReady(server)
        const browser = await chromium.launch()

        try {
            for (const width of [390, 768, 1280]) {
                const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 } })

                await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' })
                await page.screenshot({ path: path.join(evidenceDir, `root-${width}.png`) })

                await page.goto(`http://127.0.0.1:${port}/style-lab`, { waitUntil: 'networkidle' })
                await page.locator('[role="tab"]').last().click()
                await page.screenshot({ path: path.join(evidenceDir, `style-lab-settings-${width}.png`) })

                await page.close()
            }
        } finally {
            await browser.close()
        }
    } finally {
        closeServer(server)
        await Promise.race([
            once(server, 'exit'),
            new Promise(resolve => setTimeout(resolve, 3000)),
        ])
    }
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
