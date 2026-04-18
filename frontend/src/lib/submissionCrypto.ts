// Client-side encryption for vote submissions.
//
// Key derivation: wallet signs a fixed message → HKDF → AES-GCM-256 key.
// The same wallet always produces the same key (ECDSA on secp256k1 is deterministic).
// The key is cached in sessionStorage so the user only signs once per browser session.
//
// The server stores opaque ciphertext and can never read plaintext rankings.

const SESSION_KEY_CACHE  = 'zkpoll:enc-key:v1'
const SESSION_SIG_CACHE  = 'zkpoll:enc-sig:v1'

export type SignFn = (args: { account: `0x${string}`; message: string }) => Promise<`0x${string}`>

export interface KeyBundle { key: CryptoKey; keySignature: string }

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return out
}

/**
 * Derive AES-GCM key + return the wallet signature used as key material.
 * Both are cached in sessionStorage — subsequent calls within the same session
 * cost zero wallet interactions.
 *
 * The keySignature doubles as a server auth proof: the server verifies it once
 * to confirm the caller owns the wallet, then stores only opaque ciphertext.
 */
export async function deriveKey(address: string, signFn: SignFn): Promise<KeyBundle> {
  const message      = `zkpoll-encryption-key:v1:${address.toLowerCase()}`
  const keySignature = await signFn({ account: address as `0x${string}`, message })

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    hexToBytes(keySignature).buffer as ArrayBuffer,
    { name: 'HKDF' },
    false,
    ['deriveKey'],
  )
  const key = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: new TextEncoder().encode('zkpoll-submission-v1'),
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,   // exportable so we can cache it
    ['encrypt', 'decrypt'],
  )

  // Cache in sessionStorage (cleared when browser tab closes)
  const raw = await crypto.subtle.exportKey('raw', key)
  sessionStorage.setItem(SESSION_KEY_CACHE, btoa(String.fromCharCode(...new Uint8Array(raw))))
  sessionStorage.setItem(SESSION_SIG_CACHE, keySignature)

  return { key, keySignature }
}

/**
 * Load the previously-derived key + signature from sessionStorage.
 * Returns null if not cached (user hasn't signed this session yet).
 */
export async function loadCachedBundle(): Promise<KeyBundle | null> {
  const b64 = sessionStorage.getItem(SESSION_KEY_CACHE)
  const sig  = sessionStorage.getItem(SESSION_SIG_CACHE)
  if (!b64 || !sig) return null
  try {
    const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
    return { key, keySignature: sig }
  } catch {
    sessionStorage.removeItem(SESSION_KEY_CACHE)
    sessionStorage.removeItem(SESSION_SIG_CACHE)
    return null
  }
}

/** Encrypt a JSON-serialisable value. Returns a base64 string (12-byte IV prepended). */
export async function encryptJSON(data: unknown, key: CryptoKey): Promise<string> {
  const iv       = crypto.getRandomValues(new Uint8Array(12))
  const encoded  = new TextEncoder().encode(JSON.stringify(data))
  const ct       = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)
  const combined = new Uint8Array(12 + ct.byteLength)
  combined.set(iv)
  combined.set(new Uint8Array(ct), 12)
  return btoa(String.fromCharCode(...combined))
}

/** Decrypt a base64 ciphertext produced by encryptJSON. */
export async function decryptJSON(b64: string, key: CryptoKey): Promise<unknown> {
  const combined = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  const plain    = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: combined.slice(0, 12) },
    key,
    combined.slice(12),
  )
  return JSON.parse(new TextDecoder().decode(plain))
}
