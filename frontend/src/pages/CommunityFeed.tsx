import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCommunityStore } from '../store/communityStore'
import { useWallet } from '../hooks/useWallet'

const ICONS = [
  { bg: 'bg-blue-50 text-blue-600 border-blue-100',    icon: '◆' },
  { bg: 'bg-green-50 text-green-600 border-green-100',  icon: '✦' },
  { bg: 'bg-indigo-50 text-indigo-600 border-indigo-100', icon: '⬡' },
  { bg: 'bg-orange-50 text-orange-600 border-orange-100', icon: '◉' },
  { bg: 'bg-pink-50 text-pink-600 border-pink-100',     icon: '❋' },
  { bg: 'bg-yellow-50 text-yellow-600 border-yellow-100', icon: '◈' },
]

export default function CommunityFeed() {
  const { communities, loading, error, fetchAll } = useCommunityStore()
  const { address } = useWallet()
  const [search, setSearch] = useState('')

  useEffect(() => { fetchAll() }, [fetchAll])

  const myCommunities = communities.filter(c => address && (!c.creator || c.creator === address))
  const filtered = communities.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.description ?? '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="max-w-2xl mx-auto w-full">

      {/* Back + title */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          to="/"
          className="flex items-center text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors group"
        >
          <svg className="w-4 h-4 mr-1 group-hover:-translate-x-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back
        </Link>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Communities</h1>
        <Link
          to="/create"
          className="flex items-center gap-1.5 bg-gray-900 text-white px-4 py-2 rounded-full text-sm font-medium hover:bg-gray-800 transition-colors"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" strokeLinecap="round"/>
          </svg>
          New
        </Link>
      </div>

      {/* My Communities */}
      {myCommunities.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">My Communities</p>
          <div className="space-y-2">
            {myCommunities.map((c, i) => {
              const icon = ICONS[i % ICONS.length]
              return (
                <Link key={c.community_id} to={`/communities/${c.community_id}`}
                  className="flex items-center justify-between p-3.5 border border-[#0070F3] rounded-xl hover:shadow-sm transition-all bg-blue-50 group">
                  <div className="flex items-center gap-3.5">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 border ${icon.bg}`}>
                      {c.logo ? <img src={c.logo} alt={c.name} className="w-full h-full rounded-full object-cover" /> : icon.icon}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-gray-900 leading-tight">{c.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {(c.polls ?? []).length} poll{(c.polls ?? []).length !== 1 ? 's' : ''} · Owner
                      </div>
                    </div>
                  </div>
                  <svg className="w-4 h-4 text-[#0070F3]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-5">
        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
          <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35" strokeLinecap="round"/>
          </svg>
        </div>
        <input
          type="text"
          placeholder="Search communities…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="block w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition-all"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-4 mb-4 flex items-center justify-between">
          <p className="text-sm text-red-600">{error}</p>
          <button onClick={() => fetchAll()} className="text-sm text-red-600 font-medium hover:underline">Retry</button>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="space-y-2.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between p-3.5 border border-gray-100 rounded-xl bg-white animate-pulse">
              <div className="flex items-center gap-3.5">
                <div className="w-8 h-8 rounded-full bg-gray-100 shrink-0" />
                <div>
                  <div className="h-3.5 w-28 bg-gray-100 rounded mb-1.5" />
                  <div className="h-3 w-20 bg-gray-100 rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-base text-gray-500 mb-4">{search ? 'No matching communities.' : 'No communities yet.'}</p>
          {!search && (
            <Link to="/create" className="bg-gray-900 text-white px-5 py-2.5 rounded-full text-sm font-medium hover:bg-gray-800 transition-colors inline-flex items-center gap-1.5">
              Create first community
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((c, i) => {
            const icon = ICONS[i % ICONS.length]
            return (
              <Link
                key={c.community_id}
                to={`/communities/${c.community_id}`}
                className="flex items-center justify-between p-3.5 border border-gray-100 rounded-xl hover:border-gray-200 hover:shadow-sm transition-all bg-white group"
              >
                <div className="flex items-center gap-3.5">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 border ${icon.bg}`}>
                    {c.logo
                      ? <img src={c.logo} alt={c.name} className="w-full h-full rounded-full object-cover" />
                      : icon.icon
                    }
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-900 leading-tight">{c.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {(c.polls ?? []).length} poll{(c.polls ?? []).length !== 1 ? 's' : ''} · Credential type {c.credential_type}
                    </div>
                  </div>
                </div>
                <svg className="w-4 h-4 text-gray-400 group-hover:text-gray-600 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
