import type {
    SceneAuthoringRecord,
    SceneDocument,
    SceneV1AuthoringRecord,
    SceneV1CompatibilityProjection,
} from './scene-repository'

function projectScene(scene: SceneV1AuthoringRecord): SceneAuthoringRecord {
    const {
        // Legacy image URLs/base64 remain exclusively in the untouched V1 preimage.
        images: _legacyImages,
        compositionRef,
        ...authoring
    } = structuredClone(scene)
    return {
        ...authoring,
        ...(compositionRef === undefined
            ? {}
            : { compositionRef: compositionRef as SceneAuthoringRecord['compositionRef'] }),
        artifactRefs: [],
    }
}

/** Pure V1-to-document projection; callers own persistence and authority switching. */
export function migrateSceneDocuments(
    legacy: SceneV1CompatibilityProjection,
    updatedAt: string,
): readonly SceneDocument[] {
    if (!Number.isFinite(Date.parse(updatedAt))) throw new TypeError('Scene migration timestamp is invalid')
    return legacy.presets.map(preset => ({
        schemaVersion: 1,
        presetId: preset.id,
        revision: 1,
        scenes: preset.scenes.map(projectScene),
        updatedAt,
    }))
}
