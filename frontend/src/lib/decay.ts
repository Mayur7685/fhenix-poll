// MetaPoll-compatible decay model — step-function, not continuous.
// VP halves every completed 400-day period. After 5 periods: 0% (deactivated).
//
// | Periods completed | Days        | Voting Power |
// |-------------------|-------------|--------------|
// | 0                 | 0 – 399     | 100%         |
// | 1                 | 400 – 799   |  50%         |
// | 2                 | 800 – 1,199 |  25%         |
// | 3                 | 1,200–1,599 |  12.5%       |
// | 4                 | 1,600–1,999 |   6.25%      |
// | 5+                | 2,000+      |   0% (dead)  |

/** Arbitrum Sepolia: block.number = L1 Ethereum Sepolia (~12 s) → 7200 blocks/day */
const BLOCKS_PER_DAY    = 7_200
const PERIOD_DAYS       = 400
const PERIOD_BLOCKS     = PERIOD_DAYS * BLOCKS_PER_DAY   // 2_304_000
const MAX_PERIODS       = 5

// ─── Core calculations ────────────────────────────────────────────────────────

/** Number of completed 400-day periods since issuedAtBlock. */
export function completedPeriods(issuedAtBlock: number, currentBlock: number): number {
  if (currentBlock <= issuedAtBlock) return 0
  return Math.min(Math.floor((currentBlock - issuedAtBlock) / PERIOD_BLOCKS), MAX_PERIODS)
}

/** Voting Power % (0–100). Matches MetaPoll step table exactly. */
export function votingPowerPct(issuedAtBlock: number, currentBlock: number): number {
  const p = completedPeriods(issuedAtBlock, currentBlock)
  if (p >= MAX_PERIODS) return 0
  return 100 / Math.pow(2, p)   // 100, 50, 25, 12.5, 6.25
}

/** Counted Votes = floor(EV × VP%). */
export function countedVotes(eligibleVotes: number, issuedAtBlock: number, currentBlock: number): number {
  const vp = votingPowerPct(issuedAtBlock, currentBlock)
  return Math.floor(eligibleVotes * (vp / 100))
}

/** Days elapsed since issuance block. */
export function daysElapsed(issuedAtBlock: number, currentBlock: number): number {
  if (currentBlock <= issuedAtBlock) return 0
  return Math.floor((currentBlock - issuedAtBlock) / BLOCKS_PER_DAY)
}

/** Days until the next decay period completes (shows in "Decays in X days" label). */
export function daysUntilNextDecay(issuedAtBlock: number, currentBlock: number): number {
  const p = completedPeriods(issuedAtBlock, currentBlock)
  if (p >= MAX_PERIODS) return 0
  const elapsedBlocks = Math.max(0, currentBlock - issuedAtBlock)
  const blocksIntoCurrentPeriod = elapsedBlocks % PERIOD_BLOCKS
  const blocksLeft = PERIOD_BLOCKS - blocksIntoCurrentPeriod
  return Math.ceil(blocksLeft / BLOCKS_PER_DAY)
}

/** Progress through the current period (0–1). Used for the decay progress bar. */
export function periodProgress(issuedAtBlock: number, currentBlock: number): number {
  const p = completedPeriods(issuedAtBlock, currentBlock)
  if (p >= MAX_PERIODS) return 1
  const elapsedBlocks = Math.max(0, currentBlock - issuedAtBlock)
  return (elapsedBlocks % PERIOD_BLOCKS) / PERIOD_BLOCKS
}

// ─── Tailwind colour helpers ─────────────────────────────────────────────────

export function vpTextColour(pct: number): string {
  if (pct === 100) return 'text-emerald-600'
  if (pct >= 50)   return 'text-yellow-500'
  if (pct > 0)     return 'text-orange-500'
  return 'text-red-500'
}

export function vpBarColour(pct: number): string {
  if (pct === 100) return 'bg-emerald-500'
  if (pct >= 50)   return 'bg-yellow-400'
  if (pct > 0)     return 'bg-orange-400'
  return 'bg-red-400'
}

// ─── Legacy aliases (used by existing ZKCredentialPanel + snapshot_tally code) ─

/** @deprecated Use MAX_PERIODS directly. */
export const MAX_DECAY_CYCLES = MAX_PERIODS

/** @deprecated Use votingPowerPct() instead. */
export function computeVotePower(castAtBlock: number, currentBlock: number): number {
  return votingPowerPct(castAtBlock, currentBlock) / 100
}

/** @deprecated Use completedPeriods() instead. */
export function decayCycle(castAtBlock: number, currentBlock: number): number {
  return completedPeriods(castAtBlock, currentBlock)
}

/** Off-chain MDCT score preview (not authoritative — operator snapshot is). */
export function computeMDCTScores(
  votes: Array<{ rankings: number[]; cast_at: number }>,
  currentBlock: number,
): Array<{ optionId: number; score: number }> {
  const scores: Record<number, number> = {}
  for (const vote of votes) {
    const vp = votingPowerPct(vote.cast_at, currentBlock) / 100
    if (vp === 0) continue
    vote.rankings.forEach((optId, idx) => {
      if (optId === 0) return
      const posWeight = 1 / (idx + 1)   // rank 1 = 1.0, rank 2 = 0.5, …
      scores[optId] = (scores[optId] ?? 0) + vp * posWeight
    })
  }
  return Object.entries(scores)
    .sort(([, a], [, b]) => b - a)
    .map(([optId, score]) => ({ optionId: Number(optId), score }))
}
