// ─── Quest progress runner ────────────────────────────────────────────────────
//
// Polls every 120s. For each active quest:
//   VOTE_COUNT:      scans VoteCast events per participant, records FHE-encrypted increments
//   CREDENTIAL_AGE:  checks credential issuedAt vs current block, records progress
//   REFERRAL_COUNT:  off-chain only (tracked via /quests/:id/progress admin endpoint)
//
// After recording, calls requestProgressReveal + publishProgressResult for
// participants whose progress ctHash is set but not yet completed.

import {
  createPublicClient, createWalletClient, http,
  type PublicClient, type WalletClient,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { arbitrumSepolia as viemArbSepolia } from "viem/chains"
import { createCofheConfig, createCofheClient } from "@cofhe/sdk/node"
import { Encryptable } from "@cofhe/sdk"
import { arbSepolia as cofheArbSepolia } from "@cofhe/sdk/chains"
import { getAllCommunities } from "./communities.js"
import { getQuest, getCommunityQuests, saveQuestProgress, getQuestProgress } from "./quests.js"
import { getGasFees } from "./tally.js"

const CONTRACT_ADDRESS = (process.env.FHENIX_CONTRACT_ADDRESS ?? "") as `0x${string}`
const RPC_URL          = process.env.FHENIX_RPC_URL ?? "https://sepolia-rollup.arbitrum.io/rpc"
const PRIVATE_KEY_RAW  = process.env.VERIFIER_PRIVATE_KEY ?? ""

const QUEST_ABI = [
  {
    type: "function", name: "getQuest",
    inputs: [{ name: "questId", type: "bytes32" }],
    outputs: [{ type: "tuple", components: [
      { name: "id",          type: "bytes32" },
      { name: "communityId", type: "bytes32" },
      { name: "creator",     type: "address" },
      { name: "questType",   type: "uint8"   },
      { name: "target",      type: "uint32"  },
      { name: "rewardHash",  type: "bytes32" },
      { name: "expiryBlock", type: "uint32"  },
      { name: "exists",      type: "bool"    },
    ]}],
    stateMutability: "view",
  },
  {
    type: "function", name: "recordQuestProgress",
    inputs: [
      { name: "questId",     type: "bytes32" },
      { name: "participant", type: "address" },
      { name: "encProgress", type: "tuple", components: [
        { name: "ctHash",       type: "uint256" },
        { name: "securityZone", type: "uint8"   },
        { name: "utype",        type: "uint8"   },
        { name: "signature",    type: "bytes"   },
      ]},
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function", name: "questCompleted",
    inputs: [{ name: "questId", type: "bytes32" }, { name: "participant", type: "address" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function", name: "questProgressCtHash",
    inputs: [{ name: "questId", type: "bytes32" }, { name: "participant", type: "address" }],
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function", name: "requestProgressReveal",
    inputs: [{ name: "questId", type: "bytes32" }, { name: "participant", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function", name: "publishProgressResult",
    inputs: [
      { name: "questId",     type: "bytes32" },
      { name: "participant", type: "address" },
      { name: "plaintext",   type: "uint32"  },
      { name: "signature",   type: "bytes"   },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event", name: "VoteCast",
    inputs: [
      { name: "pollId", type: "bytes32", indexed: true },
      { name: "voter",  type: "address", indexed: true },
    ],
  },
] as const

let _public: PublicClient | null = null
let _wallet: WalletClient | null = null
let _cofhe: ReturnType<typeof createCofheClient> | null = null

async function initClients(): Promise<boolean> {
  if (!CONTRACT_ADDRESS || !PRIVATE_KEY_RAW) return false
  if (_public) return true

  const key = PRIVATE_KEY_RAW.startsWith("0x") ? PRIVATE_KEY_RAW : `0x${PRIVATE_KEY_RAW}`
  const account = privateKeyToAccount(key as `0x${string}`)

  _public = createPublicClient({ chain: viemArbSepolia, transport: http(RPC_URL) })
  _wallet = createWalletClient({ chain: viemArbSepolia, transport: http(RPC_URL), account })

  const config = createCofheConfig({ supportedChains: [cofheArbSepolia] })
  _cofhe = createCofheClient(config)
  await _cofhe.connect(_public as any, _wallet as any)
  return true
}

// Scan VoteCast events to count how many polls a voter has voted in
async function getVoteCountForAddress(voter: `0x${string}`): Promise<number> {
  const logs = await _public!.getLogs({
    address: CONTRACT_ADDRESS,
    event: { type: "event", name: "VoteCast", inputs: [
      { name: "pollId", type: "bytes32", indexed: true },
      { name: "voter",  type: "address", indexed: true },
    ]},
    args: { voter },
    fromBlock: 0n, toBlock: "latest",
  })
  // Count unique polls voted in
  const uniquePolls = new Set(logs.map(l => l.args.pollId))
  return uniquePolls.size
}

async function processQuest(questId: string): Promise<void> {
  const quest = getQuest(questId)
  if (!quest) return

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const writeContract = _wallet!.writeContract as (...a: any[]) => Promise<`0x${string}`>

  const onChain = await _public!.readContract({
    address: CONTRACT_ADDRESS, abi: QUEST_ABI,
    functionName: "getQuest", args: [questId as `0x${string}`],
  }) as any
  if (!onChain.exists) return

  const currentBlock = await _public!.getBlockNumber()
  if (currentBlock > BigInt(onChain.expiryBlock)) return

  // Collect all participants who have any off-chain progress recorded
  // For VOTE_COUNT: scan VoteCast events to find all voters
  if (quest.quest_type === "VOTE_COUNT") {
    const logs = await _public!.getLogs({
      address: CONTRACT_ADDRESS,
      event: { type: "event", name: "VoteCast", inputs: [
        { name: "pollId", type: "bytes32", indexed: true },
        { name: "voter",  type: "address", indexed: true },
      ]},
      fromBlock: 0n, toBlock: "latest",
    })

    const voters = new Set(logs.map(l => l.args.voter as `0x${string}`))

    for (const voter of voters) {
      const completed = await _public!.readContract({
        address: CONTRACT_ADDRESS, abi: QUEST_ABI,
        functionName: "questCompleted", args: [questId as `0x${string}`, voter],
      }) as boolean
      if (completed) continue

      const voteCount = await getVoteCountForAddress(voter)
      const stored = getQuestProgress(questId, voter)
      const lastRecorded = stored?.progress ?? 0

      if (voteCount > lastRecorded) {
        const increment = voteCount - lastRecorded
        console.log(`[quest-runner] ${questId.slice(0, 10)}… voter ${voter.slice(0, 8)}… +${increment} votes`)

        // Encrypt increment and record on-chain
        const [encInc] = await _cofhe!
          .encryptInputs([Encryptable.uint32(BigInt(increment))])
          .execute()

        const fees = await getGasFees()
        const hash = await writeContract({
          address: CONTRACT_ADDRESS, abi: QUEST_ABI,
          functionName: "recordQuestProgress",
          args: [questId as `0x${string}`, voter, encInc as any],
          ...fees,
        })
        await _public!.waitForTransactionReceipt({ hash })

        saveQuestProgress({ quest_id: questId, participant: voter, progress: voteCount, completed: false })
      }

      // If progress ctHash is set, try to reveal and publish
      const ctHash = await _public!.readContract({
        address: CONTRACT_ADDRESS, abi: QUEST_ABI,
        functionName: "questProgressCtHash", args: [questId as `0x${string}`, voter],
      }) as `0x${string}`

      if (BigInt(ctHash) !== 0n) {
        try {
          const fees = await getGasFees()
          const revealHash = await writeContract({
            address: CONTRACT_ADDRESS, abi: QUEST_ABI,
            functionName: "requestProgressReveal",
            args: [questId as `0x${string}`, voter],
            ...fees,
          })
          await _public!.waitForTransactionReceipt({ hash: revealHash })

          const { decryptedValue, signature } = await _cofhe!
            .decryptForTx(BigInt(ctHash))
            .withoutPermit()
            .execute()

          const pubFees = await getGasFees()
          const pubHash = await writeContract({
            address: CONTRACT_ADDRESS, abi: QUEST_ABI,
            functionName: "publishProgressResult",
            args: [questId as `0x${string}`, voter, Number(decryptedValue), signature as `0x${string}`],
            ...pubFees,
          })
          await _public!.waitForTransactionReceipt({ hash: pubHash })

          const isComplete = Number(decryptedValue) >= onChain.target
          saveQuestProgress({
            quest_id: questId, participant: voter,
            progress: Number(decryptedValue), completed: isComplete,
          })
          console.log(`[quest-runner] ${questId.slice(0, 10)}… ${voter.slice(0, 8)}… progress=${decryptedValue} complete=${isComplete}`)
        } catch (e: any) {
          console.warn(`[quest-runner] reveal failed for ${voter.slice(0, 8)}…:`, e.message)
        }
      }
    }
  }
}

async function runOnce(): Promise<void> {
  const communities = getAllCommunities()
  for (const comm of communities) {
    const quests = getCommunityQuests(comm.community_id)
    for (const quest of quests) {
      try {
        await processQuest(quest.quest_id)
      } catch (e: any) {
        console.error(`[quest-runner] Error processing quest ${quest.quest_id}:`, e.message)
      }
    }
  }
}

export async function startQuestRunner(): Promise<void> {
  const ready = await initClients()
  if (!ready) {
    console.warn("[quest-runner] Disabled — missing FHENIX_CONTRACT_ADDRESS or VERIFIER_PRIVATE_KEY")
    return
  }
  console.log("[quest-runner] Started — checking every 120s")
  void runOnce()
  setInterval(() => void runOnce(), 120_000)
}
