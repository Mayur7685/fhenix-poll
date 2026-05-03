import "dotenv/config"
import express, { Request, Response } from "express"
import cors from "cors"
import axios from "axios"
import { evaluateRequirements, calculateVotingWeight } from "./evaluator.js"
import { getCurrentBlockHeight, signAttestation, computeSocialNullifier, getVerifierAddress } from "./issuer.js"
import { loadCommunities, getCommunityConfig, getAllCommunities, saveCommunityConfig } from "./communities.js"
import { pinJSON, isPinataConfigured, ipfsUrl } from "./pinata.js"

import { ConnectedAccount, CommunityConfig, PollInfo, PostMetadata, QuestInfo, QuestProgress } from "./types.js"
import { generateState, consumeState, pkce, popupSuccess, popupError, storeUserToken } from "./oauth.js"
import { verifyTelegramAuth } from "./checkers/social_follow.js"
import { initSubmissions, saveSubmission, getSubmissions } from "./submissions.js"
import { startTallyRunner, manualTally } from "./tally-runner.js"
import { startQuestRunner } from "./quest-runner.js"
import { initPosts, savePost, getPost, getCommunityPosts } from "./posts.js"
import { initQuests, saveQuest, getQuest, getCommunityQuests, saveQuestProgress, getQuestProgress } from "./quests.js"

const app = express()
app.use(cors())
app.use(express.json())

// ─── Health ──────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "fhenixpoll-verifier" })
})

// ─── OAuth — Twitter (X) ─────────────────────────────────────────────────────
// Requires env: TWITTER_CLIENT_ID, TWITTER_CLIENT_SECRET
// Register callback: <APP_URL>/api/auth/twitter/callback   (APP_URL default: http://localhost:5173)

const APP_URL = process.env.APP_URL ?? "http://localhost:5173"

app.get("/auth/twitter", (_req, res) => {
  const clientId = process.env.TWITTER_CLIENT_ID
  if (!clientId) return res.status(500).send(popupError("fhenixpoll-twitter", "TWITTER_CLIENT_ID not configured"))
  const { codeVerifier, codeChallenge } = pkce()
  const state = generateState({ codeVerifier })
  const params = new URLSearchParams({
    response_type:         "code",
    client_id:             clientId,
    redirect_uri:          `${APP_URL}/auth/twitter/callback`,
    scope:                 "tweet.read users.read follows.read",
    state,
    code_challenge:        codeChallenge,
    code_challenge_method: "S256",
  })
  res.redirect(`https://twitter.com/i/oauth2/authorize?${params}`)
})

