import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import WalletButton from '../components/WalletButton'
import { useWallet } from '../hooks/useWallet'
import { listCommunities } from '../lib/verifier'
import type { CommunityConfig, PollInfo } from '../types'

const AVATAR_COLORS = [
  'bg-blue-50 border-blue-100 text-blue-500',
  'bg-teal-50 border-teal-100 text-teal-600',
  'bg-emerald-50 border-emerald-100 text-emerald-600',
  'bg-yellow-50 border-yellow-100 text-yellow-600',
  'bg-purple-50 border-purple-100 text-purple-600',
  'bg-orange-50 border-orange-100 text-orange-600',
  'bg-red-50 border-red-100 text-red-500',
]

interface FlatPoll { poll: PollInfo; community: CommunityConfig; colorIdx: number }

const HOW_IT_WORKS = [
  {
    step: '01',
    title: 'Get a credential',
    body: "Meet your community's requirements. The verifier checks eligibility off-chain, then your EVM wallet receives an FHE credential on Fhenix.",
    colour: 'bg-blue-50 text-blue-600 border-blue-100',
  },
  {
    step: '02',
    title: 'Rank your choices',
    body: 'Cast ranked-choice ballots with up to 8 options. Your vote weights are FHE-encrypted — tallied homomorphically without revealing individual ballots.',
    colour: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  },
  {
    step: '03',
    title: 'Your vote decays gracefully',
    body: 'Voting power halves every 400 days across 5 periods. Recast with one click to restore 100% VP with the same rankings.',
    colour: 'bg-amber-50 text-amber-600 border-amber-100',
  },
  {
    step: '04',
    title: 'Results are verifiable',
    body: 'The FHE tally is decrypted on-chain by the Fhenix network. Anyone can audit the result without learning individual votes.',
    colour: 'bg-purple-50 text-purple-600 border-purple-100',
  },
]

const DECAY_TABLE = [
  { period: 0, days: '0 – 399',     vp: '100%', colour: 'text-emerald-600' },
  { period: 1, days: '400 – 799',   vp: '50%',  colour: 'text-yellow-500' },
  { period: 2, days: '800 – 1,199', vp: '25%',  colour: 'text-orange-500' },
  { period: 3, days: '1,200–1,599', vp: '12.5%',colour: 'text-orange-500' },
  { period: 4, days: '1,600–1,999', vp: '6.25%',colour: 'text-orange-500' },
  { period: 5, days: '2,000+',      vp: '0%',   colour: 'text-red-500' },
]

