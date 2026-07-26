import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import test from 'node:test'
import { createServer } from 'vite'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const smartToolsPath = '/src/services/smart-tools.ts'

function installBrowserRuntimeMocks() {
    const fetchedUrls = []

    globalThis.fetch = async (url) => {
        const urlText = String(url)
        fetchedUrls.push(urlText)

        return {
            ok: true,
            status: 200,
            statusText: 'OK',
            blob: async () => new Blob([urlText], { type: 'image/png' }),
            json: async () => ({ url: urlText }),
            text: async () => urlText,
        }
    }

    globalThis.FileReader = class TestFileReader {
        result = null
        onloadend = null
        onerror = null

        readAsDataURL(blob) {
            blob.arrayBuffer()
                .then((buffer) => {
                    const mime = blob.type || 'application/octet-stream'
                    this.result = `data:${mime};base64,${Buffer.from(buffer).toString('base64')}`
                    this.onloadend?.()
                })
                .catch((error) => {
                    this.onerror?.(error)
                })
        }
    }

    return { fetchedUrls }
}

function smartToolsContractPlugin() {
    return {
        name: 'smart-tools-contract-test',
        enforce: 'pre',
        resolveId(id) {
            const normalizedId = id.replace(/\\/g, '/')
            if (id === '@gradio/client') {
                return '\0smart-tools-test-gradio-client'
            }
            if (
                id === '@/services/novelai-api' ||
                normalizedId.endsWith('/src/services/novelai-api') ||
                normalizedId.endsWith('/src/services/novelai-api.ts')
            ) {
                return '\0smart-tools-test-novelai-api'
            }
            return null
        },
        load(id) {
            if (id === '\0smart-tools-test-gradio-client') {
                return `
                    export const Client = {
                        connect: async (space) => ({
                            predict: async (endpoint, payload) => {
                                const contract = globalThis.__smartToolsContract
                                if (!contract?.predict) {
                                    throw new Error('Missing smart tools contract mock')
                                }
                                contract.calls.push({ space, endpoint, payload })
                                return await contract.predict(space, endpoint, payload)
                            },
                        }),
                    }
                `
            }
            if (id === '\0smart-tools-test-novelai-api') {
                return `
                    export async function augmentImage() {
                        throw new Error('NovelAI augmentImage is outside this contract test')
                    }
                    export async function upscaleImage() {
                        throw new Error('NovelAI upscaleImage is outside this contract test')
                    }
                `
            }
            return null
        },
    }
}

async function loadSmartTools() {
    const server = await createServer({
        root: repoRoot,
        configFile: false,
        logLevel: 'silent',
        plugins: [smartToolsContractPlugin()],
        resolve: {
            alias: {
                '@': path.resolve(repoRoot, 'src'),
            },
        },
        server: {
            middlewareMode: true,
        },
        ssr: {
            noExternal: ['@gradio/client'],
        },
    })

    try {
        const module = await server.ssrLoadModule(smartToolsPath)
        return { server, smartTools: module.smartTools }
    } catch (error) {
        await server.close()
        throw error
    }
}

async function withSmartTools(predict, run) {
    installBrowserRuntimeMocks()
    const calls = []
    globalThis.__smartToolsContract = { calls, predict }

    const { server, smartTools } = await loadSmartTools()
    try {
        await run({ smartTools, calls })
    } finally {
        await server.close()
        delete globalThis.__smartToolsContract
    }
}

test('Kaloscope style analysis sends only the intended explicit Gradio payload', async () => {
    await withSmartTools(
        async (space, endpoint, payload) => {
            assert.equal(space, 'DraconicDragon/Kaloscope-artist-style-classifier')
            assert.equal(endpoint, '/predict')
            assert.deepEqual(Object.keys(payload).sort(), ['image', 'model_selection', 'threshold', 'top_k'])
            assert.ok(payload.image instanceof Blob)
            assert.equal(payload.model_selection, 'Kaloscope v2.0 ONNX')
            assert.equal(payload.top_k, 5)
            assert.equal(payload.threshold, 0)
            return { data: ['artist one, artist two'] }
        },
        async ({ smartTools, calls }) => {
            const tags = await smartTools.analyzeStyle('test://input-style.png', undefined, 1)

            assert.equal(calls.length, 1)
            assert.deepEqual(tags, [
                { label: 'artist:artist one', score: 1 },
                { label: 'artist:artist two', score: 0.95 },
            ])
        },
    )
})

test('BRIA background removal uses the processed file output instead of the original slider image', async () => {
    const runtime = installBrowserRuntimeMocks()
    const calls = []
    globalThis.__smartToolsContract = {
        calls,
        predict: async (space, endpoint, payload) => {
            assert.equal(space, 'briaai/BRIA-RMBG-2.0')
            assert.equal(endpoint, '/image')
            assert.deepEqual(Object.keys(payload), ['image'])
            assert.ok(payload.image instanceof Blob)
            return {
                data: [
                    [
                        { url: 'https://result.test/original.png' },
                        { url: 'https://result.test/slider-processed.png' },
                    ],
                    { url: 'https://result.test/file-processed.png' },
                ],
            }
        },
    }

    const { server, smartTools } = await loadSmartTools()
    try {
        const result = await smartTools.removeBackground('test://input-background.png', undefined, 1)

        assert.match(result, /^data:image\/png;base64,/)
        assert.deepEqual(runtime.fetchedUrls, [
            'test://input-background.png',
            'https://result.test/file-processed.png',
        ])
    } finally {
        await server.close()
        delete globalThis.__smartToolsContract
    }
})

test('anime-remove-background fallback uses the result image instead of the mask image', async () => {
    const runtime = installBrowserRuntimeMocks()
    const calls = []
    globalThis.__smartToolsContract = {
        calls,
        predict: async (space, endpoint, payload) => {
            if (space === 'briaai/BRIA-RMBG-2.0') {
                throw new Error('BRIA unavailable')
            }

            assert.equal(space, 'skytnt/anime-remove-background')
            assert.equal(endpoint, '/rmbg_fn')
            assert.deepEqual(Object.keys(payload), ['img'])
            assert.ok(payload.img instanceof Blob)
            return {
                data: [
                    { url: 'https://result.test/mask.png' },
                    { url: 'https://result.test/anime-result.png' },
                ],
            }
        },
    }

    const { server, smartTools } = await loadSmartTools()
    try {
        const result = await smartTools.removeBackground('test://input-fallback.png', undefined, 1)

        assert.match(result, /^data:image\/png;base64,/)
        assert.deepEqual(runtime.fetchedUrls, [
            'test://input-fallback.png',
            'https://result.test/anime-result.png',
        ])
        assert.deepEqual(calls.map((call) => call.space), [
            'briaai/BRIA-RMBG-2.0',
            'skytnt/anime-remove-background',
        ])
    } finally {
        await server.close()
        delete globalThis.__smartToolsContract
    }
})