app.get("/auth/twitter/callback", async (req: Request, res: Response) => {
  const { code, state, error } = req.query as Record<string, string>
  if (error) return res.send(popupError("fhenixpoll-twitter", error))
  const entry = consumeState(state)
  if (!entry) return res.send(popupError("fhenixpoll-twitter", "Invalid or expired OAuth state"))

  try {
    const clientId     = process.env.TWITTER_CLIENT_ID!
    const clientSecret = process.env.TWITTER_CLIENT_SECRET!

    // Twitter OAuth 2.0 token exchange.
    // Confidential clients (Web App type) send credentials as Basic auth.
    // Public clients (Native App type) send client_id in the body only.
    // We try confidential first; fall back to public if 403.
    let tokenData: Record<string, unknown> | null = null

    const body = new URLSearchParams({
      code,
      grant_type:    "authorization_code",
      redirect_uri:  `${APP_URL}/auth/twitter/callback`,
      code_verifier: entry.codeVerifier!,
      client_id:     clientId,
    })

    try {
      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64")
      const r = await axios.post("https://api.twitter.com/2/oauth2/token", body, {
        headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
      })
      tokenData = r.data
    } catch (firstErr: any) {
      const status = firstErr?.response?.status
      console.warn("[oauth/twitter] confidential client exchange failed:", status, firstErr?.response?.data)
      if (status === 403 || status === 401) {
        // Retry as public client (no Basic auth, client_id already in body)
        const r2 = await axios.post("https://api.twitter.com/2/oauth2/token", body, {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        })
        tokenData = r2.data
      } else {
        throw firstErr
      }
    }

    const accessToken = tokenData!.access_token as string
    const expiresIn   = (tokenData!.expires_in as number | undefined) ?? 7200
    const meRes = await axios.get("https://api.twitter.com/2/users/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const { id, username } = meRes.data.data as { id: string; username: string }
    // Store user token + username so twitterapi.io follow checks can use the handle
    storeUserToken('twitter', id, accessToken, expiresIn, username)
    res.send(popupSuccess("fhenixpoll-twitter", { userId: id, username }))
  } catch (e: any) {
    const detail = e?.response?.data
    console.error("[oauth/twitter] final error:", e?.response?.status, detail)
    const msg = detail?.error_description ?? detail?.detail ?? detail?.error ?? e.message ?? "Twitter OAuth failed"
    res.send(popupError("fhenixpoll-twitter", `${msg} (status: ${e?.response?.status ?? 'unknown'})`))
  }
})

// ─── OAuth — Discord ─────────────────────────────────────────────────────────
// Requires env: DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET
// Register callback: <APP_URL>/api/auth/discord/callback

app.get("/auth/discord", (_req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID
  if (!clientId) return res.status(500).send(popupError("fhenixpoll-discord", "DISCORD_CLIENT_ID not configured"))
  const state  = generateState()
  const params = new URLSearchParams({
    response_type: "code",
    client_id:     clientId,
    redirect_uri:  `${APP_URL}/auth/discord/callback`,
    scope:         "identify guilds",   // guilds needed to check server membership via user token
    state,
  })
  res.redirect(`https://discord.com/oauth2/authorize?${params}`)
})

app.get("/auth/discord/callback", async (req: Request, res: Response) => {
  const { code, state, error } = req.query as Record<string, string>
  if (error) return res.send(popupError("fhenixpoll-discord", error))
  if (!consumeState(state)) return res.send(popupError("fhenixpoll-discord", "Invalid or expired OAuth state"))

  try {
    const tokenRes = await axios.post(
      "https://discord.com/api/oauth2/token",
      new URLSearchParams({
        client_id:     process.env.DISCORD_CLIENT_ID!,
        client_secret: process.env.DISCORD_CLIENT_SECRET!,
        grant_type:    "authorization_code",
        code,
        redirect_uri:  `${APP_URL}/auth/discord/callback`,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    )

    const accessToken = tokenRes.data.access_token as string
    const meRes = await axios.get("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const { id, username, discriminator } = meRes.data as { id: string; username: string; discriminator: string }
    const displayName = discriminator && discriminator !== "0" ? `${username}#${discriminator}` : username
    // Store user token so guild membership checks use user context instead of bot
    storeUserToken('discord', id, accessToken, tokenRes.data.expires_in ?? 604800)
    res.send(popupSuccess("fhenixpoll-discord", { userId: id, username: displayName }))
  } catch (e: any) {
    console.error("[oauth/discord]", e?.response?.data ?? e.message)
    res.send(popupError("fhenixpoll-discord", e?.response?.data?.error_description ?? e.message ?? "Discord OAuth failed"))
  }
})

// ─── OAuth — GitHub ──────────────────────────────────────────────────────────
// Requires env: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
// Register callback: <APP_URL>/api/auth/github/callback

app.get("/auth/github", (_req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID
  if (!clientId) return res.status(500).send(popupError("fhenixpoll-github", "GITHUB_CLIENT_ID not configured"))
  const state  = generateState()
  const params = new URLSearchParams({
    client_id:    clientId,
    redirect_uri: `${APP_URL}/auth/github/callback`,
    scope:        "read:user user:email",
    state,
  })
  res.redirect(`https://github.com/login/oauth/authorize?${params}`)
})

app.get("/auth/github/callback", async (req: Request, res: Response) => {
  const { code, state, error } = req.query as Record<string, string>
  if (error) return res.send(popupError("fhenixpoll-github", error))
  if (!consumeState(state)) return res.send(popupError("fhenixpoll-github", "Invalid or expired OAuth state"))

  try {
    const tokenRes = await axios.post(
      "https://github.com/login/oauth/access_token",
      { client_id: process.env.GITHUB_CLIENT_ID!, client_secret: process.env.GITHUB_CLIENT_SECRET!, code },
      { headers: { Accept: "application/json" } },
    )

    const accessToken = tokenRes.data.access_token as string
    const meRes = await axios.get("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" },
    })
    const { login, id } = meRes.data as { login: string; id: number }
    // Key by login (username) so public API calls like GET /users/{username} work
    storeUserToken('github', login, accessToken, 60 * 60 * 24 * 30, login)
    res.send(popupSuccess("fhenixpoll-github", { userId: login, username: login }))
  } catch (e: any) {
    console.error("[oauth/github]", e?.response?.data ?? e.message)
    res.send(popupError("fhenixpoll-github", e?.message ?? "GitHub OAuth failed"))
  }
})

// ─── Telegram Login Widget ───────────────────────────────────────────────────
// Requires env: TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME
// Telegram can't do OAuth in a popup (widget requires page redirect), so we
// redirect the current tab — same approach Guild.xyz uses for Telegram.

app.get("/auth/telegram", (_req, res) => {
  const botUsername = process.env.TELEGRAM_BOT_USERNAME
  if (!botUsername) return res.status(500).send(popupError("fhenixpoll-telegram", "TELEGRAM_BOT_USERNAME not configured"))
  const callbackUrl = `${APP_URL}/auth/telegram/callback`
  res.send(`<!DOCTYPE html><html><head>
<title>Connect Telegram</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f5f5}
.card{background:#fff;border-radius:16px;padding:40px;text-align:center;box-shadow:0 2px 16px rgba(0,0,0,.08)}
h2{margin:0 0 8px;font-size:18px;color:#111}p{color:#666;font-size:14px;margin:0 0 24px}</style>
</head><body><div class="card">
<h2>Connect Telegram</h2>
<p>Click the button below to authenticate with your Telegram account.</p>
<script async src="https://telegram.org/js/telegram-widget.js"
  data-telegram-login="${botUsername}"
  data-size="large"
  data-auth-url="${callbackUrl}"
  data-request-access="write"></script>
</div></body></html>`)
})

app.get("/auth/telegram/callback", (req: Request, res: Response) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) return res.send(popupError("fhenixpoll-telegram", "TELEGRAM_BOT_TOKEN not configured"))

  const data = req.query as Record<string, string>
  const userId = verifyTelegramAuth(data, botToken)
  if (!userId) return res.send(popupError("fhenixpoll-telegram", "Telegram auth verification failed"))

  const username = data.username ?? data.first_name ?? `tg_${userId}`
  res.send(popupSuccess("fhenixpoll-telegram", { userId, username }))
})

