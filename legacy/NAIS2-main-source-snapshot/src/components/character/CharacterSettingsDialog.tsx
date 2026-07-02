import React, { useRef, useState, useCallback } from 'react'
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
import { Users, Upload, X, Zap, Database, Lock, Eye, EyeOff, Image as ImageIcon } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { Tip } from '@/components/ui/tooltip'
import { useCharacterStore, ReferenceImage, PreciseReferenceType } from '@/stores/character-store'
import { parseMetadataFromBase64 } from '@/lib/metadata-parser'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
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
                await addCharacterImage(base64)
            } else {
                // Try to extract pre-encoded vibe from PNG metadata
                try {
                    const metadata = await parseMetadataFromBase64(base64)
                    if (metadata?.encodedVibes && metadata.encodedVibes.length > 0) {
                        // Use first encoded vibe and info/strength from metadata
                        const info = metadata.vibeTransferInfo?.[0]
                        await addVibeImage(
                            base64,
                            metadata.encodedVibes[0],
                            info?.informationExtracted ?? 1.0,
                            info?.strength ?? 0.6
                        )
                    } else {
                        await addVibeImage(base64)
                    }
                } catch {
                    await addVibeImage(base64)
                }
            }
        }
        // Reset input
        e.target.value = ''
    }

    const [charDragOver, setCharDragOver] = useState(false)
    const [vibeDragOver, setVibeDragOver] = useState(false)

    const handleDrop = useCallback(async (e: React.DragEvent, mode: 'character' | 'vibe') => {
        e.preventDefault()
        e.stopPropagation()
        if (mode === 'character') setCharDragOver(false)
        else setVibeDragOver(false)

        const files = e.dataTransfer.files
        if (!files || files.length === 0) return

        for (let i = 0; i < files.length; i++) {
            const file = files[i]
            if (!file.type.startsWith('image/')) continue
            const base64 = await convertToBase64(file)
            if (mode === 'character') {
                await addCharacterImage(base64)
            } else {
                try {
                    const metadata = await parseMetadataFromBase64(base64)
                    if (metadata?.encodedVibes && metadata.encodedVibes.length > 0) {
                        const info = metadata.vibeTransferInfo?.[0]
                        await addVibeImage(
                            base64,
                            metadata.encodedVibes[0],
                            info?.informationExtracted ?? 1.0,
                            info?.strength ?? 0.6
                        )
                    } else {
                        await addVibeImage(base64)
                    }
                } catch {
                    await addVibeImage(base64)
                }
            }
        }
    }, [addCharacterImage, addVibeImage])

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
    }, [])

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
            {images.map(img => {
                const isEnabled = img.enabled !== false
                return (
                    <div 
                        key={img.id} 
                        className={cn(
                            "flex gap-4 p-3 border rounded-lg bg-card transition-all",
                            isEnabled ? "bg-muted/10" : "bg-muted/5 opacity-50"
                        )}
                    >
                        <div className="relative shrink-0 w-24 h-24 bg-muted rounded-md overflow-hidden border flex items-center justify-center group/image">
                            {(img.thumbnail || img.base64) ? (
                                <img 
                                    src={img.thumbnail || img.base64} 
                                    alt="Reference" 
                                    className={cn(
                                        "w-full h-full object-cover transition-all",
                                        !isEnabled && "grayscale"
                                    )} 
                                />
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
                            {/* 활성화/비활성화 토글 */}
                            <Tip content={isEnabled ? t('characterDialog.clickToDisable', '클릭하여 비활성화') : t('characterDialog.clickToEnable', '클릭하여 활성화')}>
                                <Button
                                    variant="secondary"
                                    size="icon"
                                    className={cn(
                                        "absolute bottom-1 right-1 h-6 w-6 rounded-full transition-opacity",
                                        isEnabled ? "bg-green-500/90 hover:bg-green-600" : "bg-gray-500/90 hover:bg-gray-600"
                                    )}
                                    onClick={() => onUpdate(img.id, { enabled: !isEnabled })}
                                >
                                    {isEnabled ? <Eye className="w-3 h-3 text-white" /> : <EyeOff className="w-3 h-3 text-white" />}
                                </Button>
                            </Tip>
                            {/* Pre-encoded indicator */}
                            {img.encodedVibe && (
                                <Tip content={t('characterDialog.preEncodedTooltip')}>
                                    <div className="absolute bottom-1 left-1 bg-green-500/90 text-white text-[9px] font-bold rounded px-1 py-0.5 flex items-center gap-0.5">
                                        <Zap className="w-2.5 h-2.5" />
                                    </div>
                                </Tip>
                            )}
                        </div>
                        <div className={cn("flex-1 space-y-3 min-w-0", !isEnabled && "pointer-events-none")}>
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
                )
            })}
        </div>
    )

    // Character Reference Image List Component (참조 레퍼런스)
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
            {images.map(img => {
                const isEnabled = img.enabled !== false // undefined도 true로 취급 (하위 호환)
                return (
                    <div 
                        key={img.id} 
                        className={cn(
                            "flex gap-4 p-3 border rounded-lg bg-card transition-all",
                            isEnabled ? "bg-muted/10" : "bg-muted/5 opacity-50"
                        )}
                    >
                        <div className="relative shrink-0 w-24 h-24 bg-muted rounded-md overflow-hidden border flex items-center justify-center group/image">
                            {(img.thumbnail || img.base64) ? (
                                <img 
                                    src={img.thumbnail || img.base64} 
                                    alt="Reference" 
                                    className={cn(
                                        "w-full h-full object-cover transition-all",
                                        !isEnabled && "grayscale"
                                    )} 
                                />
                            ) : (
                                <div className="flex flex-col items-center justify-center text-muted-foreground p-2 text-center">
                                    <ImageIcon className="w-8 h-8 opacity-50 mb-1 animate-pulse" />
                                    <span className="text-[9px] leading-tight">{t('common.loading', 'Loading...')}</span>
                                </div>
                            )}
                            {/* 삭제 버튼 */}
                            <Button
                                variant="destructive"
                                size="icon"
                                className="absolute top-1 right-1 h-6 w-6 rounded-full opacity-0 group-hover/image:opacity-100 transition-opacity"
                                onClick={() => onRemove(img.id)}
                            >
                                <X className="w-3 h-3" />
                            </Button>
                            {/* 활성화/비활성화 토글 */}
                            <Tip content={isEnabled ? t('characterDialog.clickToDisable', '클릭하여 비활성화') : t('characterDialog.clickToEnable', '클릭하여 활성화')}>
                                <Button
                                    variant="secondary"
                                    size="icon"
                                    className={cn(
                                        "absolute bottom-1 right-1 h-6 w-6 rounded-full transition-opacity",
                                        isEnabled ? "bg-green-500/90 hover:bg-green-600" : "bg-gray-500/90 hover:bg-gray-600"
                                    )}
                                    onClick={() => onUpdate(img.id, { enabled: !isEnabled })}
                                >
                                    {isEnabled ? <Eye className="w-3 h-3 text-white" /> : <EyeOff className="w-3 h-3 text-white" />}
                                </Button>
                            </Tip>
                            {/* 캐시된 이미지 표시 */}
                            {img.cacheKey && (
                                <Tip content={t('characterDialog.cachedTooltip', '서버에 캐시됨 (재전송 불필요)')}>
                                    <div className="absolute bottom-1 left-1 bg-blue-500/90 text-white text-[9px] font-bold rounded px-1 py-0.5 flex items-center gap-0.5">
                                        <Zap className="w-2.5 h-2.5" />
                                    </div>
                                </Tip>
                            )}
                        </div>
                        <div className={cn("flex-1 space-y-3 min-w-0", !isEnabled && "pointer-events-none")}>
                            {/* Reference Type - 참조 타입 선택 */}
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">
                                    {t('characterDialog.referenceType', '참조 타입')}
                                </Label>
                                <Select
                                    value={img.referenceType || 'character&style'}
                                    onValueChange={(v) => onUpdate(img.id, { referenceType: v as PreciseReferenceType })}
                                    disabled={!isEnabled}
                                >
                                    <SelectTrigger className="h-8 text-xs">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="character&style">
                                            {t('characterDialog.typeCharacterStyle', '캐릭터 & 스타일')}
                                        </SelectItem>
                                        <SelectItem value="character">
                                            {t('characterDialog.typeCharacter', '캐릭터')}
                                        </SelectItem>
                                        <SelectItem value="style">
                                            {t('characterDialog.typeStyle', '스타일')}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            {/* Strength - Slider */}
                            <SafeSlider
                                label={t('characterDialog.strength', '강도 (Strength)')}
                                value={[img.strength]}
                                onValueCommit={([v]) => onUpdate(img.id, { strength: v })}
                            />
                            {/* Fidelity - Slider */}
                            <SafeSlider
                                label={t('characterDialog.fidelity', '충실도 (Fidelity)')}
                                value={[img.fidelity ?? 0.6]}
                                onValueCommit={([v]) => onUpdate(img.id, { fidelity: v })}
                            />
                        </div>
                    </div>
                )
            })}
        </div>
    )

    // Count only enabled images (enabled !== false or undefined which means enabled)
    const enabledCharCount = characterImages.filter(img => img.enabled !== false).length
    const enabledVibeCount = vibeImages.filter(img => img.enabled !== false).length
    const totalCount = enabledCharCount + enabledVibeCount

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
                            <div
                                className={cn(
                                    "border-2 border-dashed rounded-xl p-4 text-center transition-colors cursor-pointer mb-4",
                                    charDragOver
                                        ? "border-primary bg-primary/10"
                                        : "border-muted-foreground/25 hover:bg-muted/50"
                                )}
                                onClick={() => charInputRef.current?.click()}
                                onDragOver={handleDragOver}
                                onDragEnter={(e) => { e.preventDefault(); setCharDragOver(true) }}
                                onDragLeave={() => setCharDragOver(false)}
                                onDrop={(e) => handleDrop(e, 'character')}
                            >
                                <Upload className={cn("w-6 h-6 mx-auto mb-1", charDragOver ? "text-primary" : "text-muted-foreground")} />
                                <p className={cn("text-sm font-medium", charDragOver ? "text-primary" : "text-muted-foreground")}>
                                    {charDragOver ? t('characterDialog.dropHere', '여기에 놓기') : t('characterDialog.uploadCharacter')}
                                </p>
                            </div>
                            <input
                                type="file"
                                multiple
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
                        {characterImages.some(img => img.enabled !== false) && (
                            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/60 backdrop-blur-[1px]">
                                <Lock className="w-8 h-8 text-muted-foreground mb-2" />
                                <p className="text-sm font-medium text-muted-foreground text-center px-4">
                                    {t('characterDialog.vibeDisabledMsg')}
                                </p>
                            </div>
                        )}
                        <div className={characterImages.some(img => img.enabled !== false) ? "opacity-30 pointer-events-none grayscale filter blur-[1px]" : ""}>
                            <div className="py-2">
                                <div
                                    className={cn(
                                        "border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer",
                                        vibeDragOver
                                            ? "border-primary bg-primary/10"
                                            : "border-muted-foreground/25 hover:bg-muted/50"
                                    )}
                                    onClick={() => vibeInputRef.current?.click()}
                                    onDragOver={handleDragOver}
                                    onDragEnter={(e) => { e.preventDefault(); setVibeDragOver(true) }}
                                    onDragLeave={() => setVibeDragOver(false)}
                                    onDrop={(e) => handleDrop(e, 'vibe')}
                                >
                                    <Upload className={cn("w-8 h-8 mx-auto mb-2", vibeDragOver ? "text-primary" : "text-muted-foreground")} />
                                    <p className={cn("text-sm font-medium", vibeDragOver ? "text-primary" : "text-muted-foreground")}>
                                        {vibeDragOver ? t('characterDialog.dropHere', '여기에 놓기') : t('characterDialog.uploadVibe')}
                                    </p>
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
