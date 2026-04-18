// OAuth state management + shared popup-close HTML helper.
//
// Each OAuth flow:
//   1. /auth/{provider}       → generates state, redirects to provider
//   2. /auth/{provider}/callback → exchanges code, fetches user, returns popup HTML
//
// The popup HTML uses BroadcastChannel (same pattern as Guild.xyz) to send the
// result back to the opener. BroadcastChannel is same-origin so it works
// reliably without any origin checks — the main window listens on the same
// named channel and resolves the promise when a message arrives.

import crypto from 'crypto'

interface StateEntry {
  ts:            number
  codeVerifier?: string   // Twitter PKCE
}

// ─── Per-user token store ─────────────────────────────────────────────────────
// Stores the OAuth access token obtained during login, keyed by platform:userId.
// Used so requirement checkers can use the user's own token (user context) instead
// of the app's bearer token — required for Twitter free-tier follow checks and
// Discord member checks without a bot in every server.
// TTL = 2 hours (typical OAuth token lifetime). Lost on restart (acceptable).

interface TokenEntry {
  token:     string
  username?: string   // platform username, stored alongside token for API calls that need it
  expiresAt: number
}

const _tokens = new Map<string, TokenEntry>()

export function storeUserToken(
  platform: string,
  userId: string,
  token: string,
  expiresInSecs = 7200,
  username?: string,
) {
  _tokens.set(`${platform}:${userId}`, { token, username, expiresAt: Date.now() + expiresInSecs * 1000 })
}

export function getUserToken(platform: string, userId: string): string | null {
  const entry = _tokens.get(`${platform}:${userId}`)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) { _tokens.delete(`${platform}:${userId}`); return null }
  return entry.token
}

export function getUserMeta(platform: string, userId: string): { username?: string } | null {
  const entry = _tokens.get(`${platform}:${userId}`)
  if (!entry || Date.now() > entry.expiresAt) return null
  return { username: entry.username }
}

const _states = new Map<string, StateEntry>()

/** Generate a random state token and stash it for validation. */
export function generateState(extra?: Pick<StateEntry, 'codeVerifier'>): string {
  const state = crypto.randomBytes(16).toString('hex')
  _states.set(state, { ts: Date.now(), ...extra })
  return state
}

/** Validate + consume a state token. Returns the entry or null if invalid/expired. */
export function consumeState(state: string): StateEntry | null {
  const entry = _states.get(state)
  if (!entry) return null
  _states.delete(state)
  if (Date.now() - entry.ts > 10 * 60 * 1000) return null  // 10 min TTL
  return entry
}

/** PKCE helpers (Twitter OAuth 2.0 requires PKCE). */
export function pkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier  = crypto.randomBytes(32).toString('base64url')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
  return { codeVerifier, codeChallenge }
}

/**
 * Returns an HTML page that broadcasts the OAuth result via BroadcastChannel
 * and closes the popup. The channel name is "zkpoll-{provider}" — the main
 * window creates the same channel and listens for the message.
 *
 * BroadcastChannel is same-origin (works because the callback comes back
 * through the Vite proxy in dev, so it appears as localhost:5173 to the browser).
 */
export function popupSuccess(
  channelName: string,
  data: Record<string, string>,
): string {
  const payload = JSON.stringify({ status: 'success', channel: channelName, ...data })
  return `<!DOCTYPE html><html><head><title>Connected</title></head><body>
<p style="font-family:sans-serif;text-align:center;padding:48px 24px;color:#555;font-size:15px">
  Connected! Closing…</p>
<script>
  const payload = ${payload}
  // Cross-origin: use postMessage to opener (works across domains)
  if (window.opener) { window.opener.postMessage(payload, '*') }
  // Same-origin fallback: BroadcastChannel
  try { const ch = new BroadcastChannel(${JSON.stringify(channelName)}); ch.postMessage(payload); setTimeout(() => ch.close(), 500) } catch(_) {}
  setTimeout(() => window.close(), 500)
</script></body></html>`
}

export function popupError(channelName: string, message: string): string {
  const payload = JSON.stringify({ status: 'error', channel: channelName, message })
  const safe = message.replace(/</g, '&lt;')
  return `<!DOCTYPE html><html><head><title>Error</title></head><body>
<p style="font-family:sans-serif;text-align:center;padding:48px 24px;color:#c00;font-size:15px">
  ${safe}</p>
<script>
  const payload = ${payload}
  if (window.opener) { window.opener.postMessage(payload, '*') }
  try { const ch = new BroadcastChannel(${JSON.stringify(channelName)}); ch.postMessage(payload); setTimeout(() => ch.close(), 500) } catch(_) {}
  setTimeout(() => window.close(), 3000)
</script></body></html>`
}
