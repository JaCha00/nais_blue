import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles/globals.css'
import './i18n'
import { BACKUP_STORE_KEYS, migrateFromLocalStorage, migrateIndexedDBKeys, migrateRenamedLocalStorageKeys, ensureDbReady, isDbInitFailed, indexedDBStorage, type RetainedStoreMigrationResult } from './lib/indexed-db'
import { createCurrentBackupEnvelopeV3, createFullAutoBackup } from './lib/auto-backup'
import { setRuntimeCompositionAuthority } from './lib/composition-authority'

// 자동 백업 상수
const AUTO_BACKUP_KEY = 'nais2-auto-backup'
const AUTO_BACKUP_INTERVAL = 24 * 60 * 60 * 1000 // 24시간
const MAX_AUTO_BACKUPS = 3
const LEGACY_STORE_KEY_RENAMES: [string, string][] = [
    ['nais-library-storage', 'nais2-library'],
    ['tools-storage', 'nais2-tools'],
    ['nais-update', 'nais2-update'],
    // Same-shape pre-v2 aliases. Sources are retained for old-authority
    // rollback; targets are only populated when no canonical value exists.
    ['scenes', 'nais2-scenes'],
    ['scene-store', 'nais2-scenes'],
    ['wildcards', 'nais2-wildcards'],
    ['fragments', 'nais2-wildcards'],
    ['character-prompts', 'nais2-character-prompts'],
    ['characterPrompts', 'nais2-character-prompts'],
    ['generation-presets', 'nais2-presets'],
    ['generationPresets', 'nais2-presets'],
    ['prompt-presets', 'nais2-prompt-library'],
    ['promptPresets', 'nais2-prompt-library'],
]

function retainedStoreCopiesAreHealthy(results: readonly RetainedStoreMigrationResult[]): boolean {
    return results.every(result => result.status !== 'failed' && result.status !== 'verification-failed')
}

async function rehydrateCompositionConnectedStores(): Promise<void> {
    const [
        { useGenerationStore },
        { useSceneStore },
        { useCharacterPromptStore },
        { useFragmentStore },
        { usePromptLibraryStore },
        { usePresetStore },
        { useAssetModuleStore },
        { useCharacterStore },
    ] = await Promise.all([
        import('./stores/generation-store'),
        import('./stores/scene-store'),
        import('./stores/character-prompt-store'),
        import('./stores/fragment-store'),
        import('./stores/prompt-library-store'),
        import('./stores/preset-store'),
        import('./stores/asset-module-store'),
        import('./stores/character-store'),
    ])
    await Promise.all([
        useGenerationStore.persist.rehydrate(),
        useSceneStore.persist.rehydrate(),
        useCharacterPromptStore.persist.rehydrate(),
        useFragmentStore.persist.rehydrate(),
        usePromptLibraryStore.persist.rehydrate(),
        usePresetStore.persist.rehydrate(),
        useAssetModuleStore.persist.rehydrate(),
        useCharacterStore.persist.rehydrate(),
    ])
}

const setSplashStage = (message: string) => {
    const subtitle = document.querySelector<HTMLElement>('#splash-screen .splash-subtitle')
    if (subtitle) {
        subtitle.textContent = message
    }
}

// Hide splash screen when React is ready
const hideSplash = () => {
    const splash = document.getElementById('splash-screen')
    if (splash) {
        splash.classList.add('fade-out')
        setTimeout(() => splash.remove(), 500)
    }
}

// Show error message on splash screen
const showSplashError = (message: string) => {
    const splash = document.getElementById('splash-screen')
    if (splash) {
        const errorDiv = document.createElement('div')
        errorDiv.style.cssText = 'color: #ef4444; margin-top: 20px; padding: 10px; max-width: 400px; text-align: center;'
        errorDiv.textContent = message
        splash.appendChild(errorDiv)
    }
}

