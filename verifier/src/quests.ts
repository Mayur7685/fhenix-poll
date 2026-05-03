import { QuestInfo, QuestProgress } from "./types.js"
import { isPinataConfigured, pinJSON, fetchFromIPFS, listPinsByPrefix } from "./pinata.js"

const questStore    = new Map<string, QuestInfo>()
const byComm        = new Map<string, string[]>()
const progressStore = new Map<string, QuestProgress>() // key: questId:address

function _indexQuest(quest: QuestInfo) {
  questStore.set(quest.quest_id, quest)
  const list = byComm.get(quest.community_id) ?? []
  if (!list.includes(quest.quest_id)) list.push(quest.quest_id)
  byComm.set(quest.community_id, list)
}

export async function initQuests(): Promise<void> {
  if (!isPinataConfigured()) return
  try {
    const [questPins, progressPins] = await Promise.all([
      listPinsByPrefix("quest-"),
      listPinsByPrefix("quest-progress-"),
    ])
    await Promise.all([
      ...questPins
        .filter(p => !p.name.startsWith("quest-progress-"))
        .map(async pin => {
          try {
            const quest = await fetchFromIPFS<QuestInfo>(pin.cid)
            if (quest.quest_id) _indexQuest(quest)
          } catch { /* skip */ }
        }),
      ...progressPins.map(async pin => {
        try {
          const p = await fetchFromIPFS<QuestProgress>(pin.cid)
          if (p.quest_id && p.participant)
            progressStore.set(`${p.quest_id}:${p.participant.toLowerCase()}`, p)
        } catch { /* skip */ }
      }),
    ])
    console.log(`[quests] Loaded ${questStore.size} quest(s) from Pinata`)
  } catch (e: any) {
    console.warn("[quests] Pinata load failed (non-fatal):", e.message)
  }
}

export async function saveQuest(quest: QuestInfo): Promise<void> {
  _indexQuest(quest)
  if (isPinataConfigured()) {
    try { await pinJSON(quest, `quest-${quest.quest_id}`) } catch { /* non-fatal */ }
  }
}

export function getQuest(questId: string): QuestInfo | undefined {
  return questStore.get(questId)
}

export function getCommunityQuests(communityId: string): QuestInfo[] {
  return (byComm.get(communityId) ?? []).map(id => questStore.get(id)!).filter(Boolean)
}

export async function saveQuestProgress(p: QuestProgress): Promise<void> {
  const key = `${p.quest_id}:${p.participant.toLowerCase()}`
  progressStore.set(key, p)
  if (isPinataConfigured()) {
    try {
      await pinJSON(p, `quest-progress-${p.quest_id}-${p.participant.toLowerCase()}`)
    } catch { /* non-fatal */ }
  }
}

export function getQuestProgress(questId: string, participant: string): QuestProgress | undefined {
  return progressStore.get(`${questId}:${participant.toLowerCase()}`)
}
