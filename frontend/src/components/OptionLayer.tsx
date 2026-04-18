// Shows all options at one MDCT layer — ref2/ref3 design.

import type { PollOption, ScopedSnapshotMap } from '../types'

interface Props {
  options:   PollOption[]
  parentId:  number
  snapshots: ScopedSnapshotMap   // v2: per-parent scoped snapshots
  onDrillIn: (option: PollOption) => void
}

export default function OptionLayer({ options, parentId, snapshots, onDrillIn }: Props) {
  const layerOptions = options.filter(o => o.parent_option_id === parentId)
  const sorted = [...layerOptions].sort((a, b) => a.option_id - b.option_id)

  if (sorted.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-4">No options at this level.</p>
  }

  return (
    <>
      {sorted.map((opt, idx) => {
        const hasChildren = opt.child_count > 0
        return (
          <div
            key={opt.option_id}
            className="flex items-center gap-3 p-2.5 bg-white border border-gray-100 rounded-lg hover:border-gray-200 transition-colors"
          >
            {/* Sequential index badge */}
            <div className="w-6 h-6 rounded flex items-center justify-center bg-gray-100 text-gray-600 text-xs font-medium shrink-0">
              {idx + 1}
            </div>

            {/* Label */}
            <span className="flex-1 text-sm font-medium text-gray-900">{opt.label}</span>

            {/* Sub-option count badge */}
            {hasChildren && (
              <div className="w-6 h-6 rounded-full flex items-center justify-center bg-gray-100 text-gray-600 text-xs font-medium shrink-0">
                {opt.child_count}
              </div>
            )}

            {/* Drill-in arrow */}
            {hasChildren && (
              <button
                onClick={() => onDrillIn(opt)}
                title={`Explore ${opt.label}`}
                className="text-gray-400 hover:text-gray-600 transition-colors shrink-0"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
          </div>
        )
      })}
    </>
  )
}
