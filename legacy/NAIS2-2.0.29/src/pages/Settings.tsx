import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Tip } from '@/components/ui/tooltip'
import {
    Key,
    Settings2,
    Save,
    Check,
    X,
    Sun,
    Moon,
    Monitor,
    Languages,
    Loader2,
    Coins,
    FolderOpen,
    Palette,
    Type,
    Zap,
    RotateCcw,
    Info,
    Keyboard,
} from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { useThemeStore } from '@/stores/theme-store'
import { useAuthStore } from '@/stores/auth-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useShortcutStore, SHORTCUT_ACTIONS, formatKeyBinding, type ShortcutAction, type KeyBinding } from '@/stores/shortcut-store'
import { toast } from '@/components/ui/use-toast'
import NovelAILogo from '@/assets/novelai_logo.svg'
import { open } from '@tauri-apps/plugin-dialog'
import { getVersion } from '@tauri-apps/api/app'

const LANGUAGES = [
    { code: 'ko', name: '한국어' },
    { code: 'en', name: 'English' },
    { code: 'ja', name: '日本語' },
]

type SettingsSection = 'general' | 'appearance' | 'api' | 'storage' | 'shortcuts'

const SECTIONS = [
    { id: 'general' as const, icon: Settings2, labelKey: 'settingsPage.sections.general' },
    { id: 'appearance' as const, icon: Palette, labelKey: 'settingsPage.sections.appearance' },
    { id: 'api' as const, icon: Key, labelKey: 'settingsPage.sections.api' },
    { id: 'storage' as const, icon: FolderOpen, labelKey: 'settingsPage.sections.storage' },
    { id: 'shortcuts' as const, icon: Keyboard, labelKey: 'settingsPage.sections.shortcuts' },
]

