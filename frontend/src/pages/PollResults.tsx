// Poll Results — shows FHE-decrypted tally after the poll creator calls requestTallyReveal.
// Flow:
//   1. Creator calls requestTallyReveal() → marks tallyRevealed=true, calls FHE.allowPublic + FHE.decrypt
//   2. Anyone calls publishTallyResult() per option using decryptForTx (Threshold Network signing)
//   3. Once all options published, revealedTallies is populated and displayed

import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useWriteContract } from '../hooks/useWriteContract'
import { useConnection } from 'wagmi'
import { arbitrumSepolia } from '../lib/chains'
import { getPoll, getRevealedTally, getRolledUpTally, getTallyCtHash, getBlockHeight, publicClient } from '../lib/fhenix'
import { getGasFees, estimateRequestTallyRevealGas, estimatePublishTallyResultGas } from '../lib/gas'
import { getCommunityById } from '../lib/verifier'
import { FHENIX_POLL_ABI, CONTRACT_ADDRESS } from '../lib/abi'
import type { CommunityConfig, PollInfo } from '../types'

interface TallyEntry { optionId: number; label: string; count: bigint; rolledUp?: bigint; parentId?: number }

function TallyTree({ entries, parentId = 0, maxCount, isHierarchical, depth = 0 }: {
  entries: TallyEntry[]
  parentId?: number
  maxCount: number
  isHierarchical: boolean
  depth?: number
}) {
  if (depth > 5) return null  // safety guard against infinite recursion
  const children = entries.filter(e => (e.parentId ?? 0) === parentId)
  if (children.length === 0) return null

  // Sort by display value desc
  const sorted = [...children].sort((a, b) => {
    const va = Number((isHierarchical && a.rolledUp && a.rolledUp > 0n) ? a.rolledUp : a.count)
    const vb = Number((isHierarchical && b.rolledUp && b.rolledUp > 0n) ? b.rolledUp : b.count)
    return vb - va
  })

  const colors = ['#10B981', '#0070F3', '#6366f1', '#f59e0b', '#9ca3af']

  return (
    <div className={depth > 0 ? 'ml-4 border-l border-gray-100 pl-3 mt-2 space-y-2' : 'space-y-3'}>
      {sorted.map((entry, idx) => {
        const displayCount = (isHierarchical && entry.rolledUp && entry.rolledUp > 0n) ? entry.rolledUp : entry.count
        const pct = maxCount > 0 ? (Number(displayCount) / maxCount) * 100 : 0
        const color = colors[Math.min(idx, colors.length - 1)]
        const isParent = isHierarchical && entry.rolledUp !== undefined && entry.rolledUp > entry.count
        const hasChildren = isHierarchical && entries.some(e => e.parentId === entry.optionId)

        return (
          <div key={entry.optionId}>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 text-white"
                    style={{ background: color }}>{idx + 1}</span>
                  <span className="font-medium text-gray-900">{entry.label}</span>
                  {isParent && (
                    <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">subtotal</span>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-xs text-gray-400 font-mono tabular-nums">{displayCount.toLocaleString()}</span>
                  {isParent && entry.count > 0n && (
                    <div className="text-[10px] text-gray-300 font-mono">own: {entry.count.toLocaleString()}</div>
                  )}
                </div>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden ml-8">
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
              </div>
            </div>
            {hasChildren && isHierarchical && (
              <TallyTree entries={entries} parentId={entry.optionId}
                maxCount={maxCount} isHierarchical={isHierarchical} depth={depth + 1} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function PollResults() {
  const { communityId, pollId } = useParams<{ communityId: string; pollId: string }>()
  const { address, isConnected } = useConnection()
  const { writeContractAsync }   = useWriteContract()

  const [community, setCommunity]   = useState<CommunityConfig | null>(null)
  const [backendPoll, setBackendPoll] = useState<PollInfo | null>(null)
  const [tallyRevealed, setTallyRevealed] = useState(false)
  const [optionCount, setOptionCount]     = useState(0)
  const [isHierarchical, setIsHierarchical] = useState(false)
  const [pollCreator, setPollCreator]     = useState<string | null>(null)
  const [pollClosed, setPollClosed]       = useState(false)
  const [tally, setTally]                 = useState<TallyEntry[]>([])
  const [loading, setLoading]             = useState(false)
  const [revealStatus, setRevealStatus]   = useState<'idle' | 'requesting' | 'publishing' | 'done' | 'error'>('idle')
  const [revealError, setRevealError]     = useState<string | null>(null)
  const [publishProgress, setPublishProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 })

  useEffect(() => {
    console.log('[PollResults] effect fired, pollId=', pollId, 'communityId=', communityId)
    if (!pollId || !communityId) return
    if (tally.length === 0) setLoading(true)

    const timeout = (ms: number) => new Promise<null>(r => setTimeout(() => r(null), ms))

    Promise.all([
      getPoll(pollId as `0x${string}`).catch(() => null),
      Promise.race([getCommunityById(communityId).catch(() => null), timeout(5000)]),
    ]).then(async ([onChainPoll, comm]) => {
      console.log('[PollResults] data loaded', { exists: onChainPoll?.exists, tallyRevealed: onChainPoll?.tallyRevealed })

      setCommunity(comm as typeof comm)
      if (comm) {
        const bp = (comm as NonNullable<typeof comm>).polls?.find(p => p.poll_id === pollId)
        setBackendPoll(bp ?? null)
      }

      if (onChainPoll?.exists) {
        setOptionCount(onChainPoll.optionCount)
        setPollCreator(onChainPoll.creator)
        setTallyRevealed(onChainPoll.tallyRevealed)
        setIsHierarchical(onChainPoll.isHierarchical)

        console.log('[PollResults] getting block height...')
        const currentBlock = await getBlockHeight()
        console.log('[PollResults] block height', currentBlock)
        setPollClosed(currentBlock > onChainPoll.endBlock)

        if (onChainPoll.tallyRevealed && onChainPoll.optionCount > 0) {
          const backendOptions = (comm as any)?.polls?.find((p: any) => p.poll_id === pollId)?.options ?? []
          console.log('[PollResults] fetching tallies, optionCount=', onChainPoll.optionCount)

          // Fetch all tallies in parallel
          const results = await Promise.all(
            Array.from({ length: onChainPoll.optionCount }, async (_, i) => {
              const optId = i + 1
              const [count, rolledUp] = await Promise.all([
                getRevealedTally(pollId as `0x${string}`, i).catch(() => 0n),
                onChainPoll.isHierarchical
                  ? getRolledUpTally(pollId as `0x${string}`, i).catch(() => 0n)
                  : Promise.resolve(undefined),
              ])
              const opt = backendOptions.find((o: any) => o.option_id === optId)
              return {
                optionId: optId,  // 1-based to match parent_option_id references
                label:    opt?.label ?? `Option ${optId}`,
                count:    BigInt(count),
                rolledUp: rolledUp !== undefined ? BigInt(rolledUp) : undefined,
                parentId: opt?.parent_option_id,
              } as TallyEntry
            })
          )

          setTally(results.sort((a, b) => (b.count > a.count ? 1 : -1)))
          console.log('[PollResults] tally set', results.length, 'entries')
        }
      }
    }).catch(console.error).finally(() => {
      console.log('[PollResults] loading done, setting loading=false')
      setLoading(false)
    })
  }, [pollId, communityId])

  const handleReveal = async () => {
    if (!address || !pollId) return
    setRevealStatus('requesting'); setRevealError(null)
    try {
      // Step 1 — request tally reveal (marks tallyRevealed=true, calls FHE.allowPublic + FHE.decrypt)
      const [{ maxFeePerGas, maxPriorityFeePerGas }, gas] = await Promise.all([
        getGasFees(),
        estimateRequestTallyRevealGas(pollId as `0x${string}`, address),
      ])
      const hash = await writeContractAsync({
        chain:   arbitrumSepolia,
        account: address,
        address: CONTRACT_ADDRESS,
        abi:     FHENIX_POLL_ABI,
        functionName: 'requestTallyReveal',
        args:    [pollId as `0x${string}`],
        gas,
        maxFeePerGas,
        maxPriorityFeePerGas,
      })
      await publicClient.waitForTransactionReceipt({ hash })

      // Step 2 — for each option, get ctHash → decryptForTx → publishTallyResult
      setRevealStatus('publishing')
      setPublishProgress({ done: 0, total: optionCount })

      for (let i = 0; i < optionCount; i++) {
        // Read ctHash stored by requestTallyReveal (bytes32 → bigint for SDK)
        const ctHash = await getTallyCtHash(pollId as `0x${string}`, i)

        // Ask Threshold Network to sign the decryption (no permit needed — FHE.allowPublic was called)
        const { cofheClient } = await import('../lib/cofhe')
        const { decryptedValue, signature } = await cofheClient
          .decryptForTx(ctHash)
          .withoutPermit()
          .execute()

        // Publish signed plaintext on-chain (uint32 → number cast for viem ABI encoding)
        const [{ maxFeePerGas: f, maxPriorityFeePerGas: p }, pubGas] = await Promise.all([
          getGasFees(),
          estimatePublishTallyResultGas(pollId as `0x${string}`, i, Number(decryptedValue), signature as `0x${string}`, address),
        ])
        const pubHash = await writeContractAsync({
          chain:   arbitrumSepolia,
          account: address,
          address: CONTRACT_ADDRESS,
          abi:     FHENIX_POLL_ABI,
          functionName: 'publishTallyResult',
          args:    [pollId as `0x${string}`, i, Number(decryptedValue), signature as `0x${string}`],
          gas:     pubGas,
          maxFeePerGas: f,
          maxPriorityFeePerGas: p,
        })
        await publicClient.waitForTransactionReceipt({ hash: pubHash })
        setPublishProgress(prev => ({ ...prev, done: prev.done + 1 }))
      }

      setRevealStatus('done')
      setTimeout(() => window.location.reload(), 2_000)
    } catch (e: unknown) {
      setRevealError(e instanceof Error ? e.message : String(e))
      setRevealStatus('error')
    }
  }

  const maxCount = tally.length > 0
    ? Number(tally.reduce((max, e) => {
        const v = (isHierarchical && e.rolledUp !== undefined && e.rolledUp > 0n) ? e.rolledUp : e.count
        return v > max ? v : max
      }, 0n))
    : 1
  const isCreator = isConnected && address?.toLowerCase() === pollCreator?.toLowerCase()
  const title = backendPoll?.title ?? pollId?.slice(0, 10) + '…'

  // Check if tally is revealed but results not yet published
  const allPublished = tally.length > 0 && tally.every(e => e.count > 0n)
  console.log('[PollResults] render: loading=', loading, 'tallyRevealed=', tallyRevealed, 'tally.length=', tally.length)

  return (
    <div className="max-w-lg mx-auto w-full">
      <Link to={`/communities/${communityId}/polls/${pollId}`}
        className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-900 mb-4 transition-colors group">
        <svg className="w-4 h-4 mr-1 group-hover:-translate-x-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Back to Poll
      </Link>

      {loading ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 flex items-center justify-center gap-3">
          <div className="w-5 h-5 border-2 border-[#0070F3] border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-500">Loading results…</span>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Poll header */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
                <p className="text-xs text-gray-400 mt-0.5">
                  {community?.name ?? communityId?.slice(0, 12)} · {optionCount} option{optionCount !== 1 ? 's' : ''}
                </p>
              </div>
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
                tallyRevealed && allPublished
                  ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
                  : tallyRevealed
                  ? 'bg-blue-50 text-blue-600 border-blue-100'
                  : 'bg-amber-50 text-amber-600 border-amber-100'
              }`}>
                {tallyRevealed && allPublished ? 'Results final' : tallyRevealed ? 'Publishing…' : 'Pending'}
              </span>
            </div>
          </div>

          {/* Tally results */}
          {tallyRevealed && tally.length > 0 ? (
            <div className="border-[1.5px] border-[#0070F3] rounded-xl overflow-hidden bg-white shadow-sm">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-900">FHE-Decrypted Tally</h2>
                <p className="text-xs text-gray-400 mt-0.5">Ranked-choice vote weights · aggregate only</p>
              </div>
              <div className="p-5">
                {(() => {
                  try {
                    return <TallyTree entries={tally} maxCount={maxCount} isHierarchical={isHierarchical} />
                  } catch (e) {
                    console.error('[TallyTree] render error', e)
                    return <pre className="text-xs text-red-500">{String(e)}</pre>
                  }
                })()}
              </div>
              <div className="bg-[#0070F3] text-white px-5 py-3.5 text-sm font-medium">
                FHE decryption by the Fhenix network. Individual votes were never revealed.
              </div>
            </div>
          ) : tallyRevealed && tally.length === 0 ? (
            /* Tally revealed but not yet published — show publish button for anyone */
            <div className="border-[1.5px] border-[#0070F3] rounded-xl overflow-hidden bg-white shadow-sm">
              <div className="p-6 text-center">
                <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-3">
                  <span className="text-blue-500 text-lg">🔓</span>
                </div>
                <p className="text-sm font-medium text-gray-700">Decryption requested.</p>
                <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">
                  The Threshold Network has the decrypted values ready. Click below to publish them on-chain.
                </p>
              </div>

              {isConnected && revealStatus !== 'done' && (
                <div className="px-5 pb-5 text-center">
                  <button
                    onClick={() => void handleReveal()}
                    disabled={revealStatus === 'publishing'}
                    className="inline-flex items-center gap-2 bg-[#0070F3] hover:bg-blue-600 text-white font-medium px-5 py-2.5 rounded-xl text-sm transition-colors shadow-sm disabled:opacity-60"
                  >
                    {revealStatus === 'publishing' && (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    )}
                    {revealStatus === 'publishing'
                      ? `Publishing ${publishProgress.done}/${publishProgress.total}…`
                      : 'Publish Results'}
                  </button>
                  {revealError && (
                    <p className="text-xs text-red-500 mt-2">{revealError}</p>
                  )}
                </div>
              )}

              <div className="bg-[#0070F3] text-white px-5 py-3.5 text-sm font-medium">
                Anyone can publish the Threshold Network's signed decrypt results.
              </div>
            </div>
          ) : (
            /* Tally not yet requested */
            <div className="border-[1.5px] border-[#0070F3] rounded-xl overflow-hidden bg-white shadow-sm">
              <div className="p-6 text-center">
                <div className="w-10 h-10 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-3">
                  <span className="text-amber-500 text-lg">⏳</span>
                </div>
                <p className="text-sm font-medium text-gray-700">Tally not yet revealed.</p>
                <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">
                  The poll creator requests FHE decryption. The Threshold Network decrypts and
                  signs the result. Anyone can then publish it on-chain.
                </p>
              </div>

              {isCreator && revealStatus !== 'done' && (
                <div className="px-5 pb-5 text-center">
                  <button
                    onClick={() => void handleReveal()}
                    disabled={!pollClosed || revealStatus === 'requesting' || revealStatus === 'publishing'}
                    className="inline-flex items-center gap-2 bg-[#0070F3] hover:bg-blue-600 text-white font-medium px-5 py-2.5 rounded-xl text-sm transition-colors shadow-sm disabled:opacity-60"
                  >
                    {(revealStatus === 'requesting' || revealStatus === 'publishing') && (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    )}
                    {revealStatus === 'requesting'
                      ? 'Requesting decryption…'
                      : revealStatus === 'publishing'
                      ? `Publishing ${publishProgress.done}/${publishProgress.total}…`
                      : 'Reveal Tally'}
                  </button>
                  {revealError && (
                    <p className="text-xs text-red-500 mt-2">{revealError}</p>
                  )}
                  {!pollClosed && (
                    <p className="text-xs text-amber-500 mt-2">Poll is still open — reveal available after it closes.</p>
                  )}
                  <p className="text-xs text-gray-400 mt-2">
                    Requests FHE decryption, then publishes each option result on-chain.
                  </p>
                </div>
              )}

              <div className="bg-[#0070F3] text-white px-5 py-3.5 text-sm font-medium">
                Tally reveal is initiated by the poll creator. Results are verified on-chain.
              </div>
            </div>
          )}

          {!isConnected && !tallyRevealed && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
              <p className="text-sm text-amber-700">Connect your wallet to reveal the tally.</p>
            </div>
          )}

          {!isConnected && tallyRevealed && tally.length === 0 && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
              <p className="text-sm text-blue-700">Connect your wallet to publish the decrypted results on-chain.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
