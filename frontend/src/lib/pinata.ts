// Frontend Pinata client — read-only gateway fetches.
// Uploads are proxied through the verifier server (JWT stays server-side).

import type { CommunityConfig, PollInfo } from '../types'

const GATEWAY    = import.meta.env.VITE_PINATA_GATEWAY as string | undefined
const VERIFIER   = import.meta.env.VITE_VERIFIER_URL  ?? '/api'

function gatewayUrl(cid: string): string {
  if (!GATEWAY) throw new Error('VITE_PINATA_GATEWAY not set')
  return `${GATEWAY}/ipfs/${cid}`
}

// ── Reads (no auth) ───────────────────────────────────────────────────────────

export async function fetchCommunityMetadata(cid: string): Promise<Partial<CommunityConfig>> {
  const res = await fetch(gatewayUrl(cid))
  if (!res.ok) throw new Error(`Pinata fetch failed: ${res.status}`)
  return res.json()
}

export async function fetchPollMetadata(cid: string): Promise<Partial<PollInfo>> {
  const res = await fetch(gatewayUrl(cid))
  if (!res.ok) throw new Error(`Pinata fetch failed: ${res.status}`)
  return res.json()
}

// ── Uploads (proxied through verifier, JWT never in frontend) ────────────────

export async function pinCommunityMetadata(data: Partial<CommunityConfig>): Promise<string> {
  const res = await fetch(`${VERIFIER}/pin/community`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`Pin failed: ${res.status}`)
  const { cid } = await res.json() as { cid: string }
  return cid
}

export async function pinPollMetadata(data: Partial<PollInfo>): Promise<string> {
  const res = await fetch(`${VERIFIER}/pin/poll`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`Pin failed: ${res.status}`)
  const { cid } = await res.json() as { cid: string }
  return cid
}

/** Upload a community logo image. Returns { cid, url }. */
export async function pinImage(file: File): Promise<{ cid: string; url: string }> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${VERIFIER}/pin/image`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`Image pin failed: ${res.status}`)
  return res.json() as Promise<{ cid: string; url: string }>
}
