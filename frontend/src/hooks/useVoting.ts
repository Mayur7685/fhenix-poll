// FHE voting hook — encrypts per-option weights client-side then submits castVote() on-chain.
// Follows the walnut pattern: useCofheEncrypt + useCofheWriteContract.

import { useState, useCallback } from 'react'
import { Encryptable } from '@cofhe/sdk'
import { useCofheEncrypt, useCofheWriteContract } from '@cofhe/react'
import { useConnection, usePublicClient } from 'wagmi'
import { arbitrumSepolia } from '../lib/chains'
import { FHENIX_POLL_ABI, CONTRACT_ADDRESS } from '../lib/abi'
import { getGasFees, estimateCastVoteGas } from '../lib/gas'
import type { VoteRanking } from '../types'

export type VoteStatus =
  | 'idle'
  | 'encrypting'
  | 'signing'
  | 'confirming'
  | 'done'
  | 'error'

export function useVoting() {
  const { address }              = useConnection()
  const publicClient             = usePublicClient()
  const { encryptInputsAsync }   = useCofheEncrypt()
  const { writeContractAsync }   = useCofheWriteContract()

  const [status, setStatus]       = useState<VoteStatus>('idle')
  const [txHash, setTxHash]       = useState<`0x${string}` | null>(null)
  const [error, setError]         = useState<string | null>(null)

  const castVote = useCallback(async (
    pollId:      `0x${string}`,
    ranking:     VoteRanking,      // optionId → rank (1=best)
    optionCount: number,
    /** Voting power 0–1_000_000 (from credential.votingWeight). Default 1_000_000. */
    votingPower = 1_000_000,
  ) => {
    if (!address) { setError('Wallet not connected'); return }

    setStatus('encrypting'); setError(null); setTxHash(null)

    try {
      // 1. Compute per-option weights (MDCT 1/rank scoring)
      const rawWeights = computeOptionWeights(ranking, optionCount, votingPower)

      // 2. Encrypt each weight using @cofhe/react
      const encrypted = await encryptInputsAsync(
        rawWeights.map(w => Encryptable.uint32(BigInt(w)))
      )

      // 3. Shape for contract: { ctHash, securityZone, utype, signature }
      const encodedWeights = encrypted.map(e => ({
        ctHash:       e.ctHash,
        securityZone: e.securityZone,
        utype:        e.utype,
        signature:    e.signature as `0x${string}`,
      }))

      // 4. Submit castVote to contract
      setStatus('signing')
      const [{ maxFeePerGas, maxPriorityFeePerGas }, gas] = await Promise.all([
        getGasFees(),
        estimateCastVoteGas(pollId, encodedWeights, address),
      ])
      const hash = await writeContractAsync({
        chain:        arbitrumSepolia,
        account:      address,
        address:      CONTRACT_ADDRESS,
        abi:          FHENIX_POLL_ABI,
        functionName: 'castVote',
        args:         [pollId, encodedWeights],
        gas,
        maxFeePerGas,
        maxPriorityFeePerGas,
      })

      setTxHash(hash)
      setStatus('confirming')

      // 5. Wait for confirmation
      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash })
      }

      setStatus('done')
      return hash
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setStatus('error')
    }
  }, [address, encryptInputsAsync, writeContractAsync, publicClient])

  const reset = useCallback(() => {
    setStatus('idle')
    setTxHash(null)
    setError(null)
  }, [])

  return { castVote, status, txHash, error, reset }
}

// ─── Weight computation ───────────────────────────────────────────────────────

/**
 * Convert a VoteRanking map to a per-option weight array (MDCT 1/rank scoring).
 *
 * @param ranking     { optionId → rank } — rank 1 is best, 0 means unranked
 * @param optionCount total number of options in the poll
 * @param votingPower 0–1_000_000 (from credential.votingWeight)
 * @returns           integer weight per option in rank-score units
 */
export function computeOptionWeights(
  ranking:     VoteRanking,
  optionCount: number,
  votingPower: number,
): number[] {
  const weights = new Array<number>(optionCount).fill(0)
  for (const [optIdStr, rank] of Object.entries(ranking)) {
    if (rank <= 0) continue
    const optId = Number(optIdStr)
    if (optId < 0 || optId >= optionCount) continue
    const rankScore = Math.floor(1_000_000 / rank)
    weights[optId] = Math.floor((votingPower * rankScore) / 1_000_000)
  }
  return weights
}
