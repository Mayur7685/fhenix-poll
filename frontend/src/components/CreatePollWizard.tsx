// Create Poll Wizard — 3 steps: Poll Setup → Options → Deploy.
// On-chain: createPoll(pollId, communityId, credType, durationBlocks, optionCount)
// Duration UI: days → blocks conversion (BLOCKS_PER_DAY on Arbitrum Sepolia L1 ~12s/block)
// Dev mode: VITE_DEV_MODE=true → duration input is raw blocks (set 1 for instant close)

// Off-chain: IPFS pin via verifier proxy (pinata.ts)

import React, { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useWriteContract } from '../hooks/useWriteContract'
import { useConnection } from 'wagmi'
import { arbitrumSepolia } from '../lib/chains'
import { getBlockHeight, pollIdFromTitle, publicClient } from '../lib/fhenix'
import { keccak256, toHex } from 'viem'
import { getGasFees } from '../lib/gas'
import { listCommunities, confirmPoll } from '../lib/verifier'
import { pinPollMetadata } from '../lib/pinata'
import { FHENIX_POLL_ABI, CONTRACT_ADDRESS } from '../lib/abi'
import type { CommunityConfig, PollOptionInfo } from '../types'

// Arbitrum Sepolia: block.number in Solidity = L1 Ethereum Sepolia block (~12s) → 7200 blocks/day
const BLOCKS_PER_DAY = 7_200
const DEV_MODE = import.meta.env.VITE_DEV_MODE === 'true'

interface OptionDraft { draftId: number; label: string; parentDraftId: number }

function buildOptionList(drafts: OptionDraft[]): PollOptionInfo[] {
  const idMap = new Map<number, number>()
  let nextId = 1
  const queue = drafts.filter(d => d.parentDraftId === 0)
  const remaining = drafts.filter(d => d.parentDraftId !== 0)
  while (queue.length > 0 || remaining.length > 0) {
    const current = queue.shift()
    if (!current) break
    idMap.set(current.draftId, nextId++)
    queue.push(...remaining.filter(d => d.parentDraftId === current.draftId))
  }
  return drafts.map(d => ({
    option_id:        idMap.get(d.draftId) ?? 0,
    label:            d.label,
    parent_option_id: d.parentDraftId === 0 ? 0 : (idMap.get(d.parentDraftId) ?? 0),
    child_count:      drafts.filter(c => c.parentDraftId === d.draftId).length,
  })).sort((a, b) => a.option_id - b.option_id)
}

type DeployStatus = 'idle' | 'pinning' | 'deploying' | 'done' | 'error'

const inputCls = "block w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition-all"
const labelCls = "block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wide"

const STEP_LABELS = ['Poll Setup', 'Options', 'Deploy']
const MAX_OPTIONS_FLAT = 32       // contract: optionCount <= 32
const MAX_OPTIONS_HIER_TOTAL = 32 // same contract limit
const MAX_OPTIONS_PER_PARENT = 8  // UX limit per layer
const MAX_DEPTH = 3               // UX limit: 4 levels deep (0-indexed)
const MAX_OPTIONS = MAX_OPTIONS_FLAT // alias for flat polls

