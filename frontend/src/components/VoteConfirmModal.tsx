// Dark confirmation modal — matches ref2 design exactly.

import type { PollOption, VoteRanking } from '../types'

interface Props {
  ranking: VoteRanking
  options: PollOption[]
  onConfirm: () => void
  onCancel: () => void
  submitting: boolean
}

export default function VoteConfirmModal({ ranking, options, onConfirm, onCancel, submitting }: Props) {
  const sorted = Object.entries(ranking)
    .filter(([, r]) => r > 0)
    .sort(([, a], [, b]) => a - b)
    .map(([id, rank]) => ({
      rank,
      label: options.find(o => o.option_id === Number(id))?.label ?? `Option ${id}`,
    }))

  const unranked = options.filter(o => !ranking[o.option_id] || ranking[o.option_id] === 0)

  const ts = new Date().toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

  return (
    // Full-screen overlay — blur the background
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-8"
      style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(2px)' }}
      onClick={onCancel}
    >
      <div className="w-full max-w-md" onClick={e => e.stopPropagation()}>

        {/* Dark modal box — matches ref2 */}
        <div className="bg-[#0a0a0a] rounded-2xl shadow-2xl overflow-hidden flex flex-col border border-gray-800/60">
          <h2 className="text-center text-lg font-semibold text-white tracking-tight pt-5 pb-4">
            Vote Confirmation
          </h2>

          <div className="px-6 flex flex-col">
            {/* Request from */}
            <div className="flex justify-between items-center py-3 border-b border-white/10">
              <span className="text-sm text-gray-400">Request from</span>
              <span className="text-sm text-white font-medium">FhenixPoll</span>
            </div>

            {/* Vote details */}
            <div className="py-4 flex flex-col gap-1">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-gray-400">Your Vote:</span>
                <div className="flex gap-2 text-gray-500">
                  <svg className="w-3.5 h-3.5 hover:text-white cursor-pointer transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                  </svg>
                </div>
              </div>

              <span className="text-sm font-medium text-white">Ranked:</span>
              {sorted.length > 0 ? sorted.map(({ rank, label }) => (
                <span key={rank} className="text-sm text-gray-400">{rank}: {label}</span>
              )) : (
                <span className="text-sm text-gray-500 italic">No options ranked</span>
              )}

              {unranked.length > 0 && (
                <>
                  <span className="text-sm font-medium text-white mt-3">Unranked:</span>
                  {unranked.map(o => (
                    <span key={o.option_id} className="text-sm text-gray-400">{o.label}</span>
                  ))}
                </>
              )}

              <div className="flex gap-1.5 mt-3">
                <span className="text-sm font-medium text-white">Timestamp:</span>
                <span className="text-sm text-gray-400">{ts}</span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-3 pb-6 pt-2">
              <button
                onClick={onCancel}
                disabled={submitting}
                className="flex-1 py-3 rounded-full border border-gray-700 hover:bg-gray-800 hover:border-gray-600 text-[#0070F3] font-medium text-sm transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                disabled={submitting}
                className="flex-1 py-3 rounded-full bg-[#0070F3] hover:bg-blue-500 text-white font-medium text-sm transition-all shadow-[0_0_15px_rgba(0,112,243,0.3)] outline outline-2 outline-dashed outline-[#10B981] outline-offset-[3px] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Signing…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>

        {/* Blue info box — attached below modal like ref2 */}
        <div className="bg-[#0070F3] text-white px-5 py-4 text-sm font-medium rounded-b-xl leading-relaxed shadow-xl -mt-2 border-t border-blue-400/30">
          By clicking "Confirm" you're cryptographically signing your rank order, creating a verifiable ballot that cannot be falsified.
        </div>
      </div>
    </div>
  )
}