// 자동 백업 실행 (localStorage에 저장 - IndexedDB와 분리)
async function performAutoBackup() {
    try {
        const lastBackupStr = localStorage.getItem('nais2-last-auto-backup')
        const lastBackup = lastBackupStr ? parseInt(lastBackupStr, 10) : 0
        const now = Date.now()
        
        // 24시간이 지나지 않았으면 스킵
        if (now - lastBackup < AUTO_BACKUP_INTERVAL) {
            console.log('[AutoBackup] Skipping - last backup was less than 24h ago')
            return
        }
        
        console.log('[AutoBackup] Starting automatic backup...')
        const backup = await createCurrentBackupEnvelopeV3({ purpose: 'local-auto' })
        
        // 기존 자동 백업들 로드
        const existingBackupsStr = localStorage.getItem(AUTO_BACKUP_KEY)
        let backups: { timestamp: number, data: unknown }[] = []
        
        if (existingBackupsStr) {
            try {
                backups = JSON.parse(existingBackupsStr)
            } catch {
                backups = []
            }
        }
        
        // 새 백업 추가
        backups.unshift({ timestamp: now, data: backup })
        
        // 최대 3개만 유지
        if (backups.length > MAX_AUTO_BACKUPS) {
            backups = backups.slice(0, MAX_AUTO_BACKUPS)
        }
        
        // 저장 (localStorage 용량 제한 체크)
        const backupStr = JSON.stringify(backups)
        if (backupStr.length > 4 * 1024 * 1024) { // 4MB 제한
            console.warn('[AutoBackup] Backup too large, keeping only latest')
            backups = backups.slice(0, 1)
        }
        
        localStorage.setItem(AUTO_BACKUP_KEY, JSON.stringify(backups))
        localStorage.setItem('nais2-last-auto-backup', now.toString())
        
        console.log(`[AutoBackup] Complete - ${backups.length} backups stored`)
    } catch (err) {
        console.error('[AutoBackup] Failed:', err)
    }
}

// 데이터 무결성 체크 및 자동 복구
async function checkDataIntegrity(): Promise<boolean> {
    try {
        // 중요 스토어들의 데이터 확인
        const criticalStores = ['nais2-character-prompts', 'nais2-scenes', 'nais2-presets']
        let hasDataLoss = false
        
        for (const storeKey of criticalStores) {
            const data = await indexedDBStorage.getItem(storeKey)
            
            if (!data) {
                console.warn(`[Integrity] ${storeKey}: No data found`)
                continue
            }
            
            try {
                const parsed = JSON.parse(data)
                const state = parsed.state
                
                // character-prompts 체크
                if (storeKey === 'nais2-character-prompts') {
                    const presetCount = state?.presets?.length || 0
                    const charCount = state?.characters?.length || 0
                    
                    // 이전 기록과 비교
                    const prevStats = localStorage.getItem('nais2-integrity-character-prompts')
                    if (prevStats) {
                        const prev = JSON.parse(prevStats)
                        // 프리셋이 갑자기 절반 이하로 줄었으면 경고
                        if (prev.presets > 10 && presetCount < prev.presets * 0.5) {
                            console.error(`[Integrity] CHARACTER PROMPTS DATA LOSS DETECTED! Previous: ${prev.presets}, Current: ${presetCount}`)
                            hasDataLoss = true
                        }
                    }
                    
                    // 현재 통계 저장
                    localStorage.setItem('nais2-integrity-character-prompts', JSON.stringify({ presets: presetCount, characters: charCount }))
                }
                
                // scenes 체크
                if (storeKey === 'nais2-scenes') {
                    const presetCount = state?.presets?.length || 0
                    const totalScenes = state?.presets?.reduce((sum: number, p: { scenes?: unknown[] }) => sum + (p.scenes?.length || 0), 0) || 0
                    
                    const prevStats = localStorage.getItem('nais2-integrity-scenes')
                    if (prevStats) {
                        const prev = JSON.parse(prevStats)
                        if (prev.scenes > 10 && totalScenes < prev.scenes * 0.5) {
                            console.error(`[Integrity] SCENE DATA LOSS DETECTED! Previous: ${prev.scenes}, Current: ${totalScenes}`)
                            hasDataLoss = true
                        }
                    }
                    
                    localStorage.setItem('nais2-integrity-scenes', JSON.stringify({ presets: presetCount, scenes: totalScenes }))
                }
            } catch (parseErr) {
                console.error(`[Integrity] ${storeKey}: Parse error`, parseErr)
            }
        }
        
        // 데이터 손실 감지 시 자동 백업에서 복구 제안
        if (hasDataLoss) {
            console.error('[Integrity] DATA LOSS DETECTED! Check auto-backups in localStorage')
            
            // 자동 백업 존재 여부 확인
            const autoBackups = localStorage.getItem(AUTO_BACKUP_KEY)
            if (autoBackups) {
                try {
                    const backups = JSON.parse(autoBackups)
                    if (backups.length > 0) {
                        const latestBackup = new Date(backups[0].timestamp).toLocaleString()
                        console.log(`[Integrity] Auto-backup available from: ${latestBackup}`)
                        // 사용자에게 복구 옵션 제공은 Settings 페이지에서 수동으로
                    }
                } catch {
                    // 무시
                }
            }
        }
        
        return !hasDataLoss
    } catch (err) {
        console.error('[Integrity] Check failed:', err)
        return true // 에러 시에는 그냥 진행
    }
}

