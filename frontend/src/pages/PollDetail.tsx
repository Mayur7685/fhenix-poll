import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useSignMessage } from 'wagmi'
import { useWallet } from '../hooks/useWallet'
import { deriveKey, loadCachedBundle, encryptJSON } from '../lib/submissionCrypto'
import { useVoting } from '../hooks/useVoting'
import { useCredentialHub } from '../hooks/useCredentialHub'
import { useToast } from '../components/Toast'
import { getPoll, getBlockHeight, publicClient } from '../lib/fhenix'
import { getCommunityById } from '../lib/verifier'
import { FHENIX_POLL_ABI, CONTRACT_ADDRESS } from '../lib/abi'
import { vpTextColour } from '../lib/decay'
import LayerNavbar from '../components/LayerNavbar'
import type { BreadcrumbEntry } from '../components/LayerNavbar'
import OptionLayer from '../components/OptionLayer'
import VotingMode from '../components/VotingMode'
import VoteConfirmModal from '../components/VoteConfirmModal'
import type { Poll, PollOption, VoteRanking, CommunityConfig } from '../types'

// ── EV / VP% / CV strip shown above the Submit button ────────────────────────
function CredentialBar({ community }: { community: CommunityConfig }) {
  const { credential, eligibleVotes, vpPct, cv, loading } = useCredentialHub(community)

  if (loading) return null
  if (!credential) return (
    <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-100 rounded-xl">
      <span className="text-xs text-amber-700 font-medium">No credential — vote will fail.</span>
      <Link to={`/communities/${community.community_id}`}
        className="ml-auto text-xs text-amber-700 underline font-medium shrink-0">
        Get one →
      </Link>
    </div>
  )

  const vpColour = vpTextColour(vpPct)
  const vpStr = vpPct % 1 === 0 ? `${vpPct}%` : `${vpPct.toFixed(2)}%`

  return (
    <div className="flex items-center divide-x divide-gray-100 bg-gray-50 border border-gray-100 rounded-xl overflow-hidden">
      {[
        { label: 'EV', value: eligibleVotes.toLocaleString(), colour: 'text-gray-800' },
        { label: 'VP', value: vpStr, colour: vpColour },
        { label: 'CV', value: cv.toLocaleString(), colour: 'text-gray-800' },
      ].map(({ label, value, colour }) => (
        <div key={label} className="flex-1 flex flex-col items-center py-2">
          <span className={`text-sm font-semibold tabular-nums ${colour}`}>{value}</span>
          <span className="text-[10px] text-gray-400 font-mono">{label}</span>
        </div>
      ))}
      <div className="flex-[2] flex items-center justify-center px-3 py-2">
        <span className="text-xs text-gray-500">
          Your vote counts as <strong className="text-gray-800">{cv}</strong>
        </span>
      </div>
    </div>
  )
}