export default function LandingPage() {
  const { isConnected } = useWallet()
  const navigate = useNavigate()
  const [polls, setPolls] = useState<FlatPoll[]>([])

  useEffect(() => {
    if (isConnected) navigate('/polls', { replace: true })
  }, [isConnected, navigate])

  useEffect(() => {
    listCommunities()
      .then(communities => {
        const flat: FlatPoll[] = []
        communities.forEach((c, ci) => {
          ;(c.polls ?? []).forEach(p => {
            flat.push({ poll: p, community: c, colorIdx: ci % AVATAR_COLORS.length })
          })
        })
        setPolls(flat)
      })
      .catch(() => null)
  }, [])

  return (
    <div className="bg-white text-gray-900 antialiased min-h-screen flex flex-col selection:bg-blue-100 selection:text-blue-900">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="w-full px-6 py-5 flex justify-between items-center max-w-[1200px] mx-auto">
        <span className="text-xl font-semibold tracking-tight text-gray-900 leading-none">FhenixPoll</span>
        <WalletButton />
      </header>

      <main className="flex-1 flex flex-col w-full">

        {/* ── Hero ───────────────────────────────────────────────────────── */}
        <section className="mt-20 sm:mt-28 flex flex-col items-center text-center px-4 w-full max-w-4xl mx-auto">

          <div className="inline-flex items-center gap-2 bg-gray-900 text-white px-4 py-1.5 rounded-full text-xs font-medium mb-10">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] shadow-[0_0_6px_1px_rgba(16,185,129,0.6)]" />
            Built on Fhenix · FHE-proven ballots
          </div>

          <h1 className="text-5xl sm:text-6xl md:text-7xl font-semibold tracking-tight leading-[1.06]">
            <span className="text-[#0070F3]">Private governance</span>
            <br />
            <span className="text-gray-900">for your community.</span>
          </h1>

          <p className="mt-7 text-lg text-gray-500 max-w-xl leading-relaxed">
            Credentials prove eligibility. Vote weights are FHE-encrypted.
            Tallies computed homomorphically — no vote ever revealed.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center gap-4">
            <WalletButton />
            <Link
              to="/polls"
              className="text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors"
            >
              Browse polls without connecting →
            </Link>
          </div>

          {/* Three pillars */}
          <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-4 w-full text-left">
            {[
              { icon: '🔒', title: 'Votes are FHE-encrypted', body: 'Your ballot weights are encrypted client-side before submission. The chain tallies homomorphically — nobody sees individual votes.' },
              { icon: '⚖️', title: 'EV × VP% = CV', body: 'Eligible Votes reflect your stake. Voting Power decays over time. Counted Votes is the product — recast anytime to restore.' },
              { icon: '🌐', title: 'Verifiable results', body: 'The Fhenix network decrypts the aggregate tally on-chain. Audit the outcome without revealing individual votes.' },
            ].map(({ icon, title, body }) => (
              <div key={title} className="bg-gray-50 border border-gray-100 rounded-2xl p-5">
                <div className="text-2xl mb-3">{icon}</div>
                <p className="text-sm font-semibold text-gray-900 mb-1.5">{title}</p>
                <p className="text-xs text-gray-500 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Active Polls ────────────────────────────────────────────────── */}
        <section className="max-w-4xl mx-auto px-4 mt-24 w-full">
          <div className="flex items-center gap-2.5 mb-6">
            <div className="w-2 h-2 rounded-full bg-[#0070F3]" />
            <h2 className="text-sm font-semibold text-gray-900 tracking-tight">Active Polls</h2>
            {polls.length > 0 && <span className="text-sm text-gray-400">{polls.length}</span>}
          </div>

          {polls.length === 0 ? (
            <div className="border border-gray-100 rounded-2xl p-10 text-center">
              <p className="text-sm text-gray-400">No polls yet. Connect a wallet to create one.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {polls.map(({ poll, community, colorIdx }) => (
                <div
                  key={`${community.community_id}-${poll.poll_id}`}
                  className="border border-gray-100 bg-white rounded-2xl p-5 hover:border-gray-200 hover:shadow-sm transition-all flex flex-col justify-between min-h-[140px]"
                >
                  <div className="flex justify-between items-start gap-3">
                    <p className="text-sm font-medium text-gray-900 leading-snug line-clamp-2">{poll.title}</p>
                    <div className="flex items-center gap-1 shrink-0 mt-0.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                      <span className="text-[10px] text-gray-400">live</span>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-2.5">
                    {community.logo ? (
                      <img src={community.logo} alt={community.name}
                        className="w-7 h-7 rounded-full object-cover border border-gray-100 shrink-0" />
                    ) : (
                      <div className={`w-7 h-7 rounded-full border flex items-center justify-center shrink-0 text-[10px] font-bold ${AVATAR_COLORS[colorIdx]}`}>
                        {community.name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="text-xs font-medium text-gray-800 leading-none">{community.name}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {poll.options.length} option{poll.options.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── How it works ────────────────────────────────────────────────── */}
        <section className="max-w-4xl mx-auto px-4 mt-24 w-full">
          <div className="flex items-center gap-2.5 mb-6">
            <div className="w-2 h-2 rounded-full bg-[#10B981]" />
            <h2 className="text-sm font-semibold text-gray-900 tracking-tight">How it works</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {HOW_IT_WORKS.map(({ step, title, body, colour }) => (
              <div key={step} className="border border-gray-100 bg-white rounded-2xl p-5 flex gap-4">
                <div className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 text-xs font-bold ${colour}`}>
                  {step}
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900 mb-1">{title}</p>
                  <p className="text-xs text-gray-500 leading-relaxed">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Decay model table ───────────────────────────────────────────── */}
        <section className="max-w-4xl mx-auto px-4 mt-24 w-full">
          <div className="flex items-center gap-2.5 mb-6">
            <div className="w-2 h-2 rounded-full bg-amber-400" />
            <h2 className="text-sm font-semibold text-gray-900 tracking-tight">Vote power decay schedule</h2>
          </div>
          <div className="border border-gray-100 rounded-2xl overflow-hidden">
            <div className="grid grid-cols-3 bg-gray-50 border-b border-gray-100 px-5 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
              <span>Period</span>
              <span>Days since credential</span>
              <span>Voting Power</span>
            </div>
            {DECAY_TABLE.map(({ period, days, vp, colour }) => (
              <div
                key={period}
                className="grid grid-cols-3 px-5 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors"
              >
                <span className="text-xs text-gray-500 font-medium">{period === 5 ? '5+ (dead)' : period}</span>
                <span className="text-xs text-gray-400">{days}</span>
                <span className={`text-sm font-semibold tabular-nums ${colour}`}>{vp}</span>
              </div>
            ))}
            <div className="px-5 py-3 bg-gray-50 border-t border-gray-100">
              <p className="text-[11px] text-gray-400">
                Recast your vote at any time to reset to 100% with identical rankings.
              </p>
            </div>
          </div>
        </section>

        {/* ── Bottom CTA ──────────────────────────────────────────────────── */}
        <section className="max-w-4xl mx-auto px-4 mt-24 mb-32 w-full">
          <div className="bg-gray-900 rounded-3xl p-10 sm:p-14 flex flex-col items-center text-center relative overflow-hidden">
            <div className="absolute -top-10 -right-10 w-48 h-48 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-10 -left-10 w-64 h-64 bg-emerald-600/10 rounded-full blur-3xl pointer-events-none" />
            <div className="relative z-10 flex flex-col items-center">
              <h2 className="text-3xl sm:text-4xl font-semibold text-white tracking-tight leading-tight mb-4">
                Nobody — not even us —<br/>
                <span className="text-[#0070F3]">can see how you voted.</span>
              </h2>
              <p className="text-gray-400 text-sm max-w-md leading-relaxed mb-10">
                FHE-proven private governance on Fhenix. Your credential proves membership.
                Your ballot is encrypted. Only the aggregate tally is ever revealed.
              </p>
              <WalletButton />
              <p className="mt-4 text-xs text-gray-500">Fully Homomorphic Encryption on Fhenix Helium testnet.</p>
            </div>
          </div>
        </section>

      </main>
    </div>
  )
}
