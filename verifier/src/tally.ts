// ─── Fhenix tally engine ──────────────────────────────────────────────────────
//
// Interacts with the FhenixPoll contract on Arbitrum Sepolia to:
//   1. Detect polls that have ended (block.number > endBlock)
//   2. Call requestTallyReveal() to trigger FHE.allowPublic + FHE.decrypt
//   3. For each option, call decryptForTx (Threshold Network signs the plaintext)
//   4. Call publishTallyResult() to write verified plaintext into revealedTallies
//
// Uses: viem (contract calls), @cofhe/sdk/node (decryptForTx)

import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { arbitrumSepolia as viemArbSepolia } from "viem/chains"
import { createCofheConfig, createCofheClient } from "@cofhe/sdk/node"
import { arbSepolia as cofheArbSepolia } from "@cofhe/sdk/chains"

// ─── Config ──────────────────────────────────────────────────────────────────

const CONTRACT_ADDRESS = (process.env.FHENIX_CONTRACT_ADDRESS ?? "") as `0x${string}`
const RPC_URL          = process.env.FHENIX_RPC_URL ?? "https://sepolia-rollup.arbitrum.io/rpc"
const PRIVATE_KEY_RAW  = process.env.VERIFIER_PRIVATE_KEY ?? ""

// ─── Minimal ABI (only what the tally engine needs) ──────────────────────────

