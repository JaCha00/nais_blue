import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { Plus, ChevronDown, Check, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { useSettingsStore } from '@/stores/settings-store'
import { cn } from '@/lib/utils'

export const RESOLUTION_PRESETS = [
    { key: 'portrait', width: 832, height: 1216 },
    { key: 'landscape', width: 1216, height: 832 },
    { key: 'square', width: 1024, height: 1024 },
    { key: 'tallPortrait', width: 640, height: 1536 },
    { key: 'wideLandscape', width: 1536, height: 640 },
]

// NovelAI requires dimensions to be multiples of 64
export const roundTo64 = (value: number): number => Math.round(value / 64) * 64

export interface Resolution {
    label: string
    width: number
    height: number
}

interface ResolutionSelectorProps {
    value: Resolution
    onChange: (resolution: Resolution) => void
    disabled?: boolean
}


export function ResolutionSelector({ value, onChange, disabled }: ResolutionSelectorProps) {
    const { t } = useTranslation()
    const customResolutions = useSettingsStore(state => state.customResolutions)
    const addCustomResolution = useSettingsStore(state => state.addCustomResolution)
    const removeCustomResolution = useSettingsStore(state => state.removeCustomResolution)

    const [open, setOpen] = useState(false)
    const [customWidth, setCustomWidth] = useState(1024)
    const [customHeight, setCustomHeight] = useState(1024)
    const [customDialogOpen, setCustomDialogOpen] = useState(false)
    const [customLabel, setCustomLabel] = useState('Custom')

    // Find if current value matches a standard preset
    const standardPreset = RESOLUTION_PRESETS.find(
        (p) => p.width === value.width && p.height === value.height
    )

    // Find if current value matches a custom preset
    const customPreset = customResolutions.find(
        (p) => p.width === value.width && p.height === value.height
    )

    // Display text
    const displayText = standardPreset
        ? t(`resolutions.${standardPreset.key}`)
        : customPreset
            ? customPreset.label
            : `${value.width} × ${value.height}`

    const handleSelect = (preset: { key?: string; id?: string; width: number; height: number; label?: string }) => {
        if (preset.key) {
            onChange({
                label: t(`resolutions.${preset.key}`),
                width: preset.width,
                height: preset.height,
            })
        } else {
            onChange({
                label: preset.label || `${preset.width}×${preset.height}`,
                width: preset.width,
                height: preset.height,
            })
        }
        setOpen(false)
    }

    const handleAddCustom = () => {
        setOpen(false)
        setCustomDialogOpen(true)
    }

    const handleCustomSave = () => {
        // Round to nearest multiple of 64 (NovelAI requirement)
        const width = roundTo64(Number(customWidth))
        const height = roundTo64(Number(customHeight))
        const label = customLabel || `${width}x${height}`

        addCustomResolution({ label, width, height })
        onChange({ label, width, height })
        setCustomDialogOpen(false)
        
        // Reset for next time
        setCustomWidth(1024)
        setCustomHeight(1024)
        setCustomLabel('Custom')
    }

    const isSelected = (w: number, h: number) => value.width === w && value.height === h

    return (
        <>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        disabled={disabled}
                        className="w-full justify-between font-normal"
                    >
                        <span className="truncate">{displayText}</span>
                        <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent 
                    className="p-0" 
                    align="start"
                    style={{ width: 'var(--radix-popover-trigger-width)' }}
                >
                    <div className="max-h-[300px] overflow-auto">
                        {/* Standard Presets */}
                        <div className="p-1">
                            {RESOLUTION_PRESETS.map((p) => (
                                <button
                                    key={p.key}
                                    onClick={() => handleSelect(p)}
                                    className={cn(
                                        "flex items-center justify-between w-full px-2 py-1.5 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground cursor-pointer",
                                        isSelected(p.width, p.height) && "bg-accent"
                                    )}
                                >
                                    <span className="flex items-center gap-2">
                                        {isSelected(p.width, p.height) && <Check className="h-4 w-4" />}
                                        {!isSelected(p.width, p.height) && <span className="w-4" />}
                                        <span>{t(`resolutions.${p.key}`)}</span>
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                        {p.width} × {p.height}
                                    </span>
                                </button>
                            ))}
                        </div>

                        {/* Custom Resolutions */}
                        {customResolutions.length > 0 && (
                            <>
                                <div className="h-px bg-border mx-1" />
                                <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                                    {t('resolutions.custom', '사용자 정의')}
                                </div>
                                <div className="p-1 pt-0">
                                    {customResolutions.map((c) => (
                                        <div
                                            key={c.id}
                                            className={cn(
                                                "flex items-center justify-between w-full px-2 py-1.5 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground group",
                                                isSelected(c.width, c.height) && "bg-accent"
                                            )}
                                        >
                                            <button
                                                onClick={() => handleSelect(c)}
                                                className="flex items-center gap-2 flex-1 cursor-pointer"
                                            >
                                                {isSelected(c.width, c.height) && <Check className="h-4 w-4" />}
                                                {!isSelected(c.width, c.height) && <span className="w-4" />}
                                                <span>{c.label}</span>
                                            </button>
                                            <span className="flex items-center gap-1">
                                                <span className="text-xs text-muted-foreground">
                                                    {c.width} × {c.height}
                                                </span>
                                                <Tip content={t('common.delete')}>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            removeCustomResolution(c.id)
                                                            // If current selection was deleted, reset to portrait
                                                            if (isSelected(c.width, c.height)) {
                                                                onChange({
                                                                    label: t('resolutions.portrait'),
                                                                    width: 832,
                                                                    height: 1216,
                                                                })
                                                            }
                                                        }}
                                                        className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity p-0.5 cursor-pointer"
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </button>
                                                </Tip>
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}

                        {/* Add Custom Button */}
                        <div className="h-px bg-border mx-1" />
                        <div className="p-1">
                            <button
                                onClick={handleAddCustom}
                                className="flex items-center w-full px-2 py-1.5 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground cursor-pointer text-primary font-medium"
                            >
                                <Plus className="mr-2 h-4 w-4" />
                                {t('resolutions.addCustom')}
                            </button>
                        </div>
                    </div>
                </PopoverContent>
            </Popover>

            <Dialog open={customDialogOpen} onOpenChange={setCustomDialogOpen}>
                <DialogContent onInteractOutside={(e) => e.preventDefault()}>
                    <DialogHeader>
                        <DialogTitle>{t('resolutions.addCustom')}</DialogTitle>
                        <DialogDescription>
                            {t('resolutions.addCustomDesc')}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="name" className="text-right">
                                {t('resolutions.presetName')}
                            </Label>
                            <Input
                                id="name"
                                value={customLabel}
                                onChange={(e) => setCustomLabel(e.target.value)}
                                className="col-span-3"
                            />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="width" className="text-right">
                                {t('resolutions.width')}
                            </Label>
                            <div className="col-span-3 flex items-center gap-2">
                                <Input
                                    id="width"
                                    type="number"
                                    step={64}
                                    value={customWidth}
                                    onChange={(e) => setCustomWidth(Number(e.target.value))}
                                    className="flex-1"
                                />
                                {roundTo64(customWidth) !== customWidth && (
                                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                                        → {roundTo64(customWidth)}
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="height" className="text-right">
                                {t('resolutions.height')}
                            </Label>
                            <div className="col-span-3 flex items-center gap-2">
                                <Input
                                    id="height"
                                    type="number"
                                    step={64}
                                    value={customHeight}
                                    onChange={(e) => setCustomHeight(Number(e.target.value))}
                                    className="flex-1"
                                />
                                {roundTo64(customHeight) !== customHeight && (
                                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                                        → {roundTo64(customHeight)}
                                    </span>
                                )}
                            </div>
                        </div>
                        {/* Preview of final resolution */}
                        <div className="text-center text-sm text-muted-foreground pt-2 border-t">
                            {t('resolutions.finalResolution', '최종 해상도')}: <span className="font-mono font-medium text-foreground">{roundTo64(customWidth)} × {roundTo64(customHeight)}</span>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="submit" onClick={handleCustomSave}>
                            {t('common.save')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