// ─── EVM Signature Verification ──────────────────────────────────────────────

// In-memory nonce store: address → { challenge, expiresAt }
const evmChallenges = new Map<string, { challenge: string; expiresAt: number }>()

// GET /auth/evm/challenge?address=0x...
// Returns a signed challenge message for the given EVM address.
app.get("/auth/evm/challenge", (req: Request, res: Response) => {
  const address = (req.query.address as string)?.toLowerCase()
  if (!address || !/^0x[0-9a-f]{40}$/i.test(address)) {
    return res.status(400).json({ error: "Invalid address" })
  }
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36)
  const challenge = `Sign this message to verify your EVM wallet for FhenixPoll.\n\nAddress: ${address}\nNonce: ${nonce}`
  evmChallenges.set(address, { challenge, expiresAt: Date.now() + 5 * 60 * 1000 }) // 5 min TTL
  res.json({ challenge })
})

// POST /auth/evm/verify
// Verifies the signature and confirms the address owns the wallet.
app.post("/auth/evm/verify", async (req: Request, res: Response) => {
  const { address, challenge, signature } = req.body as {
    address: string; challenge: string; signature: string
  }
  if (!address || !challenge || !signature) {
    return res.status(400).json({ error: "Missing address, challenge, or signature" })
  }

  const stored = evmChallenges.get(address.toLowerCase())
  if (!stored || stored.challenge !== challenge) {
    return res.status(400).json({ error: "Invalid or expired challenge" })
  }
  if (Date.now() > stored.expiresAt) {
    evmChallenges.delete(address.toLowerCase())
    return res.status(400).json({ error: "Challenge expired" })
  }

  try {
    // Recover signer from personal_sign (EIP-191 prefixed hash)
    const { ethers } = await import("ethers")
    const recovered = ethers.verifyMessage(challenge, signature)
    const verified = recovered.toLowerCase() === address.toLowerCase()
    if (verified) evmChallenges.delete(address.toLowerCase())
    res.json({ verified })
  } catch (e: any) {
    res.status(400).json({ error: "Signature verification failed", detail: e.message })
  }
})

// ─── Communities ──────────────────────────────────────────────────────────────

function serializeCommunity(c: CommunityConfig) {
  return {
    community_id:           c.community_id,
    name:                   c.name,
    description:            c.description,
    logo:                   c.logo,
    credential_type:        c.credential_type,
    credential_expiry_days: c.credential_expiry_days,
    requirement_groups:     c.requirement_groups,
    polls:                  c.polls ?? [],   // ← include polls in every response
  }
}

