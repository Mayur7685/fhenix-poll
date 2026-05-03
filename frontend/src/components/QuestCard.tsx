import { useEffect, useState } from 'react'
import type { QuestInfo, QuestProgress } from '../types'

interface Props {
  quest: QuestInfo
  getProgress: (questId: string) => Promise<QuestProgress>
  onRequestReveal: (questId: string) => Promise<void>
  isCreator: boolean
}

export default function QuestCard({ quest, getProgress, onRequestReveal, isCreator }: Props) {
  const [progress, setProgress] = useState<QuestProgress | null>(null)
  const [revealing, setRevealing] = useState(false)

  useEffect(() => {
    getProgress(quest.quest_id).then(setProgress)
  }, [quest.quest_id, getProgress])

  const pct = progress && quest.target > 0
    ? Math.min(100, Math.round((progress.progress / quest.target) * 100))
    : 0

  async function handleReveal() {
    setRevealing(true)
    try {
      await onRequestReveal(quest.quest_id)
      const updated = await getProgress(quest.quest_id)
      setProgress(updated)
    } finally {
      setRevealing(false)
    }
  }

  const typeLabel = { VOTE_COUNT: 'Vote', REFERRAL_COUNT: 'Refer', CREDENTIAL_AGE: 'Hold' }[quest.quest_type]

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{quest.title}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{quest.description}</p>
        </div>
        {progress?.completed && (
          <span className="shrink-0 text-xs bg-green-50 text-green-600 border border-green-100 px-2.5 py-1 rounded-full font-medium">
            ✓ Complete
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>{typeLabel} {progress?.progress ?? '?'} / {quest.target}</span>
          <span>{pct}%</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-[#0070F3] rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">🎁 {quest.reward_description}</p>
        {!progress?.completed && (
          <button
            onClick={handleReveal}
            disabled={revealing}
            className="text-xs font-medium text-[#0070F3] hover:underline disabled:opacity-50"
          >
            {revealing ? 'Checking…' : 'Check progress'}
          </button>
        )}
      </div>
    </div>
  )
}
