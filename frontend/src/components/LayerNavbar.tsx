// MDCT breadcrumb — shows current path through the option tree.

import type { PollOption } from '../types'

export interface BreadcrumbEntry {
  optionId: number
  label: string
}

interface Props {
  breadcrumb: BreadcrumbEntry[]
  onNavigate: (index: number) => void
}

export default function LayerNavbar({ breadcrumb, onNavigate }: Props) {
  return (
    <nav className="flex items-center gap-1 flex-wrap">
      {breadcrumb.map((entry, idx) => (
        <span key={entry.optionId} className="flex items-center gap-1">
          {idx > 0 && <span className="text-gray-300 text-xs">›</span>}
          <button
            onClick={() => onNavigate(idx)}
            disabled={idx === breadcrumb.length - 1}
            className={`text-sm font-medium transition-colors ${
              idx === breadcrumb.length - 1
                ? 'text-gray-700 cursor-default'
                : 'text-[#0070F3] hover:underline'
            }`}
          >
            {entry.label}
          </button>
        </span>
      ))}
    </nav>
  )
}

export function buildBreadcrumb(optionId: number, options: PollOption[]): BreadcrumbEntry[] {
  const trail: BreadcrumbEntry[] = [{ optionId: 0, label: 'Root' }]
  if (optionId === 0) return trail
  const ancestors: number[] = []
  let current = optionId
  while (current !== 0) {
    ancestors.unshift(current)
    const opt = options.find(o => o.option_id === current)
    current = opt?.parent_option_id ?? 0
  }
  for (const id of ancestors) {
    const opt = options.find(o => o.option_id === id)
    trail.push({ optionId: id, label: opt?.label ?? `Option ${id}` })
  }
  return trail
}