// ── Stepper ──────────────────────────────────────────────────────────────────
function Stepper({ step }: { step: number }) {
  const steps = ['Connect', 'Browse', 'Rank', 'Confirm', 'Done']
  return (
    <div className="flex items-center w-full px-2 py-6">
      {steps.map((label, i) => {
        const done    = i < step
        const active  = i === step
        const pending = i > step
        return (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-semibold transition-all
              ${done   ? 'bg-[#10B981] text-white' : ''}
              ${active ? 'bg-[#0070F3] text-white shadow-sm ring-4 ring-blue-50' : ''}
              ${pending ? 'bg-white border-2 border-gray-200 text-gray-400' : ''}
            `}>
              {done ? (
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              ) : (
                <span>{i + 1}</span>
              )}
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-[2px] -mx-1 z-0 transition-colors ${i < step ? 'bg-[#10B981]' : 'bg-gray-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function PollDetail() {
  const { communityId, pollId } = useParams<{ communityId: string; pollId: string }>()
  const { address, isConnected } = useWallet()
  const { castVote, status, txHash: txId, error } = useVoting()
  const { signMessageAsync } = useSignMessage()
  const toast = useToast()

  const [poll, setPoll]             = useState<Poll | null>(null)
  const [community, setCommunity]   = useState<CommunityConfig | null>(null)
  const [pollLoading, setPollLoading] = useState(true)
  const [currentBlock, setCurrentBlock] = useState(0)

  const [alreadyVoted, setAlreadyVoted] = useState(false)

  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbEntry[]>([{ optionId: 0, label: 'Root' }])
  const currentParentId = breadcrumb[breadcrumb.length - 1]?.optionId ?? 0

  const [tab, setTab]             = useState<'browse' | 'vote'>('browse')
  const [ranking, setRanking]     = useState<VoteRanking>({})
  const [showConfirm, setShowConfirm] = useState(false)
  const [noCredential, setNoCredential] = useState<'missing' | 'sync' | null>(null)

  // Fetch poll: merge on-chain meta (active status) with off-chain metadata (title + options)
  useEffect(() => {
    if (!pollId || !communityId) return
    setPollLoading(true)

    Promise.all([
      getPoll(pollId as `0x${string}`).catch((e) => { console.warn('[PollDetail] getPoll failed:', e); return null }),
      getCommunityById(communityId),
      getBlockHeight().catch(() => 0),
    ]).then(([onChainPoll, community, block]) => {
      if (block) setCurrentBlock(block)
      console.log('[PollDetail] onChainPoll:', onChainPoll, 'block:', block)
      if (!onChainPoll?.exists && !community) { setPollLoading(false); return }

      const backendPoll = community?.polls?.find(p => p.poll_id === pollId)

      const options: PollOption[] = (backendPoll?.options ?? []).map(o => ({
        option_id:        o.option_id,
        label:            o.label,
        parent_option_id: o.parent_option_id,
        child_count:      o.child_count,
      }))

      // Active = on-chain endBlock is in the future.
      // If on-chain fetch failed, assume open (contract will reject the vote if truly closed).
      const onChainActive = onChainPoll?.exists
        ? block <= Number(onChainPoll.endBlock)
        : true

      setPoll({
        poll_id:                  pollId,
        community_id:             communityId,
        required_credential_type: onChainPoll?.credType ?? backendPoll?.required_credential_type ?? community?.credential_type ?? 1,
        created_at:               onChainPoll?.startBlock ?? backendPoll?.created_at_block ?? 0,
        active:                   onChainActive,
        // Use on-chain endBlock as source of truth; fall back to local only if no on-chain data
        end_block:                onChainPoll?.exists ? Number(onChainPoll.endBlock) : backendPoll?.end_block,
        options,
        poll_type:                backendPoll?.poll_type ?? 'flat',
      })

      setCommunity(community ?? null)
    }).finally(() => setPollLoading(false))
  }, [pollId, communityId])

  // Check on-chain whether this address has already voted in this poll
  useEffect(() => {
    if (!address || !pollId || !CONTRACT_ADDRESS) return
    setAlreadyVoted(false)
    publicClient.readContract({
      address: CONTRACT_ADDRESS as `0x${string}`,
      abi:     FHENIX_POLL_ABI,
      functionName: 'hasVoted',
      args:    [pollId as `0x${string}`, address as `0x${string}`],
    }).then(voted => setAlreadyVoted(Boolean(voted))).catch(() => {})
  }, [address, pollId])

  // Persist submission so My Votes can display ranked options.
  // 1. localStorage — instant, works offline.
  // 2. Verifier server — cross-device, survives localStorage clears (Render + Pinata backup).
  useEffect(() => {
    if (status !== 'done' || !poll || !address) return
    const votedAt = Date.now()
    const submissionData = {
      pollId:  pollId!,
      ranking,
      options: poll.options.map(o => ({ id: o.option_id, label: o.label })),
      votedAt,
    }
    // 1. localStorage cache
    try {
      localStorage.setItem(
        `zkpoll:submission:${address.toLowerCase()}:${pollId}`,
        JSON.stringify(submissionData),
      )
    } catch { /* quota exceeded — non-fatal */ }

    // 2. Verifier persistence — encrypted so server cannot read rankings (async, non-blocking)
    const persistToVerifier = async () => {
      try {
        // Use cached key+sig (0 extra wallet prompts) or derive once this session (1 prompt)
        const bundle = (await loadCachedBundle()) ?? (await deriveKey(address, signMessageAsync))
        const ciphertext = await encryptJSON(submissionData, bundle.key)
        const BASE = import.meta.env.VITE_VERIFIER_URL ?? '/api'
        await fetch(`${BASE}/submissions`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          // keySignature proves wallet ownership — same sig used for key derivation, no extra prompt
          body:    JSON.stringify({ address, pollId, ciphertext, keySignature: bundle.keySignature }),
        })
      } catch { /* non-fatal — localStorage copy remains */ }
    }
    void persistToVerifier()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  // Show toast / no-credential prompt when vote status resolves
  useEffect(() => {
    if (status === 'done' && txId) {
      toast.success('Vote submitted!', txId)
    } else if (status === 'error') {
      if (error === 'NO_CREDENTIAL_SYNC') {
        setNoCredential('sync')
      } else if (error === 'NO_CREDENTIAL') {
        setNoCredential('missing')
      } else if (error === 'ALREADY_VOTED') {
        toast.error('You have already voted on this poll. Each address can only vote once.')
      } else if (error) {
        toast.error(error)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  function drillIn(option: PollOption) {
    setBreadcrumb(prev => [...prev, { optionId: option.option_id, label: option.label }])
  }
  function navigateTo(index: number) {
    setBreadcrumb(prev => prev.slice(0, index + 1))
  }

  const hasRanked   = Object.values(ranking).some(r => r > 0)
  const rankedCount = Object.values(ranking).filter(r => r > 0).length
  const isDone      = status === 'done' || alreadyVoted
  // Closed = on-chain active flag is false. Don't use local end_block — it may be stale.
  const isPollClosed = poll !== null && !poll.active
  const layerOptions = poll?.options.filter(o => o.parent_option_id === currentParentId) ?? []

  // Step index: 0=Connect, 1=Browse, 2=Rank, 3=Confirm, 4=Done
  const step = isDone ? 4 : !isConnected ? 0 : tab === 'browse' ? 1 : showConfirm ? 3 : 2

  const handleConfirmVote = async () => {
    if (!communityId || !pollId || !address) return
    setShowConfirm(false)
    setNoCredential(null)
    await castVote(pollId as `0x${string}`, ranking, poll!.options.length)
    // Status effects handled by useEffect above
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (pollLoading) return (
    <div className="max-w-md mx-auto w-full">
      <div className="bg-white rounded-4xl border border-gray-100 shadow-xl p-8 flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[#0070F3] border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-400">Loading poll…</span>
        </div>
      </div>
    </div>
  )

  if (!poll) return (
    <div className="max-w-md mx-auto w-full">
      <Link to={`/communities/${communityId}`}
        className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-900 mb-4 transition-colors group">
        <svg className="w-4 h-4 mr-1 group-hover:-translate-x-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Back
      </Link>
      <div className="bg-white rounded-4xl border border-gray-100 shadow-xl p-8 text-center">
        <p className="text-gray-500 text-sm">Poll not found.</p>
      </div>
    </div>
  )

  return (
    <div className="max-w-md mx-auto w-full">

      {/* Back link */}
      <Link
        to={`/communities/${communityId}`}
        className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-900 mb-4 transition-colors group"
      >
        <svg className="w-4 h-4 mr-1 group-hover:-translate-x-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Back
      </Link>

      {isDone ? (
        // ── Already voted / Success ───────────────────────────────────────
        <div className="bg-white rounded-4xl border border-gray-100 shadow-xl overflow-hidden">
          <div className="px-8 pt-10 pb-6"><Stepper step={4} /></div>
          <div className="px-8 pb-10 flex flex-col items-center text-center gap-4">
            {alreadyVoted && status !== 'done' ? (
              // Already voted in a previous session — warn clearly
              <>
                <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center">
                  <svg className="w-8 h-8 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
                <h2 className="text-2xl font-semibold text-gray-900">Already Voted</h2>
                <p className="text-sm text-gray-500 leading-relaxed max-w-xs">
                  Your wallet has already cast a vote in this poll. Each address can only vote once.
                  To vote with a different address, switch wallets.
                </p>
              </>
            ) : (
              // Just submitted this session
              <>
                <div className="w-16 h-16 rounded-full bg-[#10B981] flex items-center justify-center">
                  <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
                <h2 className="text-2xl font-semibold text-gray-900">Vote Submitted!</h2>
                <p className="text-sm text-gray-500 leading-relaxed max-w-xs">
                  Your rankings are encrypted on-chain. The tally will be updated by the operator.
                </p>
                {txId && (
                  <a href={`https://sepolia.arbiscan.io/tx/${txId}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-sm font-medium text-[#0070F3] hover:underline">
                    View transaction ↗
                  </a>
                )}
              </>
            )}
            <Link to={`/communities/${communityId}/polls/${pollId}/results`}
              className="mt-2 bg-[#0070F3] text-white px-6 py-3 rounded-xl text-sm font-medium hover:bg-blue-600 transition-colors shadow-sm">
              View Results
            </Link>
          </div>
        </div>
      ) : (
        // ── Main vote card ───────────────────────────────────────────────
        <div className="bg-white rounded-4xl border border-gray-100 shadow-xl flex flex-col" style={{ minHeight: 700 }}>

          {/* Stepper */}
          <div className="shrink-0 px-8 pt-10 pb-0">
            <Stepper step={step} />
          </div>

          {/* Title row */}
          <div className="px-6 pb-4 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-gray-900">
                {tab === 'browse' ? 'Browse Options' : 'Rank Your Choices'}
              </h1>
              <p className="text-xs text-gray-400 mt-0.5">
                {communityId?.slice(0, 12)}…
              </p>
            </div>
            <Link to={`/communities/${communityId}/polls/${pollId}/results`}
              className="text-xs text-[#0070F3] font-medium hover:underline shrink-0">
              Results →
            </Link>
          </div>

          {/* Tabs (only when isConnected and poll is open) */}
          {isConnected && !isPollClosed && (
            <div className="px-6 pb-3">
              <div className="flex gap-1 bg-gray-50 rounded-xl p-1">
                {(['browse', 'vote'] as const).map(t => (
                  <button key={t} onClick={() => setTab(t)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all capitalize ${
                      tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}>
                    {t === 'browse' ? 'Browse' : 'Vote'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Poll closed banner */}
          {isPollClosed && (
            <div className="mx-6 mb-3 flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
              <span className="text-gray-400">🔒</span>
              <p className="text-sm font-medium text-gray-600">This poll has closed. Voting is no longer available.</p>
              <Link to={`/communities/${communityId}/polls/${pollId}/results`}
                className="ml-auto text-xs text-[#0070F3] font-medium hover:underline shrink-0">
                View Results →
              </Link>
            </div>
          )}

          {/* Not isConnected */}
          {!isConnected && (
            <div className="mx-6 mb-4 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
              <p className="text-sm text-amber-700 font-medium">Connect your wallet to vote.</p>
            </div>
          )}

          {/* Hierarchical poll beta warning */}
          {poll.poll_type === 'hierarchical' && (
            <div className="mx-6 mb-4 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <span className="text-amber-500 shrink-0 mt-0.5">⚠️</span>
              <p className="text-xs text-amber-700">
                <strong>Experimental poll:</strong> This poll has sub-options. Ranking sub-options requires a separate vote transaction per layer. Root rankings are submitted first.
              </p>
            </div>
          )}

          {/* No credential / sync delay prompt */}
          {noCredential && isConnected && (
            <div className="mx-6 mb-4 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 flex items-start gap-3">
              <svg className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              </svg>
              <div>
                {noCredential === 'sync' ? (
                  <>
                    <p className="text-sm text-amber-700 font-medium">Credential not synced to wallet yet.</p>
                    <p className="text-xs text-amber-600 mt-0.5">
                      Your credential is confirmed on-chain but the wallet hasn't indexed it yet.
                      Wait 1–2 minutes, then{' '}
                      <button onClick={() => setNoCredential(null)} className="underline font-medium">try again</button>.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-amber-700 font-medium">No credential found for this community.</p>
                    <Link to={`/communities/${communityId}`}
                      className="text-xs text-amber-700 underline mt-0.5 inline-block font-medium">
                      Get credential on the community page →
                    </Link>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Main scrollable content */}
          <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar pb-4 px-6">
            {tab === 'browse' || !isConnected ? (
              <div className="border border-gray-100 rounded-xl overflow-hidden bg-white flex flex-col shadow-sm">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 bg-gray-50">
                  <svg className="w-4 h-4 text-gray-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
                  </svg>
                  <LayerNavbar breadcrumb={breadcrumb} onNavigate={navigateTo} />
                </div>
                <div className="p-3 flex flex-col gap-2">
                  <OptionLayer
                    options={poll.options}
                    parentId={currentParentId}
                    snapshots={new Map()}
                    onDrillIn={drillIn}
                  />
                </div>
                <div className="bg-[#0070F3] text-white px-5 py-3 text-xs font-medium">
                  Click › to explore sub-options. Connect wallet to vote.
                </div>
              </div>
            ) : (
              <div className="border border-gray-100 rounded-xl overflow-hidden bg-white flex flex-col shadow-sm">
                {/* Same breadcrumb nav as Browse so user can drill into sub-options */}
                <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 bg-gray-50">
                  <svg className="w-4 h-4 text-gray-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
                  </svg>
                  <LayerNavbar breadcrumb={breadcrumb} onNavigate={navigateTo} />
                </div>
                <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
                  <p className="text-xs text-gray-400 font-medium">
                    Tap to rank · tap again to remove · click <span className="text-[#0070F3]">sub ›</span> to rank inside a category
                  </p>
                </div>
                <div className="p-3 flex flex-col gap-1.5">
                  <VotingMode
                    options={layerOptions}
                    value={ranking}
                    onChange={setRanking}
                    onDrillIn={drillIn}
                  />
                </div>
                {breadcrumb.length > 1 && poll.poll_type === 'hierarchical' && (
                  <div className="mx-3 mb-2 flex items-start gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <span className="text-amber-500 text-xs shrink-0">⚠️</span>
                    <p className="text-xs text-amber-700">Sub-option rankings require a separate vote transaction.</p>
                  </div>
                )}
                {breadcrumb.length > 1 && (
                  <div className="px-3 pb-3">
                    <button
                      onClick={() => navigateTo(breadcrumb.length - 2)}
                      className="w-full py-2 text-xs font-medium text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
                    >
                      ← Back to {breadcrumb[breadcrumb.length - 2]?.label ?? 'Root'}
                    </button>
                  </div>
                )}
                <div className="bg-[#0070F3] text-white px-5 py-3 text-xs font-medium">
                  Rankings span all layers — rank root options and sub-options together.
                </div>
              </div>
            )}
          </div>

          {/* Bottom action bar */}
          {tab === 'vote' && isConnected && !isDone && !isPollClosed && (
            <div className="shrink-0 bg-white pt-4 pb-8 px-6 border-t border-gray-100 shadow-[0_-8px_24px_-8px_rgba(0,0,0,0.06)]">
              <div className="flex flex-col items-center gap-3">
                {/* EV / VP% / CV credential strip */}
                {community && <CredentialBar community={community} />}

                <div className="w-full flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-900">
                    {hasRanked ? `${rankedCount} option${rankedCount !== 1 ? 's' : ''} ranked` : 'Tap options to rank them'}
                  </span>
                  {hasRanked && (
                    <button onClick={() => setRanking({})}
                      className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                      Clear
                    </button>
                  )}
                </div>
                <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-[#0070F3] rounded-full transition-all"
                    style={{ width: `${hasRanked ? Math.min(rankedCount / Math.max(layerOptions.length, 1) * 100, 100) : 0}%` }} />
                </div>
                <div className="flex gap-3 w-full">
                  <button onClick={() => setTab('browse')}
                    className="px-5 py-3 bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium rounded-xl text-sm transition-colors">
                    Browse
                  </button>
                  <button
                    onClick={() => setShowConfirm(true)}
                    disabled={!hasRanked || status === 'signing' || status === 'confirming'}
                    className="flex-1 py-3 bg-[#0070F3] hover:bg-blue-600 text-white font-medium rounded-xl text-sm transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {(status === 'signing' || status === 'confirming') && (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    )}
                    {status === 'signing' ? 'Waiting for wallet…' : status === 'confirming' ? 'Confirming…' : 'Submit Vote'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {showConfirm && poll && (
        <VoteConfirmModal
          ranking={ranking}
          options={layerOptions}
          submitting={status === 'signing'}
          onConfirm={() => void handleConfirmVote()}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  )
}
