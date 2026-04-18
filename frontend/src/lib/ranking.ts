// MDCT-style ranked-choice scoring utilities.
//
// The decay model gives rank-1 the full score and each subsequent rank
// a fraction: score(rank) = 1 / rank.
// This matches the on-chain storage (r1 … r8 = option IDs at each rank).

import type { VoteRanking } from '../types'

/** Convert a VoteRanking map to the 8-slot array [r1..r8] sent on-chain.
 *  Unranked options are padded with 0. */
export function rankingToSlots(ranking: VoteRanking, _optionCount: number): number[] {
  // Sort option ids by rank (ascending)
  const ranked = Object.entries(ranking)
    .filter(([, rank]) => rank > 0)
    .sort(([, a], [, b]) => a - b)
    .map(([id]) => Number(id))

  const slots = Array(8).fill(0)
  ranked.forEach((optId, i) => { slots[i] = optId })
  return slots
}

/** Aggregate an array of 8-slot vote arrays into a score per option.
 *  score(optId, voteSlots) = sum over all votes of (1/rank) if optId appears at that rank. */
export function aggregateScores(
  votes: number[][],
  optionIds: number[],
): Map<number, number> {
  const scores = new Map<number, number>(optionIds.map(id => [id, 0]))

  for (const slots of votes) {
    slots.forEach((optId, i) => {
      if (optId === 0) return          // unranked slot
      const rank = i + 1
      const weight = 1 / rank
      scores.set(optId, (scores.get(optId) ?? 0) + weight)
    })
  }

  return scores
}

/** Sort options by descending score. Returns [(optionId, score)] pairs. */
export function rankResults(scores: Map<number, number>): [number, number][] {
  return [...scores.entries()].sort(([, a], [, b]) => b - a)
}

/** Local UI key to track vote state before on-chain confirmation.
 *  Double-vote prevention is handled on-chain via hasVoted[pollId][msg.sender]. */
export function localVoteKey(pollId: `0x${string}`, address: `0x${string}`): string {
  return `${pollId}:${address}`
}
