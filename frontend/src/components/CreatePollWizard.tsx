// Create Poll Wizard — 3 steps: Poll Setup → Options → Deploy.
// On-chain: createPoll(pollId, communityId, credType, durationBlocks, optionCount)
// Off-chain: IPFS pin via verifier proxy (pinata.ts)

import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useCofheWriteContract } from '@cofhe/react'
import { useConnection } from 'wagmi'
import { arbitrumSepolia } from '../lib/chains'
import { getBlockHeight, pollIdFromTitle, publicClient } from '../lib/fhenix'
import { getGasFees } from '../lib/gas'
import { listCommunities, confirmPoll } from '../lib/verifier'
import { pinPollMetadata } from '../lib/pinata'
import { FHENIX_POLL_ABI, CONTRACT_ADDRESS } from '../lib/abi'
import type { CommunityConfig, PollOptionInfo } from '../types'

// Arbitrum Sepolia: block.number in Solidity = L1 Ethereum Sepolia block (~12s) → 7200 blocks/day
const BLOCKS_PER_DAY = 7_200

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
const MAX_OPTIONS = 8

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
  const { writeContractAsync }   = useCofheWriteContract()

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

  const handleCommunitySelect = (id: string) => {
    setCommunityId(id)
    setNotCreator(false)
    const c = communities.find(c => c.community_id === id) ?? null
    setSelectedCommunity(c)
    if (c?.creator && c.creator !== address) setNotCreator(true)
  }

  function addOption() {
    if (options.length >= MAX_OPTIONS) return
    setOptions(prev => [...prev, { draftId: nextDraftId, label: '', parentDraftId: 0 }])
    setNextDraftId(n => n + 1)
  }
  function updateOption(draftId: number, label: string) {
    setOptions(prev => prev.map(o => o.draftId === draftId ? { ...o, label } : o))
  }
  function removeOption(draftId: number) {
    setOptions(prev => prev.filter(o => o.draftId !== draftId))
  }

  const step1Valid = communityId.trim() !== '' && title.trim() !== '' && !notCreator
  const step2Valid = options.length >= 2 && options.every(o => o.label.trim() !== '')

  async function handleDeploy() {
    if (!isConnected || !address) { setDeployError('Connect your EVM wallet first.'); return }
    if (!selectedCommunity) { setDeployError('Select a community first.'); return }
    setDeployStatus('pinning'); setDeployError('')

    try {
      const blockHeight = await getBlockHeight()
      const durationBlocks = durationDays * BLOCKS_PER_DAY
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
      const hash = await writeContractAsync({
        chain:   arbitrumSepolia,
        account: address,
        address: CONTRACT_ADDRESS,
        abi:     FHENIX_POLL_ABI,
        functionName: 'createPoll',
        args: [
          pollId,
          selectedCommunity.community_id as `0x${string}`,
          selectedCommunity.credential_type,
          durationBlocks,
          options.length,
        ],
        maxFeePerGas,
        maxPriorityFeePerGas,
      })

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
                  onChange={e => handleCommunitySelect(e.target.value)}>
                  <option value="">— Select community —</option>
                  {communities.map(c => (
                    <option key={c.community_id} value={c.community_id}>{c.name}</option>
                  ))}
                </select>
                {notCreator && (
                  <p className="text-xs text-red-500 mt-1">You are not the creator of this community.</p>
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
                    <span className="text-xs text-gray-400">Inherited from community</span>
                  </div>
                </div>
              )}
              <div>
                <label className={labelCls}>Poll Duration</label>
                <div className="flex items-center gap-2 flex-wrap">
                  {[1, 3, 7, 14, 30].map(d => (
                    <button key={d} type="button" onClick={() => setDurationDays(d)}
                      className={`px-3.5 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                        durationDays === d
                          ? 'bg-gray-900 text-white border-gray-900'
                          : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-400'
                      }`}>
                      {d}d
                    </button>
                  ))}
                  <div className="flex items-center gap-1.5 ml-1">
                    <input
                      className={`${inputCls} !py-1.5`}
                      type="number" min={1} max={365} style={{ maxWidth: 80 }}
                      value={durationDays}
                      onChange={e => setDurationDays(Math.max(1, Number(e.target.value)))}
                    />
                    <span className="text-xs text-gray-400 whitespace-nowrap">days</span>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-1.5">Enforced on-chain — votes rejected after deadline.</p>
              </div>
            </div>
          )}

          {/* Step 2 */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5">
                Add up to {MAX_OPTIONS} options. Voters rank them using FHE-encrypted weights.
              </p>
              <div className="space-y-2">
                {options.map((opt, idx) => (
                  <div key={opt.draftId} className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-[#0070F3] text-white text-xs font-bold flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <input
                      className={inputCls}
                      placeholder={`Option ${idx + 1}`}
                      value={opt.label}
                      onChange={e => updateOption(opt.draftId, e.target.value)}
                    />
                    <button onClick={() => removeOption(opt.draftId)}
                      className="shrink-0 text-gray-400 hover:text-red-500 transition-colors text-sm">
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={addOption}
                disabled={options.length >= MAX_OPTIONS}
                className="w-full py-2.5 border border-dashed border-gray-300 rounded-xl text-sm font-medium text-gray-500 hover:border-[#0070F3] hover:text-[#0070F3] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                + Add Option {options.length >= MAX_OPTIONS ? `(max ${MAX_OPTIONS})` : ''}
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
                    ['Duration', `${durationDays} day${durationDays !== 1 ? 's' : ''} (on-chain enforced)`],
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
