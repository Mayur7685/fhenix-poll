import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { QuestInfo, QuestProgress } from "./types.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const QUESTS_DIR   = path.join(__dirname, "..", "quests")
const PROGRESS_DIR = path.join(__dirname, "..", "quest-progress")

const questStore    = new Map<string, QuestInfo>()
const byComm        = new Map<string, string[]>()
const progressStore = new Map<string, QuestProgress>() // key: questId:address

export function initQuests(): void {
  if (!fs.existsSync(QUESTS_DIR))   fs.mkdirSync(QUESTS_DIR,   { recursive: true })
  if (!fs.existsSync(PROGRESS_DIR)) fs.mkdirSync(PROGRESS_DIR, { recursive: true })

  for (const file of fs.readdirSync(QUESTS_DIR).filter(f => f.endsWith(".json"))) {
    const quest = JSON.parse(fs.readFileSync(path.join(QUESTS_DIR, file), "utf-8")) as QuestInfo
    _indexQuest(quest)
  }
  for (const file of fs.readdirSync(PROGRESS_DIR).filter(f => f.endsWith(".json"))) {
    const p = JSON.parse(fs.readFileSync(path.join(PROGRESS_DIR, file), "utf-8")) as QuestProgress
    progressStore.set(`${p.quest_id}:${p.participant.toLowerCase()}`, p)
  }
  console.log(`Loaded ${questStore.size} quest(s)`)
}

function _indexQuest(quest: QuestInfo) {
  questStore.set(quest.quest_id, quest)
  const list = byComm.get(quest.community_id) ?? []
  if (!list.includes(quest.quest_id)) list.push(quest.quest_id)
  byComm.set(quest.community_id, list)
}

export function saveQuest(quest: QuestInfo): void {
  fs.writeFileSync(path.join(QUESTS_DIR, `${quest.quest_id}.json`), JSON.stringify(quest, null, 2))
  _indexQuest(quest)
}

export function getQuest(questId: string): QuestInfo | undefined {
  return questStore.get(questId)
}

export function getCommunityQuests(communityId: string): QuestInfo[] {
  return (byComm.get(communityId) ?? []).map(id => questStore.get(id)!).filter(Boolean)
}

export function saveQuestProgress(p: QuestProgress): void {
  const key = `${p.quest_id}:${p.participant.toLowerCase()}`
  const file = path.join(PROGRESS_DIR, `${p.quest_id}-${p.participant.toLowerCase()}.json`)
  fs.writeFileSync(file, JSON.stringify(p, null, 2))
  progressStore.set(key, p)
}

export function getQuestProgress(questId: string, participant: string): QuestProgress | undefined {
  return progressStore.get(`${questId}:${participant.toLowerCase()}`)
}
