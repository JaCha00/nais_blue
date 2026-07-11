import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const VIEWPORTS = [
    { width: 390, height: 844, minCenterWidth: 330, sidebars: 'hidden', mobile: true },
    { width: 412, height: 892, minCenterWidth: 352, sidebars: 'hidden', mobile: true },
    { width: 768, height: 900, minCenterWidth: 680, sidebars: 'hidden' },
    { width: 1280, height: 900, minCenterWidth: 1100, sidebars: 'hidden' },
]

// These routes represent each responsive information architecture used by the
// production shell: command canvas, split editor, dense grids, and settings.
const routes = [
    '/',
    '/style-lab',
    '/scenes',
    '/prompts',
    '/tools',
    '/library',
    '/marketplace',
    '/web',
    '/asset-modules',
    '/settings',
]
const port = Number(process.env.RESPONSIVE_CONTRACT_PORT || 5177)
const baseUrl = process.env.RESPONSIVE_CONTRACT_URL || `http://127.0.0.1:${port}`
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const root = path.resolve(import.meta.dirname, '..')
const evidenceDir = process.env.RESPONSIVE_EVIDENCE_DIR
    ? path.resolve(process.env.RESPONSIVE_EVIDENCE_DIR)
    : null

if (evidenceDir) {
    mkdirSync(evidenceDir, { recursive: true })
}

function routeSlug(route) {
    return route === '/' ? 'main' : route.slice(1).replaceAll('/', '-')
}

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

