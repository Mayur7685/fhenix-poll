import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { CommunityConfig } from "./types.js"
import { isPinataConfigured, listPinsByPrefix, fetchFromIPFS } from "./pinata.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const COMMUNITIES_DIR = path.join(__dirname, "..", "communities")

const configs: Map<string, CommunityConfig> = new Map()

export function loadCommunities(): void {
  if (!fs.existsSync(COMMUNITIES_DIR)) {
    fs.mkdirSync(COMMUNITIES_DIR, { recursive: true })
  }
  const files = fs.readdirSync(COMMUNITIES_DIR).filter(f => f.endsWith(".json"))
  for (const file of files) {
    const raw    = fs.readFileSync(path.join(COMMUNITIES_DIR, file), "utf-8")
    const config = JSON.parse(raw) as CommunityConfig
    configs.set(config.community_id, config)
  }
  console.log(`Loaded ${configs.size} community config(s)`)

  // Restore any communities pinned to IPFS that are missing locally (e.g. after redeploy)
  if (isPinataConfigured()) {
    void restoreFromIPFS()
  }
}

async function restoreFromIPFS(): Promise<void> {
  try {
    const [communityPins, pollPins] = await Promise.all([
      listPinsByPrefix("community-"),
      listPinsByPrefix("poll-"),
    ])

    // Build poll lookup: community_id → PollInfo[]
    const pollsByComm = new Map<string, any[]>()
    await Promise.all(pollPins.map(async pin => {
      try {
        const poll = await fetchFromIPFS<any>(pin.cid)
        if (!poll.poll_id || !poll.community_id) return
        if (!pollsByComm.has(poll.community_id)) pollsByComm.set(poll.community_id, [])
        const existing = pollsByComm.get(poll.community_id)!
        if (!existing.find((p: any) => p.poll_id === poll.poll_id)) existing.push(poll)
      } catch { /* skip */ }
    }))

    let restored = 0
    for (const pin of communityPins) {
      const communityId = pin.name.replace(/^community-/, '')
      try {
        // Use existing local config if available, otherwise fetch from IPFS
        let config: any = configs.get(communityId)
        if (!config) {
          config = await fetchFromIPFS<any>(pin.cid)
          if (!config.community_id) continue
        }
        // Merge any polls from IPFS that are missing locally
        const extraPolls = pollsByComm.get(communityId) ?? []
        const existingIds = new Set((config.polls ?? []).map((p: any) => p.poll_id))
        const newPolls = extraPolls.filter((p: any) => !existingIds.has(p.poll_id))
        if (newPolls.length > 0 || !configs.has(communityId)) {
          config.polls = [...(config.polls ?? []), ...newPolls]
          saveCommunityConfig(config)
          restored++
          console.log(`[restore] Restored "${communityId}" with ${(config.polls ?? []).length} poll(s)`)
        }
      } catch (e: any) {
        console.warn(`[restore] Failed to restore "${communityId}": ${e.message}`)
      }
    }
    if (restored > 0) console.log(`[restore] Restored ${restored} community config(s) from IPFS`)
  } catch (e: any) {
    console.warn("[restore] IPFS restore failed (non-fatal):", e.message)
  }
}

export function getCommunityConfig(communityId: string): CommunityConfig | undefined {
  return configs.get(communityId)
}

export function getAllCommunities(): CommunityConfig[] {
  return Array.from(configs.values())
}

export function saveCommunityConfig(config: CommunityConfig): void {
  const filePath = path.join(COMMUNITIES_DIR, `${config.community_id}.json`)
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2))
  configs.set(config.community_id, config)
}
