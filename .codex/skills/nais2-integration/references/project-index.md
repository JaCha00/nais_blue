# NAIS2 Integration Project Index

## Scope Evidence

- Local target repo: `C:\Users\User\OneDrive\图片\NAIS\NAIS2-main`
- Reference A: `C:\Users\User\OneDrive\图片\NAIS\NAIS2-2.0.29`
- Public repo: `https://github.com/JaCha00/nais2-integration-review`
- Branch: `main`
- Review issue: `https://github.com/JaCha00/nais2-integration-review/issues/1`
- Uploaded commit: `c6412f9`
- Verified local HEAD at project-scope setup: `c6412f9 (HEAD -> main, origin/main)`
- Staging root: `C:\Users\User\OneDrive\图片\챗봇 제작\.analysis\nais2-integration-staging-20260629-231331`
- Staging counts: 74 modified, 8 only-A, 30 only-B preserve

## Repository Root Files

- `README.md`, `README.ja.md`, `README.ko.md`: project documentation
- `LICENSE`: GPL-3.0 license
- `package.json`, `package-lock.json`: frontend dependencies and scripts
- `vite.config.ts`: Vite build config
- `tsconfig.json`, `tsconfig.node.json`: TypeScript config
- `tailwind.config.js`, `postcss.config.js`: styling pipeline
- `eslint.config.js`: lint rules
- `components.json`: UI component config
- `index.html`: app entry HTML
- `.gitignore`: excludes local build/dependency/runtime artifacts

## Core App Source

- `src/App.tsx`: app routes and global hooks
- `src/main.tsx`: startup, migration, backup scheduling
- `src/bootstrap.ts`: app bootstrap helpers
- `src/styles/globals.css`: global styles

## Pages

- `src/pages/MainMode.tsx`: main image generation mode
- `src/pages/SceneMode.tsx`: scene generation and queue UI
- `src/pages/SceneDetail.tsx`: scene detail view
- `src/pages/PromptEditor.tsx`: prompt editor integration
- `src/pages/StyleLab.tsx`: StyleLab workflow
- `src/pages/Marketplace.tsx`: marketplace listing
- `src/pages/MarketplaceDetail.tsx`: marketplace detail
- `src/pages/ToolsMode.tsx`: tools panel
- `src/pages/Library.tsx`: image/library view
- `src/pages/Settings.tsx`: settings, backup, API slots
- `src/pages/WebView.tsx`: embedded web view

## Stores

- `src/stores/auth-store.ts`: dual NovelAI API slots
- `src/stores/generation-store.ts`: main generation state
- `src/stores/scene-store.ts`: scene presets, queues, session/cancel state
- `src/stores/character-rotation-store.ts`: character rotation state machine
- `src/stores/prompt-library-store.ts`: prompt library persistence
- `src/stores/style-lab-store.ts`: StyleLab state
- `src/stores/market-auth-store.ts`: Supabase/deep-link marketplace auth
- `src/stores/character-store.ts`: character/vibe image memory
- `src/stores/character-prompt-store.ts`: character prompt presets
- `src/stores/fragment-store.ts`: prompt fragments
- `src/stores/preset-store.ts`: generation presets
- `src/stores/settings-store.ts`: app settings
- `src/stores/library-store.ts`: library state
- `src/stores/shortcut-store.ts`: shortcuts
- `src/stores/theme-store.ts`: theme
- `src/stores/tools-store.ts`: tools state
- `src/stores/update-store.ts`: updater state
- `src/stores/layout-store.ts`: layout state

## Scene Generation Integration

- `src/hooks/useSceneGeneration.ts`: dual-worker scene generation
- `src/lib/scene-generation/build-scene-params.ts`: scene params, `imageFormat`, `charCacheKeys`
- `src/lib/scene-generation/save-scene-result.ts`: save path, thumbnail, history, encoded vibe cache
- `src/lib/scene-output-path.ts`: normal and rotation output paths
- `src/lib/character-rotation.ts`: compatibility re-export

## Backup And Persistence

- `src/lib/indexed-db.ts`: IndexedDB storage, export/import, store registry
- `src/lib/auto-backup.ts`: full disk auto-backup
- `src/lib/store-snapshots.ts`: per-store snapshot layer
- `src/components/backup/RestoreDialog.tsx`: full restore UI
- `src/components/backup/StoreSnapshotRestoreDialog.tsx`: store snapshot restore UI

## Feature Components

