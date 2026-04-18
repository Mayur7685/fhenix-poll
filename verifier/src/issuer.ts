// EIP-712 signed credential attestations.
// The verifier signs attestations server-side; users submit them directly to the contract.

import { privateKeyToAccount } from "viem/accounts"
import { keccak256, encodePacked, createPublicClient, http } from "viem"

const CHAIN_ID        = Number(process.env.FHENIX_CHAIN_ID   ?? "31337")
// For block height: on Arbitrum Sepolia, block.number = L1 Ethereum Sepolia block.
// Use L1_RPC_URL (Ethereum Sepolia) so expiryBlock stays in sync with the contract.
const RPC_URL         = process.env.L1_RPC_URL ?? process.env.FHENIX_RPC_URL ?? "http://127.0.0.1:8545"
const CONTRACT_ADDRESS = process.env.FHENIX_CONTRACT_ADDRESS as `0x${string}` | undefined
const VERIFIER_SECRET = process.env.VERIFIER_SECRET           ?? "dev-secret"

// Domain separator matching FhenixPoll.sol constructor call to EIP712("FhenixPoll", "1")
const EIP712_DOMAIN = {
  name:              "FhenixPoll",
  version:           "1",
  chainId:           BigInt(CHAIN_ID),
  verifyingContract: CONTRACT_ADDRESS,
} as const

const ATTESTATION_TYPES = {
  CredentialAttestation: [
    { name: "recipient",    type: "address" },
    { name: "communityId",  type: "bytes32"  },
    { name: "nullifier",    type: "bytes32"  },
    { name: "credType",     type: "uint8"    },
    { name: "votingWeight", type: "uint64"   },
    { name: "expiryBlock",  type: "uint32"   },
    { name: "issuedAt",     type: "uint32"   },
    { name: "nonce",        type: "uint256"  },
  ],
} as const

function getVerifierAccount() {
  const key = process.env.VERIFIER_PRIVATE_KEY
  if (!key) throw new Error("VERIFIER_PRIVATE_KEY not set in environment")
  return privateKeyToAccount(key as `0x${string}`)
}

// ─── Social nullifier ─────────────────────────────────────────────────────────

/**
 * Derive a privacy-preserving social nullifier.
 * One-way hash — same social identity on two wallets produces the same nullifier,
 * but the social ID cannot be recovered from the nullifier.
 */
export function computeSocialNullifier(
  platform:    string,
  socialId:    string,
  communityId: string,
): `0x${string}` {
  return keccak256(encodePacked(
    ["string", "string", "string", "string"],
    [VERIFIER_SECRET, platform, socialId, communityId],
  ))
}

// ─── Block height ─────────────────────────────────────────────────────────────

export async function getCurrentBlockHeight(): Promise<number> {
  const client = createPublicClient({ transport: http(RPC_URL) })
  const block  = await client.getBlockNumber()
  return Number(block)
}

// ─── Attestation signing ──────────────────────────────────────────────────────

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

export async function signAttestation(
  attestation: CredentialAttestation,
): Promise<`0x${string}`> {
  if (!CONTRACT_ADDRESS) {
    throw new Error("FHENIX_CONTRACT_ADDRESS not set — cannot sign attestation")
  }
  const account = getVerifierAccount()
  return account.signTypedData({
    domain: EIP712_DOMAIN,
    types:  ATTESTATION_TYPES,
    primaryType: "CredentialAttestation",
    message: {
      ...attestation,
      credType:     attestation.credType,
      expiryBlock:  attestation.expiryBlock,
      issuedAt:     attestation.issuedAt,
    },
  })
}

/** Derive verifier's EVM address for on-chain registration check. */
export function getVerifierAddress(): `0x${string}` {
  return getVerifierAccount().address
}
