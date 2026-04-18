# ZKPoll — End-to-End Testing Guide

**Contract:** `FhenixPoll.sol` on Arbitrum Sepolia (`0xd9836FA54D71c2745A26dABa48551E9745983676`)  
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
| View Results (after tally) | ✅ |
| **Tally** | ⚠️ Automated (60s interval) or trigger manually |

### Manual tally trigger (live demo):

```bash
curl -X POST https://zkpoll-verifier.onrender.com/admin/tally/<pollId> \
  -H "x-admin-secret: <ADMIN_SECRET>"
```

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
FHENIX_CONTRACT_ADDRESS=0xd9836FA54D71c2745A26dABa48551E9745983676
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
VITE_CONTRACT_ADDRESS=0xd9836FA54D71c2745A26dABa48551E9745983676
VITE_VERIFIER_URL=http://localhost:3001
VITE_CHAIN_ID=421614
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
3. Set duration (in blocks — 1 day ≈ 5760 L1 blocks)
4. Click **Deploy** → approve wallet transaction

### Step 4 — Vote

1. Go to the poll page → **Vote** tab
2. Click options to rank them (1 = top choice)
3. Click **Submit Vote** → approve wallet transaction (FHE-encrypts your weights on-chain)

### Step 5 — Trigger Tally

The automated runner checks every 60s. To trigger manually before the poll ends:

```bash
curl -X POST http://localhost:3001/admin/tally/<pollId> \
  -H "x-admin-secret: <ADMIN_SECRET>"
```

Get `<pollId>` from the poll URL: `/communities/<communityId>/polls/<pollId>`

Expected response:
```json
{ "ok": true, "pollId": "0x..." }
```

The tally flow runs: `requestTallyReveal()` → `decryptForTx()` (Threshold Network) → `publishTallyResult()` per option.

### Step 6 — View Results

1. Go to **Poll → Results**
2. Results show each option's vote count (read from `revealedTallies` on-chain)
3. Results are verifiable directly from the contract — no trust in ZKPoll required

---

## 6. Useful Curl Commands

```bash
# Health check
curl http://localhost:3001/health

# List communities
curl http://localhost:3001/communities

# Manually trigger tally
curl -X POST http://localhost:3001/admin/tally/<pollId> \
  -H "x-admin-secret: <ADMIN_SECRET>"
```

---

## 7. Contract Reference

**Contract:** `FhenixPoll.sol` on Arbitrum Sepolia  
**Address:** `0xd9836FA54D71c2745A26dABa48551E9745983676`

| Function | Caller | Purpose |
|---|---|---|
| `registerCommunity` | Community creator | Register community on-chain |
| `createPoll` | Community creator | Create poll with FHE-zero tallies |
| `issueCredential` | Voter | Record on-chain credential after EIP-712 verification |
| `castVote` | Voter | Submit FHE-encrypted per-option weights |
| `requestTallyReveal` | Anyone (after end) | Expose ctHashes + queue FHE decryption |
| `publishTallyResult` | Tally runner | Verify Threshold Network sig + write plaintext |

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
| `Already voted` | Nullifier enforced on-chain — one vote per address per poll |
| `Transaction rejected` | Ensure you are the community creator for poll creation |
| Results not showing | Run manual tally trigger, then refresh results page |
| Tally fails with "Poll still open" | Wait for endBlock to pass or use `requestTallyReveal` directly after it ends |

---

## 10. Known Limitations

- **Render cold start:** Live demo sleeps after 15 min idle. Local setup recommended for judging.
- **Tally time:** Threshold Network decryption takes a few seconds per option. Automated runner handles it.
- **Block time:** Arbitrum Sepolia L2 blocks are ~0.25s, but `endBlock` is an L1 Ethereum block number (~12s/block). Plan accordingly.
