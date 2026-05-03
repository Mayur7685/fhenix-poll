// My Votes — shows all VoteCast events for the connected wallet.
// Rankings are FHE-encrypted and not recoverable client-side.
// Shows: community, poll, block voted at, credential decay info.

import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useSignMessage } from 'wagmi'
import { useWallet } from '../hooks/useWallet'
import { useVoteHistory } from '../hooks/useVoteHistory'
import { getCredential, getBlockHeight } from '../lib/fhenix'
import { listCommunities } from '../lib/verifier'
import { votingPowerPct, daysUntilNextDecay, vpTextColour, vpBarColour } from '../lib/decay'
import { loadCachedBundle, deriveKey, decryptJSON } from '../lib/submissionCrypto'
import type { CommunityConfig, Credential } from '../types'
import type { VoteCastEvent } from '../hooks/useVoteHistory'

interface StoredSubmission {
  pollId:   string
  ranking:  Record<string, number>
  options:  { id: string; label: string; parentId?: number }[]
  votedAt:  number
}

interface EnrichedVote {
  event:      VoteCastEvent
  pollTitle:  string
  community:  CommunityConfig | null
  credential: Credential | null
  ev:         number
  vpPct:      number
  daysLeft:   number
  submission: StoredSubmission | null
}

function VoteCard({ vote }: { vote: EnrichedVote }) {
  const { event, pollTitle, community, credential, ev, vpPct, daysLeft, submission } = vote
  const vpColour   = vpTextColour(vpPct)
  const barColour  = vpBarColour(vpPct)
  const vpStr      = vpPct % 1 === 0 ? `${vpPct}%` : `${vpPct.toFixed(2)}%`
  // CV = floor(EV × VP%) — derive directly from already-computed vpPct
  const cv = Math.floor(ev * vpPct / 100)
  const isDeactivated = vpPct === 0

  return (
    <div className={`bg-white border rounded-2xl overflow-hidden shadow-sm transition-colors
      ${isDeactivated ? 'border-red-100' : 'border-gray-100'}`}>

      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-gray-50">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-gray-400 font-medium mb-0.5">
              {community?.name ?? 'Unknown Community'}
            </p>
            <p className="text-sm font-semibold text-gray-900 leading-snug truncate">
              {pollTitle}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
            <div className={`w-1.5 h-1.5 rounded-full ${isDeactivated ? 'bg-red-400' : 'bg-emerald-400'}`} />
            <span className="text-xs text-gray-400">block {Number(event.blockNumber).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* EV / VP% / CV */}
      {credential && (
        <div className="px-5 py-3 flex items-center divide-x divide-gray-100">
          {[
            { label: 'EV',  value: ev.toLocaleString() },
            { label: 'VP%', value: vpStr, colour: vpColour },
            { label: 'CV',  value: cv.toLocaleString() },
          ].map(({ label, value, colour }) => (
            <div key={label} className="flex-1 flex flex-col items-center pr-4 last:pr-0 first:pl-0 pl-4">
              <span className={`text-base font-semibold tabular-nums ${colour ?? 'text-gray-800'}`}>{value}</span>
              <span className="text-[10px] font-mono text-gray-400">{label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Decay bar */}
      {credential && vpPct > 0 && (
        <div className="px-5 pb-3 space-y-1">
          <div className="flex justify-between text-[10px] text-gray-400">
            <span>Voting power</span>
            <span>Decays in {daysLeft}d</span>
          </div>
          <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${barColour}`} style={{ width: `${vpPct}%` }} />
          </div>
        </div>
      )}

      {isDeactivated && (
        <div className="mx-5 mb-3 bg-red-50 border border-red-100 rounded-xl px-3 py-2 text-xs text-red-600 font-medium text-center">
          Credential expired — voting power fully decayed
        </div>
      )}

      {/* My submission */}
      {submission && (() => {
        const ranked = submission.options
          .map(o => ({ ...o, rank: submission.ranking[o.id] ?? 0 }))
          .filter(o => o.rank > 0)
          .sort((a, b) => a.rank - b.rank)
        if (ranked.length === 0) return null

        // Group by parent: render root options, then children indented under each parent
        const roots = ranked.filter(o => !o.parentId || o.parentId === 0)
        const byParent = new Map<number, typeof ranked>()
        ranked.filter(o => o.parentId && o.parentId !== 0).forEach(o => {
          const list = byParent.get(o.parentId!) ?? []
          list.push(o)
          byParent.set(o.parentId!, list)
        })

        return (
          <div className="px-5 pb-3">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">My Submission</p>
            <div className="space-y-1.5">
              {roots.map(o => (
                <div key={o.id}>
                  <span className="text-[11px] bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-full font-medium inline-block">
                    #{o.rank} · {o.label}
                  </span>
                  {byParent.has(Number(o.id)) && (
                    <div className="ml-4 mt-1 flex flex-wrap gap-1">
                      {byParent.get(Number(o.id))!.map(child => (
                        <span key={child.id}
                          className="text-[11px] bg-indigo-50 text-indigo-600 border border-indigo-100 px-2 py-0.5 rounded-full font-medium">
                          #{child.rank} · {child.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {/* Orphan children (parentId not in roots) */}
              {ranked.filter(o => o.parentId && o.parentId !== 0 && !roots.find(r => Number(r.id) === o.parentId)).map(o => (
                <span key={o.id}
                  className="text-[11px] bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-full font-medium inline-block ml-4">
                  #{o.rank} · {o.label}
                </span>
              ))}
            </div>
          </div>
        )
      })()}

      {/* FHE privacy note */}
      <div className="px-5 pb-3">
        <p className="text-[10px] text-gray-400 italic">
          Vote weights are FHE-encrypted and cannot be revealed individually.
        </p>
      </div>

      {/* Actions */}
      <div className="px-5 pb-4 flex gap-2">
        {community && (
          <Link
            to={`/communities/${community.community_id}/polls/${event.pollId}`}
            className="flex-1 py-2 text-xs font-medium text-center text-gray-600 bg-gray-50 border border-gray-100 rounded-xl hover:bg-gray-100 transition-colors"
          >
            View Poll
          </Link>
        )}
        {community && (
          <Link
            to={`/communities/${community.community_id}/polls/${event.pollId}/results`}
            className="flex-1 py-2 text-xs font-medium text-center text-[#0070F3] bg-blue-50 border border-blue-100 rounded-xl hover:bg-blue-100 transition-colors"
          >
            View Results
          </Link>
        )}
      </div>
    </div>
  )
}

interface EncryptedServerSub { pollId: string; ciphertext: string }

export default function MyVotes() {
  const { address, isConnected } = useWallet()
  const { events, loading: eventsLoading, error: eventsError, refresh } = useVoteHistory()
  const { signMessageAsync } = useSignMessage()

  const [enriched, setEnriched]         = useState<EnrichedVote[]>([])
  const [loading, setLoading]           = useState(true)
  const [currentBlock, setCurrentBlock] = useState(0)
  // Encrypted server submissions waiting for decryption key
  const [pendingDecrypt, setPendingDecrypt] = useState<EncryptedServerSub[]>([])
  const [decrypting, setDecrypting]     = useState(false)

  /** Decrypt pending server submissions and merge into enriched list. */
  const decryptAndMerge = useCallback(async () => {
    if (!address || pendingDecrypt.length === 0) return
    setDecrypting(true)
    try {
      const { key } = (await loadCachedBundle()) ?? (await deriveKey(address, signMessageAsync))
      setEnriched(prev => prev.map(vote => {
        if (vote.submission) return vote  // already have it from localStorage
        const enc = pendingDecrypt.find(s => s.pollId === vote.event.pollId)
        if (!enc) return vote
        // Decrypt synchronously after key is available — use a fire-and-forget pattern
        return vote  // will be updated below
      }))
      // Decrypt all and rebuild
      const decrypted = new Map<string, StoredSubmission>()
      await Promise.all(pendingDecrypt.map(async enc => {
        try {
          const sub = await decryptJSON(enc.ciphertext, key) as StoredSubmission
          decrypted.set(enc.pollId, sub)
        } catch { /* wrong key or corrupt — skip */ }
      }))
      setEnriched(prev => prev.map(vote =>
        vote.submission ? vote : { ...vote, submission: decrypted.get(vote.event.pollId) ?? null }
      ))
      setPendingDecrypt([])
    } catch { /* user rejected signature — leave submissions blank */ }
    finally { setDecrypting(false) }
  }, [address, pendingDecrypt, signMessageAsync])

  const enrich = useCallback(async () => {
    if (!isConnected || !address || events.length === 0) {
      setEnriched([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const BASE = import.meta.env.VITE_VERIFIER_URL ?? '/api'

      const [communities, block, encryptedSubs] = await Promise.all([
        listCommunities().catch(() => [] as CommunityConfig[]),
        getBlockHeight(),
        // Fetch encrypted submissions — server stores ciphertext only, never plaintext
        fetch(`${BASE}/submissions/${address}`)
          .then(r => r.ok ? r.json() as Promise<EncryptedServerSub[]> : ([] as EncryptedServerSub[]))
          .catch(() => [] as EncryptedServerSub[]),
      ])
      setCurrentBlock(block)

      // Try to decrypt with cached key (no prompt needed if user already signed this session)
      const cachedBundle = await loadCachedBundle()
      const decryptedServer = new Map<string, StoredSubmission>()
      if (cachedBundle && encryptedSubs.length > 0) {
        await Promise.all(encryptedSubs.map(async enc => {
          try {
            const sub = await decryptJSON(enc.ciphertext, cachedBundle.key) as StoredSubmission
            decryptedServer.set(enc.pollId, sub)
          } catch { /* skip */ }
        }))
      } else if (encryptedSubs.length > 0) {
        // No cached key — store encrypted subs so user can unlock with one tap
        setPendingDecrypt(encryptedSubs)
      }

      // Build submission lookup: prefer decrypted server copy, fall back to localStorage
      const submissionMap = new Map<string, StoredSubmission>()
      for (const [pollId, sub] of decryptedServer) submissionMap.set(pollId, sub)
      for (const ev of events) {
        if (!submissionMap.has(ev.pollId)) {
          try {
            const raw = localStorage.getItem(`zkpoll:submission:${address.toLowerCase()}:${ev.pollId}`)
            if (raw) submissionMap.set(ev.pollId, JSON.parse(raw) as StoredSubmission)
          } catch { /* corrupt entry — skip */ }
        }
      }

      const results = await Promise.all(
        events.map(async (ev) => {
          // Find community that owns this poll
          let community: CommunityConfig | null = null
          for (const c of communities) {
            if (c.polls?.some(p => p.poll_id === ev.pollId)) {
              community = c
              break
            }
          }

          // Resolve poll title from community metadata, fall back to truncated ID
          const pollInfo = community?.polls?.find(p => p.poll_id === ev.pollId)
          const pollTitle = pollInfo?.title ?? `Poll ${ev.pollId.slice(0, 10)}…`

          let credential: Credential | null = null
          if (community && address) {
            try {
              const raw = await getCredential(address, community.community_id as `0x${string}`)
              if (raw && raw.exists) {
                credential = {
                  holder: raw.holder, communityId: raw.communityId,
                  credType: raw.credType, votingWeight: raw.votingWeight,
                  issuedAt: raw.issuedAt, expiry: raw.expiry, exists: raw.exists,
                  voting_weight: Number(raw.votingWeight),
                  expiry_block: raw.expiry, issued_at: raw.issuedAt,
                }
              }
            } catch { /* community not on-chain yet */ }
          }

          // Scale votingWeight (0–1_000_000) → EV display (0–100), same as useCredentialHub
          const evDisplay = credential ? Math.round(Number(credential.votingWeight) / 10_000) : 0
          const vpPct     = credential ? votingPowerPct(credential.issued_at, block) : 0
          const daysLeft  = credential ? daysUntilNextDecay(credential.issued_at, block) : 0

          const submission = submissionMap.get(ev.pollId) ?? null

          return { event: ev, pollTitle, community, credential, ev: evDisplay, vpPct, daysLeft, submission }
        })
      )

      setEnriched(results)
    } finally {
      setLoading(false)
    }
  }, [isConnected, address, events])

  useEffect(() => { void enrich() }, [enrich])

  if (!isConnected) return (
    <div className="max-w-md mx-auto w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">My Votes</h1>
        <p className="text-sm text-gray-500 mt-1">On-chain vote records for your address.</p>
      </div>
      <div className="bg-amber-50 border border-amber-100 rounded-2xl px-5 py-4 text-sm text-amber-700 font-medium">
        Connect your EVM wallet to see your votes.
      </div>
    </div>
  )

  if (eventsLoading || loading) return (
    <div className="max-w-md mx-auto w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">My Votes</h1>
      </div>
      <div className="flex items-center gap-3 py-10 justify-center">
        <div className="w-5 h-5 border-2 border-[#0070F3] border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-gray-400">Loading from chain…</span>
      </div>
    </div>
  )

  return (
    <div className="max-w-md mx-auto w-full">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">My Votes</h1>
          <p className="text-sm text-gray-500 mt-1">
            {enriched.length > 0
              ? `${enriched.length} vote${enriched.length !== 1 ? 's' : ''} · block ${currentBlock.toLocaleString()}`
              : 'On-chain vote records for your address.'}
          </p>
        </div>
        <button
          onClick={() => void refresh()}
          className="text-xs text-gray-400 hover:text-gray-700 transition-colors mt-1 border border-gray-200 rounded-lg px-3 py-1.5 hover:border-gray-300"
        >
          Refresh
        </button>
      </div>

      {eventsError && (
        <div className="mb-4 bg-red-50 border border-red-100 rounded-2xl px-4 py-3 text-xs text-red-600 font-medium">
          Failed to load vote history: {eventsError}
          <br /><span className="font-normal opacity-80">Set VITE_DEPLOYMENT_BLOCK in .env.local to the L2 block at contract deployment to narrow the scan range.</span>
        </div>
      )}

      {/* Unlock banner — shown when server has encrypted submissions but session key not cached */}
      {pendingDecrypt.length > 0 && (
        <div className="mb-4 bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-xs text-blue-700">
            Sign once to decrypt your vote choices — stored encrypted on the server, only your wallet can read them.
          </p>
          <button
            onClick={() => void decryptAndMerge()}
            disabled={decrypting}
            className="shrink-0 text-xs font-medium text-white bg-[#0070F3] px-3 py-1.5 rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-60 flex items-center gap-1.5"
          >
            {decrypting && <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />}
            Decrypt
          </button>
        </div>
      )}

      {enriched.length === 0 && !eventsError ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center">
          <p className="text-sm text-gray-500 mb-4">You haven't voted in any polls yet.</p>
          <Link to="/polls"
            className="inline-flex items-center gap-1.5 bg-gray-900 text-white px-5 py-2.5 rounded-full text-sm font-medium hover:bg-gray-800 transition-colors">
            Browse Polls →
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {enriched.map(vote => (
            <VoteCard key={`${vote.event.pollId}-${vote.event.blockNumber}`} vote={vote} />
          ))}
        </div>
      )}
    </div>
  )
}
