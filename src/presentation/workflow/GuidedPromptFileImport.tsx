import { useEffect, useRef, useState, type DragEvent } from 'react'
import { FileImage, LoaderCircle, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { PromptModuleCreator } from '@/components/fragments/PromptModuleCreator'
import { Button } from '@/components/ui/button'
import {
    parseExternalMetadataJson,
    parseMetadataFromFile,
    parseNaiBlueSidecarMetadata,
    type NAIMetadata,
} from '@/lib/metadata-parser'
import {
    parseNaiStyleCatalogFile,
    type NaiStyleCatalog,
    type NaiStyleCatalogItem,
    type NaiStyleCatalogParseProgress,
} from '@/lib/nai-style-catalog'
import { cn } from '@/lib/utils'

import { GuidedStyleCatalogImport } from './GuidedStyleCatalogImport'
import {
    guidedPromptImportFromMetadata,
    type GuidedPromptImportValue,
} from './guided-prompt-import'

export type {
    GuidedPromptImportCharacter,
    GuidedPromptImportValue,
} from './guided-prompt-import'

const MAX_PROMPT_IMPORT_BYTES = 50 * 1024 * 1024

interface JsonRecord {
    [key: string]: unknown
}

function record(value: unknown): JsonRecord | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as JsonRecord
        : null
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function jsonPrompts(value: unknown): { positive: string; negative: string } | null {
    const source = record(value)
    if (source === null) return null
    const prompt = record(source.prompt)
    const positiveParts = prompt
        ? [prompt.base, prompt.additional, prompt.detail].map(stringValue).filter(Boolean)
        : []
    const positive = stringValue(source.prompt)
        || stringValue(prompt?.positive)
        || positiveParts.join(', ')
        || stringValue(source.basePrompt)
        || stringValue(record(record(source.v4_prompt)?.caption)?.base_caption)
    const negative = stringValue(prompt?.negative)
        || stringValue(source.negativePrompt)
        || stringValue(source.uc)
        || stringValue(source.negative_prompt)
        || stringValue(record(record(source.v4_negative_prompt)?.caption)?.base_caption)
    if (positive || negative) return { positive, negative }

    for (const key of ['Comment', 'comment', 'metadata', 'settings']) {
        const nested = source[key]
        if (typeof nested === 'string') {
            try {
                const parsed = jsonPrompts(JSON.parse(nested))
                if (parsed) return parsed
            } catch {
                continue
            }
        }
        const parsed = jsonPrompts(nested)
        if (parsed) return parsed
    }
    return null
}

function isJsonFile(file: File): boolean {
    return file.type === 'application/json' || file.name.toLocaleLowerCase().endsWith('.json')
}

function validatePromptImportFile(file: File): void {
    if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_PROMPT_IMPORT_BYTES) {
        throw new RangeError('Prompt metadata file size is invalid')
    }
    const lowerName = file.name.toLocaleLowerCase()
    const supported = file.type.startsWith('image/') || file.type === 'application/json'
        || /\.(?:png|webp|jpe?g|json)$/.test(lowerName)
    if (!supported) throw new TypeError('Unsupported prompt metadata file')
}

export async function readGuidedPromptImportFile(file: File): Promise<GuidedPromptImportValue> {
    validatePromptImportFile(file)
    let metadata: NAIMetadata | null
    let json: string | null = null
    if (isJsonFile(file)) {
        json = await file.text()
        metadata = parseExternalMetadataJson(json) ?? parseNaiBlueSidecarMetadata(json)
    } else {
        metadata = await parseMetadataFromFile(file)
    }
    const metadataImport = metadata === null
        ? null
        : guidedPromptImportFromMetadata(metadata, file.name)
    let prompts = metadataImport === null
        ? null
        : { positive: metadataImport.positive, negative: metadataImport.negative }
    if ((!prompts || (!prompts.positive && !prompts.negative)) && json !== null) {
        prompts = jsonPrompts(JSON.parse(json))
    }
    const hasCharacters = (metadataImport?.characters?.length ?? 0) > 0
    if ((!prompts || (!prompts.positive && !prompts.negative)) && !hasCharacters) {
        throw new TypeError('No prompt metadata was found')
    }
    return {
        positive: prompts?.positive ?? '',
        negative: prompts?.negative ?? '',
        sourceName: file.name,
        ...(metadataImport?.characters === undefined ? {} : { characters: metadataImport.characters }),
    }
}

