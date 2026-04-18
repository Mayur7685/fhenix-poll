// Vote submission store — persists encrypted vote submissions server-side.
//
// The client encrypts rankings with a wallet-derived AES-GCM key BEFORE sending.
// The server only ever stores opaque ciphertext — it cannot read what users voted.
//
// Storage: filesystem (submissions/<address>/<pollId>.json) + Pinata IPFS backup.
// On Render, the ephemeral disk is wiped on redeploy; IPFS restore recovers it.

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { pinJSON, isPinataConfigured, listPinsByPrefix, fetchFromIPFS } from "./pinata.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SUBMISSIONS_DIR = path.join(__dirname, "..", "submissions")

/** Server-side record — ciphertext is opaque; server cannot read rankings. */
export interface EncryptedSubmission {
  address:    string   // lowercased
  pollId:     string
  ciphertext: string   // base64 AES-GCM ciphertext from client
}

// In-memory cache: lowercased address → submissions
const cache = new Map<string, EncryptedSubmission[]>()

export function initSubmissions(): void {
  if (!fs.existsSync(SUBMISSIONS_DIR)) fs.mkdirSync(SUBMISSIONS_DIR, { recursive: true })
  if (isPinataConfigured()) void restoreFromIPFS()
}

async function restoreFromIPFS(): Promise<void> {
  try {
    const pins = await listPinsByPrefix("submission-")
    for (const pin of pins) {
      try {
        const sub = await fetchFromIPFS<EncryptedSubmission>(pin.cid)
        if (!sub.address || !sub.pollId || !sub.ciphertext) continue
        _saveToDisk(sub)
      } catch { /* skip */ }
    }
    console.log(`[submissions] IPFS restore done (${pins.length} pin(s) checked)`)
  } catch (e: any) {
    console.warn("[submissions] IPFS restore failed (non-fatal):", e.message)
  }
}

function _safePollSlug(pollId: string): string {
  return pollId.replace(/[^a-z0-9]/gi, "_").slice(0, 64)
}

function _saveToDisk(sub: EncryptedSubmission): void {
  const dir = path.join(SUBMISSIONS_DIR, sub.address.toLowerCase())
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `${_safePollSlug(sub.pollId)}.json`),
    JSON.stringify(sub, null, 2),
  )
}

function _loadFromDisk(address: string): EncryptedSubmission[] {
  const dir = path.join(SUBMISSIONS_DIR, address.toLowerCase())
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .flatMap(f => {
      try { return [JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as EncryptedSubmission] }
      catch { return [] }
    })
}

export function saveSubmission(sub: EncryptedSubmission, shouldPin = true): void {
  const norm: EncryptedSubmission = { ...sub, address: sub.address.toLowerCase() }

  _saveToDisk(norm)

  // Update cache
  const existing = cache.get(norm.address) ?? _loadFromDisk(norm.address)
  cache.set(norm.address, [...existing.filter(s => s.pollId !== norm.pollId), norm])

  if (shouldPin && isPinataConfigured()) {
    const name = `submission-${norm.address}-${_safePollSlug(norm.pollId)}`
    void pinJSON(norm, name).catch(e => console.warn("[submissions] pin failed:", e.message))
  }
}

export function getSubmissions(address: string): EncryptedSubmission[] {
  const addr = address.toLowerCase()
  if (cache.has(addr)) return cache.get(addr)!
  const subs = _loadFromDisk(addr)
  cache.set(addr, subs)
  return subs
}
