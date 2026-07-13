import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        setupFiles: ['tests/setup-composition-authority.ts'],
        clearMocks: true,
        restoreMocks: true,
        sequence: {
            concurrent: false,
        },
    },
})
