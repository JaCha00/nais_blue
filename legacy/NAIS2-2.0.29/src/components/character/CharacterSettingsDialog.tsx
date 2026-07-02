import React, { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Users, Upload, X, Zap, Database, Lock } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { Tip } from '@/components/ui/tooltip'
import { useCharacterStore, ReferenceImage } from '@/stores/character-store'
import { parseMetadataFromBase64 } from '@/lib/metadata-parser'
import { cn } from '@/lib/utils'


const SafeSlider = ({
    value,
    onValueCommit,
    max = 1,
    step = 0.01,
    label,
}: {
    value: number[]
    onValueCommit: (val: number[]) => void
    max?: number
    step?: number
    label?: string
}) => {
    const [localValue, setLocalValue] = React.useState(value)

    React.useEffect(() => {
        setLocalValue(value)
    }, [value])

    return (
        <div className="space-y-1">
            {label && (
                <div className="flex justify-between">
                    <Label className="text-xs text-muted-foreground">{label}</Label>
                    <span className="text-xs font-mono">{localValue[0].toFixed(2)}</span>
                </div>
            )}
            <Slider
                value={localValue}
                min={0}
                max={max}
                step={step}
                onValueChange={setLocalValue}
                onValueCommit={onValueCommit}
            />
        </div>
    )
}

