// Fetch live EIP-1559 fee params from the chain.
// Used to override the cofhe SDK's hardcoded localcofhe default (20 Mwei)
// which is too low for Arbitrum Sepolia when base fee spikes above it.

import { publicClient } from './fhenix'
import { FHENIX_POLL_ABI, CONTRACT_ADDRESS } from './abi'

export async function getGasFees(): Promise<{
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
}> {
  const fees = await publicClient.estimateFeesPerGas()
  return {
    maxFeePerGas:         fees.maxFeePerGas         ?? 100_000_000n,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? 1_000_000n,
  }
}

/**
 * Estimate gas for castVote from actual calldata (encrypted weights included),
 * then add a 30% buffer to cover FHE opcode variance.
 * Falls back to a safe cap (3 000 000) if estimation itself fails.
 */
export async function estimateCastVoteGas(
  pollId:         `0x${string}`,
  encodedWeights: unknown[],
  account:        `0x${string}`,
): Promise<bigint> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const estimate = await (publicClient as any).estimateContractGas({
    address:      CONTRACT_ADDRESS,
    abi:          FHENIX_POLL_ABI,
    functionName: 'castVote',
    args:         [pollId, encodedWeights],
    account,
  }).catch(() => null) as bigint | null

  if (!estimate) return 3_000_000n          // safe fallback
  const withBuffer = estimate * 130n / 100n // +30 %
  // Hard cap: 5 M gas — prevents wallet balance drain on any overestimate
  return withBuffer > 5_000_000n ? 5_000_000n : withBuffer
}
