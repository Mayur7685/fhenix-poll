import { pinJSON, isPinataConfigured, listPinsByPrefix, fetchFromIPFS } from "./pinata.js"

/** Server-side record — ciphertext is opaque; server cannot read rankings. */
export interface EncryptedSubmission {
  address:    string
  pollId:     string
  ciphertext: string
}

const cache = new Map<string, EncryptedSubmission[]>()

export function initSubmissions(): void {
  if (isPinataConfigured()) void restoreFromIPFS()
}

async function restoreFromIPFS(): Promise<void> {
  try {
    const pins = await listPinsByPrefix("submission-")
    for (const pin of pins) {
      try {
        const sub = await fetchFromIPFS<EncryptedSubmission>(pin.cid)
        if (!sub.address || !sub.pollId || !sub.ciphertext) continue
        _cache(sub)
      } catch { /* skip */ }
    }
    console.log(`[submissions] IPFS restore done (${pins.length} pin(s) checked)`)
  } catch (e: any) {
    console.warn("[submissions] IPFS restore failed (non-fatal):", e.message)
  }
}

function _cache(sub: EncryptedSubmission): void {
  const addr = sub.address.toLowerCase()
  const existing = cache.get(addr) ?? []
  cache.set(addr, [...existing.filter(s => s.pollId !== sub.pollId), sub])
}

function _slug(pollId: string): string {
  return pollId.replace(/[^a-z0-9]/gi, "_").slice(0, 64)
}

export function saveSubmission(sub: EncryptedSubmission): void {
  const norm = { ...sub, address: sub.address.toLowerCase() }
  _cache(norm)
  if (isPinataConfigured()) {
    void pinJSON(norm, `submission-${norm.address}-${_slug(norm.pollId)}`)
      .catch(e => console.warn("[submissions] pin failed:", e.message))
  }
}

export function getSubmissions(address: string): EncryptedSubmission[] {
  return cache.get(address.toLowerCase()) ?? []
}
