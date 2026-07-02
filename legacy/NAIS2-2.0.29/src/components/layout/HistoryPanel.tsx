import { useTranslation } from 'react-i18next'
import { useEffect, useState, useRef, useCallback, memo } from 'react'
import { Clock, Trash2, FolderOpen, RefreshCw, FileSearch, Copy, RotateCcw, Save, Users, Image as ImageIcon, Paintbrush, Maximize2, Film, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useGenerationStore } from '@/stores/generation-store'
import { useAuthStore } from '@/stores/auth-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useSceneStore } from '@/stores/scene-store'
import { readDir, readFile, remove, writeFile, mkdir, exists, BaseDirectory } from '@tauri-apps/plugin-fs'
import { pictureDir, join } from '@tauri-apps/api/path'
import { Command } from '@tauri-apps/plugin-shell'
import { save } from '@tauri-apps/plugin-dialog'
import { MetadataDialog } from '@/components/metadata/MetadataDialog'
import { ImageReferenceDialog } from '@/components/metadata/ImageReferenceDialog'
import { parseMetadataFromBase64 } from '@/lib/metadata-parser'
import { generateImage } from '@/services/novelai-api'
import { toast } from '@/components/ui/use-toast'
import { useToolsStore } from '@/stores/tools-store'
import { useLibraryStore } from '@/stores/library-store'
import { useNavigate } from 'react-router-dom'
import { Wand2 } from 'lucide-react'
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
    ContextMenuSeparator,
} from '@/components/ui/context-menu'
import { InpaintingDialog } from '@/components/tools/InpaintingDialog'

// Convert ArrayBuffer to base64 without stack overflow
const arrayBufferToBase64 = (buffer: Uint8Array): string => {
    let binary = ''
    const len = buffer.byteLength
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(buffer[i])
    }
    return btoa(binary)
}

interface SavedImage {
    name: string
    path: string
    timestamp: number
    type: 'main' | 'i2i' | 'inpaint' | 'upscale' | 'scene'
    isTemporary?: boolean
}

// Memoized HistoryImageItem - 불필요한 리렌더링 방지
interface HistoryImageItemProps {
    image: SavedImage
    thumbnail?: string
    index: number
    getTypeIcon: (type: 'main' | 'i2i' | 'inpaint' | 'upscale' | 'scene') => React.ReactNode
    onImageClick: (image: SavedImage) => void
    onDelete: (image: SavedImage, e?: React.MouseEvent) => void
    onSaveAs: (image: SavedImage) => void
    onCopy: (image: SavedImage) => void
    onRegenerate: (image: SavedImage) => void
    onOpenSmartTools: (image: SavedImage) => void
    onAddAsReference: (image: SavedImage) => void
    onInpaint: (image: SavedImage) => void
    onI2I: (image: SavedImage) => void
    onOpenFolder: (image: SavedImage) => void
    onLoadMetadata: (image: SavedImage) => void
    onLoadComplete: (path: string, data: string) => void
}

