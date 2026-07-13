import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const getNodePackageName = (normalizedId: string) => {
    const marker = '/node_modules/'
    const markerIndex = normalizedId.lastIndexOf(marker)

    if (markerIndex === -1) {
        return undefined
    }

    const packagePath = normalizedId.slice(markerIndex + marker.length)
    const segments = packagePath.split('/')

    if (segments[0]?.startsWith('@')) {
        return segments[1] ? `${segments[0]}/${segments[1]}` : segments[0]
    }

    return segments[0]
}

// https://vite.dev/config/
export default defineConfig({
    plugins: [react()],
    define: {
        __NAIS2_TAURI_PLATFORM__: JSON.stringify(process.env.TAURI_ENV_PLATFORM ?? ''),
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    build: {
        chunkSizeWarningLimit: 30000,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    const normalizedId = id.replace(/\\/g, '/')

                    if (normalizedId.includes('/src/assets/tags.json')) {
                        return 'tag-data'
                    }

                    if (!normalizedId.includes('/node_modules/')) {
                        return undefined
                    }

                    const packageName = getNodePackageName(normalizedId)

                    if (
                        packageName === 'react' ||
                        packageName === 'react-dom' ||
                        packageName === 'react-router-dom' ||
                        packageName === 'scheduler'
                    ) {
                        return 'react-vendor'
                    }

                    if (packageName?.startsWith('@tauri-apps/')) {
                        return 'tauri-vendor'
                    }

                    if (
                        packageName?.startsWith('@radix-ui/') ||
                        packageName === 'framer-motion' ||
                        packageName === 'lucide-react'
                    ) {
                        return 'ui-vendor'
                    }

                    if (
                        packageName?.startsWith('@gradio/') ||
                        packageName?.startsWith('@msgpack/') ||
                        packageName === 'fuse.js' ||
                        packageName === 'jszip' ||
                        packageName === 'pako'
                    ) {
                        return 'data-vendor'
                    }

                    return 'vendor'
                },
            },
        },
    },
    // Tauri dev server 설정
    clearScreen: false,
    server: {
        port: 9090,
        strictPort: true,
        watch: {
            ignored: ['**/src-tauri/**'],
        },
    },
})