// GET /communities — list all communities (for frontend browse)
app.get("/communities", (_req, res) => {
  res.json(getAllCommunities().map(serializeCommunity))
})

// GET /communities/:id — get a single community config
app.get("/communities/:id", (req, res) => {
  const community = getCommunityConfig(req.params.id)
  if (!community) return res.status(404).json({ error: "Community not found" })
  res.json(serializeCommunity(community))
})

// POST /communities — create a new community (called from CreateCommunityWizard)
app.post("/communities", async (req: Request, res: Response) => {
  const config = req.body as CommunityConfig
  if (!config.community_id || !config.name || !config.requirement_groups) {
    return res.status(400).json({ error: "Missing required fields" })
  }

  // Pin community metadata to IPFS for decentralised discoverability (best-effort)
  let ipfs_cid: string | undefined
  if (isPinataConfigured()) {
    try {
      ipfs_cid = await pinJSON(config, `community-${config.community_id}`)
      console.log(`Community ${config.community_id} pinned to IPFS: ${ipfs_cid}`)
    } catch (e: any) {
      console.warn("Pinata upload failed (non-fatal):", e.message)
    }
  }

  saveCommunityConfig(config)
  // On-chain register_community is called by the user's wallet in the frontend (Option A).
  res.status(201).json({ community_id: config.community_id, ipfs_cid })
})

// POST /communities/:id/polls — register a poll created on-chain
app.post("/communities/:id/polls", async (req: Request, res: Response) => {
  const community = getCommunityConfig(req.params.id)
  if (!community) return res.status(404).json({ error: "Community not found" })
  const poll = req.body as PollInfo
  if (!poll.poll_id || !poll.title) {
    return res.status(400).json({ error: "Missing poll_id or title" })
  }

  // Enforce creator-only poll registration
  if (!poll.creator_address) {
    return res.status(400).json({ error: "Missing creator_address" })
  }
  if (community.creator && community.creator !== poll.creator_address) {
    return res.status(403).json({ error: "Only the community creator can create polls" })
  }

  // Pin full poll metadata to IPFS — includes options + description (best-effort)
  if (isPinataConfigured() && !poll.ipfs_cid) {
    try {
      poll.ipfs_cid = await pinJSON(
        { ...poll, community_id: community.community_id, community_name: community.name },
        `poll-${poll.poll_id}`,
      )
      console.log(`Poll ${poll.poll_id} pinned to IPFS: ${poll.ipfs_cid}`)
    } catch (e: any) {
      console.warn("Pinata poll upload failed (non-fatal):", e.message)
    }
  }

  community.polls = [...(community.polls ?? []), poll]
  saveCommunityConfig(community)
  // On-chain create_poll is called by the user's wallet in the frontend (Option A).
  res.status(201).json({ poll_id: poll.poll_id, ipfs_cid: poll.ipfs_cid })
})

// ─── Pinata upload routes (JWT stays server-side) ────────────────────────────

// POST /pin/community — called by frontend CreateCommunityWizard BEFORE registerCommunity().
// IPFS pin only — does NOT write to local store (tx may still fail).
// Frontend calls POST /communities/confirm after tx confirms.
app.post("/pin/community", async (req: Request, res: Response) => {
  const config = req.body as CommunityConfig
  if (!config.community_id || !config.name) {
    return res.status(400).json({ error: "Missing community_id or name" })
  }

  let cid: string | undefined
  if (isPinataConfigured()) {
    try {
      cid = await pinJSON(config, `community-${config.community_id}`)
      console.log(`[pin] Community ${config.community_id} → IPFS ${cid}`)
    } catch (e: any) {
      console.warn("[pin] Pinata upload failed (non-fatal):", e.message)
    }
  }

  res.json({ cid: cid ?? "" })
})

// POST /communities/confirm — called by frontend AFTER registerCommunity() tx confirms.
// Persists community to local store so GET /communities returns it.
app.post("/communities/confirm", (req: Request, res: Response) => {
  const config = req.body as CommunityConfig
  if (!config.community_id || !config.name) {
    return res.status(400).json({ error: "Missing community_id or name" })
  }
  saveCommunityConfig({ ...config, polls: config.polls ?? [] })
  console.log(`[confirm] Community ${config.community_id} saved to local store`)
  res.json({ ok: true })
})