export type GuidedPromptImportSource =
    | { readonly kind: 'prompt'; readonly value: GuidedPromptImportValue }
    | { readonly kind: 'style-catalog'; readonly catalog: NaiStyleCatalog }

export async function readGuidedPromptImportSource(
    file: File,
    onProgress?: (progress: NaiStyleCatalogParseProgress) => void,
): Promise<GuidedPromptImportSource> {
    validatePromptImportFile(file)
    if (isJsonFile(file)) {
        const catalog = await parseNaiStyleCatalogFile(file, onProgress)
        if (catalog !== null) return { kind: 'style-catalog', catalog }
    }
    return { kind: 'prompt', value: await readGuidedPromptImportFile(file) }
}

export function GuidedPromptFileImport({
    positive,
    disabled = false,
    onReplace,
    onAppend,
    onModuleCreated,
    incomingImport = null,
    onIncomingImportHandled,
}: {
    positive: string
    disabled?: boolean
    onReplace(value: GuidedPromptImportValue): void
    onAppend(value: GuidedPromptImportValue): void
    onModuleCreated?(canonicalPath: string): void
    /** App-wide drops arrive here after the current Guided draft returns to this step. */
    incomingImport?: GuidedPromptImportValue | null
    onIncomingImportHandled?(): void
}) {
    const { t } = useTranslation()
    const inputRef = useRef<HTMLInputElement>(null)
    const [dragging, setDragging] = useState(false)
    const [loading, setLoading] = useState(false)
    const [imported, setImported] = useState<GuidedPromptImportValue | null>(null)
    const [catalog, setCatalog] = useState<NaiStyleCatalog | null>(null)
    const [progress, setProgress] = useState<NaiStyleCatalogParseProgress | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [createdPath, setCreatedPath] = useState<string | null>(null)

    useEffect(() => {
        if (incomingImport === null) return
        setCatalog(null)
        setImported(incomingImport)
        setError(null)
        setCreatedPath(null)
    }, [incomingImport])

    const read = async (file: File | undefined) => {
        if (!file || loading || disabled) return
        setLoading(true)
        setError(null)
        setCreatedPath(null)
        setProgress(null)
        try {
            const source = await readGuidedPromptImportSource(file, setProgress)
            if (source.kind === 'style-catalog') {
                setCatalog(source.catalog)
                setImported(null)
            } else {
                setCatalog(null)
                setImported(source.value)
            }
        } catch {
            setImported(null)
            setCatalog(null)
            setError(t('guided.promptImport.error', '프롬프트 메타데이터를 찾지 못했어요. NAI 이미지 또는 지원하는 외부 JSON인지 확인해 주세요.'))
        } finally {
            setLoading(false)
            setProgress(null)
        }
    }

    const moduleSource = imported?.positive || positive
    return (
        <section className="border-y border-border/70 py-4" data-testid="guided-prompt-file-import">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="flex items-center gap-2 text-base font-semibold">
                        <FileImage className="h-4 w-4 text-primary" aria-hidden="true" />
                        {t('guided.promptImport.title', '이미지·JSON에서 프롬프트 불러오기')}
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        {t('guided.promptImport.description', '파일을 놓거나 탐색기로 골라 이미지 메타데이터의 긍정·제외·캐릭터 프롬프트를 읽습니다.')}
                    </p>
                </div>
                {!catalog && (
                    <PromptModuleCreator
                        disabled={disabled || !moduleSource.trim()}
                        sourceText={moduleSource}
                        suggestedName={imported?.sourceName}
                        triggerLabel={imported
                            ? t('guided.promptImport.saveImportedModule', '불러온 내용을 모듈로 저장')
                            : t('guided.promptImport.saveCurrentModule', '현재 프롬프트를 모듈로 저장')}
                        onCreated={path => {
                            setCreatedPath(path)
                            onModuleCreated?.(path)
                        }}
                    />
                )}
            </div>
            <input
                ref={inputRef}
                type="file"
                className="sr-only"
                tabIndex={-1}
                accept="image/png,image/webp,image/jpeg,.nai-blue.json,.nais2.json,application/json"
                disabled={disabled || loading}
                onChange={event => {
                    void read(event.target.files?.[0])
                    event.target.value = ''
                }}
            />
            <button
                data-local-file-drop
                type="button"
                disabled={disabled || loading}
                onClick={() => inputRef.current?.click()}
                onDragEnter={event => { event.preventDefault(); if (!disabled) setDragging(true) }}
                onDragOver={event => event.preventDefault()}
                onDragLeave={event => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
                }}
                onDrop={(event: DragEvent<HTMLButtonElement>) => {
                    event.preventDefault()
                    setDragging(false)
                    void read(event.dataTransfer.files[0])
                }}
                className={cn(
                    'mt-4 flex min-h-24 w-full items-center justify-center gap-3 border border-dashed border-border/80 px-4 py-5 text-left transition-colors focus-ring',
                    dragging ? 'border-primary bg-primary/[0.055]' : 'hover:border-primary/60 hover:bg-primary/[0.035]',
                    (disabled || loading) && 'cursor-not-allowed opacity-55',
                )}
            >
                {loading ? <LoaderCircle className="h-5 w-5 shrink-0 animate-spin text-primary" aria-hidden="true" /> : <Upload className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />}
                <span className="min-w-0">
                    <span className="block text-base font-semibold">{loading
                        ? t('guided.promptImport.loading', '메타데이터를 읽는 중…')
                        : t('guided.promptImport.choose', '여기에 파일을 놓거나 눌러서 선택')}</span>
                    <span className="mt-1 block text-sm text-muted-foreground">{loading && progress
                        ? t('guided.promptImport.catalog.progress', '{{records}}개 확인 · {{percent}}%', {
                            records: progress.recordsRead.toLocaleString(),
                            percent: progress.totalBytes > 0 ? Math.min(100, Math.round(progress.bytesRead / progress.totalBytes * 100)) : 0,
                        })
                        : 'PNG · WebP · JPEG · JSON'}</span>
                </span>
            </button>
            {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}
            {createdPath && <p className="mt-3 text-sm text-success" role="status">{t('guided.promptImport.moduleSaved', '{{path}} 모듈을 저장했어요.', { path: createdPath })}</p>}
            {catalog && (
                <GuidedStyleCatalogImport
                    catalog={catalog}
                    disabled={disabled}
                    onChoose={(item: NaiStyleCatalogItem) => setImported({
                        positive: item.positive,
                        negative: item.negative,
                        sourceName: `${catalog.sourceName} · ${item.title}`,
                        ...(item.characters.length === 0 ? {} : { characters: item.characters.map(character => ({
                            prompt: character.prompt,
                            negative: character.negative,
                            position: { ...character.position },
                        })) }),
                    })}
                />
            )}
            {imported && (
                <div className="mt-4 border-t border-border/55 pt-4">
                    <p className="text-sm font-semibold">{imported.sourceName}</p>
                    <p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{imported.positive || imported.negative}</p>
                    {imported.characters && imported.characters.length > 0 && (
                        <p className="mt-2 text-xs text-muted-foreground">
                            {t('guided.promptImport.characterCount', '캐릭터 프롬프트 {{count}}개 포함', { count: imported.characters.length })}
                        </p>
                    )}
                    <div className="mt-4 flex flex-wrap gap-2">
                        <Button type="button" onClick={() => {
                            onReplace(imported)
                            setImported(null)
                            onIncomingImportHandled?.()
                        }}>{t('guided.promptImport.replace', '현재 프롬프트 교체')}</Button>
                        <Button type="button" variant="outline" onClick={() => {
                            onAppend(imported)
                            setImported(null)
                            onIncomingImportHandled?.()
                        }}>{t('guided.promptImport.append', '현재 내용 뒤에 추가')}</Button>
                        <Button type="button" variant="ghost" onClick={() => {
                            setImported(null)
                            onIncomingImportHandled?.()
                        }}>{t('common.cancel', '취소')}</Button>
                    </div>
                </div>
            )}
        </section>
    )
}
