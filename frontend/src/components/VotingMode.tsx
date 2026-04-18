// VotingMode — ranked choice voting UI matching ref1 design.
// Green dashed border list, grip handles, click or drag to rank.

import { useState, useCallback } from 'react'
import type { PollOption, VoteRanking } from '../types'

interface Props {
  options: PollOption[]
  maxRanks?: number
  value: VoteRanking
  onChange: (r: VoteRanking) => void
  onDrillIn?: (option: PollOption) => void
}

export default function VotingMode({ options, maxRanks = 8, value, onChange, onDrillIn }: Props) {
  const [dragging, setDragging] = useState<number | null>(null)
  const [dragOverId, setDragOverId] = useState<number | null>(null)

  const rankedSorted = options
    .filter(o => value[o.option_id] > 0)
    .sort((a, b) => value[a.option_id] - value[b.option_id])

  const unranked = options.filter(o => !(o.option_id in value) || value[o.option_id] === 0)

  const clickRank = useCallback((optId: number) => {
    const used = new Set(Object.values(value))
    let next = 1
    while (used.has(next) && next <= maxRanks) next++
    if (next > maxRanks) return
    onChange({ ...value, [optId]: next })
  }, [value, maxRanks, onChange])

  const clickUnrank = useCallback((optId: number) => {
    const next = { ...value }
    const removed = next[optId]
    delete next[optId]
    for (const [id, r] of Object.entries(next)) {
      if (r > removed) next[Number(id)] = r - 1
    }
    onChange(next)
  }, [value, onChange])

  const onDragStart = (optId: number) => setDragging(optId)
  const onDragEnd   = () => { setDragging(null); setDragOverId(null) }

  const swapWithRanked = (draggedId: number, targetId: number) => {
    const next = { ...value }
    const draggedRank = next[draggedId]
    const targetRank  = next[targetId]
    if (targetRank) next[draggedId] = targetRank
    else delete next[draggedId]
    if (draggedRank) next[targetId] = draggedRank
    else delete next[targetId]
    onChange(next)
  }

  const allOptions = [...rankedSorted, ...unranked]

  return (
    <div className="flex flex-col gap-1.5">
      {allOptions.map(opt => {
        const rank = value[opt.option_id] || 0
        const isDraggingThis = dragging === opt.option_id
        const isDragOver     = dragOverId === opt.option_id

        return (
          <div
            key={opt.option_id}
            className={`flex items-center gap-3 p-2.5 bg-white rounded-lg border shadow-sm transition-all
              ${isDraggingThis ? 'opacity-40 border-gray-200' : ''}
              ${isDragOver     ? 'border-[#0070F3] bg-blue-50' : 'border-gray-100'}
              ${rank > 0       ? 'cursor-grab' : 'cursor-pointer'}
            `}
            draggable
            onDragStart={() => onDragStart(opt.option_id)}
            onDragEnd={onDragEnd}
            onDragOver={e => { e.preventDefault(); setDragOverId(opt.option_id) }}
            onDragLeave={() => setDragOverId(null)}
            onDrop={() => {
              if (dragging !== null && dragging !== opt.option_id) {
                if (rank > 0) swapWithRanked(dragging, opt.option_id)
                else {
                  // drop unranked onto unranked — just rank the dragged one
                  if (!(value[dragging] > 0)) clickRank(dragging)
                }
              }
              setDragOverId(null)
            }}
            onClick={() => rank > 0 ? clickUnrank(opt.option_id) : clickRank(opt.option_id)}
          >
            {/* Grip */}
            <svg className="w-4 h-4 text-gray-300 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="9"  cy="5"  r="1" fill="currentColor" stroke="none"/>
              <circle cx="9"  cy="12" r="1" fill="currentColor" stroke="none"/>
              <circle cx="9"  cy="19" r="1" fill="currentColor" stroke="none"/>
              <circle cx="15" cy="5"  r="1" fill="currentColor" stroke="none"/>
              <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/>
              <circle cx="15" cy="19" r="1" fill="currentColor" stroke="none"/>
            </svg>

            {/* Up arrow (ranked only) */}
            {rank > 0 && (
              <svg className="w-4 h-4 text-gray-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}

            {/* Rank number or dash */}
            <span className={`text-sm font-medium shrink-0 w-4 text-center ${rank > 0 ? 'text-[#0070F3]' : 'text-gray-300'}`}>
              {rank > 0 ? rank : '–'}
            </span>

            {/* Label */}
            <span className="flex-1 text-sm font-medium text-gray-900">{opt.label}</span>

            {/* Sub-option drill-in */}
            {onDrillIn && opt.child_count > 0 && (
              <button
                onClick={e => { e.stopPropagation(); onDrillIn(opt) }}
                className="flex items-center gap-0.5 text-xs text-[#0070F3] font-medium shrink-0 hover:underline"
                title={`Explore ${opt.child_count} sub-option${opt.child_count !== 1 ? 's' : ''}`}
              >
                <span>{opt.child_count} sub</span>
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}

            {/* Remove × for ranked */}
            {rank > 0 && (
              <button
                onClick={e => { e.stopPropagation(); clickUnrank(opt.option_id) }}
                className="text-gray-300 hover:text-gray-500 transition-colors text-base leading-none shrink-0"
              >
                ×
              </button>
            )}
          </div>
        )
      })}

      {allOptions.length === 0 && (
        <p className="text-center text-sm text-gray-400 py-4">No options in this layer.</p>
      )}
    </div>
  )
}
