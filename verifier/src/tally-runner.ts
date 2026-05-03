// ─── Automated tally runner ───────────────────────────────────────────────────
//
// Polls every 60 seconds for ended FhenixPoll polls that haven't been tallied yet.
// For each ended poll it runs: requestTallyReveal → decryptForTx × N → publishTallyResult × N
//
// Requires env vars (in .env):
//   FHENIX_CONTRACT_ADDRESS — deployed FhenixPoll address
//   FHENIX_RPC_URL          — Arbitrum Sepolia RPC
//   VERIFIER_PRIVATE_KEY    — wallet key with ETH for gas

import { getAllCommunities } from "./communities.js"
import { initTallyClients, getCurrentL1Block, getOnChainPoll, runTallyForPoll } from "./tally.js"

const POLL_INTERVAL_MS = 60_000

// Track polls we've successfully fully tallied this process session
const done = new Set<string>()

async function runOnce(): Promise<void> {
  const communities = getAllCommunities()
  let l1Block: number
  try {
    l1Block = await getCurrentL1Block()
  } catch (e: unknown) {
    console.warn("[tally-runner] Could not get L1 block:", (e as Error).message)
    return
  }

  for (const config of communities) {
    if (!config.polls) continue
    for (const poll of config.polls) {
      const pollId = poll.poll_id as `0x${string}`
      if (done.has(pollId)) continue

      let onChainPoll: Awaited<ReturnType<typeof getOnChainPoll>>
      try {
        onChainPoll = await getOnChainPoll(pollId)
      } catch {
        continue
      }

      if (!onChainPoll.exists) {
        console.log(`[tally-runner] Poll ${pollId.slice(0, 12)}… not found on current contract — skipping`)
        done.add(pollId)
        continue
      }

      // Skip polls still running — require endBlock + 2 to avoid racing the boundary block
      if (l1Block <= onChainPoll.endBlock + 2) {
        console.log(
          `[tally-runner] Poll ${pollId.slice(0, 12)}… active (L1=${l1Block}, end=${onChainPoll.endBlock})`
        )
        continue
      }

      console.log(`[tally-runner] Processing ended poll ${pollId}…`)
      try {
        await runTallyForPoll(pollId)
        done.add(pollId)
      } catch (e: unknown) {
        const msg = (e as Error).message ?? ''
        if (/Poll still open/i.test(msg)) {
          console.log(`[tally-runner] Poll ${pollId.slice(0, 12)}… not yet closed on-chain — will retry`)
        } else {
          console.error(`[tally-runner] Error tallying ${pollId}:`, msg)
        }
      }    }
  }
}

export async function startTallyRunner(): Promise<void> {
  const ready = await initTallyClients()
  if (!ready) {
    console.warn("[tally-runner] Disabled — missing FHENIX_CONTRACT_ADDRESS or VERIFIER_PRIVATE_KEY")
    return
  }
  console.log("[tally-runner] Started — checking every 60s for ended polls")
  void runOnce()
  setInterval(() => void runOnce(), POLL_INTERVAL_MS)
}

/**
 * Manually tally a specific poll (called via POST /admin/tally/:pollId).
 * Safe to call multiple times — skips already-published options.
 */
export async function manualTally(pollId: string): Promise<void> {
  const ready = await initTallyClients()
  if (!ready) throw new Error("Tally clients not available — check env vars")
  await runTallyForPoll(pollId as `0x${string}`)
  done.add(pollId)
}
