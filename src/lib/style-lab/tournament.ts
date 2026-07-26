import { calculateElo } from './elo'
import {
    getArenaPool as getDomainArenaPool,
    suggestArenaPair,
    type ArenaCandidate as DomainArenaCandidate,
    type ArenaPairPolicyOptions,
    type StyleLabArenaLeague as DomainStyleLabArenaLeague,
} from '@/domain/style-lab/acquisition-policy'

export type StyleLabArenaLeague = DomainStyleLabArenaLeague

export interface ArenaCandidate extends DomainArenaCandidate {}

export interface ArenaBattleRecord extends ArenaCandidate {
    wins: number
    losses: number
    ties?: number
    battles: number
    updatedAt: number
}

/** Legacy battle counters remain a compatibility projection while mu/sigma is authoritative. */
export function applyArenaTieResult<T extends ArenaBattleRecord>(
    combinations: T[],
    leftId: string,
    rightId: string,
    updatedAt: number,
): T[] {
    if (leftId === rightId
        || !combinations.some(combo => combo.id === leftId)
        || !combinations.some(combo => combo.id === rightId)) {
        return combinations
    }
    return combinations.map(combo => (
        combo.id === leftId || combo.id === rightId
            ? {
                ...combo,
                ties: (combo.ties ?? 0) + 1,
                battles: combo.battles + 1,
                updatedAt,
            }
            : combo
    ))
}

export function getArenaPool<T extends ArenaCandidate>(
    combinations: T[],
    league: StyleLabArenaLeague,
): T[] {
    return getDomainArenaPool(combinations, league)
}

export function pickArenaPair<T extends ArenaCandidate>(
    combinations: T[],
    league: StyleLabArenaLeague,
    options: ArenaPairPolicyOptions = {},
): [string, string] | null {
    return suggestArenaPair(combinations, league, options)
}

export function applyArenaBattleResult<T extends ArenaBattleRecord>(
    combinations: T[],
    winnerId: string,
    loserId: string,
    updatedAt: number,
): T[] {
    const winner = combinations.find(combo => combo.id === winnerId)
    const loser = combinations.find(combo => combo.id === loserId)
    if (!winner || !loser) return combinations

    const updated = calculateElo(winner.elo, loser.elo)
    return combinations.map(combo => {
        if (combo.id === winnerId) {
            return {
                ...combo,
                elo: updated.winner,
                wins: combo.wins + 1,
                battles: combo.battles + 1,
                updatedAt,
            }
        }
        if (combo.id === loserId) {
            return {
                ...combo,
                elo: updated.loser,
                losses: combo.losses + 1,
                battles: combo.battles + 1,
                updatedAt,
            }
        }
        return combo
    })
}
