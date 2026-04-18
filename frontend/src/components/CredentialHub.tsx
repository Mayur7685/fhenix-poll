// CredentialHub — MetaPoll-style voting eligibility panel for CommunityDetail.
// Shows EV / VP% / CV numbers, decay bar, and credential issuance flow.

import { useState, useEffect } from 'react'
import { useCofheWriteContract } from '@cofhe/react'
import { useConnection } from 'wagmi'
import { arbitrumSepolia } from '../lib/chains'
import { getGasFees } from '../lib/gas'
import { useCredentialHub } from '../hooks/useCredentialHub'
import { getCredentialParams } from '../lib/verifier'
import { vpTextColour, vpBarColour } from '../lib/decay'
import { FHENIX_POLL_ABI, CONTRACT_ADDRESS } from '../lib/abi'
import { publicClient } from '../lib/fhenix'
import ConnectorSelector from './ConnectorSelector'
import type { CommunityConfig, ConnectedAccount, CheckResult, Requirement } from '../types'

const DEFAULT_WEIGHTS: Record<string, number> = {
  FREE: 100, ALLOWLIST: 100, TOKEN_BALANCE: 10, NFT_OWNERSHIP: 10,
  ONCHAIN_ACTIVITY: 3, DOMAIN_OWNERSHIP: 5, X_FOLLOW: 2,
  DISCORD_MEMBER: 5, DISCORD_ROLE: 5,
}

const REQ_LABELS: Record<string, string> = {
  FREE: 'Open access', ALLOWLIST: 'Allowlist', TOKEN_BALANCE: 'Token Balance',
  NFT_OWNERSHIP: 'NFT Ownership', ONCHAIN_ACTIVITY: 'On-chain Activity',
  DOMAIN_OWNERSHIP: 'Domain Ownership', X_FOLLOW: 'X / Twitter Follow',
  DISCORD_MEMBER: 'Discord Member', DISCORD_ROLE: 'Discord Role',
}

const REQ_ICONS: Record<string, string> = {
  FREE: '🌐', ALLOWLIST: '📋', TOKEN_BALANCE: '🪙', NFT_OWNERSHIP: '🖼',
  ONCHAIN_ACTIVITY: '⛓', DOMAIN_OWNERSHIP: '🌍', X_FOLLOW: '𝕏',
  DISCORD_MEMBER: '💬', DISCORD_ROLE: '🏷',
}

function reqDetail(req: Requirement): string | null {
  const p = req.params
  switch (req.type) {
    case 'X_FOLLOW':        return p.handle ? `Follow ${p.handle}` : null
    case 'DISCORD_MEMBER':  return p.serverId ? `Server ID: ${p.serverId}` : null
    case 'DISCORD_ROLE':    return p.roleId ? `Role ID: ${p.roleId}` : null
    case 'GITHUB_ACCOUNT':
      if (p.orgName)      return `Member of ${p.orgName}`
      if (p.minRepos)     return `${p.minRepos}+ public repos`
      if (p.minFollowers) return `${p.minFollowers}+ followers`
      return 'GitHub account required'
    case 'TOKEN_BALANCE':   return p.minAmount ? `Min ${p.minAmount}` : null
    case 'NFT_OWNERSHIP':   return p.contractAddress ? `Contract: ${p.contractAddress.slice(0,8)}…` : null
    case 'ONCHAIN_ACTIVITY': return `${p.minTxCount ?? 1}+ transactions`
    case 'ALLOWLIST':       return `${(p.addresses ?? []).length} addresses`
    case 'DOMAIN_OWNERSHIP': return p.domain ?? null
    default: return null
  }
}