// POST /pin/poll — called by frontend CreatePollWizard before createPoll().
// Pins metadata to IPFS and registers poll in the community's local store.
app.post("/pin/poll", async (req: Request, res: Response) => {
  const poll = req.body as PollInfo & { community_id?: string }
  if (!poll.poll_id || !poll.title) {
    return res.status(400).json({ error: "Missing poll_id or title" })
  }

  let cid: string | undefined
  if (isPinataConfigured()) {
    try {
      cid = await pinJSON(poll, `poll-${poll.poll_id}`)
      console.log(`[pin] Poll ${poll.poll_id} → IPFS ${cid}`)
    } catch (e: any) {
      console.warn("[pin] Pinata poll upload failed (non-fatal):", e.message)
    }
  }

  // NOTE: poll is NOT saved to local store here — tx may still fail.
  // Frontend calls POST /polls/confirm after tx confirms.
  res.json({ cid: cid ?? "" })
})

// POST /polls/confirm — called by frontend AFTER createPoll() tx confirms.
// Persists poll to its community's local store so GET /communities/:id returns it.
app.post("/polls/confirm", (req: Request, res: Response) => {
  const poll = req.body as PollInfo & { community_id?: string }
  if (!poll.poll_id || !poll.title) {
    return res.status(400).json({ error: "Missing poll_id or title" })
  }
  const communityId = poll.community_id ?? (poll as any).communityId
  if (!communityId) return res.status(400).json({ error: "Missing community_id" })

  const community = getCommunityConfig(communityId)
  if (!community) return res.status(404).json({ error: "Community not found" })

  const existing = community.polls ?? []
  if (!existing.find(p => p.poll_id === poll.poll_id)) {
    community.polls = [...existing, poll]
    saveCommunityConfig(community)
  }
  console.log(`[confirm] Poll ${poll.poll_id} saved to community ${communityId}`)
  res.json({ ok: true })
})

// POST /pin/image — multipart image upload (community logo)
// Uses express's built-in JSON but for multipart we read raw body
app.post("/pin/image", async (req: Request, res: Response) => {
  if (!isPinataConfigured()) return res.status(503).json({ error: "Pinata not configured" })
  // Forward the multipart request to Pinata directly
  try {
    const PINATA_API = "https://uploads.pinata.cloud/v3/files"
    const jwt = process.env.PINATA_JWT
    if (!jwt) return res.status(500).json({ error: "PINATA_JWT not set" })

    // Stream the incoming multipart form to Pinata
    const upRes = await fetch(PINATA_API, {
      method:  "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        ...Object.fromEntries(
          Object.entries(req.headers).filter(([k]) =>
            ["content-type", "content-length"].includes(k)
          )
        ),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body: req as any,
    })
    if (!upRes.ok) {
      const txt = await upRes.text()
      return res.status(502).json({ error: "Pinata upload failed", detail: txt })
    }
    const json = await upRes.json() as { data: { cid: string } }
    const cid  = json.data.cid
    res.json({ cid, url: ipfsUrl(cid) })
  } catch (e: any) {
    res.status(500).json({ error: "Image pin failed", detail: e.message })
  }
})

// ─── Requirement Verification ─────────────────────────────────────────────────

// POST /verify/check — check requirements only, no on-chain action
// Returns { passed, results } — use this to show requirement status in UI
app.post("/verify/check", async (req: Request, res: Response) => {
  const { communityId, evmAddress, connectedAccounts } = req.body as {
    communityId:       string
    evmAddress:        string
    connectedAccounts: ConnectedAccount[]
  }

  if (!communityId || !evmAddress) {
    return res.status(400).json({ error: "Missing communityId or evmAddress" })
  }

  const community = getCommunityConfig(communityId)
  if (!community) return res.status(404).json({ error: "Community not found" })

  const { passed, results } = await evaluateRequirements(
    community.requirement_groups,
    connectedAccounts ?? [],
  )

  res.json({ passed, results })
})

