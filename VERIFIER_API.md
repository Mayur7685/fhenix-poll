# ZKPoll Verifier API Reference

The verifier is a Node.js/Express backend that handles off-chain requirement verification, community/poll registry, OAuth flows, and the automated FHE tally engine. It never holds user funds; private keys are only used for EIP-712 attestation signing and tally transaction submission.

**Base URL (local):** `http://localhost:3001`

---

## Table of Contents

1. [Health](#1-health)
2. [OAuth — Twitter/X](#2-oauth--twitterx)
3. [OAuth — Discord](#3-oauth--discord)
4. [OAuth — GitHub](#4-oauth--github)
5. [OAuth — Telegram](#5-oauth--telegram)
6. [EVM Wallet Verification](#6-evm-wallet-verification)
7. [Communities](#7-communities)
8. [Polls](#8-polls)
9. [Requirement Verification](#9-requirement-verification)
10. [Tally](#10-tally)

---

## 1. Health

### `GET /health`

**Response:**
```json
{ "status": "ok", "service": "zkpoll-verifier" }
```

---

## 2. OAuth — Twitter/X

Used for `X_FOLLOW` requirement type. Opens a popup OAuth flow.

### `GET /auth/twitter`

Redirects to Twitter OAuth 2.0 authorization page.

**Env required:** `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET`

**Flow:**
1. Frontend opens `GET /auth/twitter` in a popup window
2. User authorizes on Twitter
3. Twitter redirects to `/auth/twitter/callback`
4. Callback sends result via `window.opener.postMessage` + `BroadcastChannel` fallback
5. Frontend receives the message and stores the connected account

**Note:** `APP_URL` env var must be set to the verifier's own URL, not the frontend URL.

---

### `GET /auth/twitter/callback`

Exchanges code for access token, fetches user profile, broadcasts result.

**Success message:**
```json
{ "status": "success", "channel": "zkpoll-twitter", "userId": "123456", "username": "handle" }
```

---

## 3. OAuth — Discord

Used for `DISCORD_MEMBER` and `DISCORD_ROLE` requirement types.

### `GET /auth/discord`

Redirects to Discord OAuth authorization page.

**Env required:** `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`

---

### `GET /auth/discord/callback`

Exchanges code for token, fetches user profile, broadcasts to `BroadcastChannel("zkpoll-discord")`.

**Success broadcast:**
```json
{ "status": "success", "userId": "123456", "username": "user#1234" }
```

---

## 4. OAuth — GitHub

Used for `GITHUB_ACCOUNT` requirement type (repos, followers, org membership, starred repos, commits).

### `GET /auth/github`

Redirects to GitHub OAuth authorization page.

**Env required:** `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`

---

### `GET /auth/github/callback`

Exchanges code for token, fetches GitHub profile, broadcasts to `BroadcastChannel("zkpoll-github")`.

**Success broadcast:**
```json
{ "status": "success", "userId": "octocat", "username": "octocat" }
```

---

## 5. OAuth — Telegram

Used for `TELEGRAM_MEMBER` requirement type. Uses Telegram Login Widget (full-tab redirect).

### `GET /auth/telegram`

Returns an HTML page with the Telegram Login Widget button.

**Env required:** `TELEGRAM_BOT_USERNAME`

---

### `GET /auth/telegram/callback`

Verifies the Telegram auth hash (HMAC-SHA256 with bot token), broadcasts result.

**Verification:** `HMAC-SHA256(data_check_string, SHA256(TELEGRAM_BOT_TOKEN))` — rejects if hash doesn't match or `auth_date` is >24h old.

**Success broadcast:**
```json
{ "status": "success", "userId": "123456789", "username": "telegramuser" }
```

---

## 6. EVM Wallet Verification

Proves the user controls an EVM address via `personal_sign`. Prevents anyone from claiming another wallet's token balance.

### `GET /auth/evm/challenge?address=0x...`

Generates a one-time challenge message for the given EVM address.

**Response:**
```json
{
  "challenge": "Sign this message to verify your EVM wallet for ZKPoll.\n\nAddress: 0x1234...\nNonce: abc123xyz"
}
```

- Challenge expires after 5 minutes
- One challenge per address at a time

---

### `POST /auth/evm/verify`

Verifies the EIP-191 signature and confirms address ownership.

**Body:**
```json
{
  "address": "0x1234...",
  "challenge": "Sign this message...",
  "signature": "0xabc..."
}
```

**Response:**
```json
{ "verified": true }
```

---

## 7. Communities

Community configs are stored as JSON files in `verifier/communities/`. Each file is named `<community_id>.json`.

### `GET /communities`

Returns all registered communities.

**Response:**
```json
[
  {
    "community_id": "my-community",
    "name": "My Community",
    "description": "...",
    "logo": "https://...",
    "credential_type": 1,
    "credential_expiry_days": 30,
    "requirement_groups": [...],
    "polls": [...],
    "creator": "0x1234..."
  }
]
```

---

### `GET /communities/:id`

Returns a single community config by ID.

**404** if community not found.

---

### `POST /communities`

Registers a new community. Called by the frontend after the `registerCommunity` on-chain transaction confirms.

**Body:**
```json
{
  "community_id": "my-community",
  "name": "My Community",
  "description": "...",
  "logo": "https://...",
  "credential_type": 1,
  "credential_expiry_days": 30,
  "requirement_groups": [
    {
      "id": "uuid",
      "logic": "AND",
      "requirements": [
        { "id": "uuid", "type": "FREE", "params": {} }
      ]
    }
  ],
  "creator": "0x1234..."
}
```

**What it does:**
1. Saves config to `communities/<community_id>.json`
2. Pins config JSON to IPFS via Pinata (if configured)

**Response:**
```json
{ "community_id": "my-community", "ipfs_cid": "bafkrei..." }
```

---

### `POST /communities/:id/polls`

Registers a poll under a community. Called after the `createPoll` on-chain transaction confirms.

**Body:**
```json
{
  "poll_id": "0x1234...",
  "title": "What should we build next?",
  "description": "Optional context",
  "required_credential_type": 1,
  "created_at_block": 21000000,
  "end_block": 21050000,
  "poll_type": "flat",
  "creator_address": "0x1234...",
  "options": [
    { "option_id": 0, "label": "Option A", "parent_option_id": 0, "child_count": 0 },
    { "option_id": 1, "label": "Option B", "parent_option_id": 0, "child_count": 0 }
  ]
}
```

**What it does:**
1. Validates `creator_address` matches `community.creator` — returns `403` if not the creator
2. Pins poll metadata to IPFS (if configured)
3. Appends poll to community's `polls` array and saves

**Response:**
```json
{ "poll_id": "0x1234...", "ipfs_cid": "bafkrei..." }
```

**Error responses:**
- `400` — missing `creator_address`
- `403` — caller is not the community creator
- `404` — community not found

---

### `DELETE /communities/:id/polls/:pollId`

Removes a poll from a community. Requires `x-admin-secret` header.

**Response:**
```json
{ "ok": true, "removed": "<pollId>" }
```

---

## 8. Polls

### `GET /polls/:id/vote-count`

Returns the current vote count for a poll (reads from verifier's tracked submissions).

**Response:**
```json
{ "poll_id": "0x1234...", "total_votes": 2 }
```

---

## 9. Requirement Verification

The verifier checks requirements off-chain before the user's wallet calls `issueCredential` on-chain.

### Supported Requirement Types

| Type | What it checks | Connected account needed |
|---|---|---|
| `FREE` | Always passes | None |
| `ALLOWLIST` | Address in allowlist | EVM wallet |
| `TOKEN_BALANCE` | ERC-20 balance ≥ min | EVM wallet |
| `NFT_OWNERSHIP` | ERC-721 ownership | EVM wallet |
| `ONCHAIN_ACTIVITY` | Tx count ≥ min | EVM wallet |
| `DOMAIN_OWNERSHIP` | ENS domain ownership | EVM wallet |
| `X_FOLLOW` | Follows a Twitter handle | Twitter OAuth |
| `DISCORD_MEMBER` | Member of a Discord server | Discord OAuth |
| `DISCORD_ROLE` | Has a specific Discord role | Discord OAuth |
| `GITHUB_ACCOUNT` | Repos, followers, org, starred repo, commits | GitHub OAuth |
| `TELEGRAM_MEMBER` | Member of a Telegram channel | Telegram Login |

---

### `POST /verify/check`

Checks requirements without issuing a credential. Use to show requirement status in the UI.

**Body:**
```json
{
  "communityId": "my-community",
  "evmAddress": "0x1234...",
  "connectedAccounts": [
    { "type": "EVM_WALLET", "identifier": "0x1234..." },
    { "type": "GITHUB", "identifier": "octocat" }
  ]
}
```

**Response:**
```json
{
  "passed": true,
  "results": [
    { "requirementId": "uuid", "passed": true },
    { "requirementId": "uuid2", "passed": false, "error": "Insufficient balance" }
  ]
}
```

**Logic:**
- Evaluates each `RequirementGroup` with its `AND`/`OR` logic
- Overall `passed` = all groups pass

---

### `POST /verify/attest`

Verifies requirements and returns an EIP-712 signed attestation. The user's wallet submits this attestation to `issueCredential()` on-chain.

**Body:** Same as `/verify/check`

**Response (passed):**
```json
{
  "passed": true,
  "results": [...],
  "attestation": {
    "communityId": "0x...",
    "credentialType": 1,
    "votingWeight": 15,
    "expiryBlock": 21200000,
    "issuedAt": 21000000,
    "signature": "0xabc..."
  }
}
```

**Response (failed):**
```json
{ "error": "Requirements not met", "results": [...] }
```

**How `votingWeight` is computed:**
Each passing requirement contributes its `vote_weight` param (or a default based on type). The total is the sum of all passing requirement weights — this becomes the voter's `EV` (Eligible Votes).

---

## 10. Tally

### `POST /admin/tally/:pollId`

Manually triggers the full FHE tally flow for a poll. Requires `x-admin-secret` header.

**Headers:**
```
x-admin-secret: <ADMIN_SECRET>
```

**Response:**
```json
{ "ok": true, "pollId": "0x..." }
```

**How the tally flow works:**

1. **`requestTallyReveal()`** — calls the contract to set `tallyRevealed = true`, store ctHashes in `tallyCtHashes[pollId][i]`, and call `FHE.allowPublic` + `FHE.decrypt` for each option.

2. **`decryptForTx(ctHash)`** — for each option, calls the CoFHE Threshold Network via `@cofhe/sdk` to get `{ decryptedValue, signature }`. The signature proves the Threshold Network computed the correct plaintext.

3. **`publishTallyResult(pollId, optionId, plaintext, signature)`** — calls the contract which verifies the Threshold Network's signature via `FHE.publishDecryptResult`, then writes the plaintext to `revealedTallies[pollId][optionId]`.

The flow is idempotent — options already published are skipped.

---

### Automated Tally Runner

The tally runner starts automatically on server boot. Every 60 seconds it:

1. Reads all communities and their polls
2. Gets the current L1 block number (Arbitrum Sepolia block headers carry `l1BlockNumber`)
3. For each ended poll (`l1Block > endBlock`) that hasn't been fully tallied: calls `runTallyForPoll(pollId)`
4. Marks completed polls in-memory to skip them on future iterations

**To disable:** Remove `FHENIX_CONTRACT_ADDRESS` or `VERIFIER_PRIVATE_KEY` from `.env` — the runner logs a warning and exits cleanly.

---

## Error Codes

| HTTP | Meaning |
|---|---|
| 400 | Missing required fields or invalid input |
| 403 | Requirements not met or unauthorized |
| 404 | Community or poll not found |
| 500 | Internal error (RPC, IPFS, Threshold Network) |

All errors return:
```json
{ "error": "Human-readable message", "detail": "Optional technical detail" }
```
