# ZKPoll — End-to-End Testing Guide

**Contract:** `FhenixPoll.sol` on Arbitrum Sepolia (`0xb7d950264800EA297253EA583461E39168DDA8B5`)  
**Note:** The live demo backend runs on Render free tier — first request after idle may take 30–60s to wake up. For instant response, run locally using this guide.

---

## Quick Start — Live Demo

The deployed site is fully functional for:

| Feature | Status |
|---|---|
| Create Community | ✅ |
| Credential Issuance (all requirement types) | ✅ |
| Create Poll | ✅ |
| Cast Vote (FHE-encrypted) | ✅ |
| Browse Communities & Polls | ✅ |
| Reveal Tally (creator, after poll closes) | ✅ |
| View Results | ✅ |

---

## Full Local Setup

**Requirements:**

| Tool | Version |
|---|---|
| Node.js | 18+ |
| Git | Any |
| MetaMask (or any EVM wallet) | Latest |
| Arbitrum Sepolia ETH | ~0.01 ETH from faucet |

---

## 1. Clone & Setup

```bash
git clone https://github.com/<your-repo>/zkpoll
cd zkpoll/zkpoll
```

---

## 2. Verifier Backend

> **Fastest path for local testing:** Use `FREE` requirement type — no OAuth keys, no tokens needed. Any connected EVM wallet gets a credential instantly.

```bash
cd verifier
cp .env.example .env
```

Minimum config for local testing:

```env
# Deployed FhenixPoll contract on Arbitrum Sepolia
FHENIX_CONTRACT_ADDRESS=0xb7d950264800EA297253EA583461E39168DDA8B5
FHENIX_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc

# EVM private key — signs EIP-712 attestations + submits tally transactions
# Generate: openssl rand -hex 32
VERIFIER_PRIVATE_KEY=0x<your_private_key>

# Secret for POST /admin/tally/:pollId
ADMIN_SECRET=<random_secret>

# Alchemy — for EVM token/NFT checks (get free key at alchemy.com)
ALCHEMY_API_KEY=<your_alchemy_key>

# Pinata IPFS — optional but recommended
PINATA_JWT=<your_pinata_jwt>
PINATA_GATEWAY=<your_gateway_subdomain>

APP_URL=http://localhost:5173
PORT=3001
```

```bash
npm install
npm run dev
```

Verify:
```bash
curl http://localhost:3001/health
# → {"status":"ok","service":"zkpoll-verifier"}
```

---

## 3. Frontend

```bash
cd ../frontend
```

Create `.env`:
```env
VITE_CONTRACT_ADDRESS=0xb7d950264800EA297253EA583461E39168DDA8B5
VITE_VERIFIER_URL=http://localhost:3001
VITE_CHAIN_ID=421614
VITE_PINATA_GATEWAY=<your_gateway_subdomain>.mypinata.cloud
```

```bash
npm install
npm run dev
```

Frontend runs at `http://localhost:5173`.

---

## 4. Wallet Setup

1. Install MetaMask (or any EVM wallet)
2. Add **Arbitrum Sepolia** network (Chain ID: `421614`, RPC: `https://sepolia-rollup.arbitrum.io/rpc`)
3. Get testnet ETH: https://faucet.triangleplatform.com/arbitrum/sepolia or https://www.alchemy.com/faucets/arbitrum-sepolia
4. Connect wallet at `http://localhost:5173`

---

## 5. Full E2E Test Flow

### Step 1 — Create a Community

1. Go to **Communities → New Community**
2. Fill in name and description
3. Select **Credential Type:**
   - **Open (Type 1)** — anyone gets a credential instantly. Best for quick testing.
   - **Gated (Type 2)** — 1 requirement group, up to 3 requirements
   - **Multi-gate (Type 3)** — unlimited groups and requirements
4. Poll type: **Flat**
5. Click **Create Community** → approve wallet transaction
6. Wait for on-chain confirmation (~2–5s on Arbitrum Sepolia)

### Step 2 — Get a Credential

1. Go to your community page
2. Click **Get Credential** → **Verify & Get Credential**
3. Approve the `issueCredential` wallet transaction
4. Wait for confirmation

**Requirement types and what you need to connect:**

| Requirement | What it checks | Setup needed |
|---|---|---|
| **FREE** | Always passes | Nothing — instant credential |
| **ALLOWLIST** | Your EVM address is in the list | Connect EVM wallet + sign challenge |
| **TOKEN_BALANCE** | ERC-20 balance ≥ minimum | Have tokens on connected wallet |
| **NFT_OWNERSHIP** | Owns an ERC-721 NFT | Own the NFT on connected wallet |
| **ONCHAIN_ACTIVITY** | Sent ≥ N transactions | Any active EVM wallet |
| **DOMAIN_OWNERSHIP** | Owns an ENS domain | Own ENS on connected wallet |
| **X_FOLLOW** | Follows a Twitter handle | Connect X/Twitter via OAuth popup |
| **DISCORD_MEMBER** | Member of a Discord server | Connect Discord via OAuth popup |
| **DISCORD_ROLE** | Has a specific Discord role | Connect Discord via OAuth popup |
| **GITHUB_ACCOUNT** | Repos / followers / org / starred repo / commits | Connect GitHub via OAuth popup |
| **TELEGRAM_MEMBER** *(Beta)* | Member of a Telegram channel | Connect Telegram + add @zkpollbot as admin |

**Supported EVM chains:** `ethereum`, `base`, `optimism`, `arbitrum`, `ethereum-sepolia`, `base-sepolia`, `arbitrum-sepolia`, `optimism-sepolia`

> **Tip:** Use `FREE` or `ALLOWLIST` with your own address — no tokens or OAuth needed for testing.