// POST /verify/credential-params — verify requirements, sign EIP-712 attestation.
// User calls issueCredential(attestation, signature) directly on the contract.
app.post("/verify/credential-params", async (req: Request, res: Response) => {
  const { communityId, evmAddress, connectedAccounts } = req.body as {
    communityId:       string
    evmAddress:        string
    connectedAccounts: ConnectedAccount[]
  }

  if (!communityId || !evmAddress) {
    return res.status(400).json({ error: "Missing communityId or evmAddress" })
  }

  const community = getCommunityConfig(communityId)
  if (!community) return res.status(404).json({ error: "Community not found" })

  const { passed, results } = await evaluateRequirements(
    community.requirement_groups,
    connectedAccounts ?? [],
  )

  if (!passed) {
    return res.status(403).json({ error: "Requirements not met", results })
  }

  try {
    const currentBlock = await getCurrentBlockHeight()
    // Arbitrum Sepolia: block.number = L1 Ethereum Sepolia (~12s) → 7200 blocks/day
    const expiryBlock = currentBlock + community.credential_expiry_days * 7_200
    // Raw EV is on a 1–100 display scale; contract uses 0–1_000_000 (1_000_000 = 100%).
    // Multiply by 10_000 to convert: EV 1 → 10_000, EV 100 → 1_000_000.
    // Cap at 1_000_000 so multi-requirement credentials don't exceed the max uint64 range.
    const rawEv        = calculateVotingWeight(community.requirement_groups, results)
    const scaledWeight = Math.min(rawEv * 10_000, 1_000_000)

    if (expiryBlock <= currentBlock) {
      return res.status(500).json({
        error: "Computed expiryBlock not in future",
        currentBlock, expiryBlock,
      })
    }

    // Derive social nullifier from the highest-priority connected social account
    const socialAccount = connectedAccounts.find(a =>
      ["X_TWITTER", "DISCORD", "GITHUB", "TELEGRAM"].includes(a.type)
    )
    const nullifier = computeSocialNullifier(
      socialAccount?.type ?? "EVM_WALLET",
      socialAccount?.identifier ?? evmAddress,
      communityId,
    )

    const attestation = {
      recipient:    evmAddress as `0x${string}`,
      communityId:  communityId as `0x${string}`,
      nullifier,
      credType:     community.credential_type,
      votingWeight: BigInt(scaledWeight),
      expiryBlock,
      issuedAt:     currentBlock,
      nonce:        BigInt(Date.now()),
    }

    const signature = await signAttestation(attestation)

    // BigInt fields must be serialised as strings — JSON.stringify can't handle BigInt
    res.json({
      passed: true,
      results,
      attestation: {
        ...attestation,
        votingWeight: attestation.votingWeight.toString(),
        nonce:        attestation.nonce.toString(),
      },
      signature,
    })
  } catch (e: any) {
    console.error("Attestation signing failed:", e)
    res.status(500).json({ error: "Failed to sign credential attestation", detail: e.message })
  }
})

// GET /verifier-address — returns verifier EVM address for contract registration check
app.get("/verifier-address", (_req, res) => {
  try {
    res.json({ address: getVerifierAddress() })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// DELETE /communities/:id/polls/:pollId — remove a poll from community (admin only)
// Protected by ADMIN_SECRET env var
app.delete("/communities/:id/polls/:pollId", (req: Request, res: Response) => {
  const secret = process.env.ADMIN_SECRET
  if (!secret || req.headers['x-admin-secret'] !== secret) {
    return res.status(401).json({ error: "Unauthorized" })
  }
  const community = getCommunityConfig(req.params.id)
  if (!community) return res.status(404).json({ error: "Community not found" })
  const before = (community.polls ?? []).length
  community.polls = (community.polls ?? []).filter(p => p.poll_id !== req.params.pollId)
  if (community.polls.length === before) return res.status(404).json({ error: "Poll not found" })
  saveCommunityConfig(community)
  res.json({ ok: true, removed: req.params.pollId })
})

// ─── Admin: manual tally trigger ─────────────────────────────────────────────
// POST /admin/tally/:pollId — force-run the tally flow for a specific poll.
// Requires ADMIN_SECRET header.

app.post("/admin/tally/:pollId", async (req: Request, res: Response) => {
  if (req.headers["x-admin-secret"] !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: "Forbidden" })
  }
  const { pollId } = req.params
  if (!pollId) return res.status(400).json({ error: "pollId required" })
  try {
    await manualTally(pollId)
    res.json({ ok: true, pollId })
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message })
  }
})

// ─── Vote Submissions ─────────────────────────────────────────────────────────
// Store which options each voter ranked so My Votes can show "My Submission".
// FHE encrypts the weights on-chain; option labels/ranks are not secret.