export default function Settings() {
    const { t, i18n } = useTranslation()
    const { theme, setTheme } = useThemeStore()
    const { token, isVerified, anlas, slot1Enabled, token2, isVerified2, anlas2, slot2Enabled, isLoading, verifyAndSave, clearToken, setSlotEnabled } = useAuthStore()
    const { savePath, autoSave, setSavePath, setAutoSave, promptFontSize, setPromptFontSize, useStreaming, setUseStreaming, useAbsolutePath, libraryPath, useAbsoluteLibraryPath, setLibraryPath } = useSettingsStore()
    const { bindings, enabled: shortcutsEnabled, setBinding, resetBinding, resetAllBindings, setEnabled: setShortcutsEnabled } = useShortcutStore()

    const [activeSection, setActiveSection] = useState<SettingsSection>('general')
    const [apiToken, setApiToken] = useState(token)
    const [tokenStatus, setTokenStatus] = useState<'idle' | 'valid' | 'invalid' | 'verifying'>(
        isVerified ? 'valid' : 'idle'
    )
    const [apiToken2, setApiToken2] = useState(token2)
    const [tokenStatus2, setTokenStatus2] = useState<'idle' | 'valid' | 'invalid' | 'verifying'>(
        isVerified2 ? 'valid' : 'idle'
    )
    const [localSavePath, setLocalSavePath] = useState(savePath)
    const [isAbsolutePath, setIsAbsolutePath] = useState(useAbsolutePath)
    const [localLibraryPath, setLocalLibraryPath] = useState(libraryPath)
    const [isAbsoluteLibraryPath, setIsAbsoluteLibraryPath] = useState(useAbsoluteLibraryPath)
    const [appVersion, setAppVersion] = useState('')
    
    // 키바인드 편집 상태
    const [editingAction, setEditingAction] = useState<ShortcutAction | null>(null)
    const [recordedBinding, setRecordedBinding] = useState<KeyBinding | null>(null)

    useEffect(() => {
        getVersion().then(setAppVersion).catch(() => setAppVersion('dev'))
    }, [])

    useEffect(() => {
        if (token) {
            setApiToken(token)
            if (isVerified) {
                setTokenStatus('valid')
            }
        }
    }, [token, isVerified])

    useEffect(() => {
        if (token2) {
            setApiToken2(token2)
            if (isVerified2) {
                setTokenStatus2('valid')
            }
        }
    }, [token2, isVerified2])

    const handleVerifyToken = async () => {
        if (!apiToken) return
        setTokenStatus('verifying')
        const success = await verifyAndSave(apiToken, 1)
        setTokenStatus(success ? 'valid' : 'invalid')
        if (success) {
            toast({ title: t('settingsPage.api.verified'), variant: 'success' })
        }
    }

    const handleVerifyToken2 = async () => {
        if (!apiToken2) return
        setTokenStatus2('verifying')
        const success = await verifyAndSave(apiToken2, 2)
        setTokenStatus2(success ? 'valid' : 'invalid')
        if (success) {
            toast({ title: t('settingsPage.api.verified', 'Token verified'), variant: 'success' })
        }
    }

    const handleClearToken2 = () => {
        clearToken(2)
        setApiToken2('')
        setTokenStatus2('idle')
    }

    const handleSavePath = () => {
        setSavePath(localSavePath, isAbsolutePath)
        toast({ title: t('settingsPage.saved'), variant: 'success' })
    }

    // Browse for folder using native dialog
    const handleBrowseFolder = async () => {
        try {
            const selected = await open({
                directory: true,
                multiple: false,
                title: t('settingsPage.save.selectFolder', 'Select Save Folder'),
            })
            if (selected && typeof selected === 'string') {
                setLocalSavePath(selected)
                setIsAbsolutePath(true)
            }
        } catch (e) {
            console.error('Folder selection failed:', e)
        }
    }

    // Reset to default Pictures subfolder
    const handleResetToDefault = async () => {
        setLocalSavePath('NAIS_Output')
        setIsAbsolutePath(false)
        setSavePath('NAIS_Output', false)
        toast({ title: t('settingsPage.saved'), variant: 'success' })
    }

    // Library path handlers
    const handleSaveLibraryPath = () => {
        setLibraryPath(localLibraryPath, isAbsoluteLibraryPath)
        toast({ title: t('settingsPage.saved'), variant: 'success' })
    }

    const handleBrowseLibraryFolder = async () => {
        try {
            const selected = await open({
                directory: true,
                multiple: false,
                title: t('settingsPage.library.selectFolder', 'Select Library Folder'),
            })
            if (selected && typeof selected === 'string') {
                setLocalLibraryPath(selected)
                setIsAbsoluteLibraryPath(true)
            }
        } catch (e) {
            console.error('Folder selection failed:', e)
        }
    }

    const handleResetLibraryToDefault = async () => {
        setLocalLibraryPath('NAIS_Library')
        setIsAbsoluteLibraryPath(false)
        setLibraryPath('NAIS_Library', false)
        toast({ title: t('settingsPage.saved'), variant: 'success' })
    }

    return (
        <div className="flex h-full">
            {/* Sidebar */}
            <aside className="w-56 border-r border-border/50 p-4 space-y-1">
                <h2 className="text-lg font-semibold mb-4 px-2">{t('settingsPage.title')}</h2>
                {SECTIONS.map((section) => (
                    <button
                        key={section.id}
                        onClick={() => setActiveSection(section.id)}
                        className={cn(
                            'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                            activeSection === section.id
                                ? 'bg-primary/10 text-primary'
                                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                        )}
                    >
                        <section.icon className="h-4 w-4" />
                        {t(section.labelKey)}
                    </button>
                ))}
            </aside>

            {/* Content */}
            <main className="flex-1 p-6 overflow-y-auto">
                <div className="max-w-2xl space-y-8">
                    {/* General Section */}
                    {activeSection === 'general' && (
                        <section className="space-y-6">
                            <div>
                                <h3 className="text-xl font-semibold">{t('settingsPage.sections.general')}</h3>
                                <p className="text-sm text-muted-foreground mt-1">
                                    {t('settingsPage.language.description')}
                                </p>
                            </div>
                            <div className="border border-border/50 rounded-xl p-6 space-y-6 bg-card/30">
                                <div className="flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <label className="text-sm font-medium flex items-center gap-2">
                                            <Languages className="h-4 w-4 text-muted-foreground" />
                                            {t('settingsPage.language.select')}
                                        </label>
                                        <p className="text-xs text-muted-foreground">
                                            {t('settingsPage.language.description')}
                                        </p>
                                    </div>
                                    <Select value={i18n.language} onValueChange={(v) => i18n.changeLanguage(v)}>
                                        <SelectTrigger className="w-40">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {LANGUAGES.map((lang) => (
                                                <SelectItem key={lang.code} value={lang.code}>
                                                    {lang.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Streaming Toggle */}
                                <div className="flex items-center justify-between pt-4 border-t border-border/30">
                                    <div className="space-y-0.5">
                                        <label className="text-sm font-medium flex items-center gap-2">
                                            <Zap className="h-4 w-4 text-yellow-500" />
                                            {t('settingsPage.streaming.title', 'Streaming Generation')}
                                        </label>
                                        <p className="text-xs text-muted-foreground">
                                            {t('settingsPage.streaming.description', 'Show real-time progress during image generation')}
                                        </p>
                                    </div>
                                    <Switch
                                        checked={useStreaming}
                                        onChange={(e) => setUseStreaming(e.target.checked)}
                                    />
                                </div>

                                {/* Version Info */}
                                <div className="space-y-4 pt-4 border-t border-border/30">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <label className="text-sm font-medium flex items-center gap-2">
                                                <Info className="h-4 w-4 text-blue-500" />
                                                {t('settingsPage.version.title', 'Version')}
                                            </label>
                                            <p className="text-xs text-muted-foreground">
                                                NAIS2 v{appVersion} - mayo
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </section>
                    )}

                    {/* Appearance Section */}
                    {activeSection === 'appearance' && (
                        <section className="space-y-6">
                            <div>
                                <h3 className="text-xl font-semibold">{t('settingsPage.sections.appearance')}</h3>
                                <p className="text-sm text-muted-foreground mt-1">
                                    {t('settingsPage.theme.description')}
                                </p>
                            </div>
                            <div className="border border-border/50 rounded-xl p-6 space-y-6 bg-card/30">
                                <div className="space-y-3">
                                    <label className="text-sm font-medium">{t('settingsPage.theme.mode')}</label>
                                    <div className="grid grid-cols-3 gap-3">
                                        {[
                                            { value: 'light' as const, icon: Sun, labelKey: 'settingsPage.theme.light' },
                                            { value: 'dark' as const, icon: Moon, labelKey: 'settingsPage.theme.dark' },
                                            { value: 'system' as const, icon: Monitor, labelKey: 'settingsPage.theme.system' },
                                        ].map((option) => (
                                            <button
                                                key={option.value}
                                                onClick={() => setTheme(option.value)}
                                                className={cn(
                                                    'flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all',
                                                    theme === option.value
                                                        ? 'border-primary bg-primary/5'
                                                        : 'border-border/50 hover:border-border hover:bg-muted/30'
                                                )}
                                            >
                                                <option.icon className={cn(
                                                    'h-6 w-6',
                                                    theme === option.value ? 'text-primary' : 'text-muted-foreground'
                                                )} />
                                                <span className={cn(
                                                    'text-sm font-medium',
                                                    theme === option.value ? 'text-primary' : 'text-muted-foreground'
                                                )}>
                                                    {t(option.labelKey)}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <label className="text-sm font-medium flex items-center gap-2">
                                            <Type className="h-4 w-4" />
                                            {t('settingsPage.theme.fontSize', 'Prompt Font Size')}
                                        </label>
                                        <span className="text-sm text-muted-foreground">{promptFontSize}px</span>
                                    </div>
                                    <Slider
                                        value={[promptFontSize]}
                                        onValueChange={([v]) => setPromptFontSize(v)}
                                        min={12}
                                        max={24}
                                        step={1}
                                        className="w-full"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        {t('settingsPage.theme.fontSizeHelp', 'Adjust the font size of the prompt input areas.')}
                                    </p>
                                </div>
                            </div>
                        </section>
                    )}

                    {/* API Section */}
                    {activeSection === 'api' && (
                        <section className="space-y-6">
                            <div>
                                <h3 className="text-xl font-semibold">{t('settingsPage.sections.api')}</h3>
                                <p className="text-sm text-muted-foreground mt-1">
                                    {t('settingsPage.api.description')}
                                </p>
                            </div>

                            <p className="text-xs text-muted-foreground -mt-4 leading-relaxed">
                                {t('settingsPage.api.parallelHelp', '계정을 두 개 등록하면 메인/씬 모드에서 두 토큰이 동시에 병렬로 이미지를 생성합니다 (예: 100장 → 각 계정이 약 50장씩). 각 슬롯의 \"이 계정 사용\" 스위치로 생성 도중에도 한 계정만 일시정지하거나 다시 켤 수 있어요.')}
                            </p>

                            {/* === Slot 1 === */}
                            <div className={cn(
                                'border rounded-xl p-6 space-y-4 transition-colors',
                                isVerified && slot1Enabled
                                    ? 'border-amber-500/40 bg-gradient-to-br from-amber-500/5 to-yellow-500/5'
                                    : 'border-border/50 bg-card/30'
                            )}>
                                <div className="flex items-center justify-between gap-4">
                                    <label className="text-sm font-bold flex items-center gap-2">
                                        <img src={NovelAILogo} alt="NovelAI" className="h-4 w-4" />
                                        {t('settingsPage.api.naiToken1', 'NAI 토큰 1')}
                                        {isVerified && (
                                            <span className={cn(
                                                'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full',
                                                slot1Enabled
                                                    ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                                                    : 'bg-muted/40 text-muted-foreground'
                                            )}>
                                                {slot1Enabled
                                                    ? t('settingsPage.api.slotActive', '사용 중')
                                                    : t('settingsPage.api.slotPaused', '일시정지')}
                                            </span>
                                        )}
                                    </label>
                                    {isVerified && (
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-muted-foreground">
                                                {t('settingsPage.api.useThisAccount', '이 계정 사용')}
                                            </span>
                                            <Switch
                                                checked={slot1Enabled}
                                                onChange={(e) => setSlotEnabled(1, e.target.checked)}
                                            />
                                        </div>
                                    )}
                                </div>

                                {/* Anlas card for slot 1 */}
                                {isVerified && anlas && (
                                    <div className={cn(
                                        'flex items-center gap-4 p-4 rounded-xl border transition-opacity',
                                        slot1Enabled
                                            ? 'bg-gradient-to-r from-amber-500/10 to-yellow-500/10 border-amber-500/20 opacity-100'
                                            : 'bg-muted/20 border-border/40 opacity-60'
                                    )}>
                                        <div className="p-3 bg-amber-500/20 rounded-full">
                                            <Coins className="h-6 w-6 text-amber-500" />
                                        </div>
                                        <div className="flex-1">
                                            <span className="text-xs font-bold uppercase tracking-wider text-amber-500/80">
                                                {t('settingsPage.api.naiToken1Anlas', 'NAI 1 안라스')}
                                            </span>
                                            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                                                {anlas.total.toLocaleString()} Anlas
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                {t('settingsPage.api.anlas.fixed')}: {anlas.fixed.toLocaleString()} / {t('settingsPage.api.anlas.purchased')}: {anlas.purchased.toLocaleString()}
                                            </p>
                                        </div>
                                    </div>
                                )}

                                <div className="space-y-2">
                                    <div className="flex gap-2">
                                        <div className="relative flex-1">
                                            <Input
                                                type="password"
                                                placeholder={t('settingsPage.api.tokenPlaceholder')}
                                                value={apiToken}
                                                onChange={(e) => {
                                                    setApiToken(e.target.value)
                                                    setTokenStatus('idle')
                                                }}
                                                className={cn(
                                                    'pr-10',
                                                    tokenStatus === 'valid' && 'border-green-500 focus-visible:ring-green-500',
                                                    tokenStatus === 'invalid' && 'border-destructive focus-visible:ring-destructive'
                                                )}
                                            />
                                            {tokenStatus !== 'idle' && tokenStatus !== 'verifying' && (
                                                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                                    {tokenStatus === 'valid' ? (
                                                        <Check className="h-4 w-4 text-green-500" />
                                                    ) : (
                                                        <X className="h-4 w-4 text-destructive" />
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        <Button
                                            onClick={handleVerifyToken}
                                            disabled={tokenStatus === 'verifying' || isLoading}
                                        >
                                            {tokenStatus === 'verifying' || isLoading ? (
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                            ) : (
                                                t('settingsPage.api.verify')
                                            )}
                                        </Button>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        {t('settingsPage.api.tokenHelp')}
                                    </p>
                                </div>
                            </div>

                            {/* === Slot 2 === */}
                            <div className={cn(
                                'border rounded-xl p-6 space-y-4 transition-colors',
                                isVerified2 && slot2Enabled
                                    ? 'border-purple-500/40 bg-gradient-to-br from-purple-500/5 to-pink-500/5'
                                    : 'border-border/50 bg-card/30'
                            )}>
                                <div className="flex items-center justify-between gap-4">
                                    <label className="text-sm font-bold flex items-center gap-2">
                                        <img src={NovelAILogo} alt="NovelAI" className="h-4 w-4" />
                                        {t('settingsPage.api.naiToken2', 'NAI 토큰 2')}
                                        {isVerified2 && (
                                            <span className={cn(
                                                'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full',
                                                slot2Enabled
                                                    ? 'bg-purple-500/20 text-purple-600 dark:text-purple-400'
                                                    : 'bg-muted/40 text-muted-foreground'
                                            )}>
                                                {slot2Enabled
                                                    ? t('settingsPage.api.slotActive', '사용 중')
                                                    : t('settingsPage.api.slotPaused', '일시정지')}
                                            </span>
                                        )}
                                    </label>
                                    {isVerified2 && (
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-muted-foreground">
                                                {t('settingsPage.api.useThisAccount', '이 계정 사용')}
                                            </span>
                                            <Switch
                                                checked={slot2Enabled}
                                                onChange={(e) => setSlotEnabled(2, e.target.checked)}
                                            />
                                        </div>
                                    )}
                                </div>

                                {/* Anlas card for slot 2 */}
                                {isVerified2 && anlas2 && (
                                    <div className={cn(
                                        'flex items-center gap-4 p-4 rounded-xl border transition-opacity',
                                        slot2Enabled
                                            ? 'bg-gradient-to-r from-purple-500/10 to-pink-500/10 border-purple-500/20 opacity-100'
                                            : 'bg-muted/20 border-border/40 opacity-60'
                                    )}>
                                        <div className="p-3 bg-purple-500/20 rounded-full">
                                            <Coins className="h-6 w-6 text-purple-500" />
                                        </div>
                                        <div className="flex-1">
                                            <span className="text-xs font-bold uppercase tracking-wider text-purple-500/80">
                                                {t('settingsPage.api.naiToken2Anlas', 'NAI 2 안라스')}
                                            </span>
                                            <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                                                {anlas2.total.toLocaleString()} Anlas
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                {t('settingsPage.api.anlas.fixed')}: {anlas2.fixed.toLocaleString()} / {t('settingsPage.api.anlas.purchased')}: {anlas2.purchased.toLocaleString()}
                                            </p>
                                        </div>
                                    </div>
                                )}

                                <div className="space-y-2">
                                    <div className="flex gap-2">
                                        <div className="relative flex-1">
                                            <Input
                                                type="password"
                                                placeholder={t('settingsPage.api.tokenPlaceholder')}
                                                value={apiToken2}
                                                onChange={(e) => {
                                                    setApiToken2(e.target.value)
                                                    setTokenStatus2('idle')
                                                }}
                                                className={cn(
                                                    'pr-10',
                                                    tokenStatus2 === 'valid' && 'border-green-500 focus-visible:ring-green-500',
                                                    tokenStatus2 === 'invalid' && 'border-destructive focus-visible:ring-destructive'
                                                )}
                                            />
                                            {tokenStatus2 !== 'idle' && tokenStatus2 !== 'verifying' && (
                                                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                                    {tokenStatus2 === 'valid' ? (
                                                        <Check className="h-4 w-4 text-green-500" />
                                                    ) : (
                                                        <X className="h-4 w-4 text-destructive" />
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        <Button
                                            onClick={handleVerifyToken2}
                                            disabled={tokenStatus2 === 'verifying' || isLoading || !apiToken2}
                                        >
                                            {tokenStatus2 === 'verifying' || isLoading ? (
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                            ) : (
                                                t('settingsPage.api.verify')
                                            )}
                                        </Button>
                                        {isVerified2 && (
                                            <Button variant="outline" onClick={handleClearToken2}>
                                                <X className="h-4 w-4" />
                                            </Button>
                                        )}
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        {t('settingsPage.api.naiToken2Help', '두 번째 NovelAI 계정의 토큰을 입력하세요. 비워두면 단일 계정 모드로 동작합니다.')}
                                    </p>
                                </div>
                            </div>
                        </section>
                    )}

                    {/* Storage Section */}
                    {activeSection === 'storage' && (
                        <section className="space-y-6">
                            <div>
                                <h3 className="text-xl font-semibold">{t('settingsPage.sections.storage')}</h3>
                                <p className="text-sm text-muted-foreground mt-1">
                                    {t('settingsPage.save.description')}
                                </p>
                            </div>
                            <div className="border border-border/50 rounded-xl p-6 space-y-6 bg-card/30">
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <label className="text-sm font-medium">{t('settingsPage.save.folder')}</label>
                                        {isAbsolutePath && (
                                            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                                                {t('settingsPage.save.customPath', 'Custom Path')}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex gap-2">
                                        <Input
                                            value={localSavePath}
                                            onChange={(e) => {
                                                setLocalSavePath(e.target.value)
                                                // If user manually types, assume it's relative unless it looks like an absolute path
                                                const isAbsolute = /^[A-Za-z]:[\\/]/.test(e.target.value) || e.target.value.startsWith('/')
                                                setIsAbsolutePath(isAbsolute)
                                            }}
                                            placeholder="NAIS_Output"
                                            className="flex-1"
                                        />
                                        <Button variant="outline" onClick={handleBrowseFolder}>
                                            <FolderOpen className="h-4 w-4 mr-2" />
                                            {t('settingsPage.save.browse', 'Browse')}
                                        </Button>
                                        <Button
                                            onClick={handleSavePath}
                                            variant={(localSavePath !== savePath || isAbsolutePath !== useAbsolutePath) ? "default" : "outline"}
                                            className={(localSavePath !== savePath || isAbsolutePath !== useAbsolutePath)
                                                ? "animate-pulse bg-yellow-500 hover:bg-yellow-600 text-black shadow-lg shadow-yellow-500/50"
                                                : ""}
                                        >
                                            <Save className="h-4 w-4 mr-2" />
                                            {t('settingsPage.saveBtn')}
                                        </Button>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <p className="text-xs text-muted-foreground">
                                            {isAbsolutePath
                                                ? t('settingsPage.save.absolutePathHelp', 'Images will be saved to this exact folder.')
                                                : t('settingsPage.save.folderHelp')}
                                        </p>
                                        {isAbsolutePath && (
                                            <Button variant="ghost" size="sm" onClick={handleResetToDefault} className="h-6 text-xs">
                                                <RotateCcw className="h-3 w-3 mr-1" />
                                                {t('settingsPage.save.resetDefault', 'Reset to Default')}
                                            </Button>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center justify-between pt-4 border-t border-border/30">
                                    <div className="space-y-0.5">
                                        <label className="text-sm font-medium">{t('settingsPage.save.autoSave')}</label>
                                        <p className="text-xs text-muted-foreground">
                                            {t('settingsPage.save.autoSaveHelp')}
                                        </p>
                                    </div>
                                    <Switch
                                        checked={autoSave}
                                        onChange={(e) => setAutoSave(e.target.checked)}
                                    />
                                </div>
                            </div>

                            {/* Library Path Setting */}
                            <div className="border border-border/50 rounded-xl p-6 space-y-6 bg-card/30">
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <label className="text-sm font-medium">{t('settingsPage.library.folder', 'Library Folder')}</label>
                                        {isAbsoluteLibraryPath && (
                                            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                                                {t('settingsPage.save.customPath', 'Custom Path')}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex gap-2">
                                        <Input
                                            value={localLibraryPath}
                                            onChange={(e) => {
                                                setLocalLibraryPath(e.target.value)
                                                const isAbsolute = /^[A-Za-z]:[\\/]/.test(e.target.value) || e.target.value.startsWith('/')
                                                setIsAbsoluteLibraryPath(isAbsolute)
                                            }}
                                            placeholder="NAIS_Library"
                                            className="flex-1"
                                        />
                                        <Button variant="outline" onClick={handleBrowseLibraryFolder}>
                                            <FolderOpen className="h-4 w-4 mr-2" />
                                            {t('settingsPage.save.browse', 'Browse')}
                                        </Button>
                                        <Button
                                            onClick={handleSaveLibraryPath}
                                            variant={(localLibraryPath !== libraryPath || isAbsoluteLibraryPath !== useAbsoluteLibraryPath) ? "default" : "outline"}
                                            className={(localLibraryPath !== libraryPath || isAbsoluteLibraryPath !== useAbsoluteLibraryPath)
                                                ? "animate-pulse bg-yellow-500 hover:bg-yellow-600 text-black shadow-lg shadow-yellow-500/50"
                                                : ""}
                                        >
                                            <Save className="h-4 w-4 mr-2" />
                                            {t('settingsPage.saveBtn')}
                                        </Button>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <p className="text-xs text-muted-foreground">
                                            {isAbsoluteLibraryPath
                                                ? t('settingsPage.library.absolutePathHelp', 'Library files will be saved to this exact folder.')
                                                : t('settingsPage.library.folderHelp', 'Default: Pictures/NAIS_Library')}
                                        </p>
                                        {isAbsoluteLibraryPath && (
                                            <Button variant="ghost" size="sm" onClick={handleResetLibraryToDefault} className="h-6 text-xs">
                                                <RotateCcw className="h-3 w-3 mr-1" />
                                                {t('settingsPage.save.resetDefault', 'Reset to Default')}
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </section>
                    )}

                    {/* Shortcuts Section */}
                    {activeSection === 'shortcuts' && (
                        <section className="space-y-6">
                            <div>
                                <h2 className="text-xl font-semibold">{t('settingsPage.shortcuts.title', '단축키')}</h2>
                                <p className="text-sm text-muted-foreground mt-1">
                                    {t('settingsPage.shortcuts.description', '전역 단축키를 설정합니다.')}
                                </p>
                            </div>

                            {/* Enable/Disable Shortcuts */}
                            <div className="border border-border/50 rounded-xl p-6 bg-card/30">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <label className="text-sm font-medium">{t('settingsPage.shortcuts.enable', '단축키 활성화')}</label>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            {t('settingsPage.shortcuts.enableHelp', '전역 단축키를 활성화하거나 비활성화합니다.')}
                                        </p>
                                    </div>
                                    <Switch
                                        checked={shortcutsEnabled}
                                        onChange={(e) => setShortcutsEnabled(e.target.checked)}
                                    />
                                </div>
                            </div>

                            {/* Shortcut Bindings */}
                            <div className="border border-border/50 rounded-xl p-6 space-y-4 bg-card/30">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-sm font-medium">{t('settingsPage.shortcuts.bindings', '키 바인딩')}</h3>
                                    <Button variant="ghost" size="sm" onClick={resetAllBindings}>
                                        <RotateCcw className="h-3 w-3 mr-1" />
                                        {t('settingsPage.shortcuts.resetAll', '전체 초기화')}
                                    </Button>
                                </div>

                                {/* Navigation */}
                                <div className="space-y-2">
                                    <h4 className="text-xs text-muted-foreground uppercase tracking-wider">
                                        {t('settingsPage.shortcuts.navigation', '네비게이션')}
                                    </h4>
                                    {SHORTCUT_ACTIONS.filter(a => a.category === 'navigation').map(({ action }) => (
                                        <ShortcutRow
                                            key={action}
                                            action={action}
                                            binding={bindings[action]}
                                            allBindings={bindings}
                                            isEditing={editingAction === action}
                                            recordedBinding={editingAction === action ? recordedBinding : null}
                                            onStartEdit={() => {
                                                setEditingAction(action)
                                                setRecordedBinding(null)
                                            }}
                                            onSave={(binding) => {
                                                setBinding(action, binding)
                                                setEditingAction(null)
                                                setRecordedBinding(null)
                                            }}
                                            onCancel={() => {
                                                setEditingAction(null)
                                                setRecordedBinding(null)
                                            }}
                                            onReset={() => resetBinding(action)}
                                            onKeyRecord={setRecordedBinding}
                                            t={t}
                                        />
                                    ))}
                                </div>

                                {/* Dialogs */}
                                <div className="space-y-2">
                                    <h4 className="text-xs text-muted-foreground uppercase tracking-wider">
                                        {t('settingsPage.shortcuts.dialogs', '다이얼로그')}
                                    </h4>
                                    {SHORTCUT_ACTIONS.filter(a => a.category === 'dialog').map(({ action }) => (
                                        <ShortcutRow
                                            key={action}
                                            action={action}
                                            binding={bindings[action]}
                                            allBindings={bindings}
                                            isEditing={editingAction === action}
                                            recordedBinding={editingAction === action ? recordedBinding : null}
                                            onStartEdit={() => {
                                                setEditingAction(action)
                                                setRecordedBinding(null)
                                            }}
                                            onSave={(binding) => {
                                                setBinding(action, binding)
                                                setEditingAction(null)
                                                setRecordedBinding(null)
                                            }}
                                            onCancel={() => {
                                                setEditingAction(null)
                                                setRecordedBinding(null)
                                            }}
                                            onReset={() => resetBinding(action)}
                                            onKeyRecord={setRecordedBinding}
                                            t={t}
                                        />
                                    ))}
                                </div>

                                {/* Actions */}
                                <div className="space-y-2">
                                    <h4 className="text-xs text-muted-foreground uppercase tracking-wider">
                                        {t('settingsPage.shortcuts.actions', '액션')}
                                    </h4>
                                    {SHORTCUT_ACTIONS.filter(a => a.category === 'action').map(({ action }) => (
                                        <ShortcutRow
                                            key={action}
                                            action={action}
                                            binding={bindings[action]}
                                            allBindings={bindings}
                                            isEditing={editingAction === action}
                                            recordedBinding={editingAction === action ? recordedBinding : null}
                                            onStartEdit={() => {
                                                setEditingAction(action)
                                                setRecordedBinding(null)
                                            }}
                                            onSave={(binding) => {
                                                setBinding(action, binding)
                                                setEditingAction(null)
                                                setRecordedBinding(null)
                                            }}
                                            onCancel={() => {
                                                setEditingAction(null)
                                                setRecordedBinding(null)
                                            }}
                                            onReset={() => resetBinding(action)}
                                            onKeyRecord={setRecordedBinding}
                                            t={t}
                                        />
                                    ))}
                                </div>
                            </div>
                        </section>
                    )}
                </div>
            </main>
        </div>
    )
}

// 단축키 행 컴포넌트
interface ShortcutRowProps {
    action: ShortcutAction
    binding: KeyBinding
    allBindings: Record<ShortcutAction, KeyBinding>
    isEditing: boolean
    recordedBinding: KeyBinding | null
    onStartEdit: () => void
    onSave: (binding: KeyBinding) => void
    onCancel: () => void
    onReset: () => void
    onKeyRecord: (binding: KeyBinding) => void
    t: ReturnType<typeof useTranslation>['t']
}

function ShortcutRow({ action, binding, allBindings, isEditing, recordedBinding, onStartEdit, onSave, onCancel, onReset, onKeyRecord, t }: ShortcutRowProps) {
    const [conflictAction, setConflictAction] = useState<ShortcutAction | null>(null)

    // 충돌 체크 함수
    const checkConflict = (newBinding: KeyBinding): ShortcutAction | null => {
        for (const [otherAction, otherBinding] of Object.entries(allBindings)) {
            if (otherAction === action) continue // 자기 자신은 제외
            
            // 키 조합이 정확히 같은지 확인
            if (
                otherBinding.key === newBinding.key &&
                !!otherBinding.ctrl === !!newBinding.ctrl &&
                !!otherBinding.shift === !!newBinding.shift &&
                !!otherBinding.alt === !!newBinding.alt
            ) {
                return otherAction as ShortcutAction
            }
        }
        return null
    }

    const handleSave = () => {
        if (!recordedBinding) return
        
        const conflict = checkConflict(recordedBinding)
        if (conflict) {
            setConflictAction(conflict)
            return
        }
        
        onSave(recordedBinding)
        setConflictAction(null)
    }

    const handleForceOverride = () => {
        if (!recordedBinding) return
        onSave(recordedBinding)
        setConflictAction(null)
    }
    useEffect(() => {
        if (!isEditing) return

        const handleKeyDown = (e: KeyboardEvent) => {
            e.preventDefault()
            e.stopPropagation()

            // Escape로 취소
            if (e.key === 'Escape') {
                onCancel()
                return
            }

            // 단독 modifier 키는 무시
            if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
                return
            }

            const newBinding: KeyBinding = {
                key: e.key,
                ctrl: e.ctrlKey || e.metaKey,
                shift: e.shiftKey,
                alt: e.altKey,
                label: '',
                description: binding.description,
            }
            newBinding.label = formatKeyBinding(newBinding)
            onKeyRecord(newBinding)
        }

        window.addEventListener('keydown', handleKeyDown, true)
        return () => window.removeEventListener('keydown', handleKeyDown, true)
    }, [isEditing, binding.description, onCancel, onKeyRecord])

    const displayBinding = recordedBinding || binding

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50">
                <span className="text-sm">{t(binding.description, binding.description)}</span>
                <div className="flex items-center gap-2">
                    {isEditing ? (
                        <>
                            <div className={cn(
                                "px-3 py-1.5 rounded-md text-sm font-mono min-w-[100px] text-center",
                                recordedBinding ? "bg-primary text-primary-foreground" : "bg-muted animate-pulse"
                            )}>
                                {recordedBinding ? recordedBinding.label : t('settingsPage.shortcuts.pressKey', '키 입력...')}
                            </div>
                            <Button size="sm" variant="ghost" onClick={onCancel}>
                                <X className="h-4 w-4" />
                            </Button>
                            {recordedBinding && (
                                <Button size="sm" variant="default" onClick={handleSave}>
                                    <Check className="h-4 w-4" />
                                </Button>
                            )}
                        </>
                    ) : (
                        <>
                            <button
                                onClick={onStartEdit}
                                className="px-3 py-1.5 rounded-md text-sm font-mono bg-muted hover:bg-muted/80 min-w-[100px] text-center"
                            >
                                {displayBinding.label}
                            </button>
                            <Tip content={t('settingsPage.shortcuts.reset', '초기화')}>
                                <Button size="sm" variant="ghost" onClick={onReset}>
                                    <RotateCcw className="h-3 w-3" />
                                </Button>
                            </Tip>
                        </>
                    )}
                </div>
            </div>
            
            {/* 충돌 경고 */}
            {conflictAction && recordedBinding && (
                <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-destructive/10 border border-destructive/20">
                    <div className="flex items-center gap-2 text-sm text-destructive">
                        <Info className="h-4 w-4" />
                        <span>
                            {t('settingsPage.shortcuts.conflict', '이미 사용 중:')} {t(allBindings[conflictAction].description, allBindings[conflictAction].description)}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button 
                            size="sm" 
                            variant="ghost" 
                            onClick={() => setConflictAction(null)}
                            className="text-destructive hover:text-destructive"
                        >
                            {t('common.cancel', '취소')}
                        </Button>
                        <Button 
                            size="sm" 
                            variant="destructive" 
                            onClick={handleForceOverride}
                        >
                            {t('settingsPage.shortcuts.override', '덮어쓰기')}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}
