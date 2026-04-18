// Cross-community credential panel — shows all on-chain credentials for the connected wallet.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useWallet } from '../hooks/useWallet'
import { getCredential, getBlockHeight } from '../lib/fhenix'
import { listCommunities } from '../lib/verifier'
import {
  votingPowerPct,
  countedVotes,
  daysUntilNextDecay,
  vpTextColour,
  vpBarColour,
} from '../lib/decay'
import type { CommunityConfig, Credential } from '../types'

interface CredentialEntry {
  community: CommunityConfig
  credential: Credential
}

function CredentialCard({ entry, currentBlock }: { entry: CredentialEntry; currentBlock: number }) {
  const { community, credential } = entry
  const vp   = votingPowerPct(credential.issuedAt, currentBlock)
  const ev   = Math.round(Number(credential.votingWeight) / 10_000)
  const cv   = countedVotes(ev, credential.issuedAt, currentBlock)
  const days = daysUntilNextDecay(credential.issuedAt, currentBlock)
  const expired = currentBlock > credential.expiry
  const vpColour  = vpTextColour(vp)
  const barColour = vpBarColour(vp)
  const vpStr = vp % 1 === 0 ? `${vp}%` : `${vp.toFixed(2)}%`

  return (
    <div className={`border rounded-2xl overflow-hidden shadow-sm bg-white transition-colors
      ${expired ? 'border-gray-200 opacity-60' : 'border-[#0070F3]'}`}>

      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {community.logo ? (
            <img src={community.logo} alt={community.name}
              className="w-8 h-8 rounded-full object-cover shrink-0 border border-gray-100" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
              <span className="text-blue-500 font-semibold text-xs">
                {community.name.slice(0, 2).toUpperCase()}
              </span>
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{community.name}</p>
            <p className="text-xs text-gray-400 mt-0.5">Issued at block {credential.issuedAt.toLocaleString()}</p>
          </div>
        </div>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full border shrink-0 ${
          expired
            ? 'bg-gray-50 text-gray-500 border-gray-100'
            : 'bg-emerald-50 text-emerald-600 border-emerald-100'
        }`}>
          {expired ? 'Expired' : 'Active'}
        </span>
      </div>

      {/* Metrics */}
      {!expired && (
        <div className="px-5 py-3">
          <div className="grid grid-cols-3 divide-x divide-gray-100 border border-gray-100 rounded-xl overflow-hidden mb-3">
            {[
              { label: 'EV', value: ev.toLocaleString(), colour: 'text-gray-800' },
              { label: 'VP%', value: vpStr, colour: vpColour },
              { label: 'CV', value: cv.toLocaleString(), colour: 'text-gray-800' },
            ].map(({ label, value, colour }) => (
              <div key={label} className="flex flex-col items-center py-2.5 px-2">
                <span className={`text-base font-semibold tabular-nums ${colour}`}>{value}</span>
                <span className="text-[10px] font-mono text-gray-400 mt-0.5">{label}</span>
              </div>
            ))}
          </div>

          {/* Decay bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-gray-400">
              <span>Voting power</span>
              <span>{vp > 0 ? `Decays in ${days}d` : 'Deactivated'}</span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${barColour}`} style={{ width: `${vp}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="px-5 pb-4 pt-1 flex gap-2">
        <Link
          to={`/communities/${community.community_id}`}
          className="flex-1 py-2 text-xs font-medium text-center text-gray-600 bg-gray-50 border border-gray-100 rounded-xl hover:bg-gray-100 transition-colors"
        >
          Community →
        </Link>
      </div>
    </div>
  )
}

export default function ZKCredentialPanel() {
  const { address, isConnected } = useWallet()
  const [entries, setEntries]       = useState<CredentialEntry[]>([])
  const [currentBlock, setCurrentBlock] = useState(0)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)

  useEffect(() => {
    if (!isConnected || !address) return
    setLoading(true)
    setError(null)

    Promise.all([listCommunities(), getBlockHeight()])
      .then(async ([communities, block]) => {
        setCurrentBlock(block)
        const results = await Promise.all(
          communities.map(async (community) => {
            try {
              const raw = await getCredential(address, community.community_id as `0x${string}`)
              if (!raw?.exists) return null
              const cred: Credential = {
                holder:       raw.holder,
                communityId:  raw.communityId,
                credType:     raw.credType,
                votingWeight: raw.votingWeight,
                issuedAt:     raw.issuedAt,
                expiry:       raw.expiry,
                exists:       raw.exists,
                voting_weight: Number(raw.votingWeight),
                expiry_block:  raw.expiry,
                issued_at:     raw.issuedAt,
              }
              return { community, credential: cred }
            } catch {
              return null
            }
          })
        )
        setEntries(results.filter((e): e is CredentialEntry => e !== null))
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [isConnected, address])

  if (!isConnected) return (
    <div className="border border-[#0070F3] rounded-xl overflow-hidden shadow-sm bg-white">
      <div className="p-8 text-center">
        <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-blue-100">
          <span className="text-blue-500 font-bold text-sm">FHE</span>
        </div>
        <p className="text-sm font-medium text-gray-700">Connect your wallet to view credentials.</p>
      </div>
      <div className="bg-[#0070F3] text-white px-5 py-3.5 text-sm font-medium">
        Credentials are stored on Fhenix. Connect an EVM wallet to view yours.
      </div>
    </div>
  )

  if (loading) return (
    <div className="border border-[#0070F3] rounded-xl bg-white p-8 flex items-center justify-center gap-3 shadow-sm">
      <div className="w-5 h-5 border-2 border-[#0070F3] border-t-transparent rounded-full animate-spin" />
      <span className="text-sm text-gray-500">Loading credentials from chain…</span>
    </div>
  )

  if (error) return (
    <div className="border border-red-200 rounded-xl bg-white overflow-hidden shadow-sm">
      <div className="p-5">
        <p className="text-sm text-red-500">{error}</p>
      </div>
      <div className="bg-red-500 text-white px-5 py-3 text-sm font-medium">Failed to load credentials.</div>
    </div>
  )

  if (entries.length === 0) return (
    <div className="border border-[#0070F3] rounded-xl overflow-hidden shadow-sm bg-white">
      <div className="p-8 text-center">
        <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-blue-100">
          <span className="text-blue-500 font-bold text-sm">FHE</span>
        </div>
        <p className="text-sm font-medium text-gray-700 mb-1">No credentials found.</p>
        <p className="text-xs text-gray-400">Join a community and verify requirements to receive one.</p>
      </div>
      <div className="bg-[#0070F3] text-white px-5 py-3.5 text-sm font-medium">
        Credentials are on-chain — only you can claim them by meeting community requirements.
      </div>
    </div>
  )

  return (
    <div className="flex flex-col gap-5">
      {entries.map(entry => (
        <CredentialCard
          key={`${entry.community.community_id}`}
          entry={entry}
          currentBlock={currentBlock}
        />
      ))}
    </div>
  )
}
