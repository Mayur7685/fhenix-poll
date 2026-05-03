import { CommunityConfig } from "./types.js"
import { isPinataConfigured, pinJSON, fetchFromIPFS, listPinsByPrefix } from "./pinata.js"

const configs: Map<string, CommunityConfig> = new Map()

export async function loadCommunities(): Promise<void> {
  if (!isPinataConfigured()) {
    console.log("[communities] Pinata not configured — starting with empty store")
    return
  }
  try {
    const [communityPins, pollPins] = await Promise.all([
      listPinsByPrefix("community-"),
      listPinsByPrefix("poll-"),
    ])

    // Build poll lookup: community_id → polls[]
    const pollsByComm = new Map<string, any[]>()
    await Promise.all(pollPins.map(async pin => {
      try {
        const poll = await fetchFromIPFS<any>(pin.cid)
        if (!poll.poll_id || !poll.community_id) return
        const list = pollsByComm.get(poll.community_id) ?? []
        if (!list.find((p: any) => p.poll_id === poll.poll_id)) list.push(poll)
        pollsByComm.set(poll.community_id, list)
      } catch { /* skip bad pin */ }
    }))

    await Promise.all(communityPins.map(async pin => {
      try {
        const config = await fetchFromIPFS<CommunityConfig>(pin.cid)
        if (!config.community_id) return
        const extraPolls = pollsByComm.get(config.community_id) ?? []
        const existingIds = new Set((config.polls ?? []).map(p => p.poll_id))
        config.polls = [
          ...(config.polls ?? []),
          ...extraPolls.filter(p => !existingIds.has(p.poll_id)),
        ]
        configs.set(config.community_id, config)
      } catch { /* skip bad pin */ }
    }))

    console.log(`[communities] Loaded ${configs.size} community config(s) from Pinata`)
  } catch (e: any) {
    console.warn("[communities] Pinata load failed (non-fatal):", e.message)
  }
}

export function getCommunityConfig(communityId: string): CommunityConfig | undefined {
  return configs.get(communityId)
}

export function getAllCommunities(): CommunityConfig[] {
  return Array.from(configs.values())
}

export async function saveCommunityConfig(config: CommunityConfig): Promise<void> {
  configs.set(config.community_id, config)
  if (isPinataConfigured()) {
    try {
      await pinJSON(config, `community-${config.community_id}`)
    } catch (e: any) {
      console.warn("[communities] Pinata upload failed (non-fatal):", e.message)
    }
  }
}
