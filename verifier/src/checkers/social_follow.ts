import axios from "axios"
import crypto from "crypto"

/**
 * Check whether a Twitter/X user follows a given handle.
 *
 * Uses twitterapi.io /twitter/user/check_follow_relationship (free tier friendly).
 * Falls back to the official API bearer token if TWITTERAPI_IO_KEY is not set.
 *
 * @param followerUsername  The authenticated user's Twitter handle (without @)
 * @param targetHandle      The handle they should be following (with or without @)
 */
export async function checkXFollow(
  followerUsername: string,
  targetHandle: string,
): Promise<boolean> {
  const apiKey  = process.env.TWITTERAPI_IO_KEY
  const follower = followerUsername.replace("@", "").toLowerCase()
  const target   = targetHandle.replace("@", "").toLowerCase()

  console.debug(`[checkXFollow] follower=${follower} target=${target} apiKey=${!!apiKey}`)

  if (!follower) {
    throw new Error("Twitter account not connected — connect your X account first")
  }

  if (!apiKey) {
    throw new Error("TWITTERAPI_IO_KEY not set in verifier .env")
  }

  // Single call — check_follow_relationship returns { data: { following, followed_by } }
  let res: any
  try {
    res = await axios.get("https://api.twitterapi.io/twitter/user/check_follow_relationship", {
      headers: { "X-API-Key": apiKey },
      params:  { source_user_name: follower, target_user_name: target },
    })
  } catch (err: any) {
    console.error("[checkXFollow] twitterapi.io error:", err?.response?.status, err?.response?.data)
    throw new Error(
      `twitterapi.io error ${err?.response?.status}: ${JSON.stringify(err?.response?.data ?? err.message)}`
    )
  }

  console.debug("[checkXFollow] twitterapi.io response:", JSON.stringify(res.data))
  // Response: { status: "success", data: { following: bool, followed_by: bool } }
  return res.data?.data?.following === true
}

/**
 * Check whether a user is a member of a Discord server.
 *
 * Prefers `userToken` (user-context — uses GET /users/@me/guilds, no bot needed).
 * Falls back to bot token (GET /guilds/{id}/members/{userId} — bot must be in the server).
 */
export async function checkDiscordMember(
  userId: string,
  serverId: string,
  botToken: string,
  userToken?: string | null,
): Promise<boolean> {
  if (userToken) {
    // User context: fetch the list of guilds the user belongs to
    try {
      const res = await axios.get("https://discord.com/api/v10/users/@me/guilds", {
        headers: { Authorization: `Bearer ${userToken}` },
      })
      return (res.data as { id: string }[]).some(g => g.id === serverId)
    } catch {
      // Fall through to bot method
    }
  }

  // Bot context: bot must be in the server + have GUILD_MEMBERS intent
  try {
    await axios.get(
      `https://discord.com/api/v10/guilds/${serverId}/members/${userId}`,
      { headers: { Authorization: `Bot ${botToken}` } },
    )
    return true
  } catch {
    return false
  }
}

/**
 * Check whether a user has a specific role in a Discord server.
 * Uses bot token (needs bot in server with GUILD_MEMBERS intent).
 * With user token: we only get the guild list, not role details — bot is required for roles.
 */
export async function checkDiscordRole(
  userId: string,
  serverId: string,
  roleId: string,
  botToken: string,
): Promise<boolean> {
  try {
    const res = await axios.get(
      `https://discord.com/api/v10/guilds/${serverId}/members/${userId}`,
      { headers: { Authorization: `Bot ${botToken}` } },
    )
    return (res.data.roles as string[]).includes(roleId)
  } catch {
    return false
  }
}

/**
 * Verify a Telegram Login Widget auth payload.
 * The auth data is passed as query params after the user authenticates with the widget.
 * Returns the Telegram user ID (string) if valid, or null.
 *
 * Telegram auth data format:
 *   { id, first_name, last_name?, username?, photo_url?, auth_date, hash }
 */
export function verifyTelegramAuth(
  data: Record<string, string>,
  botToken: string,
): string | null {
  const { hash, ...rest } = data
  if (!hash) return null

  // Auth must be recent (< 1 day)
  const authDate = parseInt(rest.auth_date ?? '0', 10)
  if (Date.now() / 1000 - authDate > 86400) return null

  const dataCheckString = Object.keys(rest)
    .sort()
    .map(k => `${k}=${rest[k]}`)
    .join('\n')

  const secretKey = crypto.createHash('sha256').update(botToken).digest()
  const expectedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex')

  if (expectedHash !== hash) return null
  return rest.id ?? null
}

/** Check if a Telegram user is a member of a channel/group (bot must be admin). */
export async function checkTelegramMember(
  userId: string,
  chatId: string,
  botToken: string,
): Promise<boolean> {
  if (!userId || !chatId) return false
  try {
    const res = await axios.get(
      `https://api.telegram.org/bot${botToken}/getChatMember`,
      { params: { chat_id: chatId, user_id: userId } },
    )
    const status = (res.data?.result?.status as string) ?? ''
    return ['member', 'administrator', 'creator'].includes(status)
  } catch {
    return false
  }
}
