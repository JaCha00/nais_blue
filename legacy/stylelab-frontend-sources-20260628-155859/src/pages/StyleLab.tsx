import { ChangeEvent, useMemo, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import {
    BarChart3,
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
    Sparkles,
    Star,
    Swords,
    Trash2,
    Trophy,
    Unlock,
    Upload,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/use-toast'
import { buildStyleLabPrompt, extractArtistTagsFromText, formatWeightedArtistTags, WeightedArtistTag } from '@/lib/style-lab'
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

interface CombinationCardProps {
    combo: StyleCombination
    rank?: number
    compact?: boolean
    showNote?: boolean
    chooseLabel?: string
    onChoose?: () => void
    onGenerate: () => void
    onRemove: () => void
    onToggleFavorite: () => void
    onToggleLock: () => void
    onUpdateNote: (note: string) => void
}

function getPreviewSource(combo: StyleCombination): string | null {
    if (combo.previewImage) return combo.previewImage
    if (combo.previewPath && !combo.previewPath.startsWith('memory://')) return convertFileSrc(combo.previewPath)
    return null
}

function winRate(combo: StyleCombination): string {
    if (combo.battles === 0) return '0%'
    return `${Math.round((combo.wins / combo.battles) * 100)}%`
}

async function copyToClipboard(text: string, label = '복사 완료') {
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

function CombinationCard({
    combo,
    rank,
    compact,
    showNote,
    chooseLabel,
    onChoose,
    onGenerate,
    onRemove,
    onToggleFavorite,
    onToggleLock,
    onUpdateNote,
}: CombinationCardProps) {
    const tagText = formatWeightedArtistTags(combo.tags)
    const previewSource = getPreviewSource(combo)

    return (
        <Card className={cn('overflow-hidden border-border/60 bg-card/70', combo.favorite && 'border-yellow-500/50', combo.locked && 'ring-1 ring-primary/30')}>
            <div className={cn('relative bg-muted/30', compact ? 'aspect-[4/3]' : 'aspect-video')}>
                {previewSource ? (
                    <img src={previewSource} alt="Style preview" className="h-full w-full object-cover" />
                ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
                        <FlaskConical className="h-8 w-8" />
                        <span className="text-xs">프리뷰 없음</span>
                    </div>
                )}
                {combo.isPreviewing && (
                    <div className="absolute inset-x-3 bottom-3 rounded-full bg-black/50 p-1 backdrop-blur-sm">
                        <div className="h-1.5 rounded-full bg-primary transition-all" style={{ width: `${Math.round((combo.previewProgress || 0) * 100)}%` }} />
                    </div>
                )}
                <div className="absolute left-2 top-2 flex gap-1">
                    {rank !== undefined && <Badge variant="secondary">#{rank}</Badge>}
                    <Badge variant="outline" className="bg-background/80 backdrop-blur-sm">Gen {combo.generation}</Badge>
                </div>
                <div className="absolute right-2 top-2 flex gap-1">
                    {combo.favorite && <Badge className="bg-yellow-500 text-black">★</Badge>}
                    {combo.locked && <Badge variant="secondary">잠금</Badge>}
                </div>
            </div>
            <CardContent className="space-y-3 p-3">
                <div className="grid grid-cols-4 gap-2 text-center text-xs">
                    <div className="rounded-lg bg-muted/50 p-2">
                        <div className="text-muted-foreground">Elo</div>
                        <div className="font-semibold text-foreground">{combo.elo}</div>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-2">
                        <div className="text-muted-foreground">승률</div>
                        <div className="font-semibold text-foreground">{winRate(combo)}</div>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-2">
                        <div className="text-muted-foreground">전적</div>
                        <div className="font-semibold text-foreground">{combo.wins}-{combo.losses}</div>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-2">
                        <div className="text-muted-foreground">태그</div>
                        <div className="font-semibold text-foreground">{combo.tags.length}</div>
                    </div>
                </div>

                <Textarea
                    value={tagText}
                    readOnly
                    className={cn('font-mono text-xs', compact ? 'h-20' : 'h-24')}
                    data-allow-context-menu
                />

                {combo.previewError && (
                    <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{combo.previewError}</p>
                )}

                {showNote && (
                    <Textarea
                        value={combo.note}
                        onChange={(event) => onUpdateNote(event.target.value)}
                        placeholder="메모"
                        className="h-16 text-xs"
                    />
                )}

                <div className="flex flex-wrap gap-2">
                    {onChoose && chooseLabel && (
                        <Button size="sm" className="flex-1 rounded-xl" onClick={onChoose}>
                            <Trophy className="mr-1.5 h-3.5 w-3.5" />
                            {chooseLabel}
                        </Button>
                    )}
                    <Button size="sm" variant="outline" className="rounded-xl" onClick={() => copyToClipboard(tagText, '태그 조합을 복사했습니다')}>
                        <Copy className="h-3.5 w-3.5" />
                    </Button>
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

    const [artistInput, setArtistInput] = useState('')
    const [randomCount, setRandomCount] = useState(settings.randomBatchCount)
    const [cleanupMinBattles, setCleanupMinBattles] = useState(3)
    const [cleanupEloBelow, setCleanupEloBelow] = useState(1120)
    const [analysisRows, setAnalysisRows] = useState<AnalysisRow[]>([])
    const [isAnalyzing, setIsAnalyzing] = useState(false)

    const sortedCombinations = useMemo(
        () => [...combinations].sort((a, b) => b.elo - a.elo || b.battles - a.battles || b.updatedAt - a.updatedAt),
        [combinations],
    )

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
            for (const tag of combo.tags) {
                const key = tag.artist.toLowerCase()
                const current = artistMap.get(key) || { artist: tag.artist, count: 0, weightSum: 0 }
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
            ? formatWeightedArtistTags(sortedCombinations[0].tags)
            : '1.5::artist:shnva ::, 1.3::artist:necomi ::'
        return buildStyleLabPrompt(settings.promptTemplate, sampleTags, {
            basePrompt,
            additionalPrompt,
            detailPrompt,
            inpaintingPrompt,
        })
    }, [additionalPrompt, basePrompt, detailPrompt, inpaintingPrompt, settings.promptTemplate, sortedCombinations])

    const handleAddArtists = () => {
        const added = addArtists(artistInput)
        if (added === 0) {
            toast({ title: '추가할 새 작가가 없습니다', variant: 'destructive' })
            return
        }
        setArtistInput('')
        toast({ title: `${added}명의 작가를 추가했습니다`, variant: 'success' })
    }

    const handleGenerateRandom = () => {
        updateSettings({ randomBatchCount: randomCount })
        const created = generateRandomCombinations(randomCount)
        toast({
            title: created > 0 ? `${created}개 조합 생성 완료` : '조합을 생성하지 못했습니다',
            description: created === 0 ? '작가 수가 부족하거나 중복 조합만 생성되었습니다.' : undefined,
            variant: created > 0 ? 'success' : 'destructive',
        })
    }

    const handlePickBattle = () => {
        const pair = pickBattlePair()
        if (!pair) {
            toast({ title: '대결 후보가 부족합니다', description: '현재 리그에 최소 2개 이상의 조합이 필요합니다.', variant: 'destructive' })
        }
    }

    const handleBattleChoice = (winnerId: string, loserId: string) => {
        recordBattle(winnerId, loserId)
        const next = pickBattlePair()
        if (!next) {
            toast({ title: '대결 후보가 부족합니다', variant: 'destructive' })
        }
    }

    const handleEvolve = () => {
        const childIds = evolve()
        if (childIds.length === 0) {
            toast({ title: '교배할 부모 조합이 부족합니다', description: '평가된 조합 또는 전체 조합이 최소 2개 필요합니다.', variant: 'destructive' })
            return
        }
        toast({ title: `${childIds.length}개 자식 조합을 생성했습니다`, variant: 'success' })
    }

    const handleCleanup = () => {
        const removed = cleanup(cleanupMinBattles, cleanupEloBelow)
        toast({
            title: removed > 0 ? `${removed}개 조합을 정리했습니다` : '정리할 조합이 없습니다',
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

                for (const tag of tags) {
                    const key = tag.artist.toLowerCase()
                    const current = aggregate.get(key) || {
                        artist: tag.artist,
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
                title: rows.length > 0 ? `${rows.length}개의 작가 태그를 찾았습니다` : '작가 태그를 찾지 못했습니다',
                variant: rows.length > 0 ? 'success' : 'destructive',
            })
        } catch (error) {
            toast({ title: 'PNG 분석 실패', description: String(error), variant: 'destructive' })
        } finally {
            setIsAnalyzing(false)
            event.target.value = ''
        }
    }

    const handleAddAnalysisArtists = () => {
        const added = addArtists(analysisRows.map(row => row.artist).join('\n'))
        toast({ title: `${added}명의 분석 작가를 목록에 추가했습니다`, variant: added > 0 ? 'success' : 'default' })
    }

    const handleAddAnalysisCombination = () => {
        const tags: WeightedArtistTag[] = analysisRows.slice(0, settings.maxTags).map(row => ({
            artist: row.artist,
            weight: row.avgWeight,
        }))
        const id = addCombinationFromTags(tags)
        toast({ title: id ? '분석 결과 조합을 추가했습니다' : '이미 같은 조합이 있거나 태그가 없습니다', variant: id ? 'success' : 'destructive' })
    }

    const handleExport = () => {
        const body = sortedCombinations.map((combo, index) => {
            const header = `#${index + 1} | Elo ${combo.elo} | ${combo.wins}-${combo.losses} | Gen ${combo.generation}${combo.favorite ? ' | Favorite' : ''}${combo.locked ? ' | Locked' : ''}`
            const note = combo.note.trim() ? `\n메모: ${combo.note.trim()}` : ''
            return `${header}\n${formatWeightedArtistTags(combo.tags)}${note}`
        }).join('\n\n---\n\n')
        downloadText(`NAIS_style_lab_${Date.now()}.txt`, body || '저장된 조합이 없습니다.')
    }

    const renderCombinationCard = (combo: StyleCombination, rank?: number, compact?: boolean, showNote?: boolean) => (
        <CombinationCard
            key={combo.id}
            combo={combo}
            rank={rank}
            compact={compact}
            showNote={showNote}
            onGenerate={() => generateStyleLabPreviews([combo.id])}
            onRemove={() => removeCombination(combo.id)}
            onToggleFavorite={() => toggleFavorite(combo.id)}
            onToggleLock={() => toggleLock(combo.id)}
            onUpdateNote={(note) => updateNote(combo.id, note)}
        />
    )

    const latestGeneration = Math.max(0, ...combinations.map(combo => combo.generation))
    const latestGenerationIds = combinations.filter(combo => combo.generation === latestGeneration).map(combo => combo.id)

    return (
        <div className="space-y-4 pb-8">
            <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card">
                <CardHeader className="pb-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2 text-2xl">
                                <FlaskConical className="h-6 w-6 text-primary" />
                                내 취향 그림체 연구소
                            </CardTitle>
                            <CardDescription className="mt-2">
                                작가 태그 조합을 생성하고, Elo 월드컵과 유전 알고리즘으로 취향에 맞는 그림체를 진화시킵니다.
                            </CardDescription>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center text-sm sm:min-w-[360px]">
                            <div className="rounded-xl bg-background/60 p-3">
                                <div className="text-muted-foreground">조합</div>
                                <div className="text-xl font-bold">{combinations.length}</div>
                            </div>
                            <div className="rounded-xl bg-background/60 p-3">
                                <div className="text-muted-foreground">즐겨찾기</div>
                                <div className="text-xl font-bold">{stats.favorites}</div>
                            </div>
                            <div className="rounded-xl bg-background/60 p-3">
                                <div className="text-muted-foreground">평균 Elo</div>
                                <div className="text-xl font-bold">{stats.avgElo}</div>
                            </div>
                        </div>
                    </div>
                    {isPreviewQueueRunning && (
                        <div className="mt-4 rounded-xl border border-primary/20 bg-background/60 p-3">
                            <div className="mb-2 flex items-center justify-between text-sm">
                                <span className="flex items-center gap-2"><Play className="h-4 w-4" />프리뷰 순차 생성 중</span>
                                <span>{previewQueueDone}/{previewQueueTotal}</span>
                            </div>
                            <div className="h-2 rounded-full bg-muted overflow-hidden">
                                <div className="h-full bg-primary transition-all" style={{ width: `${previewQueueTotal ? (previewQueueDone / previewQueueTotal) * 100 : 0}%` }} />
                            </div>
                        </div>
                    )}
                </CardHeader>
            </Card>

            <Tabs defaultValue="battle" className="space-y-4">
                <TabsList className="flex h-auto flex-wrap justify-start gap-1 p-1">
                    <TabsTrigger value="battle"><Swords className="mr-1.5 h-4 w-4" />월드컵</TabsTrigger>
                    <TabsTrigger value="manage"><ListPlus className="mr-1.5 h-4 w-4" />작가/조합</TabsTrigger>
                    <TabsTrigger value="evolve"><Dna className="mr-1.5 h-4 w-4" />진화</TabsTrigger>
                    <TabsTrigger value="analyze"><FileImage className="mr-1.5 h-4 w-4" />PNG 분석</TabsTrigger>
                    <TabsTrigger value="stats"><BarChart3 className="mr-1.5 h-4 w-4" />통계/정리</TabsTrigger>
                    <TabsTrigger value="settings"><Sparkles className="mr-1.5 h-4 w-4" />템플릿</TabsTrigger>
                </TabsList>

                <TabsContent value="battle" className="space-y-4">
                    <Card>
                        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
                            <div className="space-y-1">
                                <h3 className="font-semibold">그림체 이상형 월드컵</h3>
                                <p className="text-sm text-muted-foreground">현재 리그 후보 {battlePoolCount}개 · 선택 즉시 Elo 점수와 전적이 갱신됩니다.</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {(['all', 'favorites'] as StyleLabLeague[]).map(league => (
                                    <Button
                                        key={league}
                                        variant={settings.battleLeague === league ? 'default' : 'outline'}
                                        className="rounded-xl"
                                        onClick={() => setBattleLeague(league)}
                                    >
                                        {league === 'all' ? '전체 리그' : '즐겨찾기 리그'}
                                    </Button>
                                ))}
                                <Button className="rounded-xl" onClick={handlePickBattle}>
                                    <Dice5 className="mr-1.5 h-4 w-4" />대결 뽑기
                                </Button>
                                {battlePair && (
                                    <Button
                                        variant="outline"
                                        className="rounded-xl"
                                        onClick={() => generateStyleLabPreviews([battlePair.left.id, battlePair.right.id])}
                                        disabled={isPreviewQueueRunning}
                                    >
                                        <ImagePlus className="mr-1.5 h-4 w-4" />두 후보 순차 프리뷰
                                    </Button>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    {battlePair ? (
                        <div className="grid gap-4 xl:grid-cols-2">
                            <CombinationCard
                                combo={battlePair.left}
                                chooseLabel="왼쪽 선택"
                                onChoose={() => handleBattleChoice(battlePair.left.id, battlePair.right.id)}
                                onGenerate={() => generateStyleLabPreviews([battlePair.left.id])}
                                onRemove={() => removeCombination(battlePair.left.id)}
                                onToggleFavorite={() => toggleFavorite(battlePair.left.id)}
                                onToggleLock={() => toggleLock(battlePair.left.id)}
                                onUpdateNote={(note) => updateNote(battlePair.left.id, note)}
                            />
                            <CombinationCard
                                combo={battlePair.right}
                                chooseLabel="오른쪽 선택"
                                onChoose={() => handleBattleChoice(battlePair.right.id, battlePair.left.id)}
                                onGenerate={() => generateStyleLabPreviews([battlePair.right.id])}
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
                                    <p className="font-medium text-foreground">대결할 조합을 뽑아주세요</p>
                                    <p className="text-sm">조합이 부족하면 작가/조합 탭에서 랜덤 조합을 먼저 생성하세요.</p>
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </TabsContent>

                <TabsContent value="manage" className="grid gap-4 xl:grid-cols-[360px_1fr]">
                    <div className="space-y-4">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">작가 명단 관리</CardTitle>
                                <CardDescription>한 줄에 하나씩 또는 콤마로 여러 작가 태그를 붙여넣을 수 있습니다.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <Textarea
                                    value={artistInput}
                                    onChange={(event) => setArtistInput(event.target.value)}
                                    placeholder="shnva&#10;necomi&#10;momoko (momopoco)"
                                    className="h-32"
                                    data-allow-context-menu
                                />
                                <div className="flex flex-wrap gap-2">
                                    <Button className="rounded-xl" onClick={handleAddArtists}><ListPlus className="mr-1.5 h-4 w-4" />추가</Button>
                                    <Button variant="outline" className="rounded-xl" onClick={resetArtistsToDefault}><RotateCcw className="mr-1.5 h-4 w-4" />기본 목록</Button>
                                    <Button variant="outline" className="rounded-xl text-destructive hover:text-destructive" onClick={resetLabData}><Trash2 className="mr-1.5 h-4 w-4" />전체 초기화</Button>
                                </div>
                                <div className="max-h-64 overflow-y-auto rounded-xl border bg-muted/20 p-2">
                                    <div className="mb-2 text-xs text-muted-foreground">등록 작가 {artists.length}명</div>
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

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">랜덤 조합 생성</CardTitle>
                                <CardDescription>{settings.minTags}~{settings.maxTags}명, 가중치 {settings.minWeight.toFixed(1)}~{settings.maxWeight.toFixed(1)} 범위로 생성합니다.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <div className="space-y-2">
                                    <Label>생성 개수</Label>
                                    <Input type="number" min={1} max={100} value={randomCount} onChange={(event) => setRandomCount(Number(event.target.value))} />
                                </div>
                                <Button className="w-full rounded-xl" onClick={handleGenerateRandom}>
                                    <Dice5 className="mr-1.5 h-4 w-4" />랜덤 조합 생성
                                </Button>
                            </CardContent>
                        </Card>
                    </div>

                    <Card>
                        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                                <CardTitle className="text-lg">조합 관리</CardTitle>
                                <CardDescription>즐겨찾기, 잠금, 메모를 관리하고 태그를 빠르게 복사할 수 있습니다.</CardDescription>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <Button variant="outline" className="rounded-xl" onClick={() => generateStyleLabPreviews(sortedCombinations.slice(0, 6).map(combo => combo.id))} disabled={isPreviewQueueRunning || sortedCombinations.length === 0}>
                                    <ImagePlus className="mr-1.5 h-4 w-4" />상위 6개 프리뷰
                                </Button>
                                <Button variant="outline" className="rounded-xl" onClick={handleExport}>
                                    <Download className="mr-1.5 h-4 w-4" />TXT 내보내기
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent>
                            {sortedCombinations.length > 0 ? (
                                <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                                    {sortedCombinations.map((combo, index) => renderCombinationCard(combo, index + 1, true, true))}
                                </div>
                            ) : (
                                <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">아직 생성된 조합이 없습니다.</div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="evolve" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-lg"><Dna className="h-5 w-5" />조합 진화 시스템</CardTitle>
                            <CardDescription>즐겨찾기 또는 평가된 상위 조합끼리 교배하고 일부 태그/가중치를 변이합니다.</CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-4 lg:grid-cols-4">
                            <div className="space-y-2">
                                <Label>부모 후보 수</Label>
                                <Input type="number" min={2} max={50} value={settings.evolutionParentCount} onChange={(event) => updateSettings({ evolutionParentCount: Number(event.target.value) })} />
                            </div>
                            <div className="space-y-2">
                                <Label>자식 생성 수</Label>
                                <Input type="number" min={1} max={100} value={settings.evolutionChildrenCount} onChange={(event) => updateSettings({ evolutionChildrenCount: Number(event.target.value) })} />
                            </div>
                            <div className="space-y-2">
                                <Label>변이율</Label>
                                <Input type="number" min={0} max={1} step={0.01} value={settings.mutationRate} onChange={(event) => updateSettings({ mutationRate: Number(event.target.value) })} />
                            </div>
                            <div className="flex items-end gap-2">
                                <Button className="flex-1 rounded-xl" onClick={handleEvolve}><Dna className="mr-1.5 h-4 w-4" />진화 실행</Button>
                                <Button variant="outline" className="rounded-xl" onClick={() => generateStyleLabPreviews(latestGenerationIds)} disabled={latestGenerationIds.length === 0 || isPreviewQueueRunning}>
                                    <ImagePlus className="h-4 w-4" />
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">최신 세대 Gen {latestGeneration}</CardTitle>
                                <CardDescription>{latestGenerationIds.length}개 조합</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                                    {sortedCombinations.filter(combo => combo.generation === latestGeneration).map((combo, index) => renderCombinationCard(combo, index + 1, true, true))}
                                </div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">진화 기록</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {evolutionLogs.length > 0 ? evolutionLogs.slice(0, 10).map(log => (
                                    <div key={log.id} className="rounded-xl border bg-muted/20 p-3 text-sm">
                                        <div className="font-semibold">Gen {log.generation}</div>
                                        <div className="text-muted-foreground">{log.note}</div>
                                        <div className="mt-1 text-xs text-muted-foreground">{new Date(log.timestamp).toLocaleString()}</div>
                                    </div>
                                )) : <p className="text-sm text-muted-foreground">아직 진화 기록이 없습니다.</p>}
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                <TabsContent value="analyze" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-lg"><FileImage className="h-5 w-5" />PNG 작가 태그 분석기</CardTitle>
                            <CardDescription>NAI/NAIS2 PNG 메타데이터에서 artist 태그와 가중치를 추출합니다.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex flex-wrap items-center gap-2">
                                <Label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2 hover:bg-muted/50">
                                    <Upload className="h-4 w-4" />PNG 선택
                                    <input type="file" accept="image/png" multiple className="hidden" onChange={handleAnalyzePng} disabled={isAnalyzing} />
                                </Label>
                                <Button variant="outline" className="rounded-xl" onClick={handleAddAnalysisArtists} disabled={analysisRows.length === 0}>작가 목록에 추가</Button>
                                <Button variant="outline" className="rounded-xl" onClick={handleAddAnalysisCombination} disabled={analysisRows.length === 0}>조합으로 추가</Button>
                            </div>

                            {analysisRows.length > 0 ? (
                                <div className="overflow-hidden rounded-xl border">
                                    <table className="w-full text-sm">
                                        <thead className="bg-muted/50 text-left">
                                            <tr>
                                                <th className="p-3">작가</th>
                                                <th className="p-3">빈도</th>
                                                <th className="p-3">평균 가중치</th>
                                                <th className="p-3">최대 가중치</th>
                                                <th className="p-3">소스</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {analysisRows.map(row => (
                                                <tr key={row.artist} className="border-t">
                                                    <td className="p-3 font-medium">{row.artist}</td>
                                                    <td className="p-3">{row.count}</td>
                                                    <td className="p-3">{row.avgWeight.toFixed(1)}</td>
                                                    <td className="p-3">{row.maxWeight.toFixed(1)}</td>
                                                    <td className="p-3 text-xs text-muted-foreground">{row.sources.slice(0, 2).join(', ')}{row.sources.length > 2 ? ` 외 ${row.sources.length - 2}` : ''}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">PNG를 선택하면 분석 결과가 여기에 표시됩니다.</div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="stats" className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">전체 조합</div><div className="text-2xl font-bold">{combinations.length}</div></CardContent></Card>
                        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">즐겨찾기</div><div className="text-2xl font-bold">{stats.favorites}</div></CardContent></Card>
                        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">잠금</div><div className="text-2xl font-bold">{stats.locked}</div></CardContent></Card>
                        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">최고 Elo</div><div className="text-2xl font-bold">{stats.best?.elo ?? 0}</div></CardContent></Card>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-2">
                        <Card>
                            <CardHeader><CardTitle className="text-lg">작가 사용 횟수</CardTitle></CardHeader>
                            <CardContent className="space-y-2">
                                {stats.artists.map(row => (
                                    <div key={row.artist} className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2 text-sm">
                                        <span>{row.artist}</span>
                                        <span className="text-muted-foreground">{row.count}회 · 평균 {(row.weightSum / row.count).toFixed(1)}</span>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader><CardTitle className="text-lg">세대 분포</CardTitle></CardHeader>
                            <CardContent className="space-y-2">
                                {stats.generations.map(([generation, count]) => (
                                    <div key={generation} className="flex items-center gap-3 text-sm">
                                        <span className="w-16">Gen {generation}</span>
                                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                                            <div className="h-full bg-primary" style={{ width: `${combinations.length ? (count / combinations.length) * 100 : 0}%` }} />
                                        </div>
                                        <span className="w-10 text-right text-muted-foreground">{count}</span>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    </div>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">자동 조합 정리</CardTitle>
                            <CardDescription>잠금된 조합은 삭제하지 않습니다.</CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
                            <div className="space-y-2">
                                <Label>최소 평가 횟수</Label>
                                <Input type="number" min={0} value={cleanupMinBattles} onChange={(event) => setCleanupMinBattles(Number(event.target.value))} />
                            </div>
                            <div className="space-y-2">
                                <Label>삭제 기준 Elo 미만</Label>
                                <Input type="number" value={cleanupEloBelow} onChange={(event) => setCleanupEloBelow(Number(event.target.value))} />
                            </div>
                            <Button variant="outline" className="rounded-xl text-destructive hover:text-destructive" onClick={handleCleanup}><Trash2 className="mr-1.5 h-4 w-4" />정리 실행</Button>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="settings" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">전역 프롬프트 템플릿 삽입 위치</CardTitle>
                            <CardDescription>
                                생성 프리뷰를 만들 때 현재 왼쪽 프롬프트 패널 값과 작가 조합을 아래 템플릿에 렌더링합니다. 원본 프롬프트는 변경하지 않습니다.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <Textarea
                                value={settings.promptTemplate}
                                onChange={(event) => updateSettings({ promptTemplate: event.target.value })}
                                className="h-32 font-mono text-sm"
                                data-allow-context-menu
                            />
                            <div className="grid gap-2 text-sm md:grid-cols-2">
                                <div className="rounded-xl bg-muted/30 p-3"><code>{'{{artist_tags}}'}</code> · 현재 조합 태그</div>
                                <div className="rounded-xl bg-muted/30 p-3"><code>{'{{basePrompt}}'}</code> · 기본 프롬프트</div>
                                <div className="rounded-xl bg-muted/30 p-3"><code>{'{{additionalPrompt}}'}</code> · 추가 프롬프트</div>
                                <div className="rounded-xl bg-muted/30 p-3"><code>{'{{detailPrompt}}'}</code> · 세부 프롬프트</div>
                            </div>
                            <div>
                                <Label>렌더링 미리보기</Label>
                                <Textarea value={templatePreview} readOnly className="mt-2 h-28 font-mono text-xs" data-allow-context-menu />
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">조합 생성 범위</CardTitle>
                        </CardHeader>
                        <CardContent className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
                            <div className="space-y-2"><Label>최소 작가 수</Label><Input type="number" min={1} value={settings.minTags} onChange={(event) => updateSettings({ minTags: Number(event.target.value) })} /></div>
                            <div className="space-y-2"><Label>최대 작가 수</Label><Input type="number" min={1} value={settings.maxTags} onChange={(event) => updateSettings({ maxTags: Number(event.target.value) })} /></div>
                            <div className="space-y-2"><Label>최소 가중치</Label><Input type="number" min={0.2} max={2} step={0.1} value={settings.minWeight} onChange={(event) => updateSettings({ minWeight: Number(event.target.value) })} /></div>
                            <div className="space-y-2"><Label>최대 가중치</Label><Input type="number" min={0.2} max={2} step={0.1} value={settings.maxWeight} onChange={(event) => updateSettings({ maxWeight: Number(event.target.value) })} /></div>
                            <div className="space-y-2"><Label>프리뷰 딜레이(ms)</Label><Input type="number" min={250} max={10000} value={settings.previewDelayMs} onChange={(event) => updateSettings({ previewDelayMs: Number(event.target.value) })} /></div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}
