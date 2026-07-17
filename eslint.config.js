import tsParser from '@typescript-eslint/parser'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default [
    {
        ignores: [
            'dist/**',
            'node_modules/**',
            'NAIS-blue-main/**',
            'legacy/**',
            'src-tauri/**',
            'stylelab-frontend-sources-*/**',
        ],
    },
    {
        files: ['src/**/*.{ts,tsx}', 'vite.config.ts'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
                ecmaFeatures: { jsx: true },
            },
            globals: {
                ...globals.browser,
                ...globals.es2020,
                ...globals.node,
            },
        },
        plugins: {
            'react-hooks': reactHooks,
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
            'react-hooks/exhaustive-deps': 'off',
            'no-restricted-imports': ['error', {
                paths: [{
                    name: '@tauri-apps/api/core',
                    importNames: ['isTauri'],
                    message: 'Use src/platform/runtime or the runtime capability matrix instead of adding a raw platform branch.',
                }],
            }],
        },
    },
    {
        // Transitional rollback allowlist. These existing native adapters still
        // own platform-specific I/O; new call sites must use the capability matrix.
        files: [
            'src/components/backup/StoreSnapshotRestoreDialog.tsx',
            'src/components/backup/RestoreDialog.tsx',
            'src/components/layout/CustomTitleBar.tsx',
            'src/components/layout/HistoryPanel.tsx',
            'src/lib/auto-backup.ts',
            'src/lib/store-snapshots.ts',
            'src/pages/AssetModuleStudio.tsx',
            'src/services/asset-profile-file.ts',
            'src/services/credentials/legacy-credential-cleanup.ts',
            'src/services/credentials/stronghold-credential-vault.ts',
            'src/services/diagnostics/exporter.ts',
            'src/services/nai/transport.ts',
            'src/services/r2/native-r2-adapter.ts',
            'src/services/sync/native-lan-transport-adapter.ts',
        ],
        rules: {
            'no-restricted-imports': 'off',
        },
    },
    {
        files: ['tests/**/*.ts', 'vitest.config.ts'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
            globals: {
                ...globals.es2020,
                ...globals.node,
            },
        },
    },
    {
        files: ['cloudflare/**/*.ts'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
            globals: {
                ...globals.es2020,
                ...globals.worker,
            },
        },
    },
    {
        files: ['scripts/**/*.mjs', 'eslint.config.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.es2020,
            },
        },
    },
]
