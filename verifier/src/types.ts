export type RequirementType =
  | "TOKEN_BALANCE"
  | "NFT_OWNERSHIP"
  | "ONCHAIN_ACTIVITY"
  | "CONTRACT_INTERACTION"
  | "DOMAIN_OWNERSHIP"
  | "X_FOLLOW"
  | "DISCORD_MEMBER"
  | "DISCORD_ROLE"
  | "GITHUB_ACCOUNT"
  | "TELEGRAM_MEMBER"
  | "ALLOWLIST"
  | "FREE"

export type LogicOperator = "AND" | "OR"

export interface Requirement {
  id: string
  type: RequirementType
  chain?: string
  params: {
    tokenAddress?: string
    minAmount?: string
    contractAddress?: string
    handle?: string
    serverId?: string
    roleId?: string
    chatId?: string          // Telegram chat/channel ID for TELEGRAM_MEMBER
    domain?: string
    addresses?: string[]
    minTxCount?: number      // ONCHAIN_ACTIVITY: minimum transaction count (default 1)
    minRepos?: number        // GITHUB_ACCOUNT: minimum public repos
    minFollowers?: number    // GITHUB_ACCOUNT: minimum followers
    orgName?: string         // GITHUB_ACCOUNT: must be member of GitHub org
    commitsRepo?: string     // GITHUB_ACCOUNT: "owner/repo" — must have committed here
    minCommits?: number      // GITHUB_ACCOUNT: minimum commits to commitsRepo (default 1)
    starredRepo?: string     // GITHUB_ACCOUNT: "owner/repo" — user must have starred this
    vote_weight?: number     // per-requirement EV override; falls back to DEFAULT_WEIGHTS
  }
}

export interface RequirementGroup {
  logic: LogicOperator
  requirements: Requirement[]
}

export interface PollOptionInfo {
  option_id: number
  label: string
  parent_option_id: number
  child_count: number
}

export interface PollInfo {
  poll_id: string            // field value as numeric string
  title: string
  description?: string
  required_credential_type: number
  created_at_block: number
  end_block?: number         // block height after which voting closes
  options: PollOptionInfo[]
  ipfs_cid?: string          // CID of the full poll metadata on IPFS (Pinata)
  creator_address?: string  // wallet address of poll creator — verified server-side
}

export interface CommunityConfig {
  community_id: string
  name: string
  description: string
  logo?: string
  credential_type: number        // 1–255, tier issued on pass
  credential_expiry_days: number // e.g. 365
  requirement_groups: RequirementGroup[]
  polls?: PollInfo[]
  creator?: string               // EVM address of community creator
}

export type ConnectorType =
  | "EVM_WALLET"
  | "DISCORD"
  | "X_TWITTER"
  | "GITHUB"
  | "TELEGRAM"

export interface ConnectedAccount {
  type: ConnectorType
  identifier: string   // wallet address, username, etc.
  verified: boolean
  verifiedAt: number
}

export interface CheckResult {
  requirementId: string
  passed: boolean
  error?: string
}