// POST /submissions — save an encrypted vote submission.
// The client encrypts rankings client-side with a wallet-derived AES key; server stores opaque ciphertext.
// Auth: keySignature = personal_sign("zkpoll-encryption-key:v1:<address>") — same sig used for key
// derivation on the client, so no extra wallet interaction is required beyond the key-derivation step.
app.post("/submissions", async (req: Request, res: Response) => {
  const { address, pollId, ciphertext, keySignature } = req.body as {
    address:      string
    pollId:       string
    ciphertext:   string   // opaque AES-GCM ciphertext — server cannot read rankings
    keySignature: string   // personal_sign("zkpoll-encryption-key:v1:<address>") by wallet owner
  }

  if (!address || !pollId || !ciphertext || !keySignature) {
    return res.status(400).json({ error: "Missing required fields" })
  }
  if (!/^0x[0-9a-f]{40}$/i.test(address)) {
    return res.status(400).json({ error: "Invalid address" })
  }

  // Verify keySignature — same message the client signs to derive the AES key
  const message = `zkpoll-encryption-key:v1:${address.toLowerCase()}`
  try {
    const { ethers } = await import("ethers")
    const recovered = ethers.verifyMessage(message, keySignature)
    if (recovered.toLowerCase() !== address.toLowerCase()) {
      return res.status(401).json({ error: "Signature address mismatch" })
    }
  } catch (e: any) {
    return res.status(401).json({ error: "Invalid signature", detail: e.message })
  }

  saveSubmission({ address, pollId, ciphertext })
  res.json({ ok: true })
})

// GET /submissions/:address — fetch all submissions for an address (open read)
app.get("/submissions/:address", (req: Request, res: Response) => {
  const { address } = req.params
  if (!/^0x[0-9a-f]{40}$/i.test(address)) {
    return res.status(400).json({ error: "Invalid address" })
  }
  res.json(getSubmissions(address))
})

// ─── Wave 4: Posts ────────────────────────────────────────────────────────────

// POST /pin/post — pin post content to IPFS, return CID + content_hash
app.post("/pin/post", async (req: Request, res: Response) => {
  const post = req.body as PostMetadata
  if (!post.post_id || !post.community_id || !post.author || !post.title) {
    return res.status(400).json({ error: "Missing required fields" })
  }

  let cid: string | undefined
  if (isPinataConfigured()) {
    try {
      cid = await pinJSON(post, `post-${post.post_id}`)
    } catch (e: any) {
      console.warn("[pin/post] Pinata failed (non-fatal):", e.message)
    }
  }

  res.json({ cid: cid ?? "" })
})

// POST /posts/confirm — called after createPost() tx confirms
app.post("/posts/confirm", (req: Request, res: Response) => {
  const post = req.body as PostMetadata
  if (!post.post_id || !post.community_id || !post.author) {
    return res.status(400).json({ error: "Missing required fields" })
  }
  savePost(post)
  res.json({ ok: true })
})

// GET /communities/:id/posts — list posts for a community
app.get("/communities/:id/posts", (req: Request, res: Response) => {
  const posts = getCommunityPosts(req.params.id)
  res.json(posts)
})

// GET /posts/:postId — get a single post
app.get("/posts/:postId", (req: Request, res: Response) => {
  const post = getPost(req.params.postId)
  if (!post) return res.status(404).json({ error: "Post not found" })
  res.json(post)
})

// ─── Wave 4: Quests ───────────────────────────────────────────────────────────

// POST /pin/quest — pin quest metadata to IPFS
app.post("/pin/quest", async (req: Request, res: Response) => {
  const quest = req.body as QuestInfo
  if (!quest.quest_id || !quest.community_id || !quest.title) {
    return res.status(400).json({ error: "Missing required fields" })
  }

  let cid: string | undefined
  if (isPinataConfigured()) {
    try {
      cid = await pinJSON(quest, `quest-${quest.quest_id}`)
    } catch (e: any) {
      console.warn("[pin/quest] Pinata failed (non-fatal):", e.message)
    }
  }

  res.json({ cid: cid ?? "" })
})

// POST /quests/confirm — called after createQuest() tx confirms
app.post("/quests/confirm", (req: Request, res: Response) => {
  const quest = req.body as QuestInfo
  if (!quest.quest_id || !quest.community_id) {
    return res.status(400).json({ error: "Missing required fields" })
  }
  saveQuest(quest)
  res.json({ ok: true })
})

// GET /communities/:id/quests — list quests for a community
app.get("/communities/:id/quests", (req: Request, res: Response) => {
  const quests = getCommunityQuests(req.params.id)
  res.json(quests)
})

// GET /quests/:questId — get a single quest
app.get("/quests/:questId", (req: Request, res: Response) => {
  const quest = getQuest(req.params.questId)
  if (!quest) return res.status(404).json({ error: "Quest not found" })
  res.json(quest)
})

