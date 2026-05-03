// Fhenix network client — reads public state from the contract via viem.
// All writes go through the wallet (wagmi writeContract).

import { createPublicClient, http, keccak256, encodePacked, toHex } from 'viem'
import { arbitrumSepolia, localCofhe } from './chains'
import { FHENIX_POLL_ABI, CONTRACT_ADDRESS } from './abi'

export { CONTRACT_ADDRESS } from './abi'

// Pick chain based on env VITE_CHAIN_ID (defaults to localCofhe in dev)
const chainId = Number(import.meta.env.VITE_CHAIN_ID ?? '31337')
const chain = chainId === 421614 ? arbitrumSepolia : localCofhe

export const publicClient = createPublicClient({
  chain,
  transport: http(import.meta.env.VITE_RPC_URL ?? chain.rpcUrls.default.http[0]),
})

// Viem's readContract type requires `authorizationList` in newer versions when using
// `as const` ABI arrays. Cast to `any` to avoid this irrelevant type error.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readContract = publicClient.readContract as (...args: any[]) => Promise<any>

// ─── Block height ─────────────────────────────────────────────────────────────
// On Arbitrum Sepolia, Solidity's block.number returns the L1 block number
// (synced from Ethereum Sepolia, ~12s resolution).
// eth_blockNumber via the Arbitrum RPC returns the L2 block (~260M) which
// does NOT match what the contract stores for startBlock/endBlock.
// We read l1BlockNumber from the latest block object — Arbitrum includes it
// in every block via its chain formatter, matching what block.number returns
// inside the deployed contract.

