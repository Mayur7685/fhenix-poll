import { useState, useCallback } from 'react'
import { Encryptable } from '@cofhe/sdk'
import { useAccount, usePublicClient, useWalletClient } from 'wagmi'
import { arbitrumSepolia } from '../lib/chains'
import { FHENIX_POLL_ABI, CONTRACT_ADDRESS } from '../lib/abi'
import { getGasFees, estimateCastVoteGas } from '../lib/gas'
import { useCofheClient } from './useCofheClient'
import type { VoteRanking } from '../types'

export type VoteStatus = 'idle' | 'encrypting' | 'signing' | 'confirming' | 'done' | 'error'

export function useVoting() {
  const { address }            = useAccount()
  const publicClient           = usePublicClient()
  const { data: walletClient } = useWalletClient()
  const { cofheClient, isReady } = useCofheClient()

  const [status, setStatus] = useState<VoteStatus>('idle')
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null)
  const [error, setError]   = useState<string | null>(null)

  const castVote = useCallback(async (
    pollId:      `0x${string}`,
    ranking:     VoteRanking,
    optionCount: number,
    votingPower = 1_000_000,
  ) => {
    if (!address || !walletClient) { setError('Wallet not connected'); return }
    if (!isReady) { setError('CoFHE not ready — please wait'); return }

    setStatus('encrypting'); setError(null); setTxHash(null)

    try {
      const rawWeights = computeOptionWeights(ranking, optionCount, votingPower)

      // Encrypt directly via cofheClient (no iframe, no @cofhe/react)
      const encrypted = await cofheClient
        .encryptInputs(rawWeights.map(w => Encryptable.uint32(BigInt(w))))
        .execute()

      const encodedWeights = encrypted.map(e => ({
        ctHash:       e.ctHash,
        securityZone: e.securityZone,
        utype:        e.utype,
        signature:    e.signature as `0x${string}`,
      }))

      setStatus('signing')
      const [{ maxFeePerGas, maxPriorityFeePerGas }, gas] = await Promise.all([
        getGasFees(),
        estimateCastVoteGas(pollId, encodedWeights, address),
      ])

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const writeContract = walletClient.writeContract as (...a: any[]) => Promise<`0x${string}`>
      const hash = await writeContract({
        chain:   arbitrumSepolia,
        account: address,
        address: CONTRACT_ADDRESS,
        abi:     FHENIX_POLL_ABI,
        functionName: 'castVote',
        args:    [pollId, encodedWeights],
        gas,
        maxFeePerGas,
        maxPriorityFeePerGas,
      })

      setTxHash(hash)
      setStatus('confirming')
      if (publicClient) await publicClient.waitForTransactionReceipt({ hash })
      setStatus('done')
      return hash
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setStatus('error')
    }
  }, [address, walletClient, publicClient, cofheClient, isReady])

  const reset = useCallback(() => {
    setStatus('idle'); setTxHash(null); setError(null)
  }, [])

  return { castVote, status, txHash, error, reset }
}

export function computeOptionWeights(
  ranking:     VoteRanking,
  optionCount: number,
  votingPower: number,
): number[] {
  const weights = new Array<number>(optionCount).fill(0)
  for (const [optIdStr, rank] of Object.entries(ranking)) {
    if (rank <= 0) continue
    const idx = Number(optIdStr) - 1  // 1-based → 0-based
    if (idx < 0 || idx >= optionCount) continue
    const rankScore = Math.floor(1_000_000 / rank)
    weights[idx] = Math.floor((votingPower * rankScore) / 1_000_000)
  }
  return weights
}