async function renderApp(): Promise<void> {
    const { default: App } = await import('./App.tsx')
    ReactDOM.createRoot(document.getElementById('root')!).render(
        <React.StrictMode>
            <App />
        </React.StrictMode>,
    )
}

async function runPostRenderStartupTasks(): Promise<void> {
    const [
        { startAssetProfileDiskSync },
        { useCharacterStore },
        { startStoreSnapshotScheduler },
        { getRuntimeOutputWriter },
    ] = await Promise.all([
        import('./stores/asset-module-store'),
        import('./stores/character-store'),
        import('./lib/store-snapshots'),
        import('./services/output/output-writer'),
    ])
    void getRuntimeOutputWriter().recoverPending().then(results => {
        const failures = results.filter(result => result.action === 'failed')
        if (results.length > 0) {
            console.log(`[Startup] Recovered ${results.length - failures.length}/${results.length} output transactions`)
        }
        for (const failure of failures) {
            console.warn(`[Startup] Output recovery is still pending for ${failure.transactionId}:`, failure.error)
        }
    }).catch(err => {
        console.warn('[Startup] Output recovery scan failed:', err)
    })
    void startAssetProfileDiskSync().catch(err => {
        console.warn('[Startup] Asset profile disk sync failed:', err)
    })

    if (!isDbInitFailed()) {
        startStoreSnapshotScheduler()

        void checkDataIntegrity().then(isHealthy => {
            if (!isHealthy) {
                console.warn('[Startup] Data integrity check reported possible data loss')
            }
        }).catch(err => {
            console.warn('[Startup] Data integrity check failed:', err)
        })

        void performAutoBackup().catch(err => {
            console.warn('[Startup] Auto-backup failed:', err)
        })

        // Disk auto-backup supplements B's existing localStorage startup backup.
        // It restores through importAllData, so the full IndexedDB export schema remains authoritative.
        void createFullAutoBackup({ minIntervalMs: AUTO_BACKUP_INTERVAL }).then(result => {
            if (result.status === 'created') {
                console.log(`[Startup] Disk auto-backup written: ${result.entry.fileName}`)
            }
        }).catch(err => {
            console.warn('[Startup] Disk auto-backup failed:', err)
        })

        // FragmentStore owns embedded-content migration and verified repository
        // writes. Startup must not strip/delete legacy wildcard content first.
    }

    window.setTimeout(async () => {
        try {
            await useCharacterStore.getState().ensureImagesLoaded()
            console.log('[Startup] Reference images loaded from files')
        } catch (err) {
            console.error('[Startup] Failed to load reference images:', err)
        }
    }, 100)
}

function schedulePostRenderStartupTasks() {
    window.setTimeout(() => {
        void runPostRenderStartupTasks().catch(err => {
            console.warn('[Startup] Post-render task initialization failed:', err)
        })
    }, 0)
}

