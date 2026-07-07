import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const VIEWPORTS = [
    { width: 390, height: 844, minCenterWidth: 330, sidebars: 'hidden' },
    { width: 768, height: 900, minCenterWidth: 680, sidebars: 'hidden' },
    { width: 1280, height: 900, minCenterWidth: 1100, sidebars: 'hidden' },
]

const routes = ['/', '/style-lab']
const port = Number(process.env.RESPONSIVE_CONTRACT_PORT || 5177)
const baseUrl = process.env.RESPONSIVE_CONTRACT_URL || `http://127.0.0.1:${port}`
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

function run(command, args, options = {}) {
    const prepared = prepareCommand(command, args)
    return spawn(prepared.command, prepared.args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        ...options,
    })
}

function commandOutput(command, args) {
    const prepared = prepareCommand(command, args)
    const result = spawnSync(prepared.command, prepared.args, {
        encoding: 'utf8',
    })
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(' ')} failed:\n${result.error?.message || result.stderr || result.stdout}`)
    }
    return result.stdout.trim()
}

function findPlaywrightEntrypoint() {
    commandOutput(npxCommand, ['--yes', 'playwright', '--version'])

    const cacheRoot = commandOutput(npmCommand, ['config', 'get', 'cache'])
    const npxRoot = path.join(cacheRoot, '_npx')
    const candidates = []

    if (!existsSync(npxRoot)) {
        throw new Error(`Cannot find npm npx cache at ${npxRoot}`)
    }

    for (const runDir of readdirSync(npxRoot, { withFileTypes: true })) {
        if (!runDir.isDirectory()) continue
        const packageDir = path.join(npxRoot, runDir.name, 'node_modules', 'playwright')
        const entrypoint = path.join(packageDir, 'index.mjs')
        if (!existsSync(entrypoint)) continue
        candidates.push({
            entrypoint,
            modifiedAt: statSync(entrypoint).mtimeMs,
        })
    }

    candidates.sort((a, b) => b.modifiedAt - a.modifiedAt)

    if (!candidates[0]) {
        throw new Error('Cannot locate Playwright in the npm npx cache')
    }

    return candidates[0].entrypoint
}

async function waitForReady(child) {
    let output = ''
    const started = Date.now()

    child.stdout.on('data', chunk => {
        output += chunk.toString()
    })
    child.stderr.on('data', chunk => {
        output += chunk.toString()
    })

    while (Date.now() - started < 30000) {
        if (output.toLowerCase().includes('ready in')) return
        await new Promise(resolve => setTimeout(resolve, 250))
    }

    throw new Error(`Vite dev server did not become ready.\n${output}`)
}

async function closeServer(child) {
    if (!child || child.exitCode !== null) return
    if (process.platform === 'win32' && child.pid) {
        spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
        return
    }
    child.kill()
    await Promise.race([
        once(child, 'exit'),
        new Promise(resolve => setTimeout(resolve, 3000)),
    ])
}

async function main() {
    const playwrightEntrypoint = findPlaywrightEntrypoint()
    const { chromium } = await import(pathToFileURL(playwrightEntrypoint).href)
    const server = run(npmCommand, ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'])

    try {
        await waitForReady(server)

        const browser = await chromium.launch()
        try {
            for (const viewport of VIEWPORTS) {
                const page = await browser.newPage({ viewport })
                for (const route of routes) {
                    await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' })
                    if (route === '/style-lab') {
                        await page.locator('[role="tab"]').last().click()
                    }

                    const report = await page.evaluate(() => {
                        const main = document.querySelector('main')
                        const centerPanel = main?.parentElement
                        const asides = Array.from(document.querySelectorAll('aside')).map((aside) => {
                            const rect = aside.getBoundingClientRect()
                            const style = getComputedStyle(aside)
                            return {
                                width: rect.width,
                                display: style.display,
                                visible: style.display !== 'none' && rect.width > 1 && rect.height > 1,
                            }
                        })
                        const visibleTextareas = Array.from(document.querySelectorAll('textarea'))
                            .filter((textarea) => {
                                const rect = textarea.getBoundingClientRect()
                                const style = getComputedStyle(textarea)
                                return style.display !== 'none' && rect.width > 1 && rect.height > 1
                            })
                            .map((textarea) => {
                                const rect = textarea.getBoundingClientRect()
                                const style = getComputedStyle(textarea)
                                return {
                                    width: rect.width,
                                    height: rect.height,
                                    fontSize: Number.parseFloat(style.fontSize),
                                    scrollWidth: textarea.scrollWidth,
                                    clientWidth: textarea.clientWidth,
                                }
                            })

                        return {
                            bodyScrollWidth: document.body.scrollWidth,
                            documentWidth: document.documentElement.clientWidth,
                            centerWidth: centerPanel?.getBoundingClientRect().width ?? 0,
                            visibleSidebarCount: asides.filter(aside => aside.visible).length,
                            textareas: visibleTextareas,
                        }
                    })

                    assert.ok(
                        report.centerWidth >= viewport.minCenterWidth,
                        `${route} @ ${viewport.width}px center panel is ${report.centerWidth}px; expected at least ${viewport.minCenterWidth}px`,
                    )
                    assert.ok(
                        report.bodyScrollWidth <= report.documentWidth + 1,
                        `${route} @ ${viewport.width}px creates page-level horizontal overflow`,
                    )

                    if (viewport.sidebars === 'hidden') {
                        assert.equal(
                            report.visibleSidebarCount,
                            0,
                            `${route} @ ${viewport.width}px should keep sidebars out of the primary frame`,
                        )
                    }

                    if (route === '/style-lab') {
                        assert.ok(report.textareas.length > 0, 'Style Lab should render text areas')
                        for (const [index, textarea] of report.textareas.entries()) {
                            assert.ok(
                                textarea.width >= Math.min(300, viewport.width - 48),
                                `/style-lab @ ${viewport.width}px textarea ${index} is too narrow (${textarea.width}px)`,
                            )
                            assert.ok(
                                textarea.fontSize >= 12,
                                `/style-lab @ ${viewport.width}px textarea ${index} font is too small (${textarea.fontSize}px)`,
                            )
                            assert.ok(
                                textarea.scrollWidth <= textarea.clientWidth + 24,
                                `/style-lab @ ${viewport.width}px textarea ${index} has excessive horizontal internal overflow`,
                            )
                        }
                    }
                }
                await page.close()
            }
        } finally {
            await browser.close()
        }
    } finally {
        await closeServer(server)
    }
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
