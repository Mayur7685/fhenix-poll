import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useWallet } from '../hooks/useWallet'
import { useCofheWriteContract } from '@cofhe/react'
import { getBlockHeight, getCredential } from '../lib/fhenix'
import { FHENIX_POLL_ABI, CONTRACT_ADDRESS } from '../lib/abi'
import { getCredentialParams } from '../lib/verifier'
import { listCommunities } from '../lib/verifier'
import ConnectorSelector from '../components/ConnectorSelector'
import RequirementsPanel from '../components/RequirementsPanel'
import type { CommunityConfig, ConnectedAccount, Credential } from '../types'

// ── Small status badge ────────────────────────────────────────────────────────
function CredentialBadge({ status }: { status: 'active' | 'expired' | 'none' }) {
  if (status === 'active')  return <span className="text-xs font-semibold text-[#10B981] bg-green-50 border border-green-100 px-2.5 py-1 rounded-full">Credential active</span>
  if (status === 'expired') return <span className="text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-100 px-2.5 py-1 rounded-full">Expired</span>
  return <span className="text-xs font-semibold text-gray-500 bg-gray-50 border border-gray-100 px-2.5 py-1 rounded-full">No credential</span>
}

// ── Community accordion row ────────────────────────────────────────────────────
function CommunityCredentialRow({
  community,
  credential,
  connectedAccounts,
  onAccountsChange,
  evmAddress,
  isConnected,
  onIssue,
  currentBlock,
}: {
  community:          CommunityConfig
  credential:         Credential | null
  connectedAccounts:  ConnectedAccount[]
  onAccountsChange:   (a: ConnectedAccount[]) => void
  evmAddress:         string
  isConnected:        boolean
  onIssue:            (communityId: string) => void
  currentBlock:       number
}) {
  const [expanded, setExpanded] = useState(false)

  const credStatus = credential
    ? (credential.expiry > currentBlock ? 'active' : 'expired')
    : 'none'

  const allFree = community.requirement_groups.flatMap(g => g.requirements).every(r => r.type === 'FREE')

  return (
    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden hover:border-gray-200 transition-colors">
      <button
        className="w-full flex items-center gap-4 px-5 py-4 text-left"
        onClick={() => setExpanded(e => !e)}
      >
        {community.logo ? (
          <img src={community.logo} alt={community.name}
            className="w-10 h-10 rounded-full object-cover shrink-0 border border-gray-100" />
        ) : (
          <div className="w-10 h-10 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
            <span className="text-blue-500 font-semibold text-xs">
              {community.name.slice(0, 2).toUpperCase()}
            </span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-900 text-sm">{community.name}</span>
            {allFree && (
              <span className="text-xs text-gray-400 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded-full">Free</span>
            )}
          </div>
          {community.description && (
            <p className="text-xs text-gray-400 mt-0.5 truncate">{community.description}</p>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <CredentialBadge status={credStatus} />
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
          >
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 p-4">
          {credStatus === 'active' ? (
            <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3.5">
              <div className="w-8 h-8 rounded-full bg-[#10B981] flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-green-800">You have an active credential</p>
                <p className="text-xs text-green-600 mt-0.5">
                  Type {credential!.credType} · Expires at block {credential!.expiry.toLocaleString()}
                </p>
              </div>
            </div>
          ) : (
            <RequirementsPanel
              groups={community.requirement_groups}
              communityId={community.community_id}
              evmAddress={evmAddress}
              isConnected={isConnected}
              connectedAccounts={connectedAccounts}
              onAccountsChange={onAccountsChange}
              onCredentialIssued={() => onIssue(community.community_id)}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function CredentialsHub() {
  const { address, isConnected }      = useWallet()
  const { writeContractAsync }        = useCofheWriteContract()

  const [communities, setCommunities]           = useState<CommunityConfig[]>([])
  const [credentialMap, setCredentialMap]       = useState<Map<string, Credential>>(new Map())
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>(() => {
    try { return JSON.parse(localStorage.getItem('zkpoll:accounts') ?? '[]') } catch { return [] }
  })
  const [loading, setLoading]                   = useState(true)
  const [currentBlock, setCurrentBlock]         = useState(0)

  const handleAccountsChange = useCallback((accounts: ConnectedAccount[]) => {
    setConnectedAccounts(accounts)
    localStorage.setItem('zkpoll:accounts', JSON.stringify(accounts))
  }, [])

  useEffect(() => {
    listCommunities()
      .then(setCommunities)
      .catch(() => null)
      .finally(() => setLoading(false))
    getBlockHeight().then(setCurrentBlock).catch(() => null)
  }, [])

  // Load credentials for all communities when wallet connects
  useEffect(() => {
    if (!isConnected || !address || communities.length === 0) return
    const loadCreds = async () => {
      const entries = await Promise.all(
        communities.map(async (c) => {
          try {
            const raw = await getCredential(address, c.community_id as `0x${string}`)
            if (raw && (raw as { exists: boolean }).exists) {
              const r = raw as { holder: `0x${string}`; communityId: `0x${string}`; credType: number; votingWeight: bigint; issuedAt: number; expiry: number; exists: boolean }
              const cred: Credential = {
                holder: r.holder, communityId: r.communityId, credType: r.credType,
                votingWeight: r.votingWeight, issuedAt: r.issuedAt, expiry: r.expiry, exists: r.exists,
                voting_weight: Number(r.votingWeight), expiry_block: r.expiry, issued_at: r.issuedAt,
              }
              return [c.community_id, cred] as [string, Credential]
            }
          } catch { /* community not on-chain yet */ }
          return [c.community_id, null] as [string, null]
        })
      )
      setCredentialMap(new Map(entries.filter(([, v]) => v !== null) as [string, Credential][]))
    }
    void loadCreds()
  }, [isConnected, address, communities])

  // Called after RequirementsPanel issues a credential — refresh that community
  const handleIssue = useCallback(async (communityId: string) => {
    if (!address) return
    try {
      const raw = await getCredential(address, communityId as `0x${string}`)
      if (raw && (raw as { exists: boolean }).exists) {
        const r = raw as { holder: `0x${string}`; communityId: `0x${string}`; credType: number; votingWeight: bigint; issuedAt: number; expiry: number; exists: boolean }
        const cred: Credential = {
          holder: r.holder, communityId: r.communityId, credType: r.credType,
          votingWeight: r.votingWeight, issuedAt: r.issuedAt, expiry: r.expiry, exists: r.exists,
          voting_weight: Number(r.votingWeight), expiry_block: r.expiry, issued_at: r.issuedAt,
        }
        setCredentialMap(prev => new Map(prev).set(communityId, cred))
      }
    } catch { /* ignore */ }
  }, [address])

  return (
    <div className="max-w-2xl mx-auto w-full space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Credentials Hub</h1>
        <p className="text-sm text-gray-500 mt-1">
          Connect your accounts, verify community requirements, and claim FHE credentials on-chain.
        </p>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-2 h-2 rounded-full bg-[#0070F3]" />
          <h2 className="text-sm font-semibold text-gray-900">How it works</h2>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[
            { n: '1', title: 'Connect accounts', desc: 'Link your EVM wallet, X / Twitter, or Discord.' },
            { n: '2', title: 'Verify requirements', desc: 'The verifier checks eligibility off-chain.' },
            { n: '3', title: 'Submit on-chain', desc: 'Your wallet submits the signed attestation — no server key involved.' },
          ].map(({ n, title, desc }) => (
            <div key={n} className="flex flex-col gap-1.5">
              <div className="w-7 h-7 rounded-full bg-[#0070F3] text-white text-xs font-bold flex items-center justify-center shrink-0">
                {n}
              </div>
              <p className="text-xs font-semibold text-gray-800">{title}</p>
              <p className="text-xs text-gray-400 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {!isConnected && (
        <div className="bg-amber-50 border border-amber-100 rounded-2xl px-5 py-4 flex items-start gap-3">
          <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <div>
            <p className="text-sm font-semibold text-amber-800">Connect your wallet</p>
            <p className="text-xs text-amber-600 mt-0.5">Your EVM wallet is needed to sign and store credentials on-chain.</p>
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2 h-2 rounded-full bg-[#10B981]" />
          <h2 className="text-sm font-semibold text-gray-900">Connected Accounts</h2>
          <span className="text-xs text-gray-400">For requirement checks</span>
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl p-4">
          <ConnectorSelector accounts={connectedAccounts} onChange={handleAccountsChange} />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-gray-400" />
            <h2 className="text-sm font-semibold text-gray-900">Community Credentials</h2>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-[#0070F3] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : communities.length === 0 ? (
          <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center">
            <p className="text-sm text-gray-500 mb-3">No communities found.</p>
            <Link to="/create"
              className="inline-flex items-center gap-1.5 bg-gray-900 text-white px-5 py-2.5 rounded-full text-sm font-medium hover:bg-gray-800 transition-colors">
              Create Community →
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {communities.map(community => (
              <CommunityCredentialRow
                key={community.community_id}
                community={community}
                credential={credentialMap.get(community.community_id) ?? null}
                connectedAccounts={connectedAccounts}
                onAccountsChange={handleAccountsChange}
                evmAddress={address ?? ''}
                isConnected={isConnected}
                onIssue={handleIssue}
                currentBlock={currentBlock}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