function WizardStepper({ step }: { step: number }) {
  return (
    <div className="flex items-center w-full mb-8">
      {STEP_LABELS.map((label, i) => {
        const done = i < step - 1; const active = i === step - 1
        return (
          <div key={label} className="flex items-center flex-1 last:flex-none">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium shrink-0 ring-4 ring-white z-10
              ${done   ? 'bg-[#10B981] text-white' : ''}
              ${active ? 'bg-[#0070F3] text-white shadow-sm' : ''}
              ${!done && !active ? 'bg-white border-2 border-gray-200 text-gray-400' : ''}
            `}>
              {done ? (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              ) : i + 1}
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div className={`flex-1 h-[2px] -mx-1 ${i < step - 1 ? 'bg-[#10B981]' : 'bg-gray-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function CreatePollWizard() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { address, isConnected } = useConnection()
  const { writeContractAsync }   = useWriteContract()

  const [step, setStep] = useState(1)
  const [communities, setCommunities] = useState<CommunityConfig[]>([])
  const [nextDraftId, setNextDraftId] = useState(1)

  // Step 1
  const [communityId, setCommunityId]           = useState('')
  const [selectedCommunity, setSelectedCommunity] = useState<CommunityConfig | null>(null)
  const [notCreator, setNotCreator]             = useState(false)
  const [title, setTitle]                       = useState('')
  const [description, setDescription]           = useState('')
  const [durationDays, setDurationDays]         = useState(7)
  const [isHierarchical, setIsHierarchical]     = useState(false)

  // Step 2
  const [options, setOptions] = useState<OptionDraft[]>([])

  // Step 3
  const [deployStatus, setDeployStatus]   = useState<DeployStatus>('idle')
  const [deployMessage, setDeployMessage] = useState('')
  const [deployError, setDeployError]     = useState('')
  const [createdPollId, setCreatedPollId] = useState('')
  const [createdTxHash, setCreatedTxHash] = useState('')

  useEffect(() => { listCommunities().then(setCommunities).catch(() => null) }, [])

  useEffect(() => {
    const preselect = searchParams.get('community')
    if (preselect && communities.length > 0 && !communityId) {
      const c = communities.find(c => c.community_id === preselect)
      if (c) { setCommunityId(preselect); setSelectedCommunity(c) }
    }
  }, [communities, searchParams])


  function addOption(parentDraftId = 0) {
    if (options.length >= (isHierarchical ? MAX_OPTIONS_HIER_TOTAL : MAX_OPTIONS_FLAT)) return
    const siblingsCount = options.filter(o => o.parentDraftId === parentDraftId).length
    if (siblingsCount >= MAX_OPTIONS_PER_PARENT) return
    const parentDepth = parentDraftId === 0 ? -1 : getDepth(parentDraftId)
    if (parentDepth >= MAX_DEPTH) return
    setOptions(prev => [...prev, { draftId: nextDraftId, label: '', parentDraftId }])
    setNextDraftId(n => n + 1)
  }
  function updateOption(draftId: number, label: string) {
    setOptions(prev => prev.map(o => o.draftId === draftId ? { ...o, label } : o))
  }
  function removeOption(draftId: number) {
    // Remove option and all its descendants
    const toRemove = new Set<number>()
    const queue = [draftId]
    while (queue.length > 0) {
      const id = queue.shift()!
      toRemove.add(id)
      options.filter(o => o.parentDraftId === id).forEach(c => queue.push(c.draftId))
    }
    setOptions(prev => prev.filter(o => !toRemove.has(o.draftId)))
  }
  function getDepth(draftId: number): number {
    let depth = 0
    let current = options.find(o => o.draftId === draftId)
    while (current && current.parentDraftId !== 0) {
      depth++
      current = options.find(o => o.draftId === current!.parentDraftId)
    }
    return depth
  }
  function renderOptions(parentDraftId: number, depth = 0): React.ReactNode {
    return options.filter(o => o.parentDraftId === parentDraftId).map(opt => {
      const childCount = options.filter(o => o.parentDraftId === opt.draftId).length
      const canAddSub = isHierarchical && childCount < MAX_OPTIONS_PER_PARENT && depth < MAX_DEPTH && options.length < MAX_OPTIONS_HIER_TOTAL
      return (
        <div key={opt.draftId} style={{ marginLeft: depth * 16 }}>
          <div className="flex items-center gap-2 mb-2">
            {depth > 0 && <div className="w-4 h-px bg-gray-200 shrink-0" />}
            <input
              className={inputCls}
              placeholder={depth === 0 ? 'Root option label' : 'Sub-option label'}
              value={opt.label}
              onChange={e => updateOption(opt.draftId, e.target.value)}
            />
            {canAddSub && (
              <button type="button" onClick={() => addOption(opt.draftId)}
                className="shrink-0 text-xs text-[#0070F3] hover:underline font-medium whitespace-nowrap">
                + Sub
              </button>
            )}
            <button type="button" onClick={() => removeOption(opt.draftId)}
              className="shrink-0 text-gray-400 hover:text-red-500 transition-colors text-sm">
              ✕
            </button>
          </div>
          {renderOptions(opt.draftId, depth + 1)}
        </div>
      )
    })
  }

  const step1Valid = communityId.trim() !== '' && title.trim() !== '' && !notCreator
  const step2Valid = options.length >= 2 && options.every(o => o.label.trim() !== '')

  async function handleDeploy() {
    if (!isConnected || !address) { setDeployError('Connect your EVM wallet first.'); return }
    if (!selectedCommunity) { setDeployError('Select a community first.'); return }
    setDeployStatus('pinning'); setDeployError('')

    try {
      const blockHeight = await getBlockHeight()
      const durationBlocks = DEV_MODE ? durationDays : durationDays * BLOCKS_PER_DAY
      console.log(`[CreatePoll] durationDays=${durationDays} BLOCKS_PER_DAY=${BLOCKS_PER_DAY} durationBlocks=${durationBlocks} blockHeight=${blockHeight}`)
      const optionList = buildOptionList(options)
      const pollId = pollIdFromTitle(selectedCommunity.community_id as `0x${string}`, title)

      // 1. Pin poll metadata to IPFS (before tx — CID needed as configHash)
      setDeployMessage('Pinning poll metadata to IPFS…')
      await pinPollMetadata({
        poll_id:                  pollId,
        community_id:             selectedCommunity.community_id,
        title,
        description:              description.trim() || undefined,
        options:                  optionList,
        required_credential_type: selectedCommunity.credential_type,
        created_at_block:         blockHeight,
        end_block:                blockHeight + durationBlocks,
      })

      // 2. Deploy on-chain
      setDeployStatus('deploying')
      setDeployMessage('Creating poll on-chain… (wallet signature required)')

      const { maxFeePerGas, maxPriorityFeePerGas } = await getGasFees()

      let hash: `0x${string}`
      if (isHierarchical) {
        // parentIds[i] = parent of option (i+1); optionList already has correct parent_option_id
        const parentIds = optionList.map(o => o.parent_option_id)
        const labelHashes = optionList.map(o => keccak256(toHex(o.label)))

        hash = await writeContractAsync({
          chain: arbitrumSepolia, account: address,
          address: CONTRACT_ADDRESS, abi: FHENIX_POLL_ABI,
          functionName: 'createHierarchicalPoll',
          args: [
            pollId,
            selectedCommunity.community_id as `0x${string}`,
            selectedCommunity.credential_type,
            durationBlocks,
            options.length,
            parentIds,
            labelHashes,
          ],
          maxFeePerGas, maxPriorityFeePerGas,
        })
      } else {
        hash = await writeContractAsync({
          chain: arbitrumSepolia, account: address,
          address: CONTRACT_ADDRESS, abi: FHENIX_POLL_ABI,
          functionName: 'createPoll',
          args: [
            pollId,
            selectedCommunity.community_id as `0x${string}`,
            selectedCommunity.credential_type,
            durationBlocks,
            options.length,
          ],
          maxFeePerGas, maxPriorityFeePerGas,
        })
      }

      setCreatedTxHash(hash)
      setDeployMessage('Waiting for on-chain confirmation…')
      await publicClient.waitForTransactionReceipt({ hash })

      // 3. Only after tx confirms, save poll to verifier local store
      await confirmPoll({
        poll_id:                  pollId,
        community_id:             selectedCommunity.community_id,
        title,
        description:              description.trim() || undefined,
        options:                  optionList,
        required_credential_type: selectedCommunity.credential_type,
        created_at_block:         blockHeight,
        end_block:                blockHeight + durationBlocks,
        poll_type:                isHierarchical ? 'hierarchical' : 'flat',
      })

      setCreatedPollId(pollId)
      setDeployStatus('done')
    } catch (e: unknown) {
      setDeployError(e instanceof Error ? e.message : String(e))
      setDeployStatus('error')
    }
  }

  const progress = (step / STEP_LABELS.length) * 100

  return (
    <div className="max-w-lg mx-auto w-full">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col" style={{ minHeight: 640 }}>

        <div className="shrink-0 px-8 pt-8 pb-2">
          <WizardStepper step={step} />
          <h2 className="text-2xl font-semibold tracking-tight text-gray-900 text-center mb-4">
            {STEP_LABELS[step - 1]}
          </h2>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-8 py-4">

          {/* Step 1 */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className={labelCls}>Community *</label>
                <select className={inputCls} value={communityId}
                  onChange={async e => {
                    const id = e.target.value
                    setCommunityId(id)
                    setNotCreator(false)
                    if (!id) { setSelectedCommunity(null); return }
                    const c = communities.find(c => c.community_id === id) ?? null
                    setSelectedCommunity(c)
                    if (c?.creator && c.creator !== address) { setNotCreator(true); return }
                    // Async re-check with fresh data
                    try {
                      const { getCommunityById } = await import('../lib/verifier')
                      const fresh = await getCommunityById(id)
                      if (fresh?.creator && fresh.creator !== address) setNotCreator(true)
                    } catch { /* non-fatal */ }
                  }}>
                  <option value="">— Select community —</option>
                  {communities.map(c => (
                    <option key={c.community_id} value={c.community_id}>{c.name}</option>
                  ))}
                </select>
                {address && !notCreator && communities.filter(c => !c.creator || c.creator === address).length === 0 && (
                  <p className="text-xs text-amber-600 mt-1">You haven't created any communities yet.</p>
                )}
                {notCreator && (
                  <p className="text-xs text-red-500 mt-1">You are not the creator of this community and cannot create polls in it.</p>
                )}
              </div>
              <div>
                <label className={labelCls}>Poll Title *</label>
                <input className={inputCls} placeholder="e.g. Treasury Allocation Q1 2026"
                  value={title} onChange={e => setTitle(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Description</label>
                <textarea className={`${inputCls} resize-none`} rows={3} placeholder="Optional context for voters"
                  value={description} onChange={e => setDescription(e.target.value)} />
              </div>
              {selectedCommunity && (
                <div>
                  <label className={labelCls}>Required Credential Type</label>
                  <div className="flex items-center gap-2">
                    <span className="px-3.5 py-2.5 bg-gray-100 border border-gray-200 rounded-xl text-sm text-gray-700 font-medium">
                      Type {selectedCommunity.credential_type}
                    </span>
                    <span className="text-xs text-gray-400">Inherited from community — cannot be changed</span>
                  </div>
                </div>
              )}
              <div>
                <label className={labelCls}>Poll Duration{DEV_MODE && <span className="ml-1 text-amber-500">(DEV: raw blocks)</span>}</label>
                <div className="flex items-center gap-2 flex-wrap">
                  {!DEV_MODE && [1, 3, 7, 14, 30].map(d => (
                    <button key={d} type="button" onClick={() => setDurationDays(d)}
                      className={`px-3.5 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                        durationDays === d ? 'bg-gray-900 text-white border-gray-900' : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-400'
                      }`}>{d}d</button>
                  ))}
                  {DEV_MODE && [1, 5, 10].map(d => (
                    <button key={d} type="button" onClick={() => setDurationDays(d)}
                      className={`px-3.5 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                        durationDays === d ? 'bg-amber-500 text-white border-amber-500' : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-400'
                      }`}>{d}blk</button>
                  ))}
                  <div className="flex items-center gap-1.5 ml-1">
                    <input className={`${inputCls} !py-1.5`} type="number" min={1} max={DEV_MODE ? 1000 : 365}
                      style={{ maxWidth: 80 }} value={durationDays}
                      onChange={e => setDurationDays(Math.max(1, Number(e.target.value)))} />
                    <span className="text-xs text-gray-400 whitespace-nowrap">{DEV_MODE ? 'blocks' : 'days'}</span>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-1.5">Enforced on-chain — votes rejected after this deadline.</p>
              </div>
              {/* Poll type — card selector matching reference */}
              <div>
                <label className={labelCls}>Poll Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { value: false, label: 'Flat',         desc: 'Root options only.',              icon: '▤' },
                    { value: true,  label: 'Hierarchical', desc: 'Root + sub-options. Experimental.', icon: '▦' },
                  ] as const).map(({ value, label, desc, icon }) => (
                    <button key={label} type="button" onClick={() => setIsHierarchical(value)}
                      className={`flex flex-col items-start gap-1 px-3.5 py-3 rounded-xl border text-left transition-colors ${
                        isHierarchical === value ? 'border-[#0070F3] bg-blue-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                      }`}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-base">{icon}</span>
                        <span className="text-sm font-semibold text-gray-900">{label}</span>
                        {value && <span className="text-[10px] bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full font-medium">Beta</span>}
                      </div>
                      <span className="text-xs text-gray-400">{desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 2 */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5">
                {isHierarchical
                  ? `Add root options, then click "+ Sub" to nest sub-options (max ${MAX_OPTIONS_HIER_TOTAL} total, ${MAX_OPTIONS_PER_PARENT} per parent, 4 levels deep).`
                  : `Add 2–${MAX_OPTIONS_FLAT} options. Voters rank them using FHE-encrypted weights.`}
              </p>
              <div>
                {renderOptions(0)}
              </div>
              <button
                type="button"
                onClick={() => addOption(0)}
                disabled={
                  options.length >= (isHierarchical ? MAX_OPTIONS_HIER_TOTAL : MAX_OPTIONS_FLAT) ||
                  options.filter(o => o.parentDraftId === 0).length >= MAX_OPTIONS_PER_PARENT
                }
                className="w-full py-2.5 border border-dashed border-gray-300 rounded-xl text-sm font-medium text-gray-500 hover:border-[#0070F3] hover:text-[#0070F3] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                + Add Option
              </button>
              {options.length < 2 && options.length > 0 && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                  Add at least 2 options to continue.
                </p>
              )}
            </div>
          )}

          {/* Step 3 */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="border-[1.5px] border-[#0070F3] rounded-xl overflow-hidden bg-white">
                <div className="p-4 space-y-3">
                  {[
                    ['Community', selectedCommunity?.name ?? communityId],
                    ['Title', title],
                    ...(description ? [['Description', description]] : []),
                    ['Required Credential', `Type ${selectedCommunity?.credential_type ?? 1}`],
                    ['Duration', DEV_MODE ? `${durationDays} block${durationDays !== 1 ? 's' : ''} (dev mode)` : `${durationDays} day${durationDays !== 1 ? 's' : ''} (on-chain enforced)`],
                    ['Options', `${options.length} (${options.map(o => o.label).join(', ')})`],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between items-start text-sm">
                      <span className="text-gray-500">{k}</span>
                      <span className="font-medium text-gray-900 text-right ml-4 max-w-[60%] truncate">{v}</span>
                    </div>
                  ))}
                </div>
                <div className="bg-[#0070F3] text-white px-4 py-3 text-sm font-medium">
                  1 wallet signature. Vote weights are FHE-encrypted on Fhenix.
                </div>
              </div>

              {(deployStatus === 'pinning' || deployStatus === 'deploying') && (
                <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
                  <div className="w-4 h-4 border-2 border-[#0070F3] border-t-transparent rounded-full animate-spin shrink-0" />
                  <p className="text-sm text-blue-700 font-medium">{deployMessage}</p>
                </div>
              )}

              {deployStatus === 'done' && (
                <div className="flex flex-col items-center gap-3 bg-green-50 border border-green-100 rounded-xl p-6 text-center">
                  <div className="w-10 h-10 rounded-full bg-[#10B981] flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">Poll created!</p>
                    <p className="text-xs text-gray-500 mt-1">{createdPollId.slice(0, 22)}…</p>
                  </div>
                  {createdTxHash && (
                    <a href={`https://sepolia.arbiscan.io/tx/${createdTxHash}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-sm font-medium text-[#0070F3] hover:underline">
                      View transaction ↗
                    </a>
                  )}
                  <button
                    onClick={() => navigate(`/communities/${communityId}/polls/${createdPollId}`)}
                    className="bg-gray-900 text-white px-5 py-2.5 rounded-full text-sm font-medium hover:bg-gray-800 transition-colors"
                  >
                    View Poll →
                  </button>
                </div>
              )}

              {deployError && (
                <p className="text-sm text-red-500 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{deployError}</p>
              )}
            </div>
          )}
        </div>

        {deployStatus !== 'done' && (
          <div className="shrink-0 bg-white px-8 pt-5 pb-7 border-t border-gray-100 shadow-[0_-8px_24px_-8px_rgba(0,0,0,0.06)] flex flex-col items-center">
            <div className="w-full max-w-[300px] flex flex-col gap-4">
              <span className="text-center text-sm font-medium text-gray-900 tracking-tight">
                {STEP_LABELS[step - 1]}
              </span>
              <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-[#0070F3] rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
              <div className="flex gap-3 w-full">
                {(step > 1 && (deployStatus === 'idle' || deployStatus === 'error')) ? (
                  <button onClick={() => setStep(s => s - 1)}
                    className="px-6 py-3.5 bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium rounded-xl text-sm transition-colors shrink-0">
                    Back
                  </button>
                ) : <div className="shrink-0 w-12" />}

                {step < 3 ? (
                  (() => {
                    const disabled = step === 1 ? !step1Valid : !step2Valid
                    return (
                      <button
                        disabled={disabled}
                        onClick={() => setStep(s => s + 1)}
                        className="flex-1 py-3.5 font-medium rounded-xl text-sm shadow-sm text-white transition-colors"
                        style={{ background: disabled ? '#93c5fd' : '#0070F3', cursor: disabled ? 'not-allowed' : 'pointer' }}
                      >
                        Continue
                      </button>
                    )
                  })()
                ) : (
                  (deployStatus === 'idle' || deployStatus === 'error') && (
                    <button onClick={() => void handleDeploy()} disabled={!isConnected}
                      className="flex-1 py-3.5 bg-[#0070F3] hover:bg-blue-600 text-white font-medium rounded-xl text-sm transition-colors shadow-sm disabled:opacity-60">
                      {isConnected ? 'Deploy Poll' : 'Connect Wallet'}
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
