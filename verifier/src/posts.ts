import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { PostMetadata } from "./types.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const POSTS_DIR = path.join(__dirname, "..", "posts")

const store = new Map<string, PostMetadata>()
// communityId => postId[]
const byComm = new Map<string, string[]>()

export function initPosts(): void {
  if (!fs.existsSync(POSTS_DIR)) fs.mkdirSync(POSTS_DIR, { recursive: true })
  for (const file of fs.readdirSync(POSTS_DIR).filter(f => f.endsWith(".json"))) {
    const post = JSON.parse(fs.readFileSync(path.join(POSTS_DIR, file), "utf-8")) as PostMetadata
    _index(post)
  }
  console.log(`Loaded ${store.size} post(s)`)
}

function _index(post: PostMetadata) {
  store.set(post.post_id, post)
  const list = byComm.get(post.community_id) ?? []
  if (!list.includes(post.post_id)) list.push(post.post_id)
  byComm.set(post.community_id, list)
}

export function savePost(post: PostMetadata): void {
  fs.writeFileSync(path.join(POSTS_DIR, `${post.post_id}.json`), JSON.stringify(post, null, 2))
  _index(post)
}

export function getPost(postId: string): PostMetadata | undefined {
  return store.get(postId)
}

export function getCommunityPosts(communityId: string): PostMetadata[] {
  return (byComm.get(communityId) ?? []).map(id => store.get(id)!).filter(Boolean)
}
