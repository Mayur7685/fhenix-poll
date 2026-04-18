// Pinata IPFS helpers — uses Pinata v3 Files API (JWT auth).
// All uploads are public IPFS content; returned CID can be fetched by anyone.
//
// Required env vars:
//   PINATA_JWT      — JWT token from app.pinata.cloud → API Keys
//   PINATA_GATEWAY  — your gateway subdomain, e.g. "beige-quiet-bear-123"
//                     (omit "https://" and ".mypinata.cloud")

const PINATA_API = "https://uploads.pinata.cloud/v3/files"

function jwt(): string {
  const t = process.env.PINATA_JWT
  if (!t) throw new Error("PINATA_JWT env var not set")
  return t
}

function gateway(): string {
  const g = process.env.PINATA_GATEWAY
  if (!g) throw new Error("PINATA_GATEWAY env var not set")
  return g
}

export function isPinataConfigured(): boolean {
  return !!(process.env.PINATA_JWT && process.env.PINATA_GATEWAY)
}

/** Upload a JSON object to IPFS via Pinata. Returns the IPFS CID. */
export async function pinJSON(data: unknown, name: string): Promise<string> {
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" })
  const form = new FormData()
  form.append("file", blob, `${name}.json`)
  form.append("name", name)
  form.append("network", "public")

  const res = await fetch(PINATA_API, {
    method:  "POST",
    headers: { Authorization: `Bearer ${jwt()}` },
    body:    form,
  })

  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Pinata upload failed (${res.status}): ${txt}`)
  }

  const json = await res.json() as { data: { cid: string } }
  return json.data.cid
}

/** Fetch a JSON object from IPFS by CID via your Pinata gateway, with public fallback. */
export async function fetchFromIPFS<T>(cid: string): Promise<T> {
  const gw = process.env.PINATA_GATEWAY
  const urls = gw
    ? [`https://${gw}.mypinata.cloud/ipfs/${cid}`, `https://ipfs.io/ipfs/${cid}`]
    : [`https://ipfs.io/ipfs/${cid}`]
  for (const url of urls) {
    try {
      const res = await fetch(url)
      if (res.ok) return res.json() as Promise<T>
    } catch { continue }
  }
  throw new Error(`IPFS fetch failed for ${cid}`)
}

/** Public IPFS URL for a CID via your gateway. */
export function ipfsUrl(cid: string): string {
  return `https://${gateway()}.mypinata.cloud/ipfs/${cid}`
}

/** List latest pinned file per unique name matching a given prefix. */
export async function listPinsByPrefix(prefix: string): Promise<Array<{ name: string; cid: string }>> {
  const res = await fetch(
    `https://api.pinata.cloud/v3/files/public?name=${encodeURIComponent(prefix)}&limit=1000`,
    { headers: { Authorization: `Bearer ${jwt()}` } }
  )
  if (!res.ok) throw new Error(`Pinata list failed (${res.status})`)
  const json = await res.json() as { data: { files: Array<{ name: string; cid: string; created_at: string }> } }
  const files = json.data.files ?? []
  // Sort newest first, deduplicate by name — keep only the latest pin per community
  files.sort((a, b) => b.created_at.localeCompare(a.created_at))
  const seen = new Set<string>()
  return files.filter(f => { if (seen.has(f.name)) return false; seen.add(f.name); return true })
}
export async function unpin(cid: string): Promise<void> {
  try {
    await fetch(`https://api.pinata.cloud/pinning/unpin/${cid}`, {
      method:  "DELETE",
      headers: { Authorization: `Bearer ${jwt()}` },
    })
  } catch { /* best-effort */ }
}
