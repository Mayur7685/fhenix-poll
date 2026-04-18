import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { listCommunities } from '../lib/verifier'
import PollCard from '../components/PollCard'
import { SkeletonCard } from '../components/Skeleton'
import type { CommunityConfig, PollInfo } from '../types'

interface FeedItem {
  community: CommunityConfig
  poll: PollInfo
}

type FeedFilter = 'polls' | 'communities'

export default function PollFeed() {
  const [communities, setCommunities] = useState<CommunityConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FeedFilter>('polls')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listCommunities()
      .then(setCommunities)
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [])

  const feedItems: FeedItem[] = communities.flatMap(c =>
    (c.polls ?? []).map(poll => ({ community: c, poll }))
  ).sort((a, b) => b.poll.created_at_block - a.poll.created_at_block)

  return (
    <div className="flex flex-col gap-10">

      {/* Hero */}
      <section className="text-center pt-8 pb-2">
        <h1 className="text-5xl sm:text-6xl font-semibold tracking-tight leading-tight">
          <span className="text-[#0070F3] block pb-1">Privacy-first</span>
          <span className="text-gray-900 block">ranked voting</span>
        </h1>
        <p className="mt-6 text-base text-gray-500 font-medium max-w-md mx-auto leading-relaxed">
          Ranked-choice polls with FHE on Fhenix. Your vote is encrypted. Tallies revealed by the network.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            to="/create-poll"
            className="bg-gray-900 hover:bg-gray-800 text-white px-6 py-3 rounded-full text-sm font-medium transition-colors shadow-sm"
          >
            Create a Poll
          </Link>
          <Link
            to="/create"
            className="border border-gray-200 hover:border-gray-300 bg-white text-gray-700 px-6 py-3 rounded-full text-sm font-medium transition-colors"
          >
            New Community
          </Link>
        </div>
        <p className="mt-4 text-xs text-gray-400 font-medium">Powered by Fhenix · Fully Homomorphic Encryption</p>
      </section>

      {/* Section header with filter tabs */}
      <section>
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-2.5 h-2.5 rounded-full bg-[#0070F3]" />
            <h2 className="text-sm font-semibold text-gray-900 tracking-tight">
              {filter === 'polls' ? 'Active Polls' : 'Communities'}
            </h2>
            {!loading && (
              <span className="text-sm font-medium text-gray-400">
                {filter === 'polls' ? feedItems.length : communities.length}
              </span>
            )}
          </div>

          {/* Filter tabs */}
          <div className="flex items-center bg-white border border-gray-100 rounded-xl p-1 shadow-sm">
            {(['polls', 'communities'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all capitalize ${
                  filter === f
                    ? 'bg-gray-900 text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center shadow-sm">
            <p className="text-sm text-red-500 font-medium mb-3">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="text-sm text-gray-600 hover:text-gray-900 border border-gray-200 px-4 py-2 rounded-xl transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : filter === 'polls' ? (
          feedItems.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {feedItems.map(({ community, poll }) => (
                <PollCard
                  key={poll.poll_id}
                  communityId={community.community_id}
                  communityName={community.name}
                  poll={poll}
                />
              ))}
            </div>
          )
        ) : (
          communities.length === 0 ? (
            <EmptyState message="No communities yet." cta={{ label: '+ Create Community', to: '/create' }} />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {communities.map(c => (
                <Link
                  key={c.community_id}
                  to={`/communities/${c.community_id}`}
                  className="border border-gray-100 bg-white rounded-[1.25rem] p-5 hover:border-gray-200 hover:shadow-[0_4px_20px_-10px_rgba(0,0,0,0.08)] transition-all flex flex-col justify-between min-h-[120px] group"
                >
                  <div className="flex justify-between items-start gap-4">
                    <div>
                      <h3 className="text-base font-medium text-gray-900 leading-snug">{c.name}</h3>
                      {c.description && (
                        <p className="text-sm text-gray-500 mt-1 line-clamp-2">{c.description}</p>
                      )}
                    </div>
                    {c.logo && (
                      <img src={c.logo} alt={c.name} className="w-8 h-8 rounded-full object-cover shrink-0" />
                    )}
                  </div>
                  <div className="mt-4 flex items-center gap-2 text-xs text-gray-400 font-medium">
                    <span>{(c.polls ?? []).length} poll{(c.polls ?? []).length !== 1 ? 's' : ''}</span>
                    <span>·</span>
                    <span className="text-[#0070F3] group-hover:underline">View →</span>
                  </div>
                </Link>
              ))}
            </div>
          )
        )}
      </section>
    </div>
  )
}

function EmptyState({ message = 'No polls yet.', cta }: { message?: string; cta?: { label: string; to: string } }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center shadow-sm">
      {/* Abstract bar chart illustration */}
      <div className="flex items-end justify-center gap-2.5 mb-8 h-20">
        {[60, 80, 100, 70, 45].map((h, i) => (
          <div
            key={i}
            className="w-8 rounded-t-full border shadow-sm"
            style={{
              height: `${h}%`,
              background: ['#dbeafe','#fef9c3','#fee2e2','#dcfce7','#ede9fe'][i],
              borderColor: ['#bfdbfe','#fde68a','#fecaca','#bbf7d0','#ddd6fe'][i],
            }}
          />
        ))}
      </div>
      <h3 className="text-lg font-semibold text-gray-900 mb-2">{message}</h3>
      <p className="text-sm text-gray-500 mb-6 max-w-xs mx-auto">
        Create a community, then add a ranked-choice poll to get started.
      </p>
      <div className="flex gap-3 justify-center flex-wrap">
        <Link to="/create" className="border border-gray-200 text-gray-700 px-5 py-2.5 rounded-full text-sm font-medium hover:bg-gray-50 transition-colors">
          Create Community
        </Link>
        <Link to="/create-poll" className="bg-gray-900 text-white px-5 py-2.5 rounded-full text-sm font-medium hover:bg-gray-800 transition-colors">
          Create Poll
        </Link>
        {cta && (
          <Link to={cta.to} className="bg-[#0070F3] text-white px-5 py-2.5 rounded-full text-sm font-medium hover:bg-blue-600 transition-colors">
            {cta.label}
          </Link>
        )}
      </div>
    </div>
  )
}