const HistoryImageItem = memo(function HistoryImageItem({
    image, thumbnail, index, getTypeIcon,
    onImageClick, onDelete, onSaveAs, onCopy, onRegenerate,
    onOpenSmartTools, onAddAsReference, onInpaint, onI2I, onOpenFolder, onLoadMetadata,
    onLoadComplete
}: HistoryImageItemProps) {
    const { t } = useTranslation()
    const [localThumbnail, setLocalThumbnail] = useState<string | undefined>(thumbnail)

    useEffect(() => {
        if (thumbnail) setLocalThumbnail(thumbnail)
    }, [thumbnail])

    useEffect(() => {
        if (image.isTemporary) return
        if (!localThumbnail) {
            let active = true
            const load = async () => {
                try {
                    const data = await readFile(image.path)
                    if (active) {
                        const base64 = arrayBufferToBase64(data)
                        const dataUrl = `data:image/png;base64,${base64}`
                        setLocalThumbnail(dataUrl)
                        onLoadComplete(image.path, dataUrl)
                    }
                } catch (e) {
                    // console.warn('Failed to load image lazily:', image.path)
                }
            }
            load()
            return () => { active = false }
        }
    }, [image.path, localThumbnail, onLoadComplete])

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <div
                    className="aspect-square bg-muted/30 rounded-xl overflow-hidden hover:ring-2 hover:ring-primary hover:scale-[1.02] transition-all shadow-sm relative group cursor-pointer"
                    onClick={() => onImageClick(image)}
                >
                    {localThumbnail ? (
                        <img
                            draggable="true"
                            onDragStart={(e) => {
                                e.dataTransfer.setData('text/plain', image.name);
                                e.dataTransfer.effectAllowed = 'copy';
                                useLibraryStore.getState().setDraggedSource({
                                    name: image.name,
                                    path: image.path
                                });

                                // Create custom drag preview with rounded corners using DOM element
                                const dragPreview = document.createElement('div');
                                dragPreview.style.cssText = `
                                    width: 80px;
                                    height: 80px;
                                    border-radius: 12px;
                                    overflow: hidden;
                                    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
                                    border: 2px solid rgba(255,255,255,0.3);
                                    position: fixed;
                                    top: -200px;
                                    left: -200px;
                                    z-index: 9999;
                                    pointer-events: none;
                                `;

                                const previewImg = document.createElement('img');
                                previewImg.src = localThumbnail || '';
                                previewImg.style.cssText = `
                                    width: 100%;
                                    height: 100%;
                                    object-fit: cover;
                                `;

                                dragPreview.appendChild(previewImg);
                                document.body.appendChild(dragPreview);

                                e.dataTransfer.setDragImage(dragPreview, 40, 40);

                                // Clean up after a short delay
                                setTimeout(() => {
                                    document.body.removeChild(dragPreview);
                                }, 0);
                            }}
                            onDragEnd={() => {
                                useLibraryStore.getState().setDraggedSource(null);
                            }}
                            src={localThumbnail}
                            alt={`Image ${index + 1}`}
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                            Loading...
                        </div>
                    )}
                    <Button
                        variant="destructive"
                        size="icon"
                        className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => onDelete(image, e)}
                    >
                        <Trash2 className="h-3 w-3" />
                    </Button>
                    <div className="absolute bottom-1 left-1 flex gap-1">
                        <div className="h-5 w-5 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center">
                            {getTypeIcon(image.type)}
                        </div>
                        {image.isTemporary && (
                            <div className="h-5 w-5 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center">
                                <Zap className="h-3 w-3 text-yellow-400" />
                            </div>
                        )}
                    </div>
                </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
                <ContextMenuItem onClick={() => onSaveAs(image)}>
                    <Save className="h-4 w-4 mr-2" />
                    {t('actions.saveAs', '저장')}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onCopy(image)}>
                    <Copy className="h-4 w-4 mr-2" />
                    {t('actions.copy', '복사')}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onRegenerate(image)}>
                    <RotateCcw className="h-4 w-4 mr-2" />
                    {t('actions.regenerate', '재생성')}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onOpenSmartTools(image)}>
                    <Wand2 className="h-4 w-4 mr-2" />
                    {t('smartTools.title', '스마트 툴')}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => onInpaint(image)}>
                    <Paintbrush className="h-4 w-4 mr-2" />
                    {t('tools.inpainting.title', '인페인팅')}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onI2I(image)}>
                    <ImageIcon className="h-4 w-4 mr-2" />
                    {t('tools.i2i.title', 'Image to Image')}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => onAddAsReference(image)}>
                    <Users className="h-4 w-4 mr-2" />
                    {t('actions.addAsRef', '이미지 참조')}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onOpenFolder(image)} disabled={image.isTemporary}>
                    <FolderOpen className="h-4 w-4 mr-2" />
                    {t('actions.openFolder', '폴더 열기')}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onLoadMetadata(image)}>
                    <FileSearch className="h-4 w-4 mr-2" />
                    {t('metadata.loadFromImage', '메타데이터 불러오기')}
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    )
})