// GET /quests/:questId/progress/:address — get quest progress for a participant
app.get("/quests/:questId/progress/:address", (req: Request, res: Response) => {
  const progress = getQuestProgress(req.params.questId, req.params.address)
  res.json(progress ?? { quest_id: req.params.questId, participant: req.params.address, progress: 0, completed: false })
})

// POST /quests/:questId/progress — update quest progress (verifier-only, called by tally runner or admin)
// This records off-chain progress; on-chain FHE progress is recorded via recordQuestProgress()
app.post("/quests/:questId/progress", async (req: Request, res: Response) => {
  const secret = process.env.ADMIN_SECRET
  if (!secret || req.headers["x-admin-secret"] !== secret) {
    return res.status(401).json({ error: "Unauthorized" })
  }
  const { participant, progress, completed } = req.body as {
    participant: string
    progress: number
    completed: boolean
  }
  if (!participant || progress === undefined) {
    return res.status(400).json({ error: "Missing participant or progress" })
  }
  saveQuestProgress({ quest_id: req.params.questId, participant, progress, completed: completed ?? false })
  res.json({ ok: true })
})

// ─── Wave 4: Posts ────────────────────────────────────────────────────────────

app.post("/pin/post", async (req: Request, res: Response) => {
  const post = req.body as PostMetadata
  if (!post.post_id || !post.community_id || !post.author || !post.title) {
    return res.status(400).json({ error: "Missing required fields" })
  }
  let cid: string | undefined
  if (isPinataConfigured()) {
    try { cid = await pinJSON(post, `post-${post.post_id}`) } catch (e: any) { /* non-fatal */ }
  }
  res.json({ cid: cid ?? "" })
})

app.post("/posts/confirm", (req: Request, res: Response) => {
  const post = req.body as PostMetadata
  if (!post.post_id || !post.community_id || !post.author) {
    return res.status(400).json({ error: "Missing required fields" })
  }
  savePost(post)
  res.json({ ok: true })
})

app.get("/communities/:id/posts", (req: Request, res: Response) => {
  res.json(getCommunityPosts(req.params.id))
})

app.get("/posts/:postId", (req: Request, res: Response) => {
  const post = getPost(req.params.postId)
  if (!post) return res.status(404).json({ error: "Post not found" })
  res.json(post)
})

// ─── Wave 4: Quests ───────────────────────────────────────────────────────────

app.post("/pin/quest", async (req: Request, res: Response) => {
  const quest = req.body as QuestInfo
  if (!quest.quest_id || !quest.community_id || !quest.title) {
    return res.status(400).json({ error: "Missing required fields" })
  }
  let cid: string | undefined
  if (isPinataConfigured()) {
    try { cid = await pinJSON(quest, `quest-${quest.quest_id}`) } catch (e: any) { /* non-fatal */ }
  }
  res.json({ cid: cid ?? "" })
})

app.post("/quests/confirm", (req: Request, res: Response) => {
  const quest = req.body as QuestInfo
  if (!quest.quest_id || !quest.community_id) {
    return res.status(400).json({ error: "Missing required fields" })
  }
  saveQuest(quest)
  res.json({ ok: true })
})

app.get("/communities/:id/quests", (req: Request, res: Response) => {
  res.json(getCommunityQuests(req.params.id))
})

app.get("/quests/:questId", (req: Request, res: Response) => {
  const quest = getQuest(req.params.questId)
  if (!quest) return res.status(404).json({ error: "Quest not found" })
  res.json(quest)
})

app.get("/quests/:questId/progress/:address", (req: Request, res: Response) => {
  const p = getQuestProgress(req.params.questId, req.params.address)
  res.json(p ?? { quest_id: req.params.questId, participant: req.params.address, progress: 0, completed: false })
})

// Admin: update quest progress off-chain (on-chain FHE progress via recordQuestProgress)
app.post("/quests/:questId/progress", (req: Request, res: Response) => {
  if (req.headers["x-admin-secret"] !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: "Unauthorized" })
  }
  const { participant, progress, completed } = req.body as QuestProgress
  if (!participant || progress === undefined) {
    return res.status(400).json({ error: "Missing participant or progress" })
  }
  saveQuestProgress({ quest_id: req.params.questId, participant, progress, completed: completed ?? false })
  res.json({ ok: true })
})

// ─── Start ────────────────────────────────────────────────────────────────────

loadCommunities()
initSubmissions()
initPosts()
initQuests()
void startTallyRunner()
void startQuestRunner()

const PORT = Number(process.env.PORT ?? 3001)
app.listen(PORT, () => {
  console.log(`FhenixPoll verifier running on http://localhost:${PORT}`)
})
