import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'

import { chromium } from 'playwright'

const port = Number(process.env.RESCUE_MODE_PORT || 5178)
const baseUrl = `http://127.0.0.1:${port}`
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function quoteWindowsArg(arg) {
    if (/^[A-Za-z0-9_:./=-]+$/.test(arg)) return arg
    return `"${arg.replace(/"/g, '\\"')}"`
}

function startServer() {
    const args = ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort']
    if (process.platform !== 'win32') {
        return spawn(npmCommand, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    }
    return spawn('cmd.exe', ['/d', '/s', '/c', [npmCommand, ...args.map(quoteWindowsArg)].join(' ')], {
        stdio: ['ignore', 'pipe', 'pipe'],
    })
}

async function waitForReady(child) {
    let output = ''
    child.stdout.on('data', chunk => { output += chunk.toString() })
    child.stderr.on('data', chunk => { output += chunk.toString() })
    const started = Date.now()
    while (Date.now() - started < 30_000) {
        if (output.toLowerCase().includes('ready in')) return
        if (child.exitCode !== null) throw new Error(`Vite exited before readiness.\n${output}`)
        await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error(`Vite did not become ready.\n${output}`)
}

async function closeServer(child) {
    if (!child || child.exitCode !== null) return
    if (process.platform === 'win32' && child.pid) {
        spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
        return
    }
    child.kill()
    await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 3_000))])
}

async function main() {
    const server = startServer()
    let browser
    try {
        await waitForReady(server)
        browser = await chromium.launch()
        const page = await browser.newPage({
            viewport: { width: 390, height: 844 },
            hasTouch: true,
            isMobile: true,
        })
        page.setDefaultTimeout(20_000)
        await page.route('**/*', route => {
            const requestUrl = route.request().url()
            if (requestUrl.startsWith(baseUrl) || !/^https?:/i.test(requestUrl)) return route.continue()
            return route.abort()
        })
        await page.addInitScript(() => {
            window.__naisRescueDbOpenCount = 0
            const blockedFactory = {
                open() {
                    window.__naisRescueDbOpenCount += 1
                    const request = {
                        error: null,
                        onblocked: null,
                        onerror: null,
                        onsuccess: null,
                        onupgradeneeded: null,
                    }
                    queueMicrotask(() => request.onblocked?.())
                    return request
                },
            }
            Object.defineProperty(window, 'indexedDB', {
                configurable: true,
                value: blockedFactory,
            })
        })

        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
        const rescue = page.locator('main[data-startup-mode="rescue"]')
        await rescue.waitFor({ state: 'visible' })
        assert.equal(await page.locator('[data-testid="main-generate-action"], [data-testid="scene-generate-action"]').count(), 0)
        assert.match(await rescue.textContent(), /NAIS_Backup\/full/)

        const buttons = rescue.locator('button')
        assert.equal(await buttons.count(), 3)
        for (let index = 0; index < 3; index += 1) {
            const box = await buttons.nth(index).boundingBox()
            assert.ok(box && box.height >= 44, `rescue button ${index} is below 44px`)
        }

        const retry = page.getByRole('button', { name: '데이터베이스 다시 시도' })
        const initialOpenCount = await page.evaluate(() => window.__naisRescueDbOpenCount)
        await retry.focus()
        await page.keyboard.press('Enter')
        await page.waitForFunction(count => window.__naisRescueDbOpenCount > count, initialOpenCount)
        await rescue.waitFor({ state: 'visible' })

        const keyboardOpenCount = await page.evaluate(() => window.__naisRescueDbOpenCount)
        await page.getByRole('button', { name: '데이터베이스 다시 시도' }).tap()
        await page.waitForFunction(count => window.__naisRescueDbOpenCount > count, keyboardOpenCount)
        await page.locator('main[data-startup-mode="rescue"]').waitFor({ state: 'visible' })

        console.log('Rescue mode keyboard/touch contract passed (blocked IndexedDB; normal generation UI absent).')
    } finally {
        await browser?.close().catch(() => undefined)
        await closeServer(server)
    }
}

main().then(
    () => process.exit(0),
    error => {
        console.error(error)
        process.exit(1)
    },
)