function verifyDialogSourceContracts() {
    // Tool dialogs need image state that is intentionally absent from this
    // deterministic browser fixture. Keep their mobile-width requirement
    // executable without coupling the test to an authenticated/user data set.
    for (const relativePath of [
        'src/components/tools/I2IDialog.tsx',
        'src/components/tools/InpaintingDialog.tsx',
        'src/components/tools/MosaicDialog.tsx',
    ]) {
        const source = readFileSync(path.join(root, relativePath), 'utf8')
        assert.doesNotMatch(
            source,
            /(?:maxWidth|width)\s*:\s*['"]60vw['"]|(?:max-)?w-\[60vw\]/,
            `${relativePath} must not force a 60vw dialog on phone viewports`,
        )
    }
}

async function collectVisibleCtaReport(page, rootSelector = 'body') {
    return page.evaluate(({ selector }) => {
        const reportRoot = document.querySelector(selector)
        if (!reportRoot) {
            return { missingRoot: true, clipped: [], overlaps: [], count: 0 }
        }

        const CTA_SELECTOR = [
            'a[href]',
            'button',
            'input[type="button"]',
            'input[type="reset"]',
            'input[type="submit"]',
            '[role="button"]',
        ].join(',')
        const CLIPPING_VALUES = new Set(['auto', 'clip', 'hidden', 'scroll'])
        const CLIP_TOLERANCE = 2
        const OVERLAP_TOLERANCE = 2

        const intersect = (first, second) => ({
            left: Math.max(first.left, second.left),
            top: Math.max(first.top, second.top),
            right: Math.min(first.right, second.right),
            bottom: Math.min(first.bottom, second.bottom),
        })
        const dimensions = rect => ({
            width: Math.max(0, rect.right - rect.left),
            height: Math.max(0, rect.bottom - rect.top),
        })
        const rectSnapshot = rect => ({
            left: Math.round(rect.left * 10) / 10,
            top: Math.round(rect.top * 10) / 10,
            right: Math.round(rect.right * 10) / 10,
            bottom: Math.round(rect.bottom * 10) / 10,
            width: Math.round((rect.right - rect.left) * 10) / 10,
            height: Math.round((rect.bottom - rect.top) * 10) / 10,
        })
        const describe = (element, index) => {
            const testId = element.getAttribute('data-testid')
            const ariaLabel = element.getAttribute('aria-label')
            const title = element.getAttribute('title')
            const text = (element.textContent || element.getAttribute('value') || '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 60)
            const id = element.id ? `#${element.id}` : ''
            return `${element.tagName.toLowerCase()}${id} ${testId || ariaLabel || title || text || `cta-${index}`}`.trim()
        }
        const isRendered = (element, rect) => {
            const style = getComputedStyle(element)
            return !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                style.visibility !== 'collapse' &&
                Number.parseFloat(style.opacity || '1') > 0.01 &&
                rect.width >= 8 &&
                rect.height >= 8
        }
        const viewportClip = {
            left: 0,
            top: 0,
            right: document.documentElement.clientWidth,
            bottom: window.innerHeight,
        }
        const candidates = Array.from(reportRoot.querySelectorAll(CTA_SELECTOR))
            // Nested interactive markup produces the same visual CTA twice.
            .filter(element => !element.parentElement?.closest(CTA_SELECTOR))
            .map((element, index) => {
                const rect = element.getBoundingClientRect()
                if (!isRendered(element, rect)) return null

                let clip = viewportClip
                let topClipIsNonScrollable = false
                let bottomClipIsNonScrollable = false
                for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
                    const style = getComputedStyle(ancestor)
                    const ancestorRect = ancestor.getBoundingClientRect()
                    const clipsX = CLIPPING_VALUES.has(style.overflowX) || style.contain.includes('paint')
                    const clipsY = CLIPPING_VALUES.has(style.overflowY) || style.contain.includes('paint')
                    if (clipsX) {
                        clip = intersect(clip, {
                            left: ancestorRect.left,
                            top: Number.NEGATIVE_INFINITY,
                            right: ancestorRect.right,
                            bottom: Number.POSITIVE_INFINITY,
                        })
                    }
                    if (clipsY) {
                        const nonScrollable = style.overflowY === 'hidden' ||
                            style.overflowY === 'clip' ||
                            style.contain.includes('paint')
                        if (ancestorRect.top > clip.top) {
                            clip = { ...clip, top: ancestorRect.top }
                            topClipIsNonScrollable = nonScrollable
                        }
                        if (ancestorRect.bottom < clip.bottom) {
                            clip = { ...clip, bottom: ancestorRect.bottom }
                            bottomClipIsNonScrollable = nonScrollable
                        }
                    }
                }

                const visibleRect = intersect(rect, clip)
                const visibleDimensions = dimensions(visibleRect)
                if (visibleDimensions.width <= 1 || visibleDimensions.height <= 1) return null

                const horizontalLoss = Math.max(0, clip.left - rect.left, rect.right - clip.right)
                const topLoss = Math.max(0, clip.top - rect.top)
                const bottomLoss = Math.max(0, rect.bottom - clip.bottom)
                const verticalLoss = Math.max(topLoss, bottomLoss)
                const unsafeVerticalLoss = Math.max(
                    topClipIsNonScrollable ? topLoss : 0,
                    bottomClipIsNonScrollable ? bottomLoss : 0,
                )
                const area = Math.max(1, rect.width * rect.height)
                const visibleRatio = (visibleDimensions.width * visibleDimensions.height) / area
                const materiallyVisible = visibleRatio >= 0.35 &&
                    visibleDimensions.width >= Math.min(16, rect.width) &&
                    visibleDimensions.height >= Math.min(16, rect.height)

                return {
                    element,
                    label: describe(element, index),
                    rect,
                    visibleRect,
                    clipped: materiallyVisible && (
                        horizontalLoss > CLIP_TOLERANCE ||
                        unsafeVerticalLoss > CLIP_TOLERANCE
                    ),
                    horizontalLoss,
                    verticalLoss,
                }
            })
            .filter(Boolean)

        const clipped = candidates
            .filter(candidate => candidate.clipped)
            .map(candidate => ({
                label: candidate.label,
                rect: rectSnapshot(candidate.rect),
                visibleRect: rectSnapshot(candidate.visibleRect),
                horizontalLoss: Math.round(candidate.horizontalLoss * 10) / 10,
                verticalLoss: Math.round(candidate.verticalLoss * 10) / 10,
            }))

        const overlaps = []
        for (let firstIndex = 0; firstIndex < candidates.length; firstIndex += 1) {
            const first = candidates[firstIndex]
            for (let secondIndex = firstIndex + 1; secondIndex < candidates.length; secondIndex += 1) {
                const second = candidates[secondIndex]
                if (first.element.contains(second.element) || second.element.contains(first.element)) continue

                const overlap = intersect(first.visibleRect, second.visibleRect)
                const overlapDimensions = dimensions(overlap)
                if (overlapDimensions.width <= OVERLAP_TOLERANCE || overlapDimensions.height <= OVERLAP_TOLERANCE) continue

                const overlapArea = overlapDimensions.width * overlapDimensions.height
                const firstArea = Math.max(1, dimensions(first.visibleRect).width * dimensions(first.visibleRect).height)
                const secondArea = Math.max(1, dimensions(second.visibleRect).width * dimensions(second.visibleRect).height)
                if (overlapArea < 16 || overlapArea / Math.min(firstArea, secondArea) < 0.12) continue

                overlaps.push({
                    first: first.label,
                    second: second.label,
                    overlap: rectSnapshot(overlap),
                })
            }
        }

        return { missingRoot: false, clipped, overlaps, count: candidates.length }
    }, { selector: rootSelector })
}

function assertVisibleCtaLayout(report, context) {
    assert.equal(report.missingRoot, false, `${context} is missing its CTA report root`)
    assert.deepEqual(
        report.clipped,
        [],
        `${context} has visible CTAs outside the viewport or a clipping ancestor:\n${JSON.stringify(report.clipped, null, 2)}`,
    )
    assert.deepEqual(
        report.overlaps,
        [],
        `${context} has overlapping visible CTAs:\n${JSON.stringify(report.overlaps, null, 2)}`,
    )
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
    const server = run(npmCommand, ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'])

    try {
        await waitForReady(server)

        const browser = await chromium.launch()
        try {
            for (const viewport of VIEWPORTS) {
                const page = await browser.newPage({
                    viewport: { width: viewport.width, height: viewport.height },
                    hasTouch: Boolean(viewport.mobile),
                    isMobile: Boolean(viewport.mobile),
                })
                page.setDefaultTimeout(20_000)
                for (const route of routes) {
                    console.log(`Checking ${route} at ${viewport.width}x${viewport.height}`)
                    await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' })
                    await page.waitForFunction(() => {
                        const main = document.querySelector('main')
                        return Boolean(
                            main?.querySelector(
                                'a, button, input, textarea, [role="tab"], [data-testid]',
                            ),
                        )
                    })
                    await page.evaluate(async () => {
                        // Hosted runners may not reach the external font CDNs.
                        // Bound that optional wait and validate the system-font
                        // fallback layout instead of stalling the release gate.
                        await Promise.race([
                            document.fonts?.ready ?? Promise.resolve(),
                            new Promise(resolve => setTimeout(resolve, 750)),
                        ])
                        await new Promise(resolve => {
                            requestAnimationFrame(() => requestAnimationFrame(resolve))
                        })
                    })
                    if (route === '/style-lab') {
                        await page.locator('[role="tab"]').last().click()
                    }

                    const report = await page.evaluate(() => {
                        const main = document.querySelector('main')
                        const centerPanel = main?.parentElement
                        const asides = Array.from(document.querySelectorAll('#nais2-prompt-dock, #nais2-history-dock')).map((aside) => {
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

                        const navTargets = Array.from(document.querySelectorAll('nav a, nav button'))
                            .filter((target) => {
                                const rect = target.getBoundingClientRect()
                                const style = getComputedStyle(target)
                                return style.display !== 'none' && rect.width > 1 && rect.height > 1
                            })
                            .map((target) => {
                                const rect = target.getBoundingClientRect()
                                return { width: rect.width, height: rect.height }
                            })

                        const mainRect = main?.getBoundingClientRect()
                        const mainDock = document.querySelector('[data-testid="main-command-dock"]')
                        const mainAction = document.querySelector('[data-testid="main-generate-action"]')
                        const dockRect = mainDock?.getBoundingClientRect()
                        const actionRect = mainAction?.getBoundingClientRect()

                        return {
                            bodyScrollWidth: document.body.scrollWidth,
                            documentWidth: document.documentElement.clientWidth,
                            mainScrollWidth: main?.scrollWidth ?? 0,
                            mainClientWidth: main?.clientWidth ?? 0,
                            mainWithinViewport: !mainRect || (mainRect.left >= -1 && mainRect.right <= window.innerWidth + 1),
                            centerWidth: centerPanel?.getBoundingClientRect().width ?? 0,
                            visibleSidebarCount: asides.filter(aside => aside.visible).length,
                            textareas: visibleTextareas,
                            navTargets,
                            mainDock: dockRect && actionRect ? {
                                bottom: dockRect.bottom,
                                actionHeight: actionRect.height,
                            } : null,
                        }
                    })
                    const ctaReport = await collectVisibleCtaReport(page)

                    assert.ok(
                        report.centerWidth >= viewport.minCenterWidth,
                        `${route} @ ${viewport.width}px center panel is ${report.centerWidth}px; expected at least ${viewport.minCenterWidth}px`,
                    )
                    assert.ok(
                        report.bodyScrollWidth <= report.documentWidth + 1,
                        `${route} @ ${viewport.width}px creates page-level horizontal overflow`,
                    )
                    assert.ok(
                        report.mainScrollWidth <= report.mainClientWidth + 1,
                        `${route} @ ${viewport.width}px creates main-region horizontal overflow (${report.mainScrollWidth}px > ${report.mainClientWidth}px)`,
                    )
                    assert.ok(report.mainWithinViewport, `${route} @ ${viewport.width}px main region leaves the viewport`)
                    assertVisibleCtaLayout(ctaReport, `${route} @ ${viewport.width}px`)

                    assert.ok(report.navTargets.length >= 5, `${route} @ ${viewport.width}px should expose primary navigation`)
                    for (const [index, target] of report.navTargets.entries()) {
                        assert.ok(
                            target.width >= 40 && target.height >= 40,
                            `${route} @ ${viewport.width}px nav target ${index} is too small (${target.width}x${target.height})`,
                        )
                    }

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

                    // Optional evidence mode keeps the contract test fast by
                    // default while producing deterministic review artifacts
                    // when RESPONSIVE_EVIDENCE_DIR is supplied in CI or QA.
                    if (evidenceDir) {
                        await page.screenshot({
                            path: path.join(evidenceDir, `${routeSlug(route)}-${viewport.width}.png`),
                            animations: 'disabled',
                        })
                    }

                    if (route === '/') {
                        assert.ok(report.mainDock, `/ @ ${viewport.width}px should expose the compact generation dock`)
                        assert.ok(report.mainDock.bottom <= viewport.height + 1, `/ @ ${viewport.width}px command dock leaves the viewport`)
                        assert.ok(report.mainDock.actionHeight >= 44, `/ @ ${viewport.width}px generate action is below 44px`)

                        if (viewport.width === 390) {
                            await page.locator('button[aria-controls="nais2-prompt-sheet"]').click()
                            const promptSheet = page.locator('#nais2-prompt-sheet')
                            await promptSheet.waitFor({ state: 'visible' })
                            const promptReport = await promptSheet.evaluate((sheet) => {
                                const action = sheet.querySelector('[data-testid="prompt-generate-action"]')
                                const actionRect = action?.getBoundingClientRect()
                                return {
                                    scrollWidth: sheet.scrollWidth,
                                    clientWidth: sheet.clientWidth,
                                    actionHeight: actionRect?.height ?? 0,
                                    actionBottom: actionRect?.bottom ?? Number.POSITIVE_INFINITY,
                                }
                            })
                            assert.ok(promptReport.scrollWidth <= promptReport.clientWidth + 1, 'Prompt Sheet has horizontal overflow')
                            assert.ok(promptReport.actionHeight >= 44, 'Prompt Sheet generate action is below 44px')
                            assert.ok(promptReport.actionBottom <= viewport.height + 1, 'Prompt Sheet generate action is not reachable in the viewport')
                            if (evidenceDir) {
                                await page.screenshot({ path: path.join(evidenceDir, 'prompt-sheet-390.png'), animations: 'disabled' })
                            }
                            await page.keyboard.press('Escape')
                            await promptSheet.waitFor({ state: 'hidden' })

                            await page.locator('button[aria-controls="nais2-history-sheet"]').click()
                            const historySheet = page.locator('#nais2-history-sheet')
                            await historySheet.waitFor({ state: 'visible' })
                            const historyReport = await historySheet.evaluate((sheet) => {
                                const refresh = sheet.querySelector('[data-testid="history-refresh"]')
                                const refreshRect = refresh?.getBoundingClientRect()
                                return {
                                    scrollWidth: sheet.scrollWidth,
                                    clientWidth: sheet.clientWidth,
                                    refreshWidth: refreshRect?.width ?? 0,
                                    refreshHeight: refreshRect?.height ?? 0,
                                }
                            })
                            assert.ok(historyReport.scrollWidth <= historyReport.clientWidth + 1, 'History Sheet has horizontal overflow')
                            assert.ok(
                                historyReport.refreshWidth >= 44 && historyReport.refreshHeight >= 44,
                                `History refresh target is below 44px (${historyReport.refreshWidth}x${historyReport.refreshHeight})`,
                            )
                            if (evidenceDir) {
                                await page.screenshot({ path: path.join(evidenceDir, 'history-sheet-390.png'), animations: 'disabled' })
                            }
                            await page.keyboard.press('Escape')
                            await historySheet.waitFor({ state: 'hidden' })
                        }
                    }

                    if (route === '/web' && viewport.mobile) {
                        const addQuickLink = page.locator('main button:has(svg.lucide-plus)')
                        assert.equal(
                            await addQuickLink.count(),
                            1,
                            `/web @ ${viewport.width}px should expose one stable add-link dialog trigger`,
                        )
                        await addQuickLink.click()

                        const dialog = page.locator('[role="dialog"]')
                        await dialog.waitFor({ state: 'visible' })
                        const dialogReport = await dialog.evaluate((element) => {
                            const rect = element.getBoundingClientRect()
                            return {
                                left: rect.left,
                                top: rect.top,
                                right: rect.right,
                                bottom: rect.bottom,
                                scrollWidth: element.scrollWidth,
                                clientWidth: element.clientWidth,
                            }
                        })
                        assert.ok(
                            dialogReport.left >= -1 &&
                            dialogReport.top >= -1 &&
                            dialogReport.right <= viewport.width + 1 &&
                            dialogReport.bottom <= viewport.height + 1,
                            `/web @ ${viewport.width}px add-link dialog leaves the viewport`,
                        )
                        assert.ok(
                            dialogReport.scrollWidth <= dialogReport.clientWidth + 1,
                            `/web @ ${viewport.width}px add-link dialog has horizontal overflow`,
                        )
                        assertVisibleCtaLayout(
                            await collectVisibleCtaReport(page, '[role="dialog"]'),
                            `/web dialog @ ${viewport.width}px`,
                        )
                        if (evidenceDir) {
                            await page.screenshot({
                                path: path.join(evidenceDir, `web-dialog-${viewport.width}.png`),
                                animations: 'disabled',
                            })
                        }
                        await page.keyboard.press('Escape')
                        await dialog.waitFor({ state: 'hidden' })

                        // Quick-link delete controls only exist in edit mode.
                        // Exercise that state because coarse-pointer sizing can
                        // otherwise make them overlap the underlying link CTA.
                        const editQuickLinks = page.locator('main button:has(svg.lucide-square-pen)')
                        assert.equal(
                            await editQuickLinks.count(),
                            1,
                            `/web @ ${viewport.width}px should expose one stable quick-link edit trigger`,
                        )
                        await editQuickLinks.click()
                        await page.locator('main button:has(svg.lucide-x)').first().waitFor({ state: 'visible' })
                        assertVisibleCtaLayout(
                            await collectVisibleCtaReport(page),
                            `/web edit mode @ ${viewport.width}px`,
                        )
                    }
                }
                await page.close()
            }
            verifyDialogSourceContracts()
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
