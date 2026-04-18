import { RequirementGroup, Requirement, ConnectedAccount, CheckResult } from "./types.js"

// Default EV per requirement type — matches CredentialHub.tsx DEFAULT_WEIGHTS.
// Values are in the 1–100 "eligible votes" display scale.
// The issuer multiplies by 10_000 to convert to the contract's 0–1_000_000 scale.
// FREE / ALLOWLIST = 100 EV → full weight (1_000_000) for open / permissioned communities.
const DEFAULT_WEIGHTS: Record<string, number> = {
  FREE:             100,   // open community — everyone gets full weight
  ALLOWLIST:        100,   // allowlisted address — full weight
  TOKEN_BALANCE:    10,
  NFT_OWNERSHIP:    10,
  ONCHAIN_ACTIVITY: 3,
  DOMAIN_OWNERSHIP: 5,
  X_FOLLOW:         2,
  DISCORD_MEMBER:   5,
  DISCORD_ROLE:     5,
  GITHUB_ACCOUNT:   3,
  TELEGRAM_MEMBER:  3,
}

/**
 * Sum EV across all requirements in all groups that passed.
 * A requirement's weight is req.params.vote_weight ?? DEFAULT_WEIGHTS[req.type] ?? 1.
 * Minimum returned is 1 (free communities always get EV=1).
 */
export function calculateVotingWeight(
  groups: RequirementGroup[],
  results: CheckResult[],
): number {
  const passedIds = new Set(results.filter(r => r.passed).map(r => r.requirementId))
  const allReqs: Requirement[] = groups.flatMap(g => g.requirements)
  const total = allReqs
    .filter(r => passedIds.has(r.id))
    .reduce((sum, r) => sum + (r.params.vote_weight ?? DEFAULT_WEIGHTS[r.type] ?? 1), 0)
  return Math.max(total, 1)
}
import { checkTokenBalance } from "./checkers/token_balance.js"
import { checkNFTOwnership } from "./checkers/nft_ownership.js"
import { checkOnchainActivity } from "./checkers/onchain_activity.js"
import { checkXFollow, checkDiscordMember, checkDiscordRole, checkTelegramMember } from "./checkers/social_follow.js"
import { checkGitHubAccount } from "./checkers/github.js"
import { checkDomainOwnership } from "./checkers/domain_ownership.js"
import { getUserToken, getUserMeta } from "./oauth.js"

function getRpcUrl(chain: string): string {
  const urls: Record<string, string> = {
    // Mainnets
    ethereum:          "https://eth.llamarpc.com",
    base:              "https://mainnet.base.org",
    optimism:          "https://mainnet.optimism.io",
    arbitrum:          "https://arb1.arbitrum.io/rpc",
    // Testnets
    "ethereum-sepolia": "https://rpc.sepolia.org",
    "base-sepolia":     "https://sepolia.base.org",
    "arbitrum-sepolia": "https://sepolia-rollup.arbitrum.io/rpc",
    "optimism-sepolia": "https://sepolia.optimism.io",
  }
  return urls[chain] ?? urls["ethereum"]
}

async function checkSingle(
  req: RequirementGroup["requirements"][0],
  accounts: ConnectedAccount[],
): Promise<{ passed: boolean; error?: string }> {
  const evm      = accounts.find(a => a.type === "EVM_WALLET")?.identifier ?? ""
  const xAcct    = accounts.find(a => a.type === "X_TWITTER")?.identifier ?? ""
  const discord  = accounts.find(a => a.type === "DISCORD")?.identifier ?? ""
  const github   = accounts.find(a => a.type === "GITHUB")?.identifier ?? ""
  const telegram = accounts.find(a => a.type === "TELEGRAM")?.identifier ?? ""

  switch (req.type) {
    case "FREE":
      return { passed: true }

    case "ALLOWLIST":
      return {
        passed: (req.params.addresses ?? [])
          .map(a => a.toLowerCase())
          .includes(evm.toLowerCase()),
      }

    case "TOKEN_BALANCE":
      return {
        passed: await checkTokenBalance(
          evm, req.params.tokenAddress!, req.params.minAmount!, getRpcUrl(req.chain!),
        ),
      }

    case "NFT_OWNERSHIP":
      return {
        passed: await checkNFTOwnership(evm, req.params.contractAddress!, getRpcUrl(req.chain!)),
      }

    case "ONCHAIN_ACTIVITY":
      return {
        passed: await checkOnchainActivity(
          evm,
          process.env.ALCHEMY_API_KEY!,
          req.chain!,
          req.params.minTxCount ?? 1,
        ),
      }

    case "DOMAIN_OWNERSHIP":
      return {
        passed: await checkDomainOwnership(evm, req.params.domain!, getRpcUrl(req.chain!)),
      }

    case "X_FOLLOW": {
      // Resolve the authenticated user's Twitter username from the token store
      const meta     = getUserMeta('twitter', xAcct)
      const username = meta?.username ?? xAcct  // fallback to whatever identifier was stored
      console.debug(`[evaluator] X_FOLLOW xAcct="${xAcct}" username="${username}" handle="${req.params.handle}"`)
      return {
        passed: await checkXFollow(username, req.params.handle!),
      }
    }

    case "DISCORD_MEMBER":
      return {
        passed: await checkDiscordMember(
          discord,
          req.params.serverId!,
          process.env.DISCORD_BOT_TOKEN!,
          getUserToken('discord', discord), // user-context token (no bot-in-server needed)
        ),
      }

    case "DISCORD_ROLE":
      return {
        passed: await checkDiscordRole(
          discord, req.params.serverId!, req.params.roleId!, process.env.DISCORD_BOT_TOKEN!,
        ),
      }

    case "GITHUB_ACCOUNT": {
      const githubToken = getUserToken('github', github)
      return {
        passed: await checkGitHubAccount(
          github,
          {
            minRepos:     req.params.minRepos,
            minFollowers: req.params.minFollowers,
            orgName:      req.params.orgName,
            commitsRepo:  req.params.commitsRepo,
            minCommits:   req.params.minCommits,
            starredRepo:  req.params.starredRepo,
          },
          githubToken,
        ),
      }
    }

    case "TELEGRAM_MEMBER":
      return {
        passed: await checkTelegramMember(telegram, req.params.chatId!, process.env.TELEGRAM_BOT_TOKEN!),
      }

    default:
      return { passed: false, error: `Unknown requirement type: ${req.type}` }
  }
}

export async function evaluateRequirements(
  groups: RequirementGroup[],
  accounts: ConnectedAccount[],
): Promise<{ passed: boolean; results: CheckResult[] }> {
  const allResults: CheckResult[] = []

  for (const group of groups) {
    const groupResults: CheckResult[] = []

    for (const req of group.requirements) {
      let passed = false
      let error: string | undefined

      try {
        const result = await checkSingle(req, accounts)
        passed = result.passed
        error  = result.error
      } catch (e: any) {
        passed = false
        error  = e.message ?? "Check failed"
      }

      groupResults.push({ requirementId: req.id, passed, error })
    }

    allResults.push(...groupResults)

    const groupPassed =
      group.logic === "AND"
        ? groupResults.every(r => r.passed)
        : groupResults.some(r => r.passed)

    if (!groupPassed) return { passed: false, results: allResults }
  }

  return { passed: true, results: allResults }
}
