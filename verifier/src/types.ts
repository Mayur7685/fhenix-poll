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
    chatId?: string
    domain?: string
    addresses?: string[]
    minTxCount?: number
    minRepos?: number
    minFollowers?: number
    orgName?: string
    commitsRepo?: string
    minCommits?: number
    starredRepo?: string
    vote_weight?: number
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
  poll_id: string
  title: string
  description?: string
  required_credential_type: number
  created_at_block: number
  end_block?: number
  options: PollOptionInfo[]
  ipfs_cid?: string
  creator_address?: string
  poll_type?: "flat" | "hierarchical"
}

export interface CommunityConfig {
  community_id: string
  name: string
  description: string
  logo?: string
  credential_type: number
  credential_expiry_days: number
  requirement_groups: RequirementGroup[]
  polls?: PollInfo[]
  creator?: string
}

export type ConnectorType =
  | "EVM_WALLET"
  | "DISCORD"
  | "X_TWITTER"
  | "GITHUB"
  | "TELEGRAM"

export interface ConnectedAccount {
  type: ConnectorType
  identifier: string
  verified: boolean
  verifiedAt: number
}

export interface CheckResult {
  requirementId: string
  passed: boolean
  error?: string
}

// ─── Wave 4: Posts ────────────────────────────────────────────────────────────

export interface PostMetadata {
  post_id: string        // bytes32 hex
  community_id: string   // bytes32 hex
  author: string         // EVM address
  title: string
  body: string           // markdown content
  ipfs_cid?: string
  content_hash: string   // keccak256(ipfs_cid) stored on-chain
  created_at_block: number
}

// ─── Wave 4: Quests ───────────────────────────────────────────────────────────

export type QuestType = "VOTE_COUNT" | "REFERRAL_COUNT" | "CREDENTIAL_AGE"

export interface QuestInfo {
  quest_id: string       // bytes32 hex
  community_id: string   // bytes32 hex
  title: string
  description: string
  quest_type: QuestType
  target: number
  reward_description: string
  reward_hash: string    // keccak256(reward metadata IPFS CID)
  expiry_block: number
  ipfs_cid?: string
  creator_address?: string
}

export interface QuestProgress {
  quest_id: string
  participant: string    // EVM address
  progress: number
  completed: boolean
}
