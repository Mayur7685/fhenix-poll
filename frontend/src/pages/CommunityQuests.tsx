import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { useQuests } from '../hooks/useQuests'
import QuestCard from '../components/QuestCard'
import { useCommunityStore } from '../store/communityStore'
import { getBlockHeight } from '../lib/fhenix'
import type { QuestInfo } from '../types'

const QUEST_TYPES = ['VOTE_COUNT', 'REFERRAL_COUNT', 'CREDENTIAL_AGE'] as const

export default function CommunityQuests() {
  const { id = '' } = useParams<{ id: string }>()
  const { address } = useAccount()
  const { fetchOne } = useCommunityStore()
  const { quests, loading, error, fetchQuests, getProgress, createQuest, requestReveal } = useQuests(id)
  const [isCreator, setIsCreator] = useState(false)
  const [showForm, setShowForm]   = useState(false)
  const [form, setForm] = useState({
    title: '', description: '', quest_type: 'VOTE_COUNT' as QuestInfo['quest_type'],
    target: 5, reward_description: '', expiry_days: 30,
  })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetchQuests()
    if (address) {
      fetchOne(id).then(c => setIsCreator(c?.creator?.toLowerCase() === address.toLowerCase()))
    }
  }, [id, address, fetchQuests, fetchOne])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const currentBlock = await getBlockHeight()
      await createQuest({
        ...form,
        reward_hash: '',
        expiry_block: currentBlock + form.expiry_days * 7200,
      })
      setShowForm(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto w-full space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link to={`/communities/${id}`} className="text-sm text-gray-500 hover:text-gray-900">← Community</Link>
          <span className="text-gray-300">/</span>
          <h1 className="text-sm font-semibold text-gray-900">Quests</h1>
        </div>
        {isCreator && (
          <button onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-1.5 text-xs font-medium bg-gray-900 text-white px-3.5 py-2 rounded-full hover:bg-gray-800 transition-colors">
            {showForm ? 'Cancel' : '+ New Quest'}
          </button>
        )}
      </div>

      {/* Create quest form (creator only) */}
      {showForm && (
        <form onSubmit={handleCreate} className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">Create Quest</h2>
          {[
            { label: 'Title', key: 'title', type: 'text' },
            { label: 'Description', key: 'description', type: 'text' },
            { label: 'Reward description', key: 'reward_description', type: 'text' },
          ].map(({ label, key, type }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
              <input type={type} required
                value={(form as any)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0070F3]/30"
              />
            </div>
          ))}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
              <select value={form.quest_type} onChange={e => setForm(f => ({ ...f, quest_type: e.target.value as any }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
                {QUEST_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Target</label>
              <input type="number" min={1} value={form.target}
                onChange={e => setForm(f => ({ ...f, target: Number(e.target.value) }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Expires (days)</label>
              <input type="number" min={1} value={form.expiry_days}
                onChange={e => setForm(f => ({ ...f, expiry_days: Number(e.target.value) }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none" />
            </div>
          </div>
          <button type="submit" disabled={submitting}
            className="w-full py-2.5 bg-gray-900 text-white text-sm font-medium rounded-full hover:bg-gray-800 disabled:opacity-50 transition-colors">
            {submitting ? 'Creating…' : 'Create Quest'}
          </button>
        </form>
      )}

      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-5 h-5 border-2 border-[#0070F3] border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {error && <p className="text-sm text-red-500 text-center">{error}</p>}
      {!loading && quests.length === 0 && !showForm && (
        <div className="bg-white border border-gray-100 rounded-2xl p-10 text-center">
          <p className="text-sm text-gray-500">No quests yet.</p>
        </div>
      )}

      <div className="space-y-4">
        {quests.map(quest => (
          <QuestCard
            key={quest.quest_id}
            quest={quest}
            getProgress={getProgress}
            onRequestReveal={requestReveal}
            isCreator={isCreator}
          />
        ))}
      </div>
    </div>
  )
}
