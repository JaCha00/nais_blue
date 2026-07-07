import { ChangeEvent, useEffect, useMemo, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import {
    BarChart3,
    ChevronLeft,
    ChevronRight,
    Copy,
    Dice5,
    Dna,
    Download,
    FileImage,
    FlaskConical,
    ImagePlus,
    ListPlus,
    Lock,
    Play,
    RotateCcw,
    Search,
    Sparkles,
    Star,
    Swords,
    Trash2,
    Trophy,
    Unlock,
    Upload,
    X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/use-toast'
import { buildStyleLabPrompt, compactPrompt, extractArtistTagsFromText, formatWeightedPromptTags, normalizePromptTag, WeightedPromptTag } from '@/lib/style-lab'
import { parseMetadataFromFile } from '@/lib/metadata-parser'
import { cn } from '@/lib/utils'
import { generateStyleLabPreviews } from '@/services/style-lab-generation'
import { useGenerationStore } from '@/stores/generation-store'
import { StyleCombination, StyleLabLeague, useStyleLabStore } from '@/stores/style-lab-store'

interface AnalysisRow {
    artist: string
    count: number
    avgWeight: number
    maxWeight: number
    sources: string[]
}

const COMBINATIONS_PER_PAGE = 50

interface CombinationCardProps {
    combo: StyleCombination
    rank?: number
    compact?: boolean
    showNote?: boolean
    chooseLabel?: string
    promptText: string
    onChoose?: () => void
    onGenerate: () => void
    onApplyToPrompt: () => void
    onRemove: () => void
    onToggleFavorite: () => void
    onToggleLock: () => void
    onUpdateNote: (note: string) => void
}

function getPreviewSource(combo: StyleCombination): string | null {
    if (combo.previewImage) return combo.previewImage
    if (combo.previewPath && !combo.previewPath.startsWith('memory://')) return convertFileSrc(combo.previewPath)
    if (combo.previewThumbnail) return combo.previewThumbnail
    return null
}

function isTemporaryPreview(combo: StyleCombination): boolean {
    return Boolean(combo.previewPath?.startsWith('memory://') || (combo.previewThumbnail && !combo.previewPath))
}

function winRate(combo: StyleCombination): string {
    if (combo.battles === 0) return '0%'
    return `${Math.round((combo.wins / combo.battles) * 100)}%`
}

async function copyToClipboard(text: string, label: string) {
    await navigator.clipboard.writeText(text)
    toast({ title: label, variant: 'success' })
}

function downloadText(filename: string, text: string) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
}

function getCombinationSearchText(combo: StyleCombination): string {
    const tagParts = combo.tags.flatMap(rawTag => {
        const tag = normalizePromptTag(rawTag)
        const formatted = formatWeightedPromptTags([tag])
        return [tag.tag, tag.kind, `${tag.kind}:${tag.tag}`, formatted]
    })

    return [
        combo.note,
        combo.previewPrompt,
        combo.previewSeed?.toString(),
        combo.generation.toString(),
        ...tagParts,
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
}

function CombinationCard({
    combo,
    rank,
    compact,
    showNote,
    chooseLabel,
    promptText,
    onChoose,
    onGenerate,
    onApplyToPrompt,
    onRemove,
    onToggleFavorite,
    onToggleLock,
    onUpdateNote,
}: CombinationCardProps) {
    const { t } = useTranslation()
    const tagText = formatWeightedPromptTags(combo.tags)
    const previewSource = getPreviewSource(combo)
    const temporaryPreview = isTemporaryPreview(combo)

    return (
        <Card className={cn('min-w-0 overflow-hidden border-border/60 bg-card/70', combo.favorite && 'border-yellow-500/50', combo.locked && 'ring-1 ring-primary/30')}>
            <div className={cn('relative bg-muted/30', compact ? 'aspect-[4/3]' : 'aspect-video')}>
                {previewSource ? (
                    <img src={previewSource} alt={t('styleLab.card.previewAlt')} className="h-full w-full object-cover" />
                ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
                        <FlaskConical className="h-8 w-8" />
                        <span className="text-xs">{t('styleLab.card.noPreview')}</span>
                    </div>
                )}
                {combo.isPreviewing && (
                    <div className="absolute inset-x-3 bottom-3 rounded-full bg-black/50 p-1 backdrop-blur-sm">
                        <div className="h-1.5 rounded-full bg-primary transition-all" style={{ width: `${Math.round((combo.previewProgress || 0) * 100)}%` }} />
                    </div>
                )}
                <div className="absolute left-2 top-2 flex gap-1">
                    {rank !== undefined && <Badge variant="secondary">#{rank}</Badge>}
                    <Badge variant="outline" className="bg-background/80 backdrop-blur-sm">{t('styleLab.common.generationShort')} {combo.generation}</Badge>
                </div>
                <div className="absolute right-2 top-2 flex gap-1">
                    {temporaryPreview && <Badge variant="secondary" className="bg-background/80 backdrop-blur-sm">{t('styleLab.card.temporaryPreview')}</Badge>}
                    {combo.favorite && <Badge className="bg-yellow-500 text-black">★</Badge>}
                    {combo.locked && <Badge variant="secondary">{t('styleLab.card.locked')}</Badge>}
                </div>
            </div>
            <CardContent className="min-w-0 space-y-3 p-3">
                <div className="grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4">
                    <div className="min-w-0 rounded-lg bg-muted/50 p-2">
                        <div className="text-muted-foreground">{t('styleLab.metrics.elo')}</div>
                        <div className="font-semibold text-foreground">{combo.elo}</div>
                    </div>
                    <div className="min-w-0 rounded-lg bg-muted/50 p-2">
                        <div className="text-muted-foreground">{t('styleLab.metrics.winRate')}</div>
                        <div className="font-semibold text-foreground">{winRate(combo)}</div>
                    </div>
                    <div className="min-w-0 rounded-lg bg-muted/50 p-2">
                        <div className="text-muted-foreground">{t('styleLab.metrics.record')}</div>
                        <div className="font-semibold text-foreground">{combo.wins}-{combo.losses}</div>
                    </div>
                    <div className="min-w-0 rounded-lg bg-muted/50 p-2">
                        <div className="text-muted-foreground">{t('styleLab.metrics.tags')}</div>
                        <div className="font-semibold text-foreground">{combo.tags.length}</div>
                    </div>
                </div>

                <Textarea
                    value={tagText}
                    readOnly
                    className={cn('min-w-0 font-mono text-xs leading-5', compact ? 'h-24' : 'h-28')}
                    data-allow-context-menu
                />

                {combo.previewError && (
                    <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{combo.previewError}</p>
                )}

                {showNote && (
                    <Textarea
                        value={combo.note}
                        onChange={(event) => onUpdateNote(event.target.value)}
                        placeholder={t('styleLab.card.notePlaceholder')}
                        className="h-20 min-w-0 text-xs leading-5"
                    />
                )}

                <div className="grid gap-2 sm:grid-cols-3">
                    <Button size="sm" variant="outline" className="h-auto min-h-8 min-w-0 rounded-xl px-2 py-1 text-xs leading-tight whitespace-normal" onClick={() => copyToClipboard(tagText, t('styleLab.toast.copiedTags'))}>
                        <Copy className="mr-1 h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 truncate">{t('styleLab.actions.copyTags')}</span>
                    </Button>
                    <Button size="sm" variant="outline" className="h-auto min-h-8 min-w-0 rounded-xl px-2 py-1 text-xs leading-tight whitespace-normal" onClick={() => copyToClipboard(promptText, t('styleLab.toast.copiedPrompt'))}>
                        <Copy className="mr-1 h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 truncate">{t('styleLab.actions.copyPrompt')}</span>
                    </Button>
                    <Button size="sm" variant="outline" className="h-auto min-h-8 min-w-0 rounded-xl px-2 py-1 text-xs leading-tight whitespace-normal" onClick={onApplyToPrompt}>
                        <Sparkles className="mr-1 h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 truncate">{t('styleLab.actions.applyToPrompt')}</span>
                    </Button>
                </div>

                <div className="flex flex-wrap gap-2">
                    {onChoose && chooseLabel && (
                        <Button size="sm" className="min-w-[160px] flex-1 rounded-xl whitespace-normal" onClick={onChoose}>
                            <Trophy className="mr-1.5 h-3.5 w-3.5" />
                            {chooseLabel}
                        </Button>
                    )}
                    <Button size="sm" variant="outline" className="rounded-xl" onClick={onGenerate} disabled={combo.isPreviewing}>
                        <ImagePlus className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant={combo.favorite ? 'default' : 'outline'} className="rounded-xl" onClick={onToggleFavorite}>
                        <Star className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant={combo.locked ? 'default' : 'outline'} className="rounded-xl" onClick={onToggleLock}>
                        {combo.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                    </Button>
                    <Button size="sm" variant="outline" className="rounded-xl text-destructive hover:text-destructive" onClick={onRemove} disabled={combo.locked}>
                        <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                </div>
            </CardContent>
        </Card>
    )
}

export default function StyleLab() {
    const { t } = useTranslation()
    const {
        artists,
        combinations,
        evolutionLogs,
        settings,
        activeBattlePair,
        isPreviewQueueRunning,
        previewQueueTotal,
        previewQueueDone,
        addArtists,
        removeArtist,
        resetArtistsToDefault,
        resetLabData,
        updateSettings,
        generateRandomCombinations,
        addCombinationFromTags,
        removeCombination,
        toggleFavorite,
        toggleLock,
        updateNote,
        pickBattlePair,
        setBattleLeague,
        recordBattle,
        evolve,
        cleanup,
    } = useStyleLabStore()

    const basePrompt = useGenerationStore(state => state.basePrompt)
    const additionalPrompt = useGenerationStore(state => state.additionalPrompt)
    const detailPrompt = useGenerationStore(state => state.detailPrompt)
    const inpaintingPrompt = useGenerationStore(state => state.inpaintingPrompt)
    const i2iMode = useGenerationStore(state => state.i2iMode)
    const setAdditionalPrompt = useGenerationStore(state => state.setAdditionalPrompt)
    const cancelGeneration = useGenerationStore(state => state.cancelGeneration)
    const isStyleLabCancelling = useGenerationStore(state => state.generatingMode === 'styleLab' && state.isCancelled)

    const [artistInput, setArtistInput] = useState('')
    const [randomCount, setRandomCount] = useState(settings.randomBatchCount)
    const [cleanupMinBattles, setCleanupMinBattles] = useState(3)
    const [cleanupEloBelow, setCleanupEloBelow] = useState(1120)
    const [analysisRows, setAnalysisRows] = useState<AnalysisRow[]>([])
    const [isAnalyzing, setIsAnalyzing] = useState(false)
    const [combinationSearch, setCombinationSearch] = useState('')
    const [combinationPage, setCombinationPage] = useState(1)

    const sortedCombinations = useMemo(
        () => [...combinations].sort((a, b) => b.elo - a.elo || b.battles - a.battles || b.updatedAt - a.updatedAt),
        [combinations],
    )

    const normalizedCombinationSearch = combinationSearch.trim().toLowerCase()
    const combinationSearchTerms = useMemo(
        () => normalizedCombinationSearch.split(/\s+/).filter(Boolean),
        [normalizedCombinationSearch],
    )
    const filteredCombinations = useMemo(() => {
        if (combinationSearchTerms.length === 0) return sortedCombinations
        return sortedCombinations.filter(combo => {
            const haystack = getCombinationSearchText(combo)
            return combinationSearchTerms.every(term => haystack.includes(term))
        })
    }, [combinationSearchTerms, sortedCombinations])
    const combinationPageCount = Math.max(1, Math.ceil(filteredCombinations.length / COMBINATIONS_PER_PAGE))
    const visibleCombinationPage = Math.min(Math.max(combinationPage, 1), combinationPageCount)
    const combinationPageStart = (visibleCombinationPage - 1) * COMBINATIONS_PER_PAGE
    const pagedCombinations = useMemo(
        () => filteredCombinations.slice(combinationPageStart, combinationPageStart + COMBINATIONS_PER_PAGE),
        [combinationPageStart, filteredCombinations],
    )

    useEffect(() => {
        setCombinationPage(1)
    }, [normalizedCombinationSearch])

    useEffect(() => {
        setCombinationPage(page => Math.min(Math.max(page, 1), combinationPageCount))
    }, [combinationPageCount])

    const battlePair = useMemo(() => {
        if (!activeBattlePair) return null
        const left = combinations.find(combo => combo.id === activeBattlePair[0])
        const right = combinations.find(combo => combo.id === activeBattlePair[1])
        return left && right ? { left, right } : null
    }, [activeBattlePair, combinations])

    const battlePoolCount = useMemo(
        () => combinations.filter(combo => settings.battleLeague === 'all' || combo.favorite).length,
        [combinations, settings.battleLeague],
    )

    const stats = useMemo(() => {
        const favorites = combinations.filter(combo => combo.favorite).length
        const locked = combinations.filter(combo => combo.locked).length
        const best = sortedCombinations[0]
        const avgElo = combinations.length
            ? Math.round(combinations.reduce((sum, combo) => sum + combo.elo, 0) / combinations.length)
            : 0
        const artistMap = new Map<string, { artist: string; count: number; weightSum: number }>()
        const generationMap = new Map<number, number>()

        for (const combo of combinations) {
            generationMap.set(combo.generation, (generationMap.get(combo.generation) || 0) + 1)
            for (const rawTag of combo.tags) {
                const tag = normalizePromptTag(rawTag)
                if (tag.kind !== 'artist') continue
                const key = tag.tag.toLowerCase()
                const current = artistMap.get(key) || { artist: tag.tag, count: 0, weightSum: 0 }
                current.count += 1
                current.weightSum += tag.weight
                artistMap.set(key, current)
            }
        }

        return {
            favorites,
            locked,
            best,
            avgElo,
            artists: [...artistMap.values()].sort((a, b) => b.count - a.count).slice(0, 12),
            generations: [...generationMap.entries()].sort((a, b) => a[0] - b[0]),
        }
    }, [combinations, sortedCombinations])

    const templatePreview = useMemo(() => {
        const sampleTags = sortedCombinations[0]
            ? formatWeightedPromptTags(sortedCombinations[0].tags)
            : '1.5::artist:shnva ::, 1.3::artist:necomi ::'
        return buildStyleLabPrompt(settings.promptTemplate, sampleTags, {
            basePrompt,
            additionalPrompt,
            detailPrompt,
            inpaintingPrompt: i2iMode === 'inpaint' ? inpaintingPrompt : '',
        })
    }, [additionalPrompt, basePrompt, detailPrompt, i2iMode, inpaintingPrompt, settings.promptTemplate, sortedCombinations])

    const handleAddArtists = () => {
        const added = addArtists(artistInput)
        if (added === 0) {
            toast({ title: t('styleLab.toast.noNewArtists'), variant: 'destructive' })
            return
        }
        setArtistInput('')
        toast({ title: t('styleLab.toast.artistsAdded', { count: added }), variant: 'success' })
    }

    const handleGenerateRandom = () => {
        updateSettings({ randomBatchCount: randomCount })
        const created = generateRandomCombinations(randomCount)
        toast({
            title: created > 0
                ? t('styleLab.toast.randomCreated', { count: created })
                : t('styleLab.toast.randomFailed'),
            description: created === 0 ? t('styleLab.toast.randomFailedDesc') : undefined,
            variant: created > 0 ? 'success' : 'destructive',
        })
    }

    const previewBattlePairIfEnabled = (pair: [string, string] | null) => {
        if (pair && settings.autoPreviewBattlePair) {
            void generateStyleLabPreviews(pair)
        }
    }

    const handlePickBattle = () => {
        const pair = pickBattlePair()
        if (!pair) {
            toast({
                title: t('styleLab.toast.notEnoughArenaCandidates'),
                description: t('styleLab.toast.notEnoughArenaCandidatesDesc'),
                variant: 'destructive',
            })
            return
        }
        previewBattlePairIfEnabled(pair)
    }

    const handleBattleChoice = (winnerId: string, loserId: string) => {
        recordBattle(winnerId, loserId)
        const next = pickBattlePair()
        if (!next) {
            toast({ title: t('styleLab.toast.notEnoughArenaCandidates'), variant: 'destructive' })
            return
        }
        previewBattlePairIfEnabled(next)
    }

    const handleEvolve = () => {
        const childIds = evolve()
        if (childIds.length === 0) {
            toast({
                title: t('styleLab.toast.notEnoughParents'),
                description: t('styleLab.toast.notEnoughParentsDesc'),
                variant: 'destructive',
            })
            return
        }
        toast({ title: t('styleLab.toast.childrenCreated', { count: childIds.length }), variant: 'success' })
    }

    const handleCleanup = () => {
        const removed = cleanup(cleanupMinBattles, cleanupEloBelow)
        toast({
            title: removed > 0
                ? t('styleLab.toast.cleaned', { count: removed })
                : t('styleLab.toast.nothingToClean'),
            variant: removed > 0 ? 'success' : 'default',
        })
    }

    const handleAnalyzePng = async (event: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files || [])
        if (files.length === 0) return
        setIsAnalyzing(true)

        try {
            const aggregate = new Map<string, { artist: string; count: number; weightSum: number; maxWeight: number; sources: Set<string> }>()

            for (const file of files) {
                const metadata = await parseMetadataFromFile(file)
                const prompts = [
                    metadata?.v4_prompt?.caption?.base_caption,
                    metadata?.prompt,
                    metadata?.promptParts?.base,
                    metadata?.promptParts?.additional,
                    metadata?.promptParts?.detail,
                ].filter((value): value is string => Boolean(value && value.trim()))
                const tags = extractArtistTagsFromText(prompts.join(', '))

                for (const rawTag of tags) {
                    const tag = normalizePromptTag(rawTag)
                    const key = tag.tag.toLowerCase()
                    const current = aggregate.get(key) || {
                        artist: tag.tag,
                        count: 0,
                        weightSum: 0,
                        maxWeight: 0,
                        sources: new Set<string>(),
                    }
                    current.count += 1
                    current.weightSum += tag.weight
                    current.maxWeight = Math.max(current.maxWeight, tag.weight)
                    current.sources.add(file.name)
                    aggregate.set(key, current)
                }
            }

            const rows: AnalysisRow[] = [...aggregate.values()]
                .map(row => ({
                    artist: row.artist,
                    count: row.count,
                    avgWeight: Math.round((row.weightSum / row.count) * 10) / 10,
                    maxWeight: Math.round(row.maxWeight * 10) / 10,
                    sources: [...row.sources],
                }))
                .sort((a, b) => b.count - a.count || b.avgWeight - a.avgWeight)

            setAnalysisRows(rows)
            toast({
                title: rows.length > 0
                    ? t('styleLab.toast.artistTagsFound', { count: rows.length })
                    : t('styleLab.toast.noArtistTagsFound'),
                variant: rows.length > 0 ? 'success' : 'destructive',
            })
        } catch (error) {
            toast({ title: t('styleLab.toast.pngAnalyzeFailed'), description: String(error), variant: 'destructive' })
        } finally {
            setIsAnalyzing(false)
            event.target.value = ''
        }
    }

    const handleAddAnalysisArtists = () => {
        const added = addArtists(analysisRows.map(row => row.artist).join('\n'))
        toast({ title: t('styleLab.toast.analysisArtistsAdded', { count: added }), variant: added > 0 ? 'success' : 'default' })
    }

    const handleAddAnalysisCombination = () => {
        const tags: WeightedPromptTag[] = analysisRows.slice(0, settings.maxTags).map(row => ({
            tag: row.artist,
            kind: 'artist',
            weight: row.avgWeight,
            artist: row.artist,
        }))
        const id = addCombinationFromTags(tags)
        toast({
            title: id
                ? t('styleLab.toast.analysisCombinationAdded')
                : t('styleLab.toast.analysisCombinationSkipped'),
            variant: id ? 'success' : 'destructive',
        })
    }

    const handleExport = () => {
        const body = sortedCombinations.map((combo, index) => {
            const header = `#${index + 1} | Elo ${combo.elo} | ${combo.wins}-${combo.losses} | Gen ${combo.generation}${combo.favorite ? ' | Favorite' : ''}${combo.locked ? ' | Locked' : ''}`
            const note = combo.note.trim() ? `\n${t('styleLab.card.notePlaceholder')}: ${combo.note.trim()}` : ''
            return `${header}\n${formatWeightedPromptTags(combo.tags)}${note}`
        }).join('\n\n---\n\n')
        downloadText(`NAIS_style_lab_${Date.now()}.txt`, body || t('styleLab.empty.noSavedCombinations'))
    }

    const buildCombinationPrompt = (combo: StyleCombination) => buildStyleLabPrompt(
        settings.promptTemplate,
        formatWeightedPromptTags(combo.tags),
        {
            basePrompt,
            additionalPrompt,
            detailPrompt,
            inpaintingPrompt: i2iMode === 'inpaint' ? inpaintingPrompt : '',
        },
    )

    const applyCombinationToPrompt = (combo: StyleCombination) => {
        const tagText = formatWeightedPromptTags(combo.tags)
        setAdditionalPrompt(compactPrompt(additionalPrompt.trim() ? `${additionalPrompt}, ${tagText}` : tagText))
        toast({ title: t('styleLab.toast.appliedToPrompt'), variant: 'success' })
    }

    const renderCombinationCard = (combo: StyleCombination, rank?: number, compact?: boolean, showNote?: boolean) => (
        <CombinationCard
            key={combo.id}
            combo={combo}
            rank={rank}
            compact={compact}
            showNote={showNote}
            promptText={buildCombinationPrompt(combo)}
            onGenerate={() => generateStyleLabPreviews([combo.id])}
            onApplyToPrompt={() => applyCombinationToPrompt(combo)}
            onRemove={() => removeCombination(combo.id)}
            onToggleFavorite={() => toggleFavorite(combo.id)}
            onToggleLock={() => toggleLock(combo.id)}
            onUpdateNote={(note) => updateNote(combo.id, note)}
        />
    )

    const latestGeneration = Math.max(0, ...combinations.map(combo => combo.generation))
    const latestGenerationIds = combinations.filter(combo => combo.generation === latestGeneration).map(combo => combo.id)

    return (
        <div className="min-w-0 space-y-4 pb-8">
            <Card className="min-w-0 border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card">
                <CardHeader className="pb-4">
                    <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0">
                            <CardTitle className="flex min-w-0 items-center gap-2 text-xl leading-tight sm:text-2xl">
                                <FlaskConical className="h-6 w-6 text-primary" />
                                <span className="min-w-0 truncate">{t('styleLab.title')}</span>
                            </CardTitle>
                            <CardDescription className="mt-2 text-sm leading-5">
                                {t('styleLab.description')}
                            </CardDescription>
                        </div>
                        <div className="grid w-full grid-cols-1 gap-2 text-center text-sm sm:min-w-[360px] sm:grid-cols-3 lg:w-auto">
                            <div className="min-w-0 rounded-xl bg-background/60 p-3">
                                <div className="text-muted-foreground">{t('styleLab.metrics.combinations')}</div>
                                <div className="text-xl font-bold">{combinations.length}</div>
                            </div>
                            <div className="min-w-0 rounded-xl bg-background/60 p-3">
                                <div className="text-muted-foreground">{t('styleLab.metrics.favorites')}</div>
                                <div className="text-xl font-bold">{stats.favorites}</div>
                            </div>
                            <div className="min-w-0 rounded-xl bg-background/60 p-3">
                                <div className="text-muted-foreground">{t('styleLab.metrics.averageElo')}</div>
                                <div className="text-xl font-bold">{stats.avgElo}</div>
                            </div>
                        </div>
                    </div>
                    {isPreviewQueueRunning && (
                        <div className="mt-4 rounded-xl border border-primary/20 bg-background/60 p-3">
                            <div className="mb-2 flex items-center justify-between text-sm">
                                <span className="flex items-center gap-2"><Play className="h-4 w-4" />{t('styleLab.preview.queueRunning')}</span>
                                <div className="flex items-center gap-2">
                                    <span>{previewQueueDone}/{previewQueueTotal}</span>
                                    <Button size="sm" variant="destructive" className="rounded-xl" onClick={cancelGeneration} disabled={isStyleLabCancelling}>
                                        <X className="mr-1 h-3.5 w-3.5" />
                                        {isStyleLabCancelling ? t('styleLab.preview.cancelling') : t('styleLab.preview.stop')}
                                    </Button>
                                </div>
                            </div>
                            <div className="h-2 rounded-full bg-muted overflow-hidden">
                                <div className="h-full bg-primary transition-all" style={{ width: `${previewQueueTotal ? (previewQueueDone / previewQueueTotal) * 100 : 0}%` }} />
                            </div>
                        </div>
                    )}
                </CardHeader>
            </Card>

            <Tabs defaultValue="battle" className="min-w-0 space-y-4">
                <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1 sm:flex sm:w-auto sm:flex-wrap sm:justify-start">
                    <TabsTrigger value="battle" className="min-w-0 gap-1 px-2 text-xs sm:flex-none sm:text-sm"><Swords className="h-4 w-4 shrink-0" /><span className="min-w-0 truncate">{t('styleLab.tabs.arena')}</span></TabsTrigger>
                    <TabsTrigger value="manage" className="min-w-0 gap-1 px-2 text-xs sm:flex-none sm:text-sm"><ListPlus className="h-4 w-4 shrink-0" /><span className="min-w-0 truncate">{t('styleLab.tabs.manage')}</span></TabsTrigger>
                    <TabsTrigger value="evolve" className="min-w-0 gap-1 px-2 text-xs sm:flex-none sm:text-sm"><Dna className="h-4 w-4 shrink-0" /><span className="min-w-0 truncate">{t('styleLab.tabs.evolve')}</span></TabsTrigger>
                    <TabsTrigger value="analyze" className="min-w-0 gap-1 px-2 text-xs sm:flex-none sm:text-sm"><FileImage className="h-4 w-4 shrink-0" /><span className="min-w-0 truncate">{t('styleLab.tabs.analyze')}</span></TabsTrigger>
                    <TabsTrigger value="stats" className="min-w-0 gap-1 px-2 text-xs sm:flex-none sm:text-sm"><BarChart3 className="h-4 w-4 shrink-0" /><span className="min-w-0 truncate">{t('styleLab.tabs.stats')}</span></TabsTrigger>
                    <TabsTrigger value="settings" className="min-w-0 gap-1 px-2 text-xs sm:flex-none sm:text-sm"><Sparkles className="h-4 w-4 shrink-0" /><span className="min-w-0 truncate">{t('styleLab.tabs.template')}</span></TabsTrigger>
                </TabsList>

                <TabsContent value="battle" className="min-w-0 space-y-4">
                    <Card className="min-w-0">
                        <CardContent className="flex min-w-0 flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
                            <div className="min-w-0 space-y-1">
                                <h3 className="font-semibold">{t('styleLab.arena.title')}</h3>
                                <p className="text-sm text-muted-foreground">{t('styleLab.arena.description', { count: battlePoolCount })}</p>
                            </div>
                            <div className="flex min-w-0 flex-wrap gap-2">
                                {(['all', 'favorites'] as StyleLabLeague[]).map(league => (
                                    <Button
                                        key={league}
                                        variant={settings.battleLeague === league ? 'default' : 'outline'}
                                        className="min-w-[120px] rounded-xl whitespace-normal"
                                        onClick={() => setBattleLeague(league)}
                                    >
                                        {league === 'all' ? t('styleLab.arena.allLeague') : t('styleLab.arena.favoritesLeague')}
                                    </Button>
                                ))}
                                <Button className="min-w-[140px] rounded-xl whitespace-normal" onClick={handlePickBattle}>
                                    <Dice5 className="mr-1.5 h-4 w-4" />{t('styleLab.arena.pickBattle')}
                                </Button>
                                {battlePair && (
                                    <Button
                                        variant="outline"
                                        className="min-w-[140px] rounded-xl whitespace-normal"
                                        onClick={() => generateStyleLabPreviews([battlePair.left.id, battlePair.right.id])}
                                        disabled={isPreviewQueueRunning}
                                    >
                                        <ImagePlus className="mr-1.5 h-4 w-4" />{t('styleLab.arena.previewPair')}
                                    </Button>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    {battlePair ? (
                        <div className="grid min-w-0 gap-4 xl:grid-cols-2">
                            <CombinationCard
                                combo={battlePair.left}
                                chooseLabel={t('styleLab.arena.chooseLeft')}
                                promptText={buildCombinationPrompt(battlePair.left)}
                                onChoose={() => handleBattleChoice(battlePair.left.id, battlePair.right.id)}
                                onGenerate={() => generateStyleLabPreviews([battlePair.left.id])}
                                onApplyToPrompt={() => applyCombinationToPrompt(battlePair.left)}
                                onRemove={() => removeCombination(battlePair.left.id)}
                                onToggleFavorite={() => toggleFavorite(battlePair.left.id)}
                                onToggleLock={() => toggleLock(battlePair.left.id)}
                                onUpdateNote={(note) => updateNote(battlePair.left.id, note)}
                            />
                            <CombinationCard
                                combo={battlePair.right}
                                chooseLabel={t('styleLab.arena.chooseRight')}
                                promptText={buildCombinationPrompt(battlePair.right)}
                                onChoose={() => handleBattleChoice(battlePair.right.id, battlePair.left.id)}
                                onGenerate={() => generateStyleLabPreviews([battlePair.right.id])}
                                onApplyToPrompt={() => applyCombinationToPrompt(battlePair.right)}
                                onRemove={() => removeCombination(battlePair.right.id)}
                                onToggleFavorite={() => toggleFavorite(battlePair.right.id)}
                                onToggleLock={() => toggleLock(battlePair.right.id)}
                                onUpdateNote={(note) => updateNote(battlePair.right.id, note)}
                            />
                        </div>
                    ) : (
                        <Card className="border-dashed">
                            <CardContent className="flex flex-col items-center justify-center gap-3 p-12 text-center text-muted-foreground">
                                <Swords className="h-10 w-10" />
                                <div>
                                    <p className="font-medium text-foreground">{t('styleLab.arena.emptyTitle')}</p>
                                    <p className="text-sm">{t('styleLab.arena.emptyDesc')}</p>
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </TabsContent>

                <TabsContent value="manage" className="grid min-w-0 gap-4 xl:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]">
                    <div className="min-w-0 space-y-4">
                        <Card className="min-w-0">
                            <CardHeader>
                                <CardTitle className="text-lg">{t('styleLab.manage.artistListTitle')}</CardTitle>
                                <CardDescription>{t('styleLab.manage.artistListDesc')}</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <Textarea
                                    value={artistInput}
                                    onChange={(event) => setArtistInput(event.target.value)}
                                    placeholder="shnva&#10;necomi&#10;momoko (momopoco)"
                                    className="min-h-36 text-sm leading-5"
                                    data-allow-context-menu
                                />
                                <div className="grid grid-cols-1 gap-2 min-[420px]:flex min-[420px]:flex-wrap">
                                    <Button className="rounded-xl whitespace-normal" onClick={handleAddArtists}><ListPlus className="mr-1.5 h-4 w-4 shrink-0" />{t('styleLab.actions.add')}</Button>
                                    <Button variant="outline" className="rounded-xl whitespace-normal" onClick={resetArtistsToDefault}><RotateCcw className="mr-1.5 h-4 w-4 shrink-0" />{t('styleLab.actions.defaultList')}</Button>
                                    <Button variant="outline" className="rounded-xl text-destructive whitespace-normal hover:text-destructive" onClick={resetLabData}><Trash2 className="mr-1.5 h-4 w-4 shrink-0" />{t('styleLab.actions.resetAll')}</Button>
                                </div>
                                <div className="max-h-64 overflow-y-auto rounded-xl border bg-muted/20 p-2">
                                    <div className="mb-2 text-xs text-muted-foreground">{t('styleLab.manage.registeredArtists', { count: artists.length })}</div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {artists.map(artist => (
                                            <Badge key={artist} variant="secondary" className="gap-1 pr-1">
                                                {artist}
                                                <button className="rounded-full p-0.5 hover:bg-background/70" onClick={() => removeArtist(artist)}>
                                                    ×
                                                </button>
                                            </Badge>
                                        ))}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="min-w-0">
                            <CardHeader>
                                <CardTitle className="text-lg">{t('styleLab.manage.randomTitle')}</CardTitle>
                                <CardDescription>{t('styleLab.manage.randomDesc', {
                                    min: settings.minTags,
                                    max: settings.maxTags,
                                    minWeight: settings.minWeight.toFixed(1),
                                    maxWeight: settings.maxWeight.toFixed(1),
                                })}</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <div className="space-y-2">
                                    <Label>{t('styleLab.manage.randomCount')}</Label>
                                    <Input type="number" min={1} max={100} value={randomCount} onChange={(event) => setRandomCount(Number(event.target.value))} />
                                </div>
                                <Button className="w-full rounded-xl" onClick={handleGenerateRandom}>
                                    <Dice5 className="mr-1.5 h-4 w-4" />{t('styleLab.manage.generateRandom')}
                                </Button>
                            </CardContent>
                        </Card>
                    </div>

                    <Card className="min-w-0">
                        <CardHeader className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div className="min-w-0">
                                <CardTitle className="text-lg">{t('styleLab.manage.combinationsTitle')}</CardTitle>
                                <CardDescription>{t('styleLab.manage.combinationsDesc')}</CardDescription>
                            </div>
                            <div className="grid grid-cols-1 gap-2 min-[420px]:flex min-[420px]:flex-wrap">
                                <Button variant="outline" className="rounded-xl whitespace-normal" onClick={() => generateStyleLabPreviews(filteredCombinations.slice(0, 6).map(combo => combo.id))} disabled={isPreviewQueueRunning || filteredCombinations.length === 0}>
                                    <ImagePlus className="mr-1.5 h-4 w-4 shrink-0" />{t('styleLab.actions.previewTopSix')}
                                </Button>
                                <Button variant="outline" className="rounded-xl whitespace-normal" onClick={handleExport}>
                                    <Download className="mr-1.5 h-4 w-4 shrink-0" />{t('styleLab.actions.exportTxt')}
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent className="min-w-0 space-y-4">
                            <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                                <div className="min-w-0 space-y-2 lg:max-w-md lg:flex-1">
                                    <Label htmlFor="stylelab-combination-search">{t('styleLab.manage.searchLabel')}</Label>
                                    <div className="relative">
                                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                        <Input
                                            id="stylelab-combination-search"
                                            value={combinationSearch}
                                            onChange={(event) => setCombinationSearch(event.target.value)}
                                            placeholder={t('styleLab.manage.searchPlaceholder')}
                                            className="min-w-0 pl-9"
                                        />
                                    </div>
                                </div>
                                <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
                                    <span className="min-w-0 break-words">{t('styleLab.manage.searchSummary', {
                                        shown: pagedCombinations.length,
                                        filtered: filteredCombinations.length,
                                        total: sortedCombinations.length,
                                    })}</span>
                                    {combinationSearch.trim() && (
                                        <Button type="button" variant="ghost" size="sm" className="rounded-xl" onClick={() => setCombinationSearch('')}>
                                            <X className="mr-1.5 h-4 w-4" />{t('styleLab.manage.clearSearch')}
                                        </Button>
                                    )}
                                </div>
                            </div>

                            {sortedCombinations.length > 0 ? (
                                filteredCombinations.length > 0 ? (
                                    <>
                                        <div className="grid min-w-0 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                                            {pagedCombinations.map((combo, index) => renderCombinationCard(combo, combinationPageStart + index + 1, true, true))}
                                        </div>
                                        {combinationPageCount > 1 && (
                                            <div className="flex flex-col gap-3 border-t pt-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                                                <span>{t('styleLab.manage.pageSummary', {
                                                    page: visibleCombinationPage,
                                                    pages: combinationPageCount,
                                                    perPage: COMBINATIONS_PER_PAGE,
                                                })}</span>
                                                <div className="flex gap-2">
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        className="rounded-xl"
                                                        disabled={visibleCombinationPage <= 1}
                                                        onClick={() => setCombinationPage(page => Math.max(1, page - 1))}
                                                    >
                                                        <ChevronLeft className="mr-1.5 h-4 w-4" />{t('styleLab.manage.prevPage')}
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        className="rounded-xl"
                                                        disabled={visibleCombinationPage >= combinationPageCount}
                                                        onClick={() => setCombinationPage(page => Math.min(combinationPageCount, page + 1))}
                                                    >
                                                        {t('styleLab.manage.nextPage')}<ChevronRight className="ml-1.5 h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">{t('styleLab.manage.noMatchingCombinations')}</div>
                                )
                            ) : (
                                <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">{t('styleLab.empty.noCombinations')}</div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="evolve" className="min-w-0 space-y-4">
                    <Card className="min-w-0">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-lg"><Dna className="h-5 w-5" />{t('styleLab.evolve.title')}</CardTitle>
                            <CardDescription>{t('styleLab.evolve.description')}</CardDescription>
                        </CardHeader>
                        <CardContent className="grid min-w-0 gap-4 lg:grid-cols-4">
                            <div className="space-y-2">
                                <Label>{t('styleLab.evolve.parentCount')}</Label>
                                <Input type="number" min={2} max={50} value={settings.evolutionParentCount} onChange={(event) => updateSettings({ evolutionParentCount: Number(event.target.value) })} />
                            </div>
                            <div className="space-y-2">
                                <Label>{t('styleLab.evolve.childCount')}</Label>
                                <Input type="number" min={1} max={100} value={settings.evolutionChildrenCount} onChange={(event) => updateSettings({ evolutionChildrenCount: Number(event.target.value) })} />
                            </div>
                            <div className="space-y-2">
                                <Label>{t('styleLab.evolve.mutationRate')}</Label>
                                <Input type="number" min={0} max={1} step={0.01} value={settings.mutationRate} onChange={(event) => updateSettings({ mutationRate: Number(event.target.value) })} />
                            </div>
                            <div className="flex min-w-0 items-end gap-2">
                                <Button className="min-w-0 flex-1 rounded-xl whitespace-normal" onClick={handleEvolve}><Dna className="mr-1.5 h-4 w-4 shrink-0" />{t('styleLab.evolve.run')}</Button>
                                <Button variant="outline" className="rounded-xl" onClick={() => generateStyleLabPreviews(latestGenerationIds)} disabled={latestGenerationIds.length === 0 || isPreviewQueueRunning}>
                                    <ImagePlus className="h-4 w-4" />
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                        <Card className="min-w-0">
                            <CardHeader>
                                <CardTitle className="text-lg">{t('styleLab.evolve.latestGeneration', { generation: latestGeneration })}</CardTitle>
                                <CardDescription>{t('styleLab.common.combinationCount', { count: latestGenerationIds.length })}</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="grid min-w-0 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                                    {sortedCombinations.filter(combo => combo.generation === latestGeneration).map((combo, index) => renderCombinationCard(combo, index + 1, true, true))}
                                </div>
                            </CardContent>
                        </Card>
                        <Card className="min-w-0">
                            <CardHeader>
                                <CardTitle className="text-lg">{t('styleLab.evolve.history')}</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {evolutionLogs.length > 0 ? evolutionLogs.slice(0, 10).map(log => (
                                    <div key={log.id} className="rounded-xl border bg-muted/20 p-3 text-sm">
                                        <div className="font-semibold">{t('styleLab.common.generationShort')} {log.generation}</div>
                                        <div className="text-muted-foreground">{log.note || t('styleLab.evolve.historyNote', {
                                            parents: log.parentCount ?? log.parentIds.length,
                                            children: log.childCount ?? log.childIds.length,
                                        })}</div>
                                        <div className="mt-1 text-xs text-muted-foreground">{new Date(log.timestamp).toLocaleString()}</div>
                                    </div>
                                )) : <p className="text-sm text-muted-foreground">{t('styleLab.evolve.noHistory')}</p>}
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                <TabsContent value="analyze" className="min-w-0 space-y-4">
                    <Card className="min-w-0">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-lg"><FileImage className="h-5 w-5" />{t('styleLab.analyze.title')}</CardTitle>
                            <CardDescription>{t('styleLab.analyze.description')}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-1 gap-2 min-[420px]:flex min-[420px]:flex-wrap min-[420px]:items-center">
                                <Label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border px-4 py-2 text-center hover:bg-muted/50">
                                    <Upload className="h-4 w-4" />{t('styleLab.analyze.selectPng')}
                                    <input type="file" accept="image/png" multiple className="hidden" onChange={handleAnalyzePng} disabled={isAnalyzing} />
                                </Label>
                                <Button variant="outline" className="rounded-xl whitespace-normal" onClick={handleAddAnalysisArtists} disabled={analysisRows.length === 0}>{t('styleLab.analyze.addToArtists')}</Button>
                                <Button variant="outline" className="rounded-xl whitespace-normal" onClick={handleAddAnalysisCombination} disabled={analysisRows.length === 0}>{t('styleLab.analyze.addAsCombination')}</Button>
                            </div>

                            {analysisRows.length > 0 ? (
                                <div className="overflow-x-auto rounded-xl border">
                                    <table className="min-w-[640px] text-sm">
                                        <thead className="bg-muted/50 text-left">
                                            <tr>
                                                <th className="p-3">{t('styleLab.analyze.artist')}</th>
                                                <th className="p-3">{t('styleLab.analyze.frequency')}</th>
                                                <th className="p-3">{t('styleLab.analyze.avgWeight')}</th>
                                                <th className="p-3">{t('styleLab.analyze.maxWeight')}</th>
                                                <th className="p-3">{t('styleLab.analyze.source')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {analysisRows.map(row => (
                                                <tr key={row.artist} className="border-t">
                                                    <td className="p-3 font-medium">{row.artist}</td>
                                                    <td className="p-3">{row.count}</td>
                                                    <td className="p-3">{row.avgWeight.toFixed(1)}</td>
                                                    <td className="p-3">{row.maxWeight.toFixed(1)}</td>
                                                    <td className="p-3 text-xs text-muted-foreground">{row.sources.slice(0, 2).join(', ')}{row.sources.length > 2 ? t('styleLab.analyze.moreSources', { count: row.sources.length - 2 }) : ''}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">{t('styleLab.analyze.empty')}</div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="stats" className="min-w-0 space-y-4">
                    <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">{t('styleLab.stats.totalCombinations')}</div><div className="text-2xl font-bold">{combinations.length}</div></CardContent></Card>
                        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">{t('styleLab.metrics.favorites')}</div><div className="text-2xl font-bold">{stats.favorites}</div></CardContent></Card>
                        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">{t('styleLab.card.locked')}</div><div className="text-2xl font-bold">{stats.locked}</div></CardContent></Card>
                        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">{t('styleLab.stats.bestElo')}</div><div className="text-2xl font-bold">{stats.best?.elo ?? 0}</div></CardContent></Card>
                    </div>

                    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
                        <Card className="min-w-0">
                            <CardHeader><CardTitle className="text-lg">{t('styleLab.stats.artistUsage')}</CardTitle></CardHeader>
                            <CardContent className="space-y-2">
                                {stats.artists.map(row => (
                                    <div key={row.artist} className="flex min-w-0 flex-col gap-1 rounded-lg bg-muted/30 px-3 py-2 text-sm min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between">
                                        <span className="min-w-0 break-words">{row.artist}</span>
                                        <span className="text-muted-foreground">{t('styleLab.stats.artistUsageStat', { count: row.count, average: (row.weightSum / row.count).toFixed(1) })}</span>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                        <Card className="min-w-0">
                            <CardHeader><CardTitle className="text-lg">{t('styleLab.stats.generationDistribution')}</CardTitle></CardHeader>
                            <CardContent className="space-y-2">
                                {stats.generations.map(([generation, count]) => (
                                    <div key={generation} className="flex items-center gap-3 text-sm">
                                        <span className="w-16">{t('styleLab.common.generationShort')} {generation}</span>
                                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                                            <div className="h-full bg-primary" style={{ width: `${combinations.length ? (count / combinations.length) * 100 : 0}%` }} />
                                        </div>
                                        <span className="w-10 text-right text-muted-foreground">{count}</span>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    </div>

                    <Card className="min-w-0">
                        <CardHeader>
                            <CardTitle className="text-lg">{t('styleLab.cleanup.title')}</CardTitle>
                            <CardDescription>{t('styleLab.cleanup.description')}</CardDescription>
                        </CardHeader>
                        <CardContent className="grid min-w-0 gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
                            <div className="space-y-2">
                                <Label>{t('styleLab.cleanup.minBattles')}</Label>
                                <Input type="number" min={0} value={cleanupMinBattles} onChange={(event) => setCleanupMinBattles(Number(event.target.value))} />
                            </div>
                            <div className="space-y-2">
                                <Label>{t('styleLab.cleanup.eloBelow')}</Label>
                                <Input type="number" value={cleanupEloBelow} onChange={(event) => setCleanupEloBelow(Number(event.target.value))} />
                            </div>
                            <Button variant="outline" className="rounded-xl text-destructive whitespace-normal hover:text-destructive" onClick={handleCleanup}><Trash2 className="mr-1.5 h-4 w-4 shrink-0" />{t('styleLab.cleanup.run')}</Button>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="settings" className="min-w-0 space-y-4">
                    <Card className="min-w-0">
                        <CardHeader>
                            <CardTitle className="text-lg">{t('styleLab.settings.templateTitle')}</CardTitle>
                            <CardDescription>
                                {t('styleLab.settings.templateDesc')}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <Textarea
                                value={settings.promptTemplate}
                                onChange={(event) => updateSettings({ promptTemplate: event.target.value })}
                                className="min-h-36 font-mono text-xs leading-5 sm:text-sm"
                                data-allow-context-menu
                            />
                            <div className="grid min-w-0 gap-2 text-sm md:grid-cols-2">
                                <div className="min-w-0 break-words rounded-xl bg-muted/30 p-3"><code>{'{{artist_tags}}'}</code> · {t('styleLab.settings.placeholderArtistTags')}</div>
                                <div className="min-w-0 break-words rounded-xl bg-muted/30 p-3"><code>{'{{basePrompt}}'}</code> · {t('styleLab.settings.placeholderBasePrompt')}</div>
                                <div className="min-w-0 break-words rounded-xl bg-muted/30 p-3"><code>{'{{additionalPrompt}}'}</code> · {t('styleLab.settings.placeholderAdditionalPrompt')}</div>
                                <div className="min-w-0 break-words rounded-xl bg-muted/30 p-3"><code>{'{{detailPrompt}}'}</code> · {t('styleLab.settings.placeholderDetailPrompt')}</div>
                            </div>
                            <div>
                                <Label>{t('styleLab.settings.renderPreview')}</Label>
                                <Textarea value={templatePreview} readOnly className="mt-2 min-h-32 font-mono text-xs leading-5" data-allow-context-menu />
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="min-w-0">
                        <CardHeader>
                            <CardTitle className="text-lg">{t('styleLab.settings.generationRangeTitle')}</CardTitle>
                        </CardHeader>
                        <CardContent className="grid min-w-0 gap-4 md:grid-cols-3 xl:grid-cols-5">
                            <div className="space-y-2"><Label>{t('styleLab.settings.minArtists')}</Label><Input type="number" min={1} value={settings.minTags} onChange={(event) => updateSettings({ minTags: Number(event.target.value) })} /></div>
                            <div className="space-y-2"><Label>{t('styleLab.settings.maxArtists')}</Label><Input type="number" min={1} value={settings.maxTags} onChange={(event) => updateSettings({ maxTags: Number(event.target.value) })} /></div>
                            <div className="space-y-2"><Label>{t('styleLab.settings.minWeight')}</Label><Input type="number" min={0.2} max={2} step={0.1} value={settings.minWeight} onChange={(event) => updateSettings({ minWeight: Number(event.target.value) })} /></div>
                            <div className="space-y-2"><Label>{t('styleLab.settings.maxWeight')}</Label><Input type="number" min={0.2} max={2} step={0.1} value={settings.maxWeight} onChange={(event) => updateSettings({ maxWeight: Number(event.target.value) })} /></div>
                            <div className="space-y-2"><Label>{t('styleLab.settings.previewDelay')}</Label><Input type="number" min={250} max={10000} value={settings.previewDelayMs} onChange={(event) => updateSettings({ previewDelayMs: Number(event.target.value) })} /></div>
                            <div className="flex min-w-0 flex-col gap-3 rounded-xl border bg-muted/20 p-3 min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between md:col-span-3 xl:col-span-2">
                                <div className="min-w-0 space-y-1">
                                    <Label htmlFor="stylelab-auto-preview-battle">{t('styleLab.settings.autoPreviewBattle')}</Label>
                                    <p className="text-xs text-muted-foreground">{t('styleLab.settings.autoPreviewBattleDesc')}</p>
                                </div>
                                <Switch
                                    id="stylelab-auto-preview-battle"
                                    checked={settings.autoPreviewBattlePair}
                                    onChange={(event) => updateSettings({ autoPreviewBattlePair: event.target.checked })}
                                />
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}
