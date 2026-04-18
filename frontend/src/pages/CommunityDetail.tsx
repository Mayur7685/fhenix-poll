import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useCommunityStore } from '../store/communityStore'
import { getBlockHeight } from '../lib/fhenix'
import CredentialHub from '../components/CredentialHub'
import PollCard from '../components/PollCard'
import type { CommunityConfig } from '../types'

export default function CommunityDetail() {
  const { id } = useParams<{ id: string }>()
  const { fetchOne } = useCommunityStore()
  const [community, setCommunity] = useState<CommunityConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentBlock, setCurrentBlock] = useState(0)

  useEffect(() => {
    if (!id) return
    fetchOne(id).then(c => { setCommunity(c); setLoading(false) })
    getBlockHeight().then(setCurrentBlock).catch(() => null)
  }, [id, fetchOne])

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-6 h-6 border-2 border-[#0070F3] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (!community) return (
    <div className="text-center py-20">
      <p className="text-gray-500 text-sm">Community not found.</p>
      <Link to="/communities" className="text-[#0070F3] text-sm hover:underline mt-2 inline-block">
        ← All communities
      </Link>
    </div>
  )

  const polls = community.polls ?? []

  return (
    <div className="max-w-2xl mx-auto w-full space-y-6">

      {/* Back */}
      <Link
        to="/communities"
        className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors group"
      >
        <svg className="w-4 h-4 mr-1 group-hover:-translate-x-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Communities
      </Link>

      {/* Community header card */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-start gap-4">
          {community.logo ? (
            <img src={community.logo} alt={community.name}
              className="w-12 h-12 rounded-full object-cover shrink-0 border border-gray-100" />
          ) : (
            <div className="w-12 h-12 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
              <span className="text-blue-500 font-semibold text-sm">
                {community.name.slice(0, 2).toUpperCase()}
              </span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold text-gray-900 tracking-tight">{community.name}</h1>
            {community.description && (
              <p className="text-sm text-gray-500 mt-1 leading-relaxed">{community.description}</p>
            )}
            <div className="flex gap-2 mt-3 flex-wrap">
              <span className="text-xs bg-blue-50 text-blue-600 border border-blue-100 px-2.5 py-1 rounded-full font-medium">
                Credential type {community.credential_type}
              </span>
              <span className="text-xs bg-gray-50 text-gray-600 border border-gray-100 px-2.5 py-1 rounded-full font-medium">
                {community.credential_expiry_days}d validity
              </span>
              <span className="text-xs bg-gray-50 text-gray-600 border border-gray-100 px-2.5 py-1 rounded-full font-medium">
                {polls.length} poll{polls.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
          <Link
            to={`/create-poll?community=${community.community_id}`}
            className="shrink-0 flex items-center gap-1.5 text-xs font-medium bg-gray-900 text-white px-3.5 py-2 rounded-full hover:bg-gray-800 transition-colors"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 5v14M5 12h14" strokeLinecap="round"/>
            </svg>
            Poll
          </Link>
        </div>
      </div>

      {/* Credential Hub — eligibility, decay, recast */}
      <CredentialHub community={community} />

      {/* Polls */}
      <div>
        {(() => {
          const activePolls = polls.filter(p => !p.end_block || currentBlock === 0 || currentBlock <= p.end_block)
          const pastPolls   = polls.filter(p => p.end_block && currentBlock > 0 && currentBlock > p.end_block)
          return (
            <>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#10B981]" />
                  <h2 className="text-sm font-semibold text-gray-900">Active Polls</h2>
                  {activePolls.length > 0 && <span className="text-sm text-gray-400">{activePolls.length}</span>}
                </div>
              </div>
              {activePolls.length === 0 ? (
                <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center mb-4">
                  <p className="text-sm text-gray-500 mb-4">No active polls.</p>
                  <Link to={`/create-poll?community=${community.community_id}`}
                    className="inline-flex items-center gap-1.5 bg-gray-900 text-white px-5 py-2.5 rounded-full text-sm font-medium hover:bg-gray-800 transition-colors">
                    Create first poll →
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 mb-6">
                  {activePolls.map(poll => (
                    <PollCard key={poll.poll_id} communityId={community.community_id} communityName={community.name} poll={poll} />
                  ))}
                </div>
              )}
              {pastPolls.length > 0 && (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-gray-300" />
                    <h2 className="text-sm font-semibold text-gray-500">Past Polls</h2>
                    <span className="text-sm text-gray-400">{pastPolls.length}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-4 opacity-70">
                    {pastPolls.map(poll => (
                      <PollCard key={poll.poll_id} communityId={community.community_id} communityName={community.name} poll={poll} />
                    ))}
                  </div>
                </>
              )}
            </>
          )
        })()}
      </div>
    </div>
  )
}
