import type {
    SceneResultPresentationPort,
    SceneResultProjection,
} from '@/application/scene/scene-result-presentation-port'
import { toast } from '@/components/ui/use-toast'
import i18n from '@/i18n'
import { publishGeneratedArtifact } from '@/stores/artifact-lifecycle-store'
import { useCharacterStore } from '@/stores/character-store'
import { useGenerationStore } from '@/stores/generation-store'
import { getScenePresetPathSegments, useSceneStore } from '@/stores/scene-store'
import { useSettingsStore } from '@/stores/settings-store'

/**
 * Projects committed Scene output into the existing Zustand read models and
 * supplies legacy output defaults. Durable Queue snapshots override those
 * defaults before this adapter receives the committed result.
 */
export function createZustandSceneResultPresentation(): SceneResultPresentationPort {
    const presentation: SceneResultPresentationPort = {
        readOutputDefaults: presetId => {
            const generation = useGenerationStore.getState()
            const scene = useSceneStore.getState()
            const settings = useSettingsStore.getState()
            const preset = scene.presets.find(candidate => candidate.id === presetId)
            return {
                useAbsoluteScenePath: settings.useAbsoluteScenePath,
                metadataMode: settings.metadataMode,
                presetName: preset?.name ?? 'Default',
                presetPathSegments: getScenePresetPathSegments(scene.presets, presetId),
                fallbackPromptParts: {
                    base: generation.basePrompt,
                    additional: generation.additionalPrompt,
                    detail: generation.detailPrompt,
                    negative: generation.negativePrompt,
                    inpainting: generation.inpaintingPrompt,
                },
            }
        },
        commitResult: (result: SceneResultProjection) => {
            useSceneStore.getState().addImageToScene(result.presetId, result.sceneId, result.path)
            useGenerationStore.getState().addToHistory({
                id: result.historyId,
                url: result.path,
                thumbnail: result.thumbnail,
                prompt: result.prompt,
                seed: result.seed,
                timestamp: new Date(),
                sentPayloadSummary: result.sentPayloadSummary,
                ...(result.artifactId === undefined ? {} : { artifactId: result.artifactId }),
                ...(result.sourceJobId === undefined ? {} : { sourceJobId: result.sourceJobId }),
                ...(result.sourceSceneId === undefined ? {} : { sourceSceneId: result.sourceSceneId }),
            })
            publishGeneratedArtifact({
                path: result.path,
                ...(result.artifactId === undefined ? {} : { artifactId: result.artifactId }),
                ...(result.sourceJobId === undefined ? {} : { sourceJobId: result.sourceJobId }),
                ...(result.sourceSceneId === undefined ? {} : { sourceSceneId: result.sourceSceneId }),
            })
        },
        rollbackResult: result => {
            useSceneStore.setState(state => ({
                presets: state.presets.map(preset => preset.id === result.presetId
                    ? {
                        ...preset,
                        scenes: preset.scenes.map(scene => scene.id === result.sceneId
                            ? { ...scene, images: scene.images.filter(image => image.url !== result.path) }
                            : scene),
                    }
                    : preset),
            }))
            if (result.historyId !== null) {
                useGenerationStore.setState(state => ({
                    history: state.history.filter(item => item.id !== result.historyId),
                }))
            }
        },
        reportCapabilityFallback: (reason, alternative) => {
            toast({
                title: i18n.t(
                    'composition.outputCapabilityFallbackTitle',
                    'Output destination changed for this platform',
                ),
                description: i18n.t(
                    'composition.outputCapabilityFallbackDescription',
                    '{{reason}} Alternative: {{alternative}}',
                    { reason: reason ?? '', alternative: alternative ?? '' },
                ),
            })
        },
        updateEncodedVibes: encodedVibes => {
            const { vibeImages, updateVibeImage } = useCharacterStore.getState()
            let encodedIndex = 0
            for (let index = 0; index < vibeImages.length && encodedIndex < encodedVibes.length; index += 1) {
                if (!vibeImages[index].encodedVibe) {
                    updateVibeImage(vibeImages[index].id, { encodedVibe: encodedVibes[encodedIndex] })
                    encodedIndex += 1
                }
            }
        },
    }
    return Object.freeze(presentation)
}
