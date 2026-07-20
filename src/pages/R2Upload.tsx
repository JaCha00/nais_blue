import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CloudUpload } from 'lucide-react'

import { NativeR2SetupPanel } from '@/components/r2/NativeR2SetupPanel'
import { toast } from '@/components/ui/use-toast'
import { useAssetModuleStore } from '@/stores/asset-module-store'
import type { AssetProfile } from '@/types/asset-profile'

export default function R2Upload() {
    const { t } = useTranslation()
    const profile = useAssetModuleStore(state => state.profile)
    const replaceProfileDraft = useAssetModuleStore(state => state.replaceProfileDraft)
    const saveToDisk = useAssetModuleStore(state => state.saveToDisk)
    const [localRoot, setLocalRoot] = useState(profile.output.directory ?? 'NAIS_Output')

    // R2 still projects its non-secret settings into the shared generation profile;
    // credentials remain in the OS vault and never enter the persisted profile.
    const persistAssetProfile = useCallback((nextProfile: AssetProfile) => {
        replaceProfileDraft(nextProfile)
        void saveToDisk(nextProfile).catch(error => {
            toast({
                title: t('toast.saveFailed', '저장 실패'),
                description: error instanceof Error ? error.message : String(error),
                variant: 'destructive',
            })
        })
    }, [replaceProfileDraft, saveToDisk, t])

    return (
        <div className="mx-auto min-w-0 w-full max-w-7xl space-y-5 overflow-x-hidden p-2 sm:p-4">
            <header className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary">
                    <CloudUpload className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                    <h1 className="text-xl font-semibold">{t('nav.r2Upload', 'R2 Upload')}</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        처음 사용하는 분도 순서대로 따라 할 수 있는 Cloudflare R2 업로드 설정입니다.
                    </p>
                </div>
            </header>

            {/* This card is the horizontal scroll boundary for NativeR2SetupPanel.
                It links the global large-type mode to long credential/path inputs,
                keeping their intrinsic scroll inside controls instead of widening main. */}
            <section className="min-w-0 overflow-x-hidden rounded-panel bg-card p-4 sm:p-5 lg:p-6">
                <NativeR2SetupPanel
                    assetProfile={profile}
                    localRoot={localRoot}
                    onLocalRootChange={setLocalRoot}
                    onPersistAssetProfile={persistAssetProfile}
                />
            </section>
        </div>
    )
}
