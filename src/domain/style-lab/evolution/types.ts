export const STYLE_EVOLUTION_ALGORITHM_VERSION = 'style-map-elites-lite-v1' as const
export const STYLE_EVOLUTION_LINEAGE_SCHEMA_VERSION = 1 as const
export const STYLE_EVOLUTION_ARCHIVE_SCHEMA_VERSION = 1 as const

export type StyleEvolutionTagKind = 'artist' | 'style' | 'quality' | 'subject' | 'plain'

export interface StyleEvolutionTag {
    tag: string
    kind: StyleEvolutionTagKind
    weight: number
    artist?: string
}

export type StyleEvolutionOperator =
    | 'tag-add'
    | 'tag-delete'
    | 'tag-replace'
    | 'weight-jitter'
    | 'weight-mix'
    | 'order-swap'
    | 'order-move'
    | 'parent-splice'
    | 'legacy-import'

export interface EvolutionLineage {
    schemaVersion: typeof STYLE_EVOLUTION_LINEAGE_SCHEMA_VERSION
    id: string
    childId: string
    boardId: string | null
    parentIds: string[]
    operator: StyleEvolutionOperator
    diff: string[]
    rngSeed: number
    algorithmVersion: typeof STYLE_EVOLUTION_ALGORITHM_VERSION
    generation: number
    createdAt: number
}

export type StyleTagCountBin = 'compact' | 'balanced' | 'dense'
export type StyleWeightShape = 'flat' | 'mixed' | 'focused'

export interface StyleEvolutionCellAxes {
    tagCount: StyleTagCountBin
    weightShape: StyleWeightShape
}

export interface StyleArchiveMember {
    comboId: string
    score: number
    uncertainty: number
    novelty: number
    niche: string
}

export interface StyleEvolutionArchiveCell {
    schemaVersion: typeof STYLE_EVOLUTION_ARCHIVE_SCHEMA_VERSION
    id: string
    boardId: string
    key: string
    axes: StyleEvolutionCellAxes
    elite: StyleArchiveMember | null
    challenger: StyleArchiveMember | null
    novel: StyleArchiveMember | null
    updatedAt: number
}

export interface EvolutionProposal {
    tags: StyleEvolutionTag[]
    parentIds: string[]
    operator: Exclude<StyleEvolutionOperator, 'legacy-import'>
    diff: string[]
    rngSeed: number
    generation: number
    predictedUtility: number
    uncertainty: number
    novelty: number
    preScore: number
    archiveKey: string
}
