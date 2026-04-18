// HTTP client for the off-chain verifier service.
// Community metadata is stored on IPFS via Pinata; verifier handles OAuth + EIP-712 signing.

import type { ConnectedAccount, VerifyResponse, CredentialParamsResponse, CommunityConfig, PollInfo } from '../types'

const BASE = import.meta.env.VITE_VERIFIER_URL ?? '/api'

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error ?? `Verifier ${res.status}`)
  }
  return res.json()
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error ?? `Verifier ${res.status}`)
  }
  return res.json()
}

/** List all communities (with IPFS metadata hydrated by the verifier). */
export const listCommunities = (): Promise<CommunityConfig[]> =>
  get('/communities')

/** Fetch a single community by ID (bytes32 hex or slug). */
export const getCommunityById = (id: string): Promise<CommunityConfig | null> =>
  get<CommunityConfig>(`/communities/${encodeURIComponent(id)}`).catch(() => null)

/**
 * After registerCommunity tx confirms, persist community to the verifier's
 * local store so GET /communities returns it.
 */
export const confirmCommunity = (config: Partial<CommunityConfig>): Promise<void> =>
  post('/communities/confirm', config)

/** After createPoll tx confirms, persist poll to verifier local store. */
export const confirmPoll = (poll: Partial<PollInfo>): Promise<void> =>
  post('/polls/confirm', poll)

/** Check requirements only — no on-chain transaction */
export const checkRequirements = (
  communityId:       string,
  evmAddress:        string,
  connectedAccounts: ConnectedAccount[],
): Promise<VerifyResponse> =>
  post('/verify/check', { communityId, evmAddress, connectedAccounts })

/**
 * Verify requirements and get EIP-712 signed attestation for issueCredential().
 * Returns { passed, results, attestation, signature }.
 * BigInt fields (votingWeight, nonce) are serialised as strings by the verifier
 * and converted back to BigInt here.
 */
export const getCredentialParams = async (
  communityId:       string,
  evmAddress:        string,
  connectedAccounts: ConnectedAccount[],
): Promise<CredentialParamsResponse> => {
  const raw = await post<CredentialParamsResponse & {
    attestation: { votingWeight: string | bigint; nonce: string | bigint }
  }>('/verify/credential-params', { communityId, evmAddress, connectedAccounts })
  return {
    ...raw,
    attestation: {
      ...raw.attestation,
      votingWeight: BigInt(raw.attestation.votingWeight),
      nonce:        BigInt(raw.attestation.nonce),
    },
  }
}