export function HistoryPanel() {
    const { t } = useTranslation()
    const { setPreviewImage, isGenerating, setIsGenerating, setSourceImage, setI2IMode } = useGenerationStore()
    const { savePath, useAbsolutePath } = useSettingsStore()
    const [savedImages, setSavedImages] = useState<SavedImage[]>([])
    const [imageThumbnails, setImageThumbnails] = useState<Record<string, string>>({})
    const [isLoading, setIsLoading] = useState(false)
    const [metadataDialogOpen, setMetadataDialogOpen] = useState(false)
    const [selectedImageForMetadata, setSelectedImageForMetadata] = useState<string | undefined>()
    const [imageRefDialogOpen, setImageRefDialogOpen] = useState(false)
    const [selectedImageForRef, setSelectedImageForRef] = useState<string | null>(null)
    // Inpainting dialog state
    const [inpaintDialogOpen, setInpaintDialogOpen] = useState(false)
    const [selectedImageForInpaint, setSelectedImageForInpaint] = useState<string | null>(null)
    const prevIsGenerating = useRef(isGenerating)
    const navigate = useNavigate()
    const { setActiveImage } = useToolsStore()



    // LRU cache limit for imageThumbnails to prevent memory bloat
    const MAX_THUMBNAIL_CACHE = 20

    const handleImageLoadComplete = useCallback((path: string, data: string) => {
        setImageThumbnails(prev => {
            if (prev[path]) return prev
            const keys = Object.keys(prev)
            // If cache is full, remove oldest entries (first in object)
            if (keys.length >= MAX_THUMBNAIL_CACHE) {
                const keysToRemove = keys.slice(0, keys.length - MAX_THUMBNAIL_CACHE + 1)
                const newCache = { ...prev }
                keysToRemove.forEach(k => delete newCache[k])
                return { ...newCache, [path]: data }
            }
            return { ...prev, [path]: data }
        })
    }, [])

    // Add new image instantly to history (no compression - use original directly)
    const addNewImage = useCallback((imagePath: string, imageData: string) => {
        const timestamp = Date.now()
        const isTemporary = imagePath.startsWith('memory://')
        const name = imagePath.split(/[/\\]/).pop() || `NAIS_${timestamp}.png`

        const newImage: SavedImage = {
            name,
            path: imagePath,
            timestamp,
            type: imagePath.includes('NAIS_Scene') ? 'scene' :
                name.includes('INPAINT_') ? 'inpaint' :
                    name.includes('I2I_') ? 'i2i' :
                        name.includes('UPSCALE_') ? 'upscale' : 'main',
            isTemporary
        }

        // Instantly add to list with original data
        setSavedImages(prev => {
            let next = [newImage, ...prev]

            // Limit temporary images to 10
            if (isTemporary) {
                const tempImages = next.filter(img => img.isTemporary)
                if (tempImages.length > 10) {
                    // Sort temp images by timestamp (oldest first) to find the one to remove
                    const sortedTemp = [...tempImages].sort((a, b) => a.timestamp - b.timestamp)
                    const oldest = sortedTemp[0]
                    next = next.filter(img => img !== oldest)
                }
            }
            return next.slice(0, 50)
        })
        // Apply same cache limit for instant additions
        setImageThumbnails(prev => {
            const keys = Object.keys(prev)
            if (keys.length >= MAX_THUMBNAIL_CACHE) {
                const keysToRemove = keys.slice(0, keys.length - MAX_THUMBNAIL_CACHE + 1)
                const newCache = { ...prev }
                keysToRemove.forEach(k => delete newCache[k])
                return { ...newCache, [imagePath]: imageData }
            }
            return { ...prev, [imagePath]: imageData }
        })
    }, [])

    const getGenerationType = (name: string): 'main' | 'i2i' | 'inpaint' | 'upscale' | 'scene' => {
        if (name.includes('INPAINT_')) return 'inpaint'
        if (name.includes('I2I_')) return 'i2i'
        if (name.includes('UPSCALE_')) return 'upscale'
        if (name.includes('SCENE_')) return 'scene'
        return 'main'
    }

    // Get icon component for generation type
    const getTypeIcon = (type: 'main' | 'i2i' | 'inpaint' | 'upscale' | 'scene') => {
        switch (type) {
            case 'i2i': return <ImageIcon className="h-3 w-3 text-indigo-400" />
            case 'inpaint': return <Paintbrush className="h-3 w-3 text-pink-400" />
            case 'upscale': return <Maximize2 className="h-3 w-3 text-purple-400" />
            case 'scene': return <Film className="h-3 w-3 text-emerald-400" />
            default: return <ImageIcon className="h-3 w-3 text-amber-500" />
        }
    }

    // Load images from save path
    const loadSavedImages = async () => {
        setIsLoading(true)
        try {
            const images: SavedImage[] = []
            const picturePath = await pictureDir()

            // 1. Load Main Output Images - Always load from Pictures/NAIS_Output first
            const defaultOutputDir = 'NAIS_Output'

            // Always load from Pictures/NAIS_Output for backward compatibility
            try {
                if (await exists(defaultOutputDir, { baseDir: BaseDirectory.Picture })) {
                    const entries = await readDir(defaultOutputDir, { baseDir: BaseDirectory.Picture })

                    for (const entry of entries) {
                        if (entry.name && (entry.name.toLowerCase().endsWith('.png') || entry.name.toLowerCase().endsWith('.jpg') || entry.name.toLowerCase().endsWith('.webp'))) {
                            const fullPath = await join(picturePath, defaultOutputDir, entry.name)
                            const match = entry.name.match(/_(\d+)\.[^.]+$/)
                            const timestamp = match ? parseInt(match[1]) : 0
                            images.push({
                                name: entry.name,
                                path: fullPath,
                                timestamp,
                                type: getGenerationType(entry.name)
                            })
                        }
                    }
                }
            } catch (e) {
                console.warn('Failed to load from default Pictures folder:', e)
            }

            // Additionally load from absolute path if set
            if (useAbsolutePath && savePath) {
                try {
                    if (await exists(savePath)) {
                        const entries = await readDir(savePath)

                        for (const entry of entries) {
                            if (entry.name && (entry.name.toLowerCase().endsWith('.png') || entry.name.toLowerCase().endsWith('.jpg') || entry.name.toLowerCase().endsWith('.webp'))) {
                                const fullPath = await join(savePath, entry.name)

                                // Skip duplicates
                                if (images.some(img => img.path === fullPath)) continue

                                const match = entry.name.match(/_(\d+)\.[^.]+$/)
                                const timestamp = match ? parseInt(match[1]) : 0
                                images.push({
                                    name: entry.name,
                                    path: fullPath,
                                    timestamp,
                                    type: getGenerationType(entry.name)
                                })
                            }
                        }
                    }
                } catch (e) {
                    console.warn('Failed to load from absolute path:', e)
                }
            }

            // 2. Load Scene Images (Recursive) - Always load from Pictures, plus absolute path if set
            const sceneBaseDir = 'NAIS_Scene'
            const scenePicturePath = await pictureDir()

            // Helper: recursively collect scene images at ANY depth under
            // NAIS_Scene. Supports both:
            //   {preset}/{scene}/img                       (normal)
            //   {preset}/{character}/{scene}/img           (character rotation)
            // and the legacy {scene}/img layout.
            const MAX_SCENE_DEPTH = 4
            const isSceneImage = (n?: string) => !!n && (
                n.toLowerCase().endsWith('.png') || n.toLowerCase().endsWith('.jpg') || n.toLowerCase().endsWith('.webp')
            )

            const loadSceneImagesFromDir = async (baseDir: string, useBaseDir: boolean = false) => {
                const walk = async (relDir: string, absDir: string, depth: number) => {
                    let entries
                    try {
                        entries = useBaseDir
                            ? await readDir(relDir, { baseDir: BaseDirectory.Picture })
                            : await readDir(absDir)
                    } catch (e) {
                        console.warn('Failed to read scene dir:', useBaseDir ? relDir : absDir, e)
                        return
                    }

                    for (const entry of entries) {
                        if (!entry.name) continue
                        if (entry.isDirectory) {
                            if (depth >= MAX_SCENE_DEPTH) continue
                            if (useBaseDir) await walk(`${relDir}/${entry.name}`, '', depth + 1)
                            else await walk('', await join(absDir, entry.name), depth + 1)
                        } else if (isSceneImage(entry.name)) {
                            const fullPath = useBaseDir
                                ? await join(scenePicturePath, relDir, entry.name)
                                : await join(absDir, entry.name)

                            if (images.some(img => img.path === fullPath)) continue

                            const match = entry.name.match(/_(\d+)\.[^.]+$/)
                            const timestamp = match ? parseInt(match[1]) : 0

                            images.push({
                                name: entry.name,
                                path: fullPath,
                                timestamp,
                                type: 'scene'
                            })
                        }
                    }
                }

                try {
                    if (useBaseDir) {
                        if (!(await exists(sceneBaseDir, { baseDir: BaseDirectory.Picture }))) return
                        await walk(sceneBaseDir, '', 0)
                    } else {
                        if (!(await exists(baseDir))) return
                        await walk('', baseDir, 0)
                    }
                } catch (e) {
                    console.warn('Failed to load scene images from:', baseDir, e)
                }
            }

            // Always load from Pictures/NAIS_Scene (for backward compatibility)
            await loadSceneImagesFromDir(sceneBaseDir, true)

            // Additionally load from absolute path if set
            if (useAbsolutePath && savePath) {
                const absoluteSceneDir = await join(savePath, sceneBaseDir)
                await loadSceneImagesFromDir(absoluteSceneDir, false)
            }

            images.sort((a, b) => b.timestamp - a.timestamp)

            // Merge with existing temporary images
            setSavedImages(prev => {
                const tempImages = prev.filter(img => img.isTemporary)
                // Enforce limit on merge just in case
                const sortedTemp = tempImages.sort((a, b) => b.timestamp - a.timestamp).slice(0, 10)

                const combined = [...images, ...sortedTemp]
                return combined.sort((a, b) => b.timestamp - a.timestamp)
            })

            // NOTE: Removed pre-loading of thumbnails using readFile to prevent UI lag.
            // Using convertFileSrc in the render loop is much more efficient as it uses native asset handling.
        } catch (error) {
            console.error('Failed to load history:', error)
            setSavedImages([])
        }
        setIsLoading(false)
    }

    useEffect(() => {
        loadSavedImages()
    }, [savePath])

    // Listen for instant image updates from generation
    useEffect(() => {
        const handler = (e: CustomEvent<{ path: string; data: string }>) => {
            const { path, data } = e.detail
            addNewImage(path, data)
        }

        window.addEventListener('newImageGenerated', handler as EventListener)
        return () => window.removeEventListener('newImageGenerated', handler as EventListener)
    }, [addNewImage])

    // Fallback auto-refresh when generation completes (if event wasn't fired)
    useEffect(() => {
        if (prevIsGenerating.current && !isGenerating) {
            const timer = setTimeout(() => loadSavedImages(), 2000)
            return () => clearTimeout(timer)
        }
        prevIsGenerating.current = isGenerating
    }, [isGenerating])

    // Auto-refresh when scene generates images (triggered by scene store)
    const historyRefreshTrigger = useSceneStore(s => s.historyRefreshTrigger)
    const prevTrigger = useRef(historyRefreshTrigger)
    useEffect(() => {
        if (prevTrigger.current !== historyRefreshTrigger && historyRefreshTrigger > 0) {
            // Scene generation added an image, refresh after delay
            const timer = setTimeout(() => loadSavedImages(), 1500)
            prevTrigger.current = historyRefreshTrigger
            return () => clearTimeout(timer)
        }
    }, [historyRefreshTrigger])


    const handleImageClick = async (image: SavedImage) => {
        let finalDataUrl = imageThumbnails[image.path]

        // Load if missing (unless temporary)
        if (!finalDataUrl && !image.isTemporary) {
            try {
                const data = await readFile(image.path)
                const base64 = arrayBufferToBase64(data)
                finalDataUrl = `data:image/png;base64,${base64}`
                setImageThumbnails(prev => ({ ...prev, [image.path]: finalDataUrl }))
            } catch (e) {
                console.error('Failed to load image:', e)
                return
            }
        }

        // Set preview
        setPreviewImage(finalDataUrl)

        // Show seed (Preview only)
        try {
            const metadata = await parseMetadataFromBase64(finalDataUrl)
            if (metadata && metadata.seed) {
                // Determine if this seed is different from current generation seed
                const genStore = useGenerationStore.getState()
                if (genStore.seed !== metadata.seed) {
                    genStore.setPreviewSeed(metadata.seed)
                } else {
                    genStore.setPreviewSeed(null)
                }
            } else {
                useGenerationStore.getState().setPreviewSeed(null)
            }
        } catch (error) {
            console.warn('Failed to parse metadata for seed sync:', error)
            useGenerationStore.getState().setPreviewSeed(null)
        }

        navigate('/') // Navigate to main mode to show the image
    }

    const handleDeleteImage = async (image: SavedImage, e?: React.MouseEvent) => {
        e?.stopPropagation()

        // Handle temporary image deletion (just state update)
        if (image.isTemporary) {
            setSavedImages(prev => prev.filter(img => img.path !== image.path))
            setImageThumbnails(prev => {
                const next = { ...prev }
                delete next[image.path]
                return next
            })
            return
        }

        try {
            await remove(image.path)
            setSavedImages(prev => prev.filter(img => img.path !== image.path))
            setImageThumbnails(prev => {
                const next = { ...prev }
                delete next[image.path]
                return next
            })
        } catch (e) {
            console.error('Failed to delete image:', e)
        }
    }

    const handleLoadMetadata = async (image: SavedImage) => {
        let imageData = imageThumbnails[image.path]

        if (!imageData) {
            try {
                const data = await readFile(image.path)
                const base64 = arrayBufferToBase64(data)
                imageData = `data:image/png;base64,${base64}`
                setImageThumbnails(prev => ({ ...prev, [image.path]: imageData }))
            } catch {
                return
            }
        }

        setSelectedImageForMetadata(imageData)
        setMetadataDialogOpen(true)
    }

    const handleCopyImage = async (image: SavedImage) => {
        const imageData = imageThumbnails[image.path]
        if (!imageData) return

        try {
            const response = await fetch(imageData)
            const blob = await response.blob()
            await navigator.clipboard.write([
                new ClipboardItem({ [blob.type]: blob })
            ])
        } catch (e) {
            console.error('Copy failed:', e)
        }
    }

    // Regenerate image with its metadata
    const handleRegenerate = async (image: SavedImage) => {
        if (isGenerating) {
            toast({ title: t('toast.generating', '생성 중입니다...'), variant: 'default' })
            return
        }

        const imageData = imageThumbnails[image.path]


        // Use local variable for data to ensure we have it
        let finalData = imageThumbnails[image.path]
        if (!finalData && !image.isTemporary) {
            try {
                const data = await readFile(image.path)
                const base64 = arrayBufferToBase64(data)
                finalData = `data:image/png;base64,${base64}`
                setImageThumbnails(prev => ({ ...prev, [image.path]: finalData }))
            } catch (e) {
                return
            }
        }

        if (!finalData) return

        const token = useAuthStore.getState().token
        if (!token) {
            toast({ title: t('toast.tokenRequired.title', '토큰 필요'), variant: 'destructive' })
            return
        }

        try {
            const metadata = await parseMetadataFromBase64(imageData)
            if (!metadata) {
                toast({
                    title: t('toast.noMetadata', '메타데이터 없음'),
                    description: t('toast.noMetadataDesc', '이 이미지에서 메타데이터를 찾을 수 없습니다'),
                    variant: 'destructive',
                })
                return
            }

            setIsGenerating(true)
            const newSeed = Math.floor(Math.random() * 4294967295)

            // Map model name to API ID
            const mapModelNameToId = (name?: string): string => {
                if (!name) return 'nai-diffusion-4-5-full'
                const lower = name.toLowerCase()
                if (lower.includes('4.5') || lower.includes('4-5')) {
                    if (lower.includes('curated')) return 'nai-diffusion-4-5-curated'
                    return 'nai-diffusion-4-5-full'
                }
                if (lower.includes('v4') || lower.includes('4')) {
                    if (lower.includes('curated')) return 'nai-diffusion-4-curated-preview'
                    return 'nai-diffusion-4-full'
                }
                if (lower.includes('furry')) return 'nai-diffusion-furry-3'
                if (lower.includes('v3') || lower.includes('3')) return 'nai-diffusion-3'
                return 'nai-diffusion-4-5-full'
            }

            const result = await generateImage(token, {
                prompt: metadata.prompt || '',
                negative_prompt: metadata.negativePrompt || '',
                model: mapModelNameToId(metadata.model),
                width: metadata.width || 832,
                height: metadata.height || 1216,
                steps: metadata.steps || 28,
                cfg_scale: metadata.cfgScale || 5,
                cfg_rescale: metadata.cfgRescale || 0,
                sampler: metadata.sampler || 'k_euler',
                scheduler: metadata.scheduler || 'native',
                smea: metadata.smea ?? true,
                smea_dyn: metadata.smeaDyn ?? false,
                variety: metadata.variety ?? false,
                seed: newSeed,
            })

            if (result.success && result.imageData) {
                setPreviewImage(`data:image/png;base64,${result.imageData}`)

                // Save to disk if autoSave is enabled
                const { autoSave, useAbsolutePath } = useSettingsStore.getState()
                if (autoSave) {
                    try {
                        const binaryString = atob(result.imageData)
                        const bytes = new Uint8Array(binaryString.length)
                        for (let j = 0; j < binaryString.length; j++) {
                            bytes[j] = binaryString.charCodeAt(j)
                        }

                        const fileName = `NAIS_${Date.now()}.png`
                        const outputDir = savePath || 'NAIS_Output'

                        let fullPath: string

                        if (useAbsolutePath) {
                            // Save to absolute path directly
                            const dirExists = await exists(outputDir)
                            if (!dirExists) {
                                await mkdir(outputDir, { recursive: true })
                            }
                            fullPath = await join(outputDir, fileName)
                            await writeFile(fullPath, bytes)
                        } else {
                            // Save relative to Pictures directory
                            const dirExists = await exists(outputDir, { baseDir: BaseDirectory.Picture })
                            if (!dirExists) {
                                await mkdir(outputDir, { baseDir: BaseDirectory.Picture })
                            }
                            await writeFile(`${outputDir}/${fileName}`, bytes, { baseDir: BaseDirectory.Picture })
                            const picPath = await pictureDir()
                            fullPath = await join(picPath, outputDir, fileName)
                        }

                        // Dispatch event for instant history update
                        try {
                            window.dispatchEvent(new CustomEvent('newImageGenerated', {
                                detail: { path: fullPath, data: `data:image/png;base64,${result.imageData}` }
                            }))
                        } catch (e) {
                            console.warn('Failed to dispatch newImageGenerated event:', e)
                        }
                    } catch (e) {
                        console.warn('Failed to save regenerated image:', e)
                    }
                } else {
                    // Auto-save OFF (Regenerate): Dispatch memory-only event
                    const fileName = `NAIS_${Date.now()}.png`
                    const memoryPath = `memory://${fileName}`

                    try {
                        window.dispatchEvent(new CustomEvent('newImageGenerated', {
                            detail: { path: memoryPath, data: `data:image/png;base64,${result.imageData}` }
                        }))
                    } catch (e) {
                        console.warn('Failed to dispatch newImageGenerated event (Memory):', e)
                    }
                }

                toast({ title: t('toast.regenerated', '재생성 완료'), variant: 'success' })
            } else {
                toast({ title: t('toast.generateFailed', '생성 실패'), description: result.error, variant: 'destructive' })
            }
        } catch (e) {
            console.error('Regenerate failed:', e)
        } finally {
            setIsGenerating(false)
        }
    }

    // Open folder containing saved images
    const handleOpenFolder = async (image: SavedImage) => {
        if (image.isTemporary) return
        try {
            await Command.create('explorer', ['/select,', image.path]).execute()
        } catch (e) {
            console.error('Failed to open folder:', e)
        }
    }

    const handleOpenSmartTools = async (image: SavedImage) => {
        setIsLoading(true)
        try {
            let base64 = imageThumbnails[image.path]

            if (!base64 && !image.isTemporary) {
                // Read full image file to pass to tools
                const data = await readFile(image.path)
                base64 = `data:image/png;base64,${arrayBufferToBase64(data)}`
            }

            if (base64) {
                setActiveImage(base64)
                navigate('/tools')
            }
        } catch (e) {
            toast({ title: t('smartTools.error', '이미지 로드 실패'), variant: 'destructive' })
        } finally {
            setIsLoading(false)
        }
    }

    const handleSaveAs = async (image: SavedImage) => {
        try {
            let data: Uint8Array

            if (image.isTemporary) {
                const base64 = imageThumbnails[image.path]
                if (!base64) throw new Error("Image data not found")
                // Convert base64 back to Uint8Array
                const binaryString = atob(base64.split(',')[1])
                data = new Uint8Array(binaryString.length)
                for (let i = 0; i < binaryString.length; i++) {
                    data[i] = binaryString.charCodeAt(i)
                }
            } else {
                data = await readFile(image.path)
            }

            const filePath = await save({
                defaultPath: image.name,
                filters: [{ name: 'PNG Image', extensions: ['png'] }],
            })
            if (filePath) {
                await writeFile(filePath, data)
                toast({ title: t('toast.saved', '저장 완료'), variant: 'success' })
            }
        } catch (e) {
            console.error('Save failed:', e)
            toast({ title: t('toast.saveFailed', '저장 실패'), variant: 'destructive' })
        }
    }

    const handleAddAsReference = async (image: SavedImage) => {
        let imageData = imageThumbnails[image.path]
        if (!imageData && !image.isTemporary) {
            try {
                const data = await readFile(image.path)
                const base64 = arrayBufferToBase64(data)
                imageData = `data:image/png;base64,${base64}`
            } catch { return }
        }
        setSelectedImageForRef(imageData)
        setImageRefDialogOpen(true)
    }

    // Inpainting: Open dialog directly with image (source/mode set when mask is saved)
    const handleInpaint = async (image: SavedImage) => {
        let imageData = imageThumbnails[image.path]
        if (!imageData && !image.isTemporary) {
            try {
                const data = await readFile(image.path)
                const base64 = arrayBufferToBase64(data)
                imageData = `data:image/png;base64,${base64}`
                setImageThumbnails(prev => ({ ...prev, [image.path]: imageData }))
            } catch { return }
        }
        if (!imageData) return
        
        // Only open dialog - source/mode will be set when mask is saved
        setSelectedImageForInpaint(imageData)
        setInpaintDialogOpen(true)
    }

    // I2I: Set source and navigate to main mode
    const handleI2I = async (image: SavedImage) => {
        let imageData = imageThumbnails[image.path]
        if (!imageData && !image.isTemporary) {
            try {
                const data = await readFile(image.path)
                const base64 = arrayBufferToBase64(data)
                imageData = `data:image/png;base64,${base64}`
                setImageThumbnails(prev => ({ ...prev, [image.path]: imageData }))
            } catch { return }
        }
        if (!imageData) return
        
        setSourceImage(imageData)
        setI2IMode('i2i')
        navigate('/')
    }

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="h-12 flex items-center justify-between px-4">
                <span className="text-sm font-medium flex items-center gap-2">
                    <FolderOpen className="h-4 w-4 text-amber-400" />
                    {t('history.title')}
                </span>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                        {t('history.count', { count: savedImages.length })}
                    </span>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={loadSavedImages}
                        disabled={isLoading}
                    >
                        <RefreshCw className={`h-3.5 w-3.5 text-muted-foreground ${isLoading ? 'animate-spin' : ''}`} />
                    </Button>
                </div>
            </div>

            {/* History Grid */}
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                {savedImages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground opacity-50">
                        <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center mb-3">
                            <Clock className="h-6 w-6 opacity-50" />
                        </div>
                        <span className="text-xs">{t('history.empty')}</span>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-2">
                        {savedImages.slice(0, 20).map((image, index) => (
                            <HistoryImageItem
                                key={image.path}
                                image={image}
                                thumbnail={imageThumbnails[image.path]}
                                onLoadComplete={handleImageLoadComplete}
                                index={index}
                                getTypeIcon={getTypeIcon}
                                onImageClick={handleImageClick}
                                onDelete={handleDeleteImage}
                                onSaveAs={handleSaveAs}
                                onCopy={handleCopyImage}
                                onRegenerate={handleRegenerate}
                                onOpenSmartTools={handleOpenSmartTools}
                                onAddAsReference={handleAddAsReference}
                                onInpaint={handleInpaint}
                                onI2I={handleI2I}
                                onOpenFolder={handleOpenFolder}
                                onLoadMetadata={handleLoadMetadata}
                            />
                        ))}
                    </div>
                )}
            </div>

            <MetadataDialog
                open={metadataDialogOpen}
                onOpenChange={(open) => {
                    setMetadataDialogOpen(open)
                    if (!open) setSelectedImageForMetadata(undefined)
                }}
                initialImage={selectedImageForMetadata}
            />

            <ImageReferenceDialog
                open={imageRefDialogOpen}
                onOpenChange={setImageRefDialogOpen}
                imageBase64={selectedImageForRef}
            />

            <InpaintingDialog
                open={inpaintDialogOpen}
                onOpenChange={(open) => {
                    setInpaintDialogOpen(open)
                    if (!open) setSelectedImageForInpaint(null)
                }}
                sourceImage={selectedImageForInpaint}
            />
        </div>
    )
}