function ThreeNumbers({ ev, vp, cv }: { ev: number; vp: number; cv: number }) {
  return (
    <div className="grid grid-cols-3 divide-x divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
      {[
        { label: 'Eligible Votes', value: ev.toLocaleString(), sub: 'EV' },
        { label: 'Voting Power',   value: `${vp % 1 === 0 ? vp : vp.toFixed(2)}%`, sub: 'VP', colour: vpTextColour(vp) },
        { label: 'Counted Votes',  value: cv.toLocaleString(), sub: 'CV' },
      ].map(({ label, value, sub, colour }) => (
        <div key={sub} className="flex flex-col items-center py-3 px-2 bg-white">
          <span className={`text-lg font-semibold tabular-nums ${colour ?? 'text-gray-900'}`}>{value}</span>
          <span className="text-xs text-gray-400 mt-0.5">{label}</span>
          <span className="text-[10px] font-mono text-gray-300 mt-0.5">{sub}</span>
        </div>
      ))}
    </div>
  )
}

function DecayBar({ progress, daysLeft, periods, vpPct }: {
  progress: number; daysLeft: number; periods: number; vpPct: number
}) {
  if (vpPct === 0) return (
    <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-center">
      <p className="text-sm font-semibold text-red-600">Vote deactivated</p>
      <p className="text-xs text-red-400 mt-0.5">Credential fully decayed. Renew to restore voting power.</p>
    </div>
  )
  const barColour = vpBarColour(vpPct)
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span className="font-medium">Period {periods + 1} of 5</span>
        <span>Decays in <strong className="text-gray-800">{daysLeft} days</strong> → {(vpPct / 2).toFixed(2)}%</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColour}`}
          style={{ width: `${Math.min(progress * 100, 100)}%` }} />
      </div>
    </div>
  )
}

interface Props { community: CommunityConfig }

export default function CredentialHub({ community }: Props) {
  const { address, isConnected }  = useConnection()
  const { writeContractAsync }    = useCofheWriteContract()
  const hub = useCredentialHub(community)

  const allReqs      = community.requirement_groups.flatMap(g => g.requirements)
  const isFreeOnly   = allReqs.every(r => r.type === 'FREE')
  const needsEVM     = allReqs.some(r => ['TOKEN_BALANCE','NFT_OWNERSHIP','ONCHAIN_ACTIVITY','DOMAIN_OWNERSHIP','ALLOWLIST'].includes(r.type))
  const needsTwitter = allReqs.some(r => r.type === 'X_FOLLOW')
  const needsDiscord = allReqs.some(r => ['DISCORD_MEMBER','DISCORD_ROLE'].includes(r.type))
  const needsGitHub  = allReqs.some(r => r.type === 'GITHUB_ACCOUNT')
  const needsTelegram = allReqs.some(r => r.type === 'TELEGRAM_MEMBER')
  const needsConnectors = needsEVM || needsTwitter || needsDiscord || needsGitHub || needsTelegram

  const [accounts, setAccounts] = useState<ConnectedAccount[]>(() => {
    try { return JSON.parse(localStorage.getItem('zkpoll:accounts') ?? '[]') } catch { return [] }
  })
  useEffect(() => { localStorage.setItem('zkpoll:accounts', JSON.stringify(accounts)) }, [accounts])

  const [results, setResults]         = useState<CheckResult[] | null>(null)
  const [issuing, setIssuing]         = useState(false)
  const [issueStatus, setIssueStatus] = useState<'idle' | 'issuing' | 'done' | 'error'>('idle')
  const [issueTxHash, setIssueTxHash] = useState<string | null>(null)
  const [issueError, setIssueError]   = useState<string | null>(null)

  const handleGetCredential = async () => {
    if (!isConnected || !address) return
    setIssuing(true); setIssueError(null); setResults(null); setIssueStatus('idle'); setIssueTxHash(null)

    try {
      const evmAddress = address as string
      const res = await getCredentialParams(community.community_id, evmAddress, accounts)
      setResults(res.results ?? null)

      if (!res.passed) {
        setIssueStatus('error')
        setIssueError('Requirements not met. Check items above.')
        setIssuing(false)
        return
      }

      setIssueStatus('issuing')
      setIssuing(false)

      const { attestation, signature } = res
      const { maxFeePerGas, maxPriorityFeePerGas } = await getGasFees()
      const hash = await writeContractAsync({
        chain:   arbitrumSepolia,
        account: address,
        address: CONTRACT_ADDRESS,
        abi:     FHENIX_POLL_ABI,
        functionName: 'issueCredential',
        maxFeePerGas,
        maxPriorityFeePerGas,
        args: [
          {
            recipient:    attestation.recipient,
            communityId:  attestation.communityId,
            nullifier:    attestation.nullifier,
            credType:     attestation.credType,
            votingWeight: attestation.votingWeight,
            expiryBlock:  attestation.expiryBlock,
            issuedAt:     attestation.issuedAt,
            nonce:        attestation.nonce,
          },
          signature,
        ],
      })

      setIssueTxHash(hash)
      await publicClient.waitForTransactionReceipt({ hash })
      setIssueStatus('done')
      setTimeout(() => void hub.refresh(), 2_000)
    } catch (e: unknown) {
      setIssueError(e instanceof Error ? e.message : String(e))
      setIssueStatus('error')
      setIssuing(false)
    }
  }

  if (hub.loading) return (
    <div className="border border-gray-100 rounded-2xl p-6 bg-white flex items-center justify-center gap-3 shadow-sm">
      <div className="w-4 h-4 border-2 border-[#0070F3] border-t-transparent rounded-full animate-spin" />
      <span className="text-sm text-gray-400">Loading credential status…</span>
    </div>
  )

  // A credential with eligibleVotes === 0 was issued before the votingWeight scaling fix.
  // Treat it the same as "no credential" so the user can re-issue with corrected weight.
  const credBroken = !!hub.credential && hub.eligibleVotes === 0
  const hasCred    = !!hub.credential && !hub.isExpired && !credBroken

  return (
    <div className="border border-gray-100 rounded-2xl overflow-hidden bg-white shadow-sm">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-gray-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm
              ${hasCred ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>
              {hasCred ? '✓' : '🔑'}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Voting Eligibility</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {isFreeOnly ? 'Open to everyone' : 'Gated access'}
              </p>
            </div>
          </div>
          {hasCred && (
            <span className="text-xs bg-emerald-50 text-emerald-600 border border-emerald-100 px-2.5 py-1 rounded-full font-medium">
              Active credential
            </span>
          )}
          {hub.isExpired && (
            <span className="text-xs bg-amber-50 text-amber-600 border border-amber-100 px-2.5 py-1 rounded-full font-medium">
              Expired — renew
            </span>
          )}
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Requirements breakdown */}
        {!isFreeOnly && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Requirements</p>
            {allReqs.map(req => {
              const result = results?.find(r => r.requirementId === req.id)
              const weight = req.params.vote_weight ?? DEFAULT_WEIGHTS[req.type] ?? 1
              return (
                <div key={req.id}
                  className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-sm transition-colors
                    ${result?.passed === true  ? 'bg-emerald-50 border-emerald-100' :
                      result?.passed === false ? 'bg-red-50 border-red-100' :
                      'bg-gray-50 border-gray-100'}`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-base leading-none">{REQ_ICONS[req.type] ?? '●'}</span>
                    <div>
                      <span className="font-medium text-gray-800">{REQ_LABELS[req.type] ?? req.type}</span>
                      {req.chain && (
                        <span className="ml-1.5 text-xs text-gray-400 bg-white border border-gray-100 px-1.5 py-0.5 rounded-full">
                          {req.chain}
                        </span>
                      )}
                      {reqDetail(req) && (
                        <p className="text-xs text-gray-500 mt-0.5">{reqDetail(req)}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-gray-400">{weight} vote{weight !== 1 ? 's' : ''}</span>
                    {result && (
                      <span className={`text-xs font-semibold ${result.passed ? 'text-emerald-600' : 'text-red-500'}`}>
                        {result.passed ? '✓' : '✕'}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {credBroken && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
            <span className="text-xl leading-none mt-0.5">⚠️</span>
            <div>
              <p className="text-sm font-medium text-amber-800">Credential has 0 voting weight</p>
              <p className="text-xs text-amber-700 mt-0.5">
                Issued before a scaling fix. Connect a social account (Twitter, Discord, etc.)
                then click below — this generates a new nullifier so the contract can overwrite
                the broken credential with the correct weight.
              </p>
            </div>
          </div>
        )}

        {isFreeOnly && !hasCred && !credBroken && (
          <div className="flex items-start gap-3 bg-gray-50 rounded-xl px-4 py-3">
            <span className="text-xl leading-none mt-0.5">🌐</span>
            <div>
              <p className="text-sm font-medium text-gray-800">Open to everyone</p>
              <p className="text-xs text-gray-500 mt-0.5">
                No requirements — get a free credential to vote.
              </p>
            </div>
          </div>
        )}

        {/* Account connectors — shown for gated requirements, or when re-issuing a broken credential */}
        {(needsConnectors || credBroken) && !hasCred && issueStatus !== 'done' && (
          <ConnectorSelector accounts={accounts} onChange={setAccounts} />
        )}

        {/* 3-number panel */}
        {hasCred && (
          <>
            <ThreeNumbers ev={hub.eligibleVotes} vp={hub.vpPct} cv={hub.cv} />
            <DecayBar progress={hub.progress} daysLeft={hub.daysLeft} periods={hub.periods} vpPct={hub.vpPct} />
          </>
        )}

        {/* Issuance feedback */}
        {issueStatus === 'issuing' && (
          <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
            <div className="w-4 h-4 border-2 border-[#0070F3] border-t-transparent rounded-full animate-spin shrink-0" />
            <p className="text-sm text-blue-700 font-medium">Submitting credential on Fhenix…</p>
          </div>
        )}

        {issueStatus === 'done' && (
          <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-100 rounded-xl p-4">
            <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center shrink-0 mt-0.5">
              <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-emerald-800">Credential issued on-chain!</p>
              <p className="text-xs text-emerald-600 mt-0.5">Stored on Fhenix. Refreshing…</p>
              {issueTxHash && (
                <a href={`https://sepolia.arbiscan.io/tx/${issueTxHash}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-xs text-emerald-600 hover:underline mt-1 block">
                  View transaction ↗
                </a>
              )}
            </div>
          </div>
        )}

        {issueStatus === 'error' && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3">
            <p className="text-sm text-red-600">{issueError ?? 'Requirements not met.'}</p>
          </div>
        )}

        {/* Actions */}
        {!isConnected ? (
          <p className="text-center text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
            Connect your EVM wallet to check eligibility.
          </p>
        ) : (!hasCred || hub.isExpired) && issueStatus !== 'done' ? (
          <button
            onClick={() => void handleGetCredential()}
            disabled={issuing || issueStatus === 'issuing'}
            className="w-full py-3 bg-[#0070F3] hover:bg-blue-600 text-white font-medium rounded-xl text-sm transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {(issuing || issueStatus === 'issuing') && (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            )}
            {hub.isExpired || credBroken ? 'Renew Credential' : isFreeOnly ? 'Get Free Credential' : 'Verify & Get Credential'}
          </button>
        ) : null}

        {/* Credential metadata */}
        {hub.credential && (
          <div className="flex items-center justify-between text-xs text-gray-400 pt-1 border-t border-gray-50">
            <span>
              {hub.isExpired
                ? 'Credential expired'
                : `Expires at block ${hub.credential.expiry.toLocaleString()}`}
            </span>
            <span>Issued {hub.elapsed} day{hub.elapsed !== 1 ? 's' : ''} ago</span>
          </div>
        )}
      </div>

      {/* Footer bar */}
      <div className={`px-5 py-3 text-xs font-medium text-white
        ${hasCred ? 'bg-emerald-500' : 'bg-[#0070F3]'}`}>
        {hasCred
          ? `${hub.cv.toLocaleString()} counted vote${hub.cv !== 1 ? 's' : ''} · ${hub.vpPct}% voting power`
          : isFreeOnly
          ? 'Open community — anyone can vote. One credential per wallet.'
          : 'Verifier checks eligibility off-chain. Your wallet submits on Fhenix.'}
      </div>
    </div>
  )
}