export function CharacterSettingsDialog({ open, onOpenChange }: { open?: boolean, onOpenChange?: (open: boolean) => void } = {}) {
    const { t } = useTranslation()
    const {
        characterImages,
        vibeImages,
        addCharacterImage,
        removeCharacterImage,
        updateCharacterImage,
        addVibeImage,
        removeVibeImage,
        updateVibeImage
    } = useCharacterStore()

    const charInputRef = useRef<HTMLInputElement>(null)
    const vibeInputRef = useRef<HTMLInputElement>(null)

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, mode: 'character' | 'vibe') => {
        const files = e.target.files
        if (!files || files.length === 0) return

        for (let i = 0; i < files.length; i++) {
            const file = files[i]
            const base64 = await convertToBase64(file)
            if (mode === 'character') {
                addCharacterImage(base64)
            } else {
                // Try to extract pre-encoded vibe from PNG metadata
                try {
                    const metadata = await parseMetadataFromBase64(base64)
                    if (metadata?.encodedVibes && metadata.encodedVibes.length > 0) {
                        // Use first encoded vibe and info/strength from metadata
                        const info = metadata.vibeTransferInfo?.[0]
                        addVibeImage(
                            base64,
                            metadata.encodedVibes[0],
                            info?.informationExtracted ?? 1.0,
                            info?.strength ?? 0.6
                        )
                    } else {
                        addVibeImage(base64)
                    }
                } catch {
                    addVibeImage(base64)
                }
            }
        }
        // Reset input
        e.target.value = ''
    }

    const convertToBase64 = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.readAsDataURL(file)
            reader.onload = () => {
                resolve(reader.result as string)
            }
            reader.onerror = error => reject(error)
        })
    }

    // Vibe Image List Component
    const VibeImageList = ({
        images,
        onRemove,
        onUpdate
    }: {
        images: ReferenceImage[],
        onRemove: (id: string) => void,
        onUpdate: (id: string, updates: Partial<ReferenceImage>) => void
    }) => (
        <div className="space-y-4 pt-4">
            {images.length === 0 && (
                <div className="text-center py-8 text-muted-foreground bg-muted/30 rounded-lg border border-dashed">
                    {t('characterDialog.noImages')}
                </div>
            )}
            {images.map(img => (
                <div key={img.id} className="flex gap-4 p-3 border rounded-lg bg-card bg-muted/10">
                    <div className="relative shrink-0 w-24 h-24 bg-muted rounded-md overflow-hidden border flex items-center justify-center group/image">
                        {img.base64 ? (
                            <img src={img.base64} alt="Reference" className="w-full h-full object-cover" />
                        ) : (
                            <div className="flex flex-col items-center justify-center text-muted-foreground p-2 text-center">
                                <Database className="w-8 h-8 opacity-50 mb-1" />
                                <span className="text-[9px] leading-tight whitespace-pre-line">{t('characterDialog.encodedDataOnly')}</span>
                            </div>
                        )}
                        <Button
                            variant="destructive"
                            size="icon"
                            className="absolute top-1 right-1 h-6 w-6 rounded-full opacity-0 group-hover/image:opacity-100 transition-opacity"
                            onClick={() => onRemove(img.id)}
                        >
                            <X className="w-3 h-3" />
                        </Button>
                        {/* Pre-encoded indicator */}
                        {img.encodedVibe && (
                            <Tip content={t('characterDialog.preEncodedTooltip')}>
                                <div className="absolute bottom-1 left-1 bg-green-500/90 text-white text-[9px] font-bold rounded px-1 py-0.5 flex items-center gap-0.5">
                                    <Zap className="w-2.5 h-2.5" />
                                </div>
                            </Tip>
                        )}
                    </div>
                    <div className="flex-1 space-y-3 min-w-0">
                        <SafeSlider
                            label={t('characterDialog.vibeInfoExtracted', '정보 추출률 (Information Extracted)')}
                            value={[img.informationExtracted]}
                            onValueCommit={([v]) => onUpdate(img.id, { informationExtracted: v })}
                        />
                        <SafeSlider
                            label={t('characterDialog.vibeStrength', '강도 (Reference Strength)')}
                            value={[img.strength]}
                            onValueCommit={([v]) => onUpdate(img.id, { strength: v })}
                        />
                    </div>
                </div>
            ))}
        </div>
    )

    // Character Reference Image List Component
    const CharacterImageList = ({
        images,
        onRemove,
        onUpdate
    }: {
        images: ReferenceImage[],
        onRemove: (id: string) => void,
        onUpdate: (id: string, updates: Partial<ReferenceImage>) => void
    }) => (
        <div className="space-y-4 pt-4">
            {images.length === 0 && (
                <div className="text-center py-8 text-muted-foreground bg-muted/30 rounded-lg border border-dashed">
                    {t('characterDialog.noImages')}
                </div>
            )}
            {images.map(img => (
                <div key={img.id} className="flex gap-4 p-3 border rounded-lg bg-card bg-muted/10">
                    <div className="relative shrink-0 w-24 h-24 bg-muted rounded-md overflow-hidden border flex items-center justify-center group/image">
                        <img src={img.base64} alt="Reference" className="w-full h-full object-cover" />
                        <Button
                            variant="destructive"
                            size="icon"
                            className="absolute top-1 right-1 h-6 w-6 rounded-full opacity-0 group-hover/image:opacity-100 transition-opacity"
                            onClick={() => onRemove(img.id)}
                        >
                            <X className="w-3 h-3" />
                        </Button>
                    </div>
                    <div className="flex-1 space-y-3 min-w-0">
                        {/* Mode — NAI precise reference (Character & Style / Character / Style) */}
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">{t('characterDialog.mode', '모드')}</Label>
                            <div className="flex gap-1">
                                {([
                                    ['character&style', t('characterDialog.modeCharStyle', '캐릭터+스타일')],
                                    ['character', t('characterDialog.modeChar', '캐릭터')],
                                    ['style', t('characterDialog.modeStyle', '스타일')],
                                ] as const).map(([m, label]) => (
                                    <button
                                        key={m}
                                        type="button"
                                        onClick={() => onUpdate(img.id, { mode: m })}
                                        className={cn(
                                            'flex-1 px-2 py-1 rounded-md text-xs border transition-colors',
                                            (img.mode || 'character&style') === m
                                                ? 'border-primary/50 bg-primary/15 text-primary font-semibold'
                                                : 'border-white/10 text-muted-foreground hover:bg-white/5'
                                        )}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        {/* Strength — adjustable (matches NAI web; was hard-fixed to 1.0 before) */}
                        <SafeSlider
                            label={t('characterDialog.strength', '강도 (Strength)')}
                            value={[img.strength]}
                            onValueCommit={([v]) => onUpdate(img.id, { strength: v })}
                        />
                        {/* Fidelity */}
                        <SafeSlider
                            label={t('characterDialog.fidelity', '충실도 (Fidelity)')}
                            value={[img.fidelity ?? 1.0]}
                            onValueCommit={([v]) => onUpdate(img.id, { fidelity: v })}
                        />
                    </div>
                </div>
            ))}
        </div>
    )

    const totalCount = characterImages.length + vibeImages.length

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="flex-1 text-xs rounded-xl h-9 relative group">
                    <Users className="h-3.5 w-3.5 mr-1.5" />
                    {t('prompt.imageReference')}
                    {totalCount > 0 && (
                        <div className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold rounded-md px-1 py-0.5 min-w-[16px] h-[16px] flex items-center justify-center shadow-sm">
                            {totalCount}
                        </div>
                    )}
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl max-h-[85vh] flex flex-col overflow-hidden">
                <DialogHeader>
                    <DialogTitle>{t('characterDialog.title')}</DialogTitle>
                    <DialogDescription>{t('characterDialog.description')}</DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="character" className="flex-1 flex flex-col min-h-0">
                    <TabsList className="grid grid-cols-2 w-full">
                        <TabsTrigger value="character">{t('characterDialog.tabCharacter')}</TabsTrigger>
                        <TabsTrigger value="vibe">{t('characterDialog.tabVibe')}</TabsTrigger>
                    </TabsList>

                    <TabsContent value="character" className="flex-1 overflow-y-auto min-h-0 pr-1">
                        <div className="py-2">
                            {characterImages.length === 0 && (
                                <div
                                    className="border-2 border-dashed border-muted-foreground/25 rounded-xl p-6 text-center hover:bg-muted/50 transition-colors cursor-pointer"
                                    onClick={() => charInputRef.current?.click()}
                                >
                                    <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                                    <p className="text-sm text-muted-foreground font-medium">{t('characterDialog.uploadCharacter')}</p>
                                </div>
                            )}
                            <input
                                type="file"
                                multiple={false}
                                accept="image/*"
                                className="hidden"
                                ref={charInputRef}
                                onChange={(e) => handleFileUpload(e, 'character')}
                            />

                            <CharacterImageList
                                images={characterImages}
                                onRemove={removeCharacterImage}
                                onUpdate={updateCharacterImage}
                            />
                        </div>
                    </TabsContent>

                    <TabsContent value="vibe" className="flex-1 overflow-y-auto min-h-0 pr-1 relative">
                        {characterImages.length > 0 && (
                            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/60 backdrop-blur-[1px]">
                                <Lock className="w-8 h-8 text-muted-foreground mb-2" />
                                <p className="text-sm font-medium text-muted-foreground text-center px-4">
                                    {t('characterDialog.vibeDisabledMsg')}
                                </p>
                            </div>
                        )}
                        <div className={characterImages.length > 0 ? "opacity-30 pointer-events-none grayscale filter blur-[1px]" : ""}>
                            <div className="py-2">
                                <div
                                    className="border-2 border-dashed border-muted-foreground/25 rounded-xl p-6 text-center hover:bg-muted/50 transition-colors cursor-pointer"
                                    onClick={() => vibeInputRef.current?.click()}
                                >
                                    <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                                    <p className="text-sm text-muted-foreground font-medium">{t('characterDialog.uploadVibe')}</p>
                                </div>
                                <input
                                    type="file"
                                    multiple
                                    accept="image/*"
                                    className="hidden"
                                    ref={vibeInputRef}
                                    onChange={(e) => handleFileUpload(e, 'vibe')}
                                />
                                <VibeImageList
                                    images={vibeImages}
                                    onRemove={removeVibeImage}
                                    onUpdate={updateVibeImage}
                                />
                            </div>
                        </div>
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    )
}