### Step 3 — Create a Poll

1. Go to **Communities → [Your Community] → Create Poll**
2. Add title + 2–8 options
3. Set duration (1 day ≈ 7200 L1 blocks on Arbitrum Sepolia)
4. Click **Deploy** → approve wallet transaction

> **For quick tally testing:** enable dev mode (see [Dev Mode](#dev-mode-fast-tally-testing) below) to set duration in raw blocks — use `1` block for a poll that closes in ~12 seconds.

### Step 4 — Vote

1. Go to the poll page → **Vote** tab
2. Click options to rank them (1 = top choice)
3. Click **Submit Vote** → approve wallet transaction (FHE-encrypts your weights on-chain)

### Step 5 — Reveal Tally

Once the poll's `endBlock` has passed, the poll creator can reveal the tally from the Results page:

1. Go to **Poll → Results**
2. Click **Reveal Tally** → approve `requestTallyReveal` wallet transaction
3. The frontend then calls `decryptForTx` (Threshold Network) per option and submits `publishTallyResult` for each

The button is disabled with a message while the poll is still open.

Alternatively, trigger via the verifier backend (works for any ended poll):

```bash
curl -X POST http://localhost:3001/admin/tally/<pollId> \
  -H "x-admin-secret: <ADMIN_SECRET>"
```

Get `<pollId>` from the poll URL: `/communities/<communityId>/polls/<pollId>`

Expected response:
```json
{ "ok": true, "pollId": "0x..." }
```

### Step 6 — View Results

1. Go to **Poll → Results**
2. Results show each option's FHE-decrypted vote count (read from `revealedTallies` on-chain)
3. Results are verifiable directly from the contract — no trust in ZKPoll required

---

## Dev Mode — Fast Tally Testing

To test the full tally flow without waiting for a real poll to close, enable dev mode:

Add to `frontend/.env`:
```env
VITE_DEV_MODE=true
```

Restart the dev server. In dev mode:

- The **Poll Duration** input accepts **raw L1 block counts** instead of days
- Quick-select buttons show `1blk`, `5blk`, `10blk`
- Set duration to `1` → poll closes after the next L1 block (~12 seconds on Arbitrum Sepolia)

**Full fast test flow:**
1. Enable `VITE_DEV_MODE=true`, restart dev server
2. Create a poll with duration `1` block
3. Cast a vote
4. Wait ~12 seconds
5. Go to Results → click **Reveal Tally**

> Dev mode only affects the duration input. All other behaviour (FHE encryption, gas estimation, on-chain checks) is identical to production.

---

## 6. Useful Curl Commands

```bash
# Health check
curl http://localhost:3001/health

# List communities
curl http://localhost:3001/communities

# Manually trigger tally (verifier backend)
curl -X POST http://localhost:3001/admin/tally/<pollId> \
  -H "x-admin-secret: <ADMIN_SECRET>"
```

---

## 7. Contract Reference

**Contract:** `FhenixPoll.sol` on Arbitrum Sepolia  
**Address:** `0xb7d950264800EA297253EA583461E39168DDA8B5`

| Function | Caller | Purpose |
|---|---|---|
| `registerCommunity` | Community creator | Register community on-chain |
| `createPoll` | Community creator | Create poll with FHE-zero tallies |
| `issueCredential` | Voter | Record on-chain credential after EIP-712 verification |
| `castVote` | Voter | Submit FHE-encrypted per-option weights |
| `requestTallyReveal` | Poll creator (after end) | Expose ctHashes + queue FHE decryption |
| `publishTallyResult` | Anyone | Verify Threshold Network sig + write plaintext |

**Privacy model:**
- Vote weights are FHE-encrypted — tallies accumulate under encryption, revealing nothing until `publishTallyResult`
- "Who voted" is public, "how they voted" is private until tally
- `publishTallyResult` verifies the Threshold Network's cryptographic signature — results cannot be forged

---

## 8. Architecture

```
Browser (React + MetaMask + CoFHE client)
    │
    ├── FhenixPoll.sol (Arbitrum Sepolia)
    │       castVote → FHE-encrypted euint32 weights accumulated homomorphically
    │       requestTallyReveal → FHE.allowPublic + FHE.decrypt per option
    │       publishTallyResult → Threshold Network signature verified on-chain
    │
    └── Verifier (Node.js)
            ├── Requirement checks (GitHub, Discord, EVM, etc.)
            ├── EIP-712 attestations → user wallet calls issueCredential
            └── Tally Runner (60s interval)
                    ├── getOnChainPoll → detect ended polls
                    ├── requestTallyReveal → expose ctHashes
                    ├── decryptForTx → Threshold Network returns plaintext + signature
                    └── publishTallyResult → write verified plaintext on-chain
```

---

## 9. Troubleshooting

| Issue | Fix |
|---|---|
| Render backend slow | Use local setup — first request wakes the instance |
| `Already voted` | One vote per address per poll, enforced on-chain |
| `Transaction rejected` | Ensure you are the community creator for poll/community creation |
| `Poll still open` | Wait for `endBlock` to pass — use dev mode (`VITE_DEV_MODE=true`) for fast testing |
| High gas warning in MetaMask | Expected for FHE operations — gas is estimated with a 30% buffer and capped. Safe to approve. |
| Results not showing after reveal | Refresh the results page after all `publishTallyResult` transactions confirm |

---

## 10. Known Limitations

- **Render cold start:** Live demo sleeps after 15 min idle. Local setup recommended for judging.
- **Tally time:** Threshold Network decryption takes a few seconds per option.
- **Block time:** `endBlock` is an L1 Ethereum Sepolia block number (~12s/block), not an L2 block. A 1-day poll = ~7200 L1 blocks.
