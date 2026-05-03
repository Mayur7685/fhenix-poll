# ZKPoll Verifier API Reference

The verifier is a Node.js/Express backend handling off-chain requirement verification, community/poll registry, OAuth flows, posts, quests, and the automated FHE tally engine.

**Base URL (local):** `http://localhost:3001`

---

## Table of Contents

1. [Health](#1-health)
2. [OAuth](#2-oauth)
3. [EVM Wallet Verification](#3-evm-wallet-verification)
4. [Communities](#4-communities)
5. [Polls](#5-polls)
6. [Posts (Wave 4)](#6-posts-wave-4)
7. [Quests (Wave 4)](#7-quests-wave-4)
8. [Requirement Verification](#8-requirement-verification)
9. [Tally](#9-tally)

---

## 1. Health

### `GET /health`
```json
{ "status": "ok", "service": "fhenixpoll-verifier" }
```

---

## 2. OAuth

All OAuth flows open a popup. Results are broadcast via `BroadcastChannel` + `window.opener.postMessage`.

| Route | Provider | Env required |
|---|---|---|
| `GET /auth/twitter` | Twitter/X | `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET` |
| `GET /auth/discord` | Discord | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` |
| `GET /auth/github` | GitHub | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |
| `GET /auth/telegram` | Telegram | `TELEGRAM_BOT_USERNAME`, `TELEGRAM_BOT_TOKEN` |

Each callback broadcasts:
```json
{ "status": "success", "userId": "...", "username": "..." }
```

---

## 3. EVM Wallet Verification

### `GET /auth/evm/challenge?address=0x...`
Returns a one-time challenge (5 min TTL).

### `POST /auth/evm/verify`
```json
{ "address": "0x...", "challenge": "...", "signature": "0x..." }
```
Returns `{ "verified": true }`.

---

## 4. Communities

### `GET /communities`
List all communities (includes `polls` array).

### `GET /communities/:id`
Single community by ID. `404` if not found.

### `POST /pin/community`
Pin community metadata to IPFS before on-chain tx. Returns `{ "cid": "..." }`.

### `POST /communities/confirm`
Persist community after `registerCommunity()` tx confirms.

**Body:** Full `CommunityConfig` object.

### `GET /verifier-address`
Returns `{ "address": "0x..." }` — the verifier's EVM address for contract registration check.

---

## 5. Polls

### `POST /pin/poll`
Pin poll metadata to IPFS. Returns `{ "cid": "..." }`.

### `POST /polls/confirm`
Persist poll after `createPoll()` / `createHierarchicalPoll()` tx confirms.

**Body:**
```json
{
  "poll_id": "0x...",
  "community_id": "0x...",
  "title": "...",
  "poll_type": "flat | hierarchical",
  "options": [
    { "option_id": 1, "label": "...", "parent_option_id": 0, "child_count": 2 }
  ],
  "end_block": 10800000,
  "creator_address": "0x..."
}
```

### `DELETE /communities/:id/polls/:pollId`
Remove poll (requires `x-admin-secret` header).

---

## 6. Posts (Wave 4)

### `POST /pin/post`
Pin post content to IPFS before on-chain tx.

**Body:**
```json
{
  "post_id": "0x...",
  "community_id": "0x...",
  "author": "0x...",
  "title": "...",
  "body": "markdown content",
  "content_hash": "0x..."
}
```
Returns `{ "cid": "..." }`.

### `POST /posts/confirm`
Persist post after `createPost()` tx confirms. Same body as above.

### `GET /communities/:id/posts`
List all posts for a community. Returns `PostMetadata[]`.

### `GET /posts/:postId`
Single post. `404` if not found.

---

## 7. Quests (Wave 4)

### `POST /pin/quest`
Pin quest metadata to IPFS.

**Body:**
```json
{
  "quest_id": "0x...",
  "community_id": "0x...",
  "title": "Vote in 5 polls",
  "description": "...",
  "quest_type": "VOTE_COUNT | REFERRAL_COUNT | CREDENTIAL_AGE",
  "target": 5,
  "reward_description": "OG Badge",
  "reward_hash": "0x...",
  "expiry_block": 10900000
}
```
Returns `{ "cid": "..." }`.

### `POST /quests/confirm`
Persist quest after `createQuest()` tx confirms.

### `GET /communities/:id/quests`
List all quests for a community. Returns `QuestInfo[]`.

### `GET /quests/:questId`
Single quest. `404` if not found.

### `GET /quests/:questId/progress/:address`
Get participant's off-chain progress.

**Response:**
```json
{ "quest_id": "0x...", "participant": "0x...", "progress": 3, "completed": false }
```

### `POST /quests/:questId/progress`
Update off-chain progress (admin only — requires `x-admin-secret` header).

**Body:** `{ "participant": "0x...", "progress": 3, "completed": false }`

---

## 8. Requirement Verification

### `POST /verify/check`
Check requirements without issuing a credential.

**Body:**
```json
{
  "communityId": "0x...",
  "evmAddress": "0x...",
  "connectedAccounts": [
    { "type": "EVM_WALLET", "identifier": "0x..." },
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

### `POST /verify/credential-params`
Verify requirements and return EIP-712 attestation for `issueCredential()`.

**Response (passed):**
```json
{
  "passed": true,
  "results": [...],
  "attestation": {
    "recipient": "0x...",
    "communityId": "0x...",
    "nullifier": "0x...",
    "credType": 1,
    "votingWeight": "1000000",
    "expiryBlock": 10900000,
    "issuedAt": 10800000,
    "nonce": "1234567890"
  },
  "signature": "0x..."
}
```

### Supported requirement types

| Type | Checks | Auth |
|---|---|---|
| `FREE` | Always passes | None |
| `ALLOWLIST` | Address in list | EVM wallet |
| `TOKEN_BALANCE` | ERC-20 balance ≥ min | Alchemy RPC |
| `NFT_OWNERSHIP` | ERC-721 ownership | Alchemy RPC |
| `ONCHAIN_ACTIVITY` | Tx count ≥ min | Alchemy RPC |
| `DOMAIN_OWNERSHIP` | ENS domain | ENS resolution |
| `X_FOLLOW` | Follows a handle | Twitter OAuth |
| `DISCORD_MEMBER` | Server member | Discord OAuth |
| `DISCORD_ROLE` | Has role | Discord bot |
| `GITHUB_ACCOUNT` | Repos/followers/org/commits/starred | GitHub OAuth |
| `TELEGRAM_MEMBER` | Channel member | Telegram widget |

---

## 9. Tally

### `POST /admin/tally/:pollId`
Manually trigger full FHE tally flow. Requires `x-admin-secret` header.

**Response:** `{ "ok": true, "pollId": "0x..." }`

**Tally flow:**
1. Check `VoteCast` events — skip if no votes (avoids `FHE.allowPublic` revert on zero handle)
2. Call `requestTallyReveal()` — `FHE.allowPublic` per non-zero option (15s delay to ensure `block.number > endBlock`)
3. For each option: `decryptForTx(ctHash).withoutPermit().execute()` → `{ decryptedValue, signature }`
4. Call `publishTallyResult(pollId, optionId, plaintext, signature)` — verifies Threshold Network signature on-chain

Options with zero votes (no submissions) are published as `0` directly without FHE decryption.

### Automated Tally Runner
Starts on boot. Every 60 seconds:
- Reads all communities and polls
- Skips polls not found on current contract (old contract data)
- Skips polls with `l1Block <= endBlock + 2` (buffer to avoid boundary race)
- Runs `runTallyForPoll` for ended, unrevealed polls with votes

### Automated Quest Runner
Starts on boot. Every 120 seconds:
- For `VOTE_COUNT` quests: scans `VoteCast` events, encrypts progress increments, calls `recordQuestProgress` on-chain
- After recording, calls `requestProgressReveal` + `publishProgressResult` for participants near completion

---

## Error Codes

| HTTP | Meaning |
|---|---|
| 400 | Missing required fields |
| 401 | Missing or invalid `x-admin-secret` |
| 403 | Requirements not met or not community creator |
| 404 | Resource not found |
| 500 | Internal error (RPC, IPFS, Threshold Network) |

All errors: `{ "error": "message", "detail": "optional" }`