// Start app only after migrations complete
async function startApp() {
    // No workflow may use v2 authority until repository migration verifies.
    setRuntimeCompositionAuthority('legacy')
    console.log('[Startup] Starting app initialization...')
    setSplashStage('Starting database')
    
    // CRITICAL: Ensure IndexedDB is ready before any migration
    const dbReady = await ensureDbReady()
    if (!dbReady) {
        console.error('[Startup] IndexedDB initialization failed!')
        showSplashError('데이터베이스 초기화 실패. 앱이 정상 작동하지 않을 수 있습니다.')
        // 계속 진행하되, 데이터 저장이 안될 수 있음
    }
    
    // CRITICAL: Migration must complete BEFORE React renders
    // Otherwise Zustand stores will hydrate from empty IndexedDB
    
    if (!isDbInitFailed()) {
        let legacySourceCopyHealthy = true
        // Step 1: Migrate renamed keys within IndexedDB (old name → new name)
        // This handles stores that were already using IndexedDB but had their names changed
        try {
            setSplashStage('Migrating IndexedDB keys')
            const results = await migrateIndexedDBKeys(LEGACY_STORE_KEY_RENAMES)
            legacySourceCopyHealthy &&= retainedStoreCopiesAreHealthy(results)
            console.log('[Startup] IndexedDB key migration complete')
        } catch (err) {
            legacySourceCopyHealthy = false
            console.error('[Startup] IndexedDB key migration failed:', err)
        }

        try {
            setSplashStage('Migrating legacy local data')
            const results = await migrateRenamedLocalStorageKeys(LEGACY_STORE_KEY_RENAMES)
            legacySourceCopyHealthy &&= retainedStoreCopiesAreHealthy(results)
            console.log('[Startup] Legacy localStorage key migration complete')
        } catch (err) {
            legacySourceCopyHealthy = false
            console.error('[Startup] Legacy localStorage key migration failed:', err)
        }

        // Step 2: Migrate localStorage to IndexedDB for ALL stores
        // Missing entries here will cause data loss on app restart/update!
        try {
            setSplashStage('Migrating local data')
            const results = await migrateFromLocalStorage([...BACKUP_STORE_KEYS])
            legacySourceCopyHealthy &&= retainedStoreCopiesAreHealthy(results)
            console.log('[Startup] LocalStorage migration complete')
        } catch (err) {
            legacySourceCopyHealthy = false
            console.error('[Startup] LocalStorage migration failed:', err)
        }

        try {
            setSplashStage('Migrating Composition data')
            const { runStartupCompositionMigration } = await import('./lib/composition-migration-startup')
            const migration = await runStartupCompositionMigration(
                legacySourceCopyHealthy ? {} : { authority: 'legacy' },
            )
            if (!legacySourceCopyHealthy) {
                console.error('[Startup] Composition v2 activation blocked because a retained source copy was not verified')
            }
            if (migration.status === 'failed') {
                console.error('[Startup] Composition migration retained legacy authority:', migration.error)
            } else {
                console.log(
                    `[Startup] Composition migration ${migration.status}; authority=${migration.authority}`,
                )
            }
        } catch (err) {
            // The migration transaction is fail-closed and never deletes old
            // stores. Startup can safely continue on the legacy authority.
            console.error('[Startup] Composition migration failed; legacy authority retained:', err)
        }

        try {
            setSplashStage('Hydrating migrated stores')
            await rehydrateCompositionConnectedStores()
        } catch (err) {
            console.error('[Startup] Migrated store hydration failed; forcing legacy authority:', err)
            try {
                const { applyCompositionAuthorityFeatureFlag } = await import('./lib/composition-migration-startup')
                await applyCompositionAuthorityFeatureFlag('legacy')
            } catch (authorityError) {
                setRuntimeCompositionAuthority('legacy')
                console.error('[Startup] Failed to persist hydration rollback authority:', authorityError)
            }
        }
        
        // Non-critical integrity, backup, image-load, and cleanup tasks run after
        // the first React paint so the splash screen is not held by maintenance work.
    } else {
        console.warn('[Startup] Skipping migrations due to DB init failure')
    }
    
    console.log('[Startup] Initialization complete, rendering React app...')
    setSplashStage('Rendering app')

    // NOW render React app
    await renderApp()

    // Delay slightly to ensure app renders, then hide splash
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            setSplashStage('Ready')
            hideSplash()
            schedulePostRenderStartupTasks()
        })
    })
}

// Start the app - DO NOT add any code after this that runs in parallel!
startApp().catch(err => {
    console.error('[Startup] Fatal error:', err)
    showSplashError(`시작 오류: ${err.message || '알 수 없는 오류'}`)
})
