// Credential hub hook — viem contract reads for EV / VP% / CV numbers + recast action.

import { useState, useEffect, useCallback } from 'react'
import { useWallet } from './useWallet'
import { useVoting } from './useVoting'
import { getBlockHeight, getCredential } from '../lib/fhenix'
import {
  votingPowerPct,
  countedVotes,
  daysUntilNextDecay,
  completedPeriods,
  daysElapsed,
  periodProgress,
} from '../lib/decay'
import type { Credential, VoteRanking, CommunityConfig } from '../types'

export interface CredentialHubState {
  credential:     Credential | null
  currentBlock:   number
  loading:        boolean

  // MetaPoll 3-number model
  eligibleVotes:  number   // EV — from credential.votingWeight (normalised to 0–100 scale)
  vpPct:          number   // VP% — step-function decay
  cv:             number   // CV = floor(EV × VP%)
  periods:        number   // completed decay periods (0–5)
  daysLeft:       number   // days until next decay period
  elapsed:        number   // days since credential issued
  progress:       number   // 0–1 through current period (for progress bar)

  isExpired:      boolean
  isDeactivated:  boolean  // VP = 0%

  recast:         (pollId: `0x${string}`, ranking: VoteRanking, optionCount: number) => Promise<void>
  refresh:        () => Promise<void>
}

export function useCredentialHub(community: CommunityConfig): CredentialHubState {
  const { address, isConnected } = useWallet()
  const { castVote }             = useVoting()

  const [credential, setCredential]       = useState<Credential | null>(null)
  const [currentBlock, setCurrentBlock]   = useState(0)
  const [loading, setLoading]             = useState(true)

  const communityId = community.community_id as `0x${string}`

  const load = useCallback(async () => {
    if (!isConnected || !address) { setLoading(false); setCredential(null); return }
    setLoading(true)
    try {
      const [raw, block] = await Promise.all([
        getCredential(address, communityId),
        getBlockHeight(),
      ])

      if (raw && (raw as { exists: boolean }).exists) {
        const r = raw as {
          holder: `0x${string}`;
          communityId: `0x${string}`;
          credType: number;
          votingWeight: bigint;
          issuedAt: number;
          expiry: number;
          exists: boolean;
        }
        const cred: Credential = {
          holder:      r.holder,
          communityId: r.communityId,
          credType:    r.credType,
          votingWeight: r.votingWeight,
          issuedAt:    r.issuedAt,
          expiry:      r.expiry,
          exists:      r.exists,
          // Legacy compat
          voting_weight: Number(r.votingWeight),
          expiry_block:  r.expiry,
          issued_at:     r.issuedAt,
        }
        setCredential(cred)
      } else {
        setCredential(null)
      }
      setCurrentBlock(block)
    } finally {
      setLoading(false)
    }
  }, [isConnected, address, communityId])

  useEffect(() => { void load() }, [load])

  // Decay numbers
  const issuedAt      = credential?.issuedAt ?? 0
  const expiryBlock   = credential?.expiry   ?? 0
  // EV: scale 1_000_000 → 100 (percentage points for display)
  const eligibleVotes = credential ? Math.round(Number(credential.votingWeight) / 10_000) : 1
  const vpPct         = credential ? votingPowerPct(issuedAt, currentBlock) : 0
  const cv            = credential ? countedVotes(eligibleVotes, issuedAt, currentBlock) : 0
  const periods       = credential ? completedPeriods(issuedAt, currentBlock) : 0
  const daysLeft      = credential ? daysUntilNextDecay(issuedAt, currentBlock) : 400
  const elapsed       = credential ? daysElapsed(issuedAt, currentBlock) : 0
  const progress      = credential ? periodProgress(issuedAt, currentBlock) : 0
  const isExpired     = !!credential && currentBlock > expiryBlock
  const isDeactivated = vpPct === 0 && !!credential

  const recast = useCallback(async (
    pollId: `0x${string}`,
    ranking: VoteRanking,
    optionCount: number,
  ) => {
    if (!credential) return
    await castVote(pollId, ranking, optionCount, Number(credential.votingWeight))
    await load()
  }, [credential, castVote, load])

  return {
    credential,
    currentBlock,
    loading,
    eligibleVotes,
    vpPct,
    cv,
    periods,
    daysLeft,
    elapsed,
    progress,
    isExpired,
    isDeactivated,
    recast,
    refresh: load,
  }
}
