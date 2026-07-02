// @ts-ignore
import { Client } from "@gradio/client";

export interface TagResult {
    label: string
    score: number
}

/**
 * Singleton class to manage Smart Tools
 */
class SmartToolsService {
    private static instance: SmartToolsService

    private constructor() { }

    public static getInstance(): SmartToolsService {
        if (!SmartToolsService.instance) {
            SmartToolsService.instance = new SmartToolsService()
        }
        return SmartToolsService.instance
    }

    /**
     * Analyze Artist/Style using Kaloscope (Hugging Face Space API)
     */
    public async analyzeStyle(imageUrl: string, _progressCallback?: (progress: number) => void): Promise<TagResult[]> {
        try {
            const response = await fetch(imageUrl);
            const blob = await response.blob();

            console.log("SmartTools: Connecting to Kaloscope API...");
            const client = await Client.connect("DraconicDragon/Kaloscope-artist-style-classifier");

            const result = await client.predict("/predict", {
                image: blob
            });

            console.log("Kaloscope raw result:", result);

            const dataArray = result.data as any[];
            const rawData = dataArray?.[0];

            if (typeof rawData === 'string') {
                const artists = rawData.split(',').map(a => a.trim()).filter(a => a.length > 0);
                return artists.map((artist, index) => ({
                    label: `artist:${artist}`,
                    score: 1 - (index * 0.05)
                }));
            }

            if (typeof rawData === 'object' && rawData !== null) {
                const entries = Object.entries(rawData as Record<string, number>);
                return entries
                    .map(([label, score]) => ({ label: `artist:${label}`, score }))
                    .sort((a, b) => b.score - a.score);
            }

            console.warn("Kaloscope: Unexpected result format", rawData);
            return [];
        } catch (e) {
            console.error("Kaloscope API Error:", e);
            throw new Error("Failed to connect to Kaloscope API. Internet connection required.");
        }
    }

    /**
     * Remove background from an image using Hugging Face Space
     * Uses BRIA-RMBG-2.0 API with fallback to anime-remove-background
     */
    public async removeBackground(
        imageUrl: string,
        _progressCallback?: (progress: number) => void
    ): Promise<string> {
        const response = await fetch(imageUrl);
        const blob = await response.blob();

        // Step 1: Try BRIA-RMBG-2.0 (best quality)
        try {
            console.log("SmartTools: Trying briaai/BRIA-RMBG-2.0...");
            const client = await Client.connect("briaai/BRIA-RMBG-2.0");
            const result = await client.predict("/image", { image: blob });

            const outputData = (result.data as any[])?.[0]?.[0] || (result.data as any[])?.[1];
            if (outputData) {
                return await this.processGradioOutput(outputData);
            }
        } catch (e: any) {
            console.warn("BRIA-RMBG-2.0 failed:", e?.message);
        }

        // Step 2: Fallback skytnt/anime-remove-background
        try {
            console.log("SmartTools: Trying skytnt/anime-remove-background...");
            const client = await Client.connect("skytnt/anime-remove-background");
            const result = await client.predict("/rmbg_fn", { img: blob });

            const outputData = (result.data as any[])?.[0];
            if (outputData) {
                return await this.processGradioOutput(outputData);
            }
        } catch (e: any) {
            console.warn("anime-remove-background failed:", e?.message);
        }

        throw new Error("모든 배경 제거 서비스 연결 실패. 잠시 후 다시 시도해주세요.");
    }

    /**
     * Process Gradio output (URL, path, or data URL)
     */
    private async processGradioOutput(outputData: any): Promise<string> {
        if (typeof outputData === 'string') {
            if (outputData.startsWith('http')) {
                const imgResponse = await fetch(outputData);
                const imgBlob = await imgResponse.blob();
                return await this.blobToDataUrl(imgBlob);
            }
            if (outputData.startsWith('data:')) {
                return outputData;
            }
        } else if (outputData.url) {
            const imgResponse = await fetch(outputData.url);
            const imgBlob = await imgResponse.blob();
            return await this.blobToDataUrl(imgBlob);
        }
        throw new Error("Invalid output format");
    }

    /**
     * Convert Blob to Data URL
     */
    private blobToDataUrl(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    /**
     * Run NAI Director Tools (augment-image API)
     * Supports: bg-removal, lineart, sketch, colorize, emotion, declutter
     */
    public async directorTool(
        imageInput: string,
        token: string,
        reqType: 'bg-removal' | 'lineart' | 'sketch' | 'colorize' | 'emotion' | 'declutter',
        options?: { defry?: number; prompt?: string; emotion?: string }
    ): Promise<string> {
        const { augmentImage } = await import('@/services/novelai-api')

        // Convert URL to base64 data URL if needed
        let imageBase64 = imageInput
        if (!imageInput.startsWith('data:')) {
            const response = await fetch(imageInput)
            const blob = await response.blob()
            imageBase64 = await this.blobToDataUrl(blob)
        }

        const img = new Image()
        await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve()
            img.onerror = reject
            img.src = imageBase64
        })
        const width = img.width
        const height = img.height
        img.src = ''

        // For emotion type, combine emotion and prompt as "emotion;;prompt"
        let prompt = options?.prompt
        if (reqType === 'emotion' && options?.emotion) {
            prompt = `${options.emotion};;${options.prompt || ''}`
        }

        const result = await augmentImage(
            token,
            imageBase64,
            width,
            height,
            reqType,
            options?.defry,
            prompt,
        )

        if (!result.success || !result.imageData) {
            throw new Error(result.error || 'Director tool failed')
        }

        return `data:image/png;base64,${result.imageData}`
    }

    /**
     * Upscale image using NovelAI's upscale API (4x)
     */
    public async upscale(imageInput: string, token: string): Promise<string> {
        const { upscaleImage } = await import('@/services/novelai-api')

        // Convert URL to base64 data URL if needed
        let imageBase64 = imageInput
        if (!imageInput.startsWith('data:')) {
            const response = await fetch(imageInput)
            const blob = await response.blob()
            imageBase64 = await this.blobToDataUrl(blob)
        }

        const img = new Image()
        await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve()
            img.onerror = reject
            img.src = imageBase64
        })

        const width = img.width
        const height = img.height
        img.src = ''

        const result = await upscaleImage(token, imageBase64, width, height)

        if (!result.success || !result.imageData) {
            throw new Error(result.error || 'Upscale failed')
        }

        return `data:image/png;base64,${result.imageData}`
    }
}

export const smartTools = SmartToolsService.getInstance()
