import type {
    ActorRef,
    CharacterDefinition,
    CharacterPosition,
    Extensions,
    PromptTarget,
    ResolutionIssue,
} from '@/domain/composition/types'
import { validateCharacterPositionModes } from '@/domain/composition/validation'
import { migrateCharacterPromptIds } from '@/lib/composition/character-prompt-migration'

export interface CharacterTemplatePresetSnapshot {
    id: string
    name: string
    prompt: string
    negative: string
    image?: string
    groupId?: string
}

export interface CharacterTemplateGroupSnapshot {
    id: string
    name: string
    collapsed: boolean
    colorIndex: number
}

export interface CharacterProjectionContext {
    revision: number
    timestamp: string
    actor: ActorRef
}

export interface CharacterPromptProjectionSource {
    id?: string | null
    name?: string
    presetId?: string
    groupId?: string
    prompt?: string | null
    negative?: string | null
    enabled?: boolean | null
    position?: CharacterPosition | { x?: number | null; y?: number | null } | null
}

export interface CharacterPromptProjectionInput {
    characters: readonly CharacterPromptProjectionSource[]
    positionEnabled: boolean
    presets?: readonly CharacterTemplatePresetSnapshot[]
    groups?: readonly CharacterTemplateGroupSnapshot[]
    context: CharacterProjectionContext
}

export interface CharacterPromptProjectionResult {
    success: boolean
    characters: CharacterDefinition[]
    errors: ResolutionIssue[]
    templateExtensions: Extensions
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function coordinate(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.min(1, value))
        : 0.5
}

function projectPosition(
    position: CharacterPromptProjectionSource['position'],
    positionEnabled: boolean,
): CharacterPosition {
    const record: Record<string, unknown> | null = isRecord(position)
        ? position as Record<string, unknown>
        : null
    if (record?.mode === 'ai-choice') {
        return { mode: 'ai-choice' }
    }
    if (record?.mode === 'manual') {
        return {
            mode: 'manual',
            x: coordinate(record.x),
            y: coordinate(record.y),
        }
    }
    if (!positionEnabled) return { mode: 'ai-choice' }
    return {
        mode: 'manual',
        x: record === null ? 0.5 : coordinate(record.x),
        y: record === null ? 0.5 : coordinate(record.y),
    }
}

function revisionFields(context: CharacterProjectionContext) {
    return {
        revision: Math.max(0, Math.trunc(context.revision)),
        createdAt: context.timestamp,
        createdBy: context.actor,
        updatedAt: context.timestamp,
        updatedBy: context.actor,
    }
}

function characterExtensions(character: CharacterPromptProjectionSource): Extensions | undefined {
    const template: Extensions = {}
    if (typeof character.presetId === 'string' && character.presetId.length > 0) {
        template.presetId = character.presetId
    }
    if (typeof character.groupId === 'string' && character.groupId.length > 0) {
        template.groupId = character.groupId
    }
    return Object.keys(template).length === 0 ? undefined : { legacyTemplate: template }
}

/**
 * Keeps legacy character library organization as inert template metadata. The
 * preset image field is intentionally excluded because binary/image storage
 * remains owned by the character resource repository.
 */
export function projectCharacterTemplateExtensions(
    presets: readonly CharacterTemplatePresetSnapshot[] = [],
    groups: readonly CharacterTemplateGroupSnapshot[] = [],
): Extensions {
    return {
        legacyCharacterTemplates: {
            schemaVersion: 2,
            groups: groups.map(group => ({
                id: group.id,
                name: group.name,
                collapsed: group.collapsed,
                colorIndex: group.colorIndex,
            })),
            presets: presets.map(preset => ({
                id: preset.id,
                name: preset.name,
                prompt: preset.prompt,
                negative: preset.negative,
                ...(preset.groupId === undefined ? {} : { groupId: preset.groupId }),
            })),
        },
    }
}

/** Stable character IDs, never list indexes, are used for recipe prompt targets. */
export function createCharacterPromptTarget(
    characterId: string,
    polarity: 'positive' | 'negative',
): PromptTarget {
    return { kind: 'character', characterId, polarity }
}

export function projectCharacterPromptsToV2(
    input: CharacterPromptProjectionInput,
): CharacterPromptProjectionResult {
    const migratedIds = migrateCharacterPromptIds(input.characters)
    const fields = revisionFields(input.context)
    const characters = input.characters.map((source, index): CharacterDefinition => {
        const id = migratedIds.characters[index].id
        const extensions = characterExtensions(source)
        return {
            ...fields,
            id,
            orderKey: `character:${String(index).padStart(6, '0')}`,
            name: source.name?.trim() || id,
            enabled: typeof source.enabled === 'boolean' ? source.enabled : true,
            positivePrompt: typeof source.prompt === 'string' ? source.prompt : '',
            negativePrompt: typeof source.negative === 'string' ? source.negative : '',
            position: projectPosition(source.position, input.positionEnabled),
            resourceBindings: [],
            ...(extensions === undefined ? {} : { extensions }),
        }
    })
    const errors = validateCharacterPositionModes({
        characters: characters.map(character => ({
            characterId: character.id,
            position: character.position,
            enabled: character.enabled,
        })),
        characterPositionEnabled: input.positionEnabled,
        sourceRef: { kind: 'external', source: 'character-prompt-store:v2-projection' },
        fieldPath: ['characters'],
    })

    return {
        success: errors.length === 0,
        characters,
        errors,
        templateExtensions: projectCharacterTemplateExtensions(input.presets, input.groups),
    }
}