- `src/components/scene/CharacterRotationDialog.tsx`: rotation setup
- `src/components/scene/RotationStatusBar.tsx`: rotation status and controls
- `src/components/scene/ExportDialog.tsx`: scene export
- `src/components/scene/SceneImageContextMenu.tsx`: scene image actions
- `src/components/layout/AnimatedNavBar.tsx`: navigation
- `src/components/layout/PromptPanel.tsx`: prompt controls
- `src/components/layout/HistoryPanel.tsx`: generated image history
- `src/components/layout/SmartToolsPanel.tsx`: smart tools
- `src/components/marketplace/*`: marketplace upload/report/auth UI
- `src/components/tools/*`: tag analysis, mosaic, inpaint, i2i, background removal
- `src/components/metadata/*`: image metadata/reference dialogs
- `src/components/character/*`: character prompt/image controls
- `src/components/fragments/*`: fragment prompt UI
- `src/components/prompt/*`: prompt generator UI
- `src/components/ui/*`: shared UI primitives

## Services And Libraries

- `src/services/novelai-api.ts`: NovelAI API, streaming, metadata, cache keys
- `src/services/style-lab-generation.ts`: StyleLab generation path
- `src/services/smart-tools.ts`: local smart tools/tagger integration
- `src/services/gemini-service.ts`: Gemini helper service
- `src/lib/image-utils.ts`: thumbnail/image helpers
- `src/lib/metadata-parser.ts`: image metadata parsing
- `src/lib/nais2-png-meta.ts`: NAIS2 PNG metadata
- `src/lib/style-lab/*`: StyleLab genome/ELO/prompt/tournament logic
- `src/lib/supabase.ts`: Supabase client
- `src/lib/tag-matcher.ts`, `src/lib/tag-data.ts`: tag matching data/helpers

## Tauri And Rust

- `src-tauri/Cargo.toml`: Rust dependencies and Tauri plugins
- `src-tauri/Cargo.lock`: Rust lockfile
- `src-tauri/src/lib.rs`: Tauri commands, plugins, sidecar, deep-link setup
- `src-tauri/src/main.rs`: Tauri entrypoint
- `src-tauri/tauri.conf.json`: Tauri app/bundle/updater/sidecar config
- `src-tauri/capabilities/default.json`: Tauri permissions
- `src-tauri/python/tagger_server.py`: local WD tagger sidecar source
- `src-tauri/python/tagger_server.spec`: sidecar build spec
- `src-tauri/python/build_sidecar.bat`: Windows sidecar build helper
- `src-tauri/python/build_sidecar_macos.sh`: macOS sidecar build helper
- `src-tauri/nsis/installer-hooks.nsh`: installer hooks
- `src-tauri/icons/*`: app icons

## Verification Scripts

- `scripts/verify-prompt-editor-phase.mjs`
- `scripts/verify-auto-backup-phase.mjs`
- `scripts/verify-store-snapshot-phase.mjs`
- `scripts/verify-dual-api-phase.mjs`
- `scripts/verify-dual-worker-phase.mjs`
- `scripts/verify-character-rotation-phase.mjs`
- `scripts/verify-tagger-sidecar-phase.mjs`
- `scripts/create-public-release.ps1`

## Final Verification Already Run Before Project Scope

- `node scripts\verify-prompt-editor-phase.mjs`
- `node scripts\verify-auto-backup-phase.mjs`
- `node scripts\verify-store-snapshot-phase.mjs`
- `node scripts\verify-dual-api-phase.mjs`
- `node scripts\verify-dual-worker-phase.mjs`
- `node scripts\verify-character-rotation-phase.mjs`
- `node scripts\verify-tagger-sidecar-phase.mjs`
- `npm run lint`
- `npm run build`
- `cd src-tauri && cargo check`

## Intentional Public Repo Exclusions

- `node_modules/`
- `dist/`
- `src-tauri/target/`
- generated sidecar binaries
- local nested working copies
- local extraction/staging dumps

## Preservation Rules

- Preserve B Marketplace/Supabase/deep-link auth.
- Preserve B StyleLab generation path.
- Preserve B IndexedDB export/import and image memory pipeline.
- Preserve B Tauri updater, deep-link, single-instance, and protocol-asset plugins.
- Preserve B session/cancel model in scene generation: `startNewGenerationSession()`, `cancelSceneGeneration()`, and `generationSessionId` checks before API calls, after API calls, and before result saving.
- Streaming generation uses one worker only; non-streaming generation may run all active verified token slots.
- Character rotation is owned by `src/stores/character-rotation-store.ts`; `src/lib/character-rotation.ts` stays a compatibility re-export.
- Scene output path construction is owned by `src/lib/scene-output-path.ts`.

