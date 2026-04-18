// Vote history — reads VoteCast events from the contract for the connected address.
// Uses the same fromBlock strategy as fhenix.ts: VITE_DEPLOYMENT_BLOCK env var
// or a 3M-block lookback (~10 days) to stay within public-RPC range limits.

import { useState, useEffect, useCallback } from 'react'
import { useWallet } from './useWallet'
import { publicClient, CONTRACT_ADDRESS } from '../lib/fhenix'
import { FHENIX_POLL_ABI } from '../lib/abi'

export interface VoteCastEvent {
  pollId:      `0x${string}`
  voter:       `0x${string}`
  blockNumber: bigint
}

const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? '31337')

async function resolveFromBlock(): Promise<bigint> {
  if (import.meta.env.VITE_DEPLOYMENT_BLOCK) {
    return BigInt(import.meta.env.VITE_DEPLOYMENT_BLOCK)
  }
  if (CHAIN_ID !== 421614) return 0n   // local chain — no range limit
  const current = await publicClient.getBlockNumber()
  const lookback = 3_000_000n          // ~10 days of Arbitrum Sepolia L2 blocks
  return current > lookback ? current - lookback : 0n
}

const VOTE_CAST_EVENT = FHENIX_POLL_ABI.find(
  e => e.type === 'event' && e.name === 'VoteCast'
) as Parameters<typeof publicClient.getLogs>[0]['event']

export function useVoteHistory() {
  const { address, isConnected } = useWallet()
  const [events, setEvents]   = useState<VoteCastEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!isConnected || !address) { setEvents([]); return }
    setLoading(true)
    setError(null)
    try {
      const fb = await resolveFromBlock()
      const logs = await publicClient.getLogs({
        address:   CONTRACT_ADDRESS,
        event:     VOTE_CAST_EVENT,
        args:      { voter: address },
        fromBlock: fb,
        toBlock:   'latest',
      })
      setEvents(
        logs
          .map(l => ({
            pollId:      (l.args as { pollId: `0x${string}`; voter: `0x${string}` }).pollId,
            voter:       (l.args as { pollId: `0x${string}`; voter: `0x${string}` }).voter,
            blockNumber: l.blockNumber ?? 0n,
          }))
          .sort((a, b) => (b.blockNumber > a.blockNumber ? 1 : -1))
      )
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setEvents([])
    } finally {
      setLoading(false)
    }
  }, [isConnected, address])

  useEffect(() => { void refresh() }, [refresh])

  return { events, loading, error, refresh }
}
