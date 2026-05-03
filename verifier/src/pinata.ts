import { PinataSDK } from "pinata"

let _sdk: PinataSDK | null = null

function sdk(): PinataSDK {
  if (!_sdk) {
    const jwt = process.env.PINATA_JWT
    const gateway = process.env.PINATA_GATEWAY
    if (!jwt || !gateway) throw new Error("PINATA_JWT and PINATA_GATEWAY must be set")
    _sdk = new PinataSDK({ pinataJwt: jwt, pinataGateway: `${gateway}.mypinata.cloud` })
  }
  return _sdk
}

export function isPinataConfigured(): boolean {
  return !!(process.env.PINATA_JWT && process.env.PINATA_GATEWAY)
}

/** Upload a JSON object to IPFS. Returns the IPFS CID. */
export async function pinJSON(data: object, name: string): Promise<string> {
  const result = await sdk().upload.public.json(data).name(name)
  return result.cid
}

/** Fetch a JSON object from IPFS by CID. */
export async function fetchFromIPFS<T>(cid: string): Promise<T> {
  const result = await sdk().gateways.public.get(cid)
  return result.data as T
}

/** Public IPFS URL for a CID. */
export async function ipfsUrl(cid: string): Promise<string> {
  return sdk().gateways.public.convert(cid)
}

/** List latest pinned file per unique name matching a given prefix. */
export async function listPinsByPrefix(prefix: string): Promise<Array<{ name: string; cid: string }>> {
  const result = await sdk().files.public.list().name(prefix).limit(1000)
  const files = (result.files ?? []) as Array<{ name: string | null; cid: string; created_at: string }>
  files.sort((a, b) => b.created_at.localeCompare(a.created_at))
  const seen = new Set<string>()
  return files
    .filter(f => {
      const n = f.name ?? ""
      if (seen.has(n)) return false
      seen.add(n)
      return true
    })
    .map(f => ({ name: f.name ?? "", cid: f.cid }))
}
