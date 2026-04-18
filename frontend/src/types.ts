// ─── Verifier / Community types ────────────────────────────────────────────────

export type RequirementType =
  | 'FREE'
  | 'ALLOWLIST'
  | 'TOKEN_BALANCE'
  | 'NFT_OWNERSHIP'
  | 'ONCHAIN_ACTIVITY'
  | 'DOMAIN_OWNERSHIP'
  | 'X_FOLLOW'
  | 'DISCORD_MEMBER'
  | 'DISCORD_ROLE'
  | 'GITHUB_ACCOUNT'
  | 'TELEGRAM_MEMBER'

export interface Requirement {
  id: string
  type: RequirementType
  chain?: string
  params: {
    tokenAddress?: string
    minAmount?: string
    contractAddress?: string
    addresses?: string[]
    domain?: string
    handle?: string
    serverId?: string
    roleId?: string
    chatId?: string
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
  id: string
  logic: 'AND' | 'OR'
  requirements: Requirement[]
}

export interface PollOptionInfo {
  option_id: number
  label: string
  parent_option_id: number
  child_count: number
}

export interface PollInfo {
  poll_id: string               // bytes32 hex
  community_id?: string         // bytes32 hex — parent community
  title: string
  description?: string
  required_credential_type: number
  created_at_block: number
  end_block?: number
  options: PollOptionInfo[]
  ipfs_cid?: string
  poll_type?: 'flat' | 'hierarchical'
  scope_keys?: Array<{ parentOptionId: number; scopeKey: string }>
  creator_address?: string
}

export interface CommunityConfig {
  community_id: string          // bytes32 hex
  name: string
  description: string
  logo: string
  credential_type: number
  credential_expiry_days: number
  requirement_groups: RequirementGroup[]
  polls?: PollInfo[]
  creator?: string              // EVM address of community creator
}

// ─── Connected accounts ────────────────────────────────────────────────────────

export type AccountType = 'EVM_WALLET' | 'X_TWITTER' | 'DISCORD' | 'GITHUB' | 'TELEGRAM'

export interface ConnectedAccount {
  type: AccountType
  identifier: string
  displayName?: string
}

// ─── Poll types ────────────────────────────────────────────────────────────────

export interface PollOption {
  option_id: number
  label: string
  parent_option_id: number
  child_count: number
}

export interface Poll {
  poll_id: string               // bytes32 hex
  community_id: string          // bytes32 hex
  required_credential_type: number
  created_at: number
  active: boolean
  end_block?: number
  options: PollOption[]
  vote_count?: number
  poll_type?: 'flat' | 'hierarchical'
}

// ─── Vote state ────────────────────────────────────────────────────────────────

export interface VoteRanking {
  [optionId: number]: number    // optionId → rank (1-8, 0 = unranked)
}

// ─── Credential (on-chain Fhenix) ──────────────────────────────────────────────

export interface Credential {
  holder: `0x${string}`
  communityId: `0x${string}`
  credType: number
  votingWeight: bigint          // scaled by 1e6 (1_000_000 = 100%)
  issuedAt: number              // block number
  expiry: number                // block number
  exists: boolean
  // Legacy compat fields used by decay.ts
  voting_weight: number         // = Number(votingWeight) / 1_000_000 * 100 for EV
  expiry_block: number          // = expiry
  issued_at: number             // = issuedAt
}

// ─── FHE vote weights ─────────────────────────────────────────────────────────

export interface VoteWeights {
  pollId: `0x${string}`
  optionWeights: unknown[]      // EncryptedUint32Input[] after encryption
}

export interface RevealedTally {
  pollId: `0x${string}`
  optionScores: bigint[]
}

// ─── Check result ──────────────────────────────────────────────────────────────

export interface CheckResult {
  requirementId: string
  passed: boolean
  error?: string
}

export interface VerifyResponse {
  passed: boolean
  results: CheckResult[]
  txHash?: string
}

/** EIP-712 signed attestation returned by POST /verify/credential-params */
export interface CredentialAttestation {
  recipient:    `0x${string}`
  communityId:  `0x${string}`
  nullifier:    `0x${string}`
  credType:     number
  votingWeight: bigint
  expiryBlock:  number
  issuedAt:     number
  nonce:        bigint
}

export interface CredentialParamsResponse {
  passed:      boolean
  results:     CheckResult[]
  attestation: CredentialAttestation
  signature:   `0x${string}`
}

// ─── Tally (revealed) ─────────────────────────────────────────────────────────

export interface TallyResult {
  optionId: number
  score: bigint                 // raw uint32 from contract after reveal
}
