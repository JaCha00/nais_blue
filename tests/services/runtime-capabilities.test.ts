import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
    createRuntimeCapabilities,
    UnsupportedRuntimeCapabilityError,
} from '@/platform/capabilities'

describe('RuntimeCapabilities', () => {
    it('exposes the complete desktop capability matrix', () => {
        const capabilities = createRuntimeCapabilities('windows')

        expect(capabilities.platform).toBe('windows')
        expect(capabilities.absoluteOutputPath.supported).toBe(true)
        expect(capabilities.externalProfileFileWatch.supported).toBe(true)
        expect(capabilities.localTaggerSidecar.supported).toBe(true)
        expect(capabilities.embeddedBrowser.supported).toBe(true)
        expect(capabilities.r2DeployTooling.supported).toBe(true)
        expect(capabilities.secureLanSyncTransport.supported).toBe(false)
        expect(capabilities.lanBlobTransfer.supported).toBe(false)
        expect(capabilities.embeddedPngMetadataWrite.supported).toBe(true)
        expect(capabilities.supportedImageFormats).toEqual(['png', 'webp'])
    })

    it('provides a reason and alternative for every unsupported Android capability', () => {
        const capabilities = createRuntimeCapabilities('android')
        const unsupported = [
            capabilities.absoluteOutputPath,
            capabilities.externalProfileFileWatch,
            capabilities.localTaggerSidecar,
            capabilities.embeddedBrowser,
            capabilities.r2DeployTooling,
            capabilities.r2ForegroundUpload,
            capabilities.r2BackgroundUpload,
            capabilities.secureLanSyncTransport,
            capabilities.lanBlobTransfer,
        ]

        expect(unsupported.every(capability => (
            !capability.supported
            && Boolean(capability.reason)
            && Boolean(capability.alternative)
        ))).toBe(true)
        expect(capabilities.embeddedPngMetadataWrite.supported).toBe(true)
        expect(capabilities.supportedImageFormats).toEqual(['png', 'webp'])
    })

    it('carries actionable details in unsupported errors', () => {
        const capability = createRuntimeCapabilities('android').r2DeployTooling
        const error = new UnsupportedRuntimeCapabilityError('r2DeployTooling', capability)

        expect(error.message).toContain(capability.reason)
        expect(error.message).toContain(capability.alternative)
    })

    it('never leaves the legacy Android output fallback silent', async () => {
        const callers = await Promise.all([
            'src/stores/generation-store.ts',
            'src/lib/scene-generation/save-scene-result.ts',
            'src/services/style-lab-generation.ts',
        ].map(path => readFile(resolve(process.cwd(), path), 'utf8')))

        for (const source of callers) {
            expect(source).toContain('capabilityFallbackUsed')
            expect(source).toContain('capabilityFallbackReason')
            expect(source).toContain('capabilityFallbackAlternative')
            expect(source).toContain('outputCapabilityFallbackTitle')
        }
    })
})
