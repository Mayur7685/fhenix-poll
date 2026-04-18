// Shows MDCT-style voting weight distribution for the user's current ranking.
// Rank 1 gets score 1.0, rank 2 gets 0.5, rank 3 gets 0.33, etc.

import type { PollOption, VoteRanking } from '../types'

interface Props {
  ranking: VoteRanking
  options: PollOption[]
}

export default function VotingPowerGauge({ ranking, options }: Props) {
  const ranked = Object.entries(ranking)
    .filter(([, r]) => r > 0)
    .sort(([, a], [, b]) => a - b)
    .map(([id, rank]) => ({
      rank,
      label: options.find(o => o.option_id === Number(id))?.label ?? `Option ${id}`,
      weight: 1 / rank,
    }))

  if (ranked.length === 0) return null

  const maxWeight = ranked[0]?.weight ?? 1

  return (
    <div className="gauge">
      <div className="gauge-title">Voting Weight (MDCT decay)</div>
      {ranked.map(({ rank, label, weight }) => (
        <div key={rank} className="gauge-row">
          <span className="gauge-label" title={label}>
            #{rank} {label.length > 20 ? label.slice(0, 20) + '…' : label}
          </span>
          <div className="gauge-bar-wrap">
            <div className="gauge-bar" style={{ width: `${(weight / maxWeight) * 100}%` }} />
          </div>
          <span className="gauge-weight">{weight.toFixed(2)}x</span>
        </div>
      ))}
    </div>
  )
}