export async function getBlockHeight(): Promise<number> {
  if (chainId !== 421614) {
    // localcofhe — L2 block == L1 block
    return Number(await publicClient.getBlockNumber())
  }
  // Arbitrum Sepolia: read l1BlockNumber from the block header
  const block = await publicClient.getBlock({ blockTag: 'latest' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const l1Block = (block as any).l1BlockNumber
  if (l1Block !== undefined) return Number(l1Block)
  // Fallback: eth_getBlockByNumber exposes l1BlockNumber as a hex field
  const raw = await publicClient.request({
    method: 'eth_getBlockByNumber' as never,
    params: ['latest', false] as never,
  }) as { l1BlockNumber?: string }
  return raw.l1BlockNumber ? parseInt(raw.l1BlockNumber, 16) : Number(await publicClient.getBlockNumber())
}

// ─── Community reads ──────────────────────────────────────────────────────────

export async function getCommunity(communityId: `0x${string}`) {
  return readContract({
    address: CONTRACT_ADDRESS,
    abi:     FHENIX_POLL_ABI,
    functionName: 'getCommunity',
    args:    [communityId],
  }) as Promise<{
    id: `0x${string}`; creator: `0x${string}`; configHash: `0x${string}`;
    credType: number; exists: boolean
  }>
}

// fromBlock helper for getLogs.
// On Arbitrum Sepolia (chain 421614) the L2 has ~260 M blocks; public RPCs cap
// the scan range.  Set VITE_DEPLOYMENT_BLOCK in .env.local to the L2 block of
// the contract deploy tx (found on Arbiscan) to make every scan precise.
// Without it we fall back to a 3 M-block lookback (~10 days at Arbitrum speed),
// which is enough for any freshly deployed contract.
async function fromBlock(): Promise<bigint> {
  if (import.meta.env.VITE_DEPLOYMENT_BLOCK) {
    return BigInt(import.meta.env.VITE_DEPLOYMENT_BLOCK)
  }
  if (chainId !== 421614) return 0n   // local chain — no range limit
  const current = await publicClient.getBlockNumber()
  const lookback = 3_000_000n         // ~10 days of L2 blocks
  return current > lookback ? current - lookback : 0n
}

export async function getAllCommunityIds(): Promise<`0x${string}`[]> {
  const logs = await publicClient.getLogs({
    address: CONTRACT_ADDRESS,
    event: {
      type: 'event', name: 'CommunityRegistered',
      inputs: [
        { name: 'id',      type: 'bytes32', indexed: true },
        { name: 'creator', type: 'address', indexed: true },
      ],
    },
    fromBlock: await fromBlock(),
    toBlock:   'latest',
  })
  return logs.map(l => l.args.id as `0x${string}`)
}

// ─── Poll reads ───────────────────────────────────────────────────────────────

export async function getPoll(pollId: `0x${string}`) {
  return readContract({
    address: CONTRACT_ADDRESS,
    abi:     FHENIX_POLL_ABI,
    functionName: 'getPoll',
    args:    [pollId],
  }) as Promise<{
    id: `0x${string}`; communityId: `0x${string}`; creator: `0x${string}`;
    credType: number; startBlock: number; endBlock: number;
    optionCount: number; tallyRevealed: boolean; exists: boolean;
    isHierarchical: boolean
  }>
}

export async function getPollOption(pollId: `0x${string}`, optionId: number) {
  return readContract({
    address: CONTRACT_ADDRESS,
    abi:     FHENIX_POLL_ABI,
    functionName: 'getPollOption',
    args:    [pollId, optionId],
  }) as Promise<{
    optionId: number; parentId: number; childCount: number;
    labelHash: `0x${string}`; exists: boolean
  }>
}

export async function getRolledUpTally(pollId: `0x${string}`, optionId: number): Promise<bigint> {
  const result = await readContract({
    address: CONTRACT_ADDRESS,
    abi:     FHENIX_POLL_ABI,
    functionName: 'rolledUpTallies',
    args:    [pollId, optionId],
  })
  return BigInt(result as number)
}

export async function hasVoted(pollId: `0x${string}`, voter: `0x${string}`): Promise<boolean> {
  return readContract({
    address: CONTRACT_ADDRESS,
    abi:     FHENIX_POLL_ABI,
    functionName: 'hasVoted',
    args:    [pollId, voter],
  }) as Promise<boolean>
}

export async function getRevealedTally(
  pollId: `0x${string}`,
  optionId: number,
): Promise<bigint> {
  const result = await readContract({
    address: CONTRACT_ADDRESS,
    abi:     FHENIX_POLL_ABI,
    functionName: 'getRevealedTally',
    args:    [pollId, optionId],
  })
  return BigInt(result as number)
}

export async function getTallyCtHash(
  pollId: `0x${string}`,
  optionId: number,
): Promise<bigint> {
  const result = await readContract({
    address: CONTRACT_ADDRESS,
    abi:     FHENIX_POLL_ABI,
    functionName: 'tallyCtHashes',
    args:    [pollId, optionId],
  })
  // Returns bytes32 (hex string) — convert to bigint for decryptForTx
  return BigInt(result as string)
}

// ─── Credential reads ─────────────────────────────────────────────────────────

export async function getCredential(holder: `0x${string}`, communityId: `0x${string}`) {
  return readContract({
    address: CONTRACT_ADDRESS,
    abi:     FHENIX_POLL_ABI,
    functionName: 'getCredential',
    args:    [holder, communityId],
  }) as Promise<{
    holder: `0x${string}`; communityId: `0x${string}`; credType: number;
    votingWeight: bigint; issuedAt: number; expiry: number; exists: boolean
  }>
}

export async function getPollIds(communityId: `0x${string}`): Promise<`0x${string}`[]> {
  const logs = await publicClient.getLogs({
    address: CONTRACT_ADDRESS,
    event: {
      type: 'event', name: 'PollCreated',
      inputs: [
        { name: 'pollId',      type: 'bytes32', indexed: true },
        { name: 'communityId', type: 'bytes32', indexed: true },
        { name: 'endBlock',    type: 'uint32',  indexed: false },
      ],
    },
    args:      { communityId },
    fromBlock: await fromBlock(),
    toBlock:   'latest',
  })
  return logs.map(l => l.args.pollId as `0x${string}`)
}

/** Count on-chain votes for a poll by scanning VoteCast events. */
export async function getVoteCount(pollId: `0x${string}`): Promise<number> {
  const logs = await publicClient.getLogs({
    address: CONTRACT_ADDRESS,
    event: {
      type: 'event', name: 'VoteCast',
      inputs: [
        { name: 'pollId', type: 'bytes32', indexed: true },
        { name: 'voter',  type: 'address', indexed: true },
      ],
    },
    args:      { pollId },
    fromBlock: await fromBlock(),
    toBlock:   'latest',
  })
  return logs.length
}

// ─── ID generation ────────────────────────────────────────────────────────────

/** Derive bytes32 community ID from a human-readable name. */
export function communityIdFromName(name: string): `0x${string}` {
  return keccak256(toHex(name))
}

/** Derive bytes32 poll ID from community ID + title. */
export function pollIdFromTitle(communityId: `0x${string}`, title: string): `0x${string}` {
  return keccak256(encodePacked(['bytes32', 'string'], [communityId, title]))
}

/** Encode an IPFS CID string as bytes32 (keccak256 hash). */
export function cidToBytes32(cid: string): `0x${string}` {
  return keccak256(toHex(cid))
}
