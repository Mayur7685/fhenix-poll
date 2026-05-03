import { PostMetadata } from "./types.js"
import { isPinataConfigured, pinJSON, fetchFromIPFS, listPinsByPrefix } from "./pinata.js"

const store = new Map<string, PostMetadata>()
const byComm = new Map<string, string[]>()

function _index(post: PostMetadata) {
  store.set(post.post_id, post)
  const list = byComm.get(post.community_id) ?? []
  if (!list.includes(post.post_id)) list.push(post.post_id)
  byComm.set(post.community_id, list)
}

export async function initPosts(): Promise<void> {
  if (!isPinataConfigured()) return
  try {
    const pins = await listPinsByPrefix("post-")
    await Promise.all(pins.map(async pin => {
      try {
        const post = await fetchFromIPFS<PostMetadata>(pin.cid)
        if (post.post_id) _index(post)
      } catch { /* skip */ }
    }))
    console.log(`[posts] Loaded ${store.size} post(s) from Pinata`)
  } catch (e: any) {
    console.warn("[posts] Pinata load failed (non-fatal):", e.message)
  }
}

export async function savePost(post: PostMetadata): Promise<void> {
  _index(post)
  if (isPinataConfigured()) {
    try {
      await pinJSON(post, `post-${post.post_id}`)
    } catch (e: any) {
      console.warn("[posts] Pinata upload failed (non-fatal):", e.message)
    }
  }
}

export function getPost(postId: string): PostMetadata | undefined {
  return store.get(postId)
}

export function getCommunityPosts(communityId: string): PostMetadata[] {
  return (byComm.get(communityId) ?? []).map(id => store.get(id)!).filter(Boolean)
}