const TALLY_ABI = [
  {
    type: "function", name: "getPoll",
    inputs: [{ name: "pollId", type: "bytes32" }],
    outputs: [{
      type: "tuple",
      components: [
        { name: "id",            type: "bytes32" },
        { name: "communityId",   type: "bytes32" },
        { name: "creator",       type: "address" },
        { name: "credType",      type: "uint8"   },
        { name: "startBlock",    type: "uint32"  },
        { name: "endBlock",      type: "uint32"  },
        { name: "optionCount",   type: "uint8"   },
        { name: "tallyRevealed", type: "bool"    },
        { name: "exists",        type: "bool"    },
      ],
    }],
    stateMutability: "view",
  },
  {
    type: "function", name: "requestTallyReveal",
    inputs: [{ name: "pollId", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function", name: "tallyCtHashes",
    inputs: [
      { name: "pollId",   type: "bytes32" },
      { name: "optionId", type: "uint8"   },
    ],
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function", name: "publishTallyResult",
    inputs: [
      { name: "pollId",    type: "bytes32" },
      { name: "optionId",  type: "uint8"   },
      { name: "plaintext", type: "uint32"  },
      { name: "signature", type: "bytes"   },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function", name: "getRevealedTally",
    inputs: [
      { name: "pollId",   type: "bytes32" },
      { name: "optionId", type: "uint8"   },
    ],
    outputs: [{ type: "uint32" }],
    stateMutability: "view",
  },
] as const

// ─── Clients (lazy init) ─────────────────────────────────────────────────────

let _publicClient:  PublicClient | null  = null
let _walletClient:  WalletClient | null  = null
let _cofheClient:   Awaited<ReturnType<typeof createCofheClient>> | null = null
let _clientReady = false

export async function initTallyClients(): Promise<boolean> {
  if (_clientReady) return true
  if (!CONTRACT_ADDRESS || CONTRACT_ADDRESS === "0x") {
    console.warn("[tally] FHENIX_CONTRACT_ADDRESS not set — tally disabled")
    return false
  }
  const rawKey = PRIVATE_KEY_RAW
  if (!rawKey) {
    console.warn("[tally] VERIFIER_PRIVATE_KEY not set — tally disabled")
    return false
  }
  const key = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`
  const account = privateKeyToAccount(key)

  _publicClient = createPublicClient({
    chain:     viemArbSepolia,
    transport: http(RPC_URL),
  })

  _walletClient = createWalletClient({
    chain:     viemArbSepolia,
    transport: http(RPC_URL),
    account,
  })

  const cofheConfig = createCofheConfig({
    supportedChains: [cofheArbSepolia],
  })
  _cofheClient = createCofheClient(cofheConfig)
  await _cofheClient.connect(_publicClient as any, _walletClient as any)

  _clientReady = true
  console.log(`[tally] Clients ready. Operator: ${account.address}`)
  return true
}

// ─── Block height ─────────────────────────────────────────────────────────────
// On Arbitrum Sepolia, block.number in the contract = L1 Ethereum block.
// We must read l1BlockNumber from block headers to match on-chain endBlock values.

export async function getCurrentL1Block(): Promise<number> {
  if (!_publicClient) throw new Error("clients not initialised")
  const block = await _publicClient.getBlock({ blockTag: "latest" })
  const l1 = (block as any).l1BlockNumber
  if (l1 !== undefined) return Number(l1)
  // Fallback via eth_getBlockByNumber raw response
  const raw = await _publicClient.request({
    method: "eth_getBlockByNumber" as never,
    params: ["latest", false] as never,
  }) as { l1BlockNumber?: string }
  return raw.l1BlockNumber
    ? parseInt(raw.l1BlockNumber, 16)
    : Number(await _publicClient.getBlockNumber())
}

// ─── Poll reads ───────────────────────────────────────────────────────────────

export async function getOnChainPoll(pollId: `0x${string}`) {
  if (!_publicClient) throw new Error("clients not initialised")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const readContract = _publicClient.readContract as (...a: any[]) => Promise<any>
  return readContract({
    address: CONTRACT_ADDRESS,
    abi:     TALLY_ABI,
    functionName: "getPoll",
    args:    [pollId],
  }) as Promise<{
    id: `0x${string}`; communityId: `0x${string}`; creator: `0x${string}`;
    credType: number; startBlock: number; endBlock: number;
    optionCount: number; tallyRevealed: boolean; exists: boolean
  }>
}

async function getTallyCtHash(pollId: `0x${string}`, optionId: number): Promise<bigint> {
  if (!_publicClient) throw new Error("clients not initialised")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const readContract = _publicClient.readContract as (...a: any[]) => Promise<any>
  const hex = await readContract({
    address: CONTRACT_ADDRESS,
    abi:     TALLY_ABI,
    functionName: "tallyCtHashes",
    args:    [pollId, optionId],
  }) as `0x${string}`
  return BigInt(hex)
}

async function getRevealedTally(pollId: `0x${string}`, optionId: number): Promise<number> {
  if (!_publicClient) throw new Error("clients not initialised")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const readContract = _publicClient.readContract as (...a: any[]) => Promise<any>
  return readContract({
    address: CONTRACT_ADDRESS,
    abi:     TALLY_ABI,
    functionName: "getRevealedTally",
    args:    [pollId, optionId],
  }) as Promise<number>
}

// ─── Gas helper ───────────────────────────────────────────────────────────────

async function getGasFees() {
  if (!_publicClient) throw new Error("clients not initialised")
  const block = await _publicClient.getBlock({ blockTag: "latest" })
  const baseFee = (block as any).baseFeePerGas ?? 100_000_000n
  const tip     = 1_500_000n
  return {
    maxFeePerGas:         baseFee * 2n + tip,
    maxPriorityFeePerGas: tip,
  }
}

// ─── Main tally flow ──────────────────────────────────────────────────────────

/**
 * Run the full tally flow for one poll:
 *   requestTallyReveal → decryptForTx × N → publishTallyResult × N
 *
 * Safe to call even if the poll is already partially or fully published.
 */
export async function runTallyForPoll(pollId: `0x${string}`): Promise<void> {
  if (!_clientReady || !_publicClient || !_walletClient || !_cofheClient) {
    throw new Error("tally clients not ready — call initTallyClients() first")
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const writeContract = _walletClient.writeContract as (...a: any[]) => Promise<`0x${string}`>

  const poll = await getOnChainPoll(pollId)
  if (!poll.exists) throw new Error(`Poll ${pollId} does not exist on-chain`)

  // Step 1 — request reveal if not yet done
  if (!poll.tallyRevealed) {
    const l1Block = await getCurrentL1Block()
    if (l1Block <= poll.endBlock) {
      throw new Error(
        `Poll still open — endBlock=${poll.endBlock}, current L1=${l1Block}`,
      )
    }
    console.log(`[tally] Requesting reveal for ${pollId}…`)
    const fees = await getGasFees()
    const hash = await writeContract({
      address: CONTRACT_ADDRESS,
      abi:     TALLY_ABI,
      functionName: "requestTallyReveal",
      args:    [pollId],
      ...fees,
    })
    await _publicClient.waitForTransactionReceipt({ hash })
    console.log(`[tally] requestTallyReveal confirmed: ${hash}`)
  } else {
    console.log(`[tally] Poll ${pollId} tallyRevealed=true already`)
  }

  // Step 2 — publish each option that isn't published yet
  for (let i = 0; i < poll.optionCount; i++) {
    const existing = await getRevealedTally(pollId, i)
    if (existing > 0) {
      console.log(`[tally]   option ${i}: already published (${existing})`)
      continue
    }

    const ctHash = await getTallyCtHash(pollId, i)
    if (ctHash === 0n) {
      console.warn(`[tally]   option ${i}: ctHash is zero — requestTallyReveal may not have run yet`)
      continue
    }

    console.log(`[tally]   option ${i}: decrypting ctHash=${ctHash.toString(16).slice(0, 16)}…`)
    const { decryptedValue, signature } = await _cofheClient
      .decryptForTx(ctHash)
      .withoutPermit()
      .execute()

    const fees = await getGasFees()
    const hash = await writeContract({
      address: CONTRACT_ADDRESS,
      abi:     TALLY_ABI,
      functionName: "publishTallyResult",
      args:    [pollId, i, Number(decryptedValue), signature],
      ...fees,
    })
    await _publicClient.waitForTransactionReceipt({ hash })
    console.log(`[tally]   option ${i}: published plaintext=${decryptedValue} tx=${hash}`)
  }

  console.log(`[tally] Poll ${pollId} fully tallied.`)
}
