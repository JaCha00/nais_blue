import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const PAIRING_TTL_MS = 120_000
const DEPLOYMENT_POLL_TIMEOUT_MS = 30_000
const DEPLOYMENT_POLL_INTERVAL_MS = 500
const EDGE_POLL_TIMEOUT_MS = 30_000
const EDGE_POLL_INTERVAL_MS = 500
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const qaScript = resolve(projectRoot, 'scripts', 'qa-cloudflare-transfer-live.mjs')
const wranglerCli = resolve(projectRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js')

const arguments_ = new Set(process.argv.slice(2))
const dryRun = arguments_.delete('--dry-run')
if (arguments_.size > 0) throw new Error(`Unknown argument: ${[...arguments_][0]}`)

const endpoint = process.env.NAIS_WORKER_URL?.trim().replace(/\/$/, '')
if (!endpoint) throw new Error('NAIS_WORKER_URL is required.')
const endpointUrl = new URL(endpoint)
if (endpointUrl.protocol !== 'https:' || endpointUrl.username || endpointUrl.password
    || endpointUrl.search || endpointUrl.hash) {
    throw new Error('NAIS_WORKER_URL must be a credential-free HTTPS base URL.')
}

await Promise.all([access(wranglerCli), access(qaScript)])

function run(command, args, { env = process.env, input } = {}) {
    return new Promise((resolveRun, rejectRun) => {
        const child = spawn(command, args, {
            cwd: projectRoot,
            env,
            shell: false,
            windowsHide: true,
            stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
        })
        child.once('error', rejectRun)
        child.once('exit', (code, signal) => {
            if (code === 0) resolveRun()
            else rejectRun(new Error(`${command} exited with ${code ?? `signal ${signal}`}.`))
        })
        if (input !== undefined) {
            child.stdin.once('error', error => {
                if (error.code !== 'EPIPE') rejectRun(error)
            })
            child.stdin.end(input)
        }
    })
}

/**
 * Wrangler's JSON deployment status is the control-plane boundary created by secret bulk. This
 * helper feeds waitForSecretDeployment without echoing stdout, so only public version metadata is
 * parsed and pairing material remains confined to the bulk command's stdin.
 */
function capture(command, args) {
    return new Promise((resolveCapture, rejectCapture) => {
        const child = spawn(command, args, {
            cwd: projectRoot,
            env: process.env,
            shell: false,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'inherit'],
        })
        let stdout = ''
        child.stdout.setEncoding('utf8')
        child.stdout.on('data', chunk => { stdout += chunk })
        child.once('error', rejectCapture)
        child.once('exit', (code, signal) => {
            if (code === 0) resolveCapture(stdout)
            else rejectCapture(new Error(`${command} exited with ${code ?? `signal ${signal}`}.`))
        })
    })
}

/**
 * The active production deployment links Wrangler's secret-change version to public Worker
 * traffic. Requiring one 100% version prevents QA from consuming a capability during a gradual or
 * stale deployment and returns only the non-secret version ID plus its trigger annotation.
 */
async function productionDeployment() {
    const output = await capture(process.execPath, [
        wranglerCli,
        'deployments',
        'status',
        '--json',
    ])
    const deployment = JSON.parse(output)
    const active = Array.isArray(deployment.versions)
        ? deployment.versions.filter(version => version?.percentage === 100
            && typeof version.version_id === 'string')
        : []
    if (active.length !== 1) throw new Error('Worker must have exactly one 100% production version.')
    return {
        versionId: active[0].version_id,
        triggeredBy: deployment.annotations?.['workers/triggered_by'],
    }
}

/**
 * Secret bulk and production deployment status interact through Cloudflare's version control
 * plane. Polling until a distinct secret-triggered version is active removes the fixed-delay race;
 * a bounded timeout fails closed before the one-use capability is ever sent to the Worker.
 */
async function waitForSecretDeployment(previousVersionId) {
    const deadline = Date.now() + DEPLOYMENT_POLL_TIMEOUT_MS
    do {
        const deployment = await productionDeployment()
        if (deployment.versionId !== previousVersionId && deployment.triggeredBy === 'secret') {
            return deployment.versionId
        }
        await new Promise(resolveDelay => setTimeout(resolveDelay, DEPLOYMENT_POLL_INTERVAL_MS))
    } while (Date.now() < deadline)
    throw new Error('Timed out waiting for the secret-change production version.')
}

/**
 * The Worker's version-metadata readiness route links the public edge request path to the exact
 * Secret Change version observed in Wrangler. It sends no capability and fails closed on malformed,
 * cached, stale, or unavailable responses, so the subsequent QA retains its single pairing attempt.
 */
async function waitForEdgeVersion(expectedVersionId) {
    const deadline = Date.now() + EDGE_POLL_TIMEOUT_MS
    do {
        try {
            const response = await fetch(`${endpoint}/v1/ready`, {
                method: 'GET',
                headers: { 'cache-control': 'no-store' },
                redirect: 'error',
            })
            const body = response.ok ? await response.json() : null
            if (body?.versionId === expectedVersionId) {
                console.log(`CLOUDFLARE_PAIRING_EDGE_READY versionId=${expectedVersionId}`)
                return
            }
        } catch {
            // A transient route or parse failure is safe to retry because no capability is sent.
        }
        await new Promise(resolveDelay => setTimeout(resolveDelay, EDGE_POLL_INTERVAL_MS))
    } while (Date.now() < deadline)
    throw new Error('Timed out waiting for the secret-change version at the public Worker edge.')
}

const capabilityBytes = randomBytes(32)
const capability = capabilityBytes.toString('base64url')
const capabilityHash = createHash('sha256').update(capability, 'utf8').digest('hex')
const expiresAtMs = Date.now() + PAIRING_TTL_MS
if (!/^[a-f0-9]{64}$/.test(capabilityHash)) throw new Error('Pairing hash invariant failed.')

if (dryRun) {
    capabilityBytes.fill(0)
    console.log(`CLOUDFLARE_PAIRING_DRY_RUN_OK hashFormat=hex64 ttlMs=${PAIRING_TTL_MS}`)
    process.exit(0)
}

const previousVersionId = (await productionDeployment()).versionId

/**
 * The pinned Wrangler JavaScript CLI consumes both values from one stdin JSON object, so the
 * verifier hash and expiry reach the deployed Worker together without exposing capability
 * material in arguments or files. Invoking it through Node also keeps piped stdin portable on
 * Windows, while the existing live QA receives plaintext only through its child environment.
 */
await run(process.execPath, [wranglerCli, 'secret', 'bulk'], {
    input: JSON.stringify({
        PAIRING_CAPABILITY_SHA256: capabilityHash,
        PAIRING_EXPIRES_AT_MS: String(expiresAtMs),
    }),
})
const secretVersionId = await waitForSecretDeployment(previousVersionId)
console.log(
    `CLOUDFLARE_PAIRING_ROTATED versionId=${secretVersionId}`
    + ` expiresAtMs=${expiresAtMs} ttlMs=${PAIRING_TTL_MS}`,
)

await waitForEdgeVersion(secretVersionId)
await run(process.execPath, [qaScript], {
    env: {
        ...process.env,
        NAIS_WORKER_URL: endpoint,
        NAIS_PAIRING_CAPABILITY: capability,
    },
})
capabilityBytes.fill(0)
