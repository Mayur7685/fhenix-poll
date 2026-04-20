# ZKPoll

Privacy-preserving ranked-choice voting powered by Fully Homomorphic Encryption (FHE) on Fhenix / Arbitrum Sepolia. Vote totals accumulate homomorphically under encryption — the plaintext is only revealed after the poll closes via the Threshold Network.

## How it works

```
User wallet  ──►  FhenixPoll.sol (Arbitrum Sepolia)  ──►  euint32 tallies (FHE-encrypted)
                                                                   │
Verifier  ──►  EIP-712 credential attestation                      │  poll ends
                                                                   ▼
                                                  requestTallyReveal() → FHE.allowPublic
                                                         │
                                                  Threshold Network decrypts
                                                         │
                                                  publishTallyResult() → on-chain plaintext
```

1. **Community creator** registers a community on-chain and defines membership requirements (token balance, NFT, Discord role, X follow, etc.)
2. **Voter** connects external accounts, verifier checks eligibility off-chain, and issues an EIP-712 signed attestation — no server signing key touches chain
3. **Voter** submits encrypted vote weights via `castVote()` — FHE addition keeps the running tally homomorphically encrypted
4. **After poll ends**, the **poll creator** calls `requestTallyReveal()` from the Results page — the contract calls `FHE.allowPublic` + `FHE.decrypt` for each option
5. **Tally runner** reads the ctHashes, calls `decryptForTx` against the Threshold Network, then calls `publishTallyResult()` with the verified plaintext + signature
6. Anyone can verify results by reading `revealedTallies` directly from the contract

## Features

### Communities
- Create a community with a name, description, logo, and credential type
- Define membership requirements with `AND`/`OR` group logic — mix token balance, NFT ownership, social follows, Discord roles, GitHub accounts, and more
- Each requirement type carries a configurable `vote_weight` — token holders can be given more votes than social followers
- Community metadata is optionally pinned to IPFS via Pinata for decentralised discoverability
- Only the community creator can create polls — enforced in the UI and at the verifier API

### Credentials
- Verifier checks requirements off-chain, then returns an EIP-712 signed attestation
- The voter's wallet submits the attestation to `issueCredential()` on-chain
- Credentials have an on-chain expiry block — expired credentials cannot be used to vote
- The Credentials Hub shows per-community eligibility status and lets users claim or renew credentials

### Voting
- Ranked-choice ballot — voters drag/tap to rank options in order of preference
- Each ranking maps to an encrypted weight submitted to `castVote()` — the contract adds it homomorphically to the running FHE tally
- Double-vote prevention via on-chain nullifier mapping
- After voting, the UI shows the voter's submitted rankings

### Voting power decay
Voting power decays over 5 periods (~90 days each at 7200 blocks/day) to incentivise active participation:

```
Period 1: 100% → Period 2: 50% → Period 3: 25% → Period 4: 12.5% → Period 5: 6.25% → deactivated
```

`CountedVotes (CV) = EligibleVotes (EV) × VotingPower% (VP)`

The UI shows a live EV / VP% / CV panel. Voters can recast at any time to restore 100% VP.

### Tally & Results
- After the poll closes, the **poll creator** clicks "Reveal Tally" on the Results page — this calls `requestTallyReveal()`, then `decryptForTx` per option, then `publishTallyResult()` per option
- Results page reads `revealedTallies` directly from the contract — no trust in the verifier
- Automated tally runner in the verifier also checks every 60 seconds as a fallback
- Manual tally trigger via `POST /admin/tally/:pollId` (requires `x-admin-secret` header)

## Project structure

```
zkpoll/
├── contracts/               # Solidity contract (Hardhat)
│   └── contracts/FhenixPoll.sol   # registerCommunity, createPoll, issueCredential,
│                                  # castVote, requestTallyReveal, publishTallyResult
├── frontend/                # React + Vite UI
│   └── src/
│       ├── pages/           # PollFeed, CommunityFeed, CommunityDetail,
│       │                    # PollDetail, PollResults, CredentialsHub, MyVotes
│       ├── components/      # CreateCommunityWizard, CreatePollWizard,
│       │                    # CredentialHub, ConnectorSelector, VotingMode
│       ├── hooks/           # useWallet, useVoting, useCredentialHub
│       └── lib/             # fhenix.ts (viem reads), verifier.ts (HTTP client), decay.ts
├── verifier/                # Node.js + Express off-chain service
│   └── src/
│       ├── index.ts         # REST API
│       ├── evaluator.ts     # requirement group evaluation
│       ├── tally.ts         # on-chain FHE tally decryption (CoFHE SDK + viem)
│       ├── tally-runner.ts  # background tally loop (60s interval)
│       ├── oauth.ts         # Twitter, Discord, GitHub, Telegram OAuth
│       ├── issuer.ts        # EIP-712 credential attestation signing
│       ├── pinata.ts        # IPFS pinning (optional)
│       └── checkers/        # per-requirement-type check implementations
└── communities/             # JSON store — one file per community + polls
```

---

## Real-world scenario

**A DAO wants to decide their Q3 budget allocation across 5 departments.**

1. **Alice (DAO admin)** opens ZKPoll, connects her MetaMask, and creates "Acme DAO". She sets the membership requirement to "hold ≥ 100 ACME tokens on Ethereum". She clicks "Register" — her wallet signs `registerCommunity` on Arbitrum Sepolia.

2. **Alice creates a poll** "Q3 Budget Allocation" with 5 options: Engineering, Marketing, Operations, Research, Community. She sets a 7-day voting window. Her wallet signs `createPoll`.

3. **Bob (a DAO member)** visits ZKPoll, finds Acme DAO, clicks "Get Credential". He connects MetaMask — the verifier checks his ACME balance. He passes. He submits the EIP-712 attestation to `issueCredential` — the verifier never touches a signing key on his behalf.

4. **Bob votes**. He ranks: 1. Engineering, 2. Research, 3. Community. He clicks Submit — his wallet signs `castVote`. His weights are FHE-encrypted and homomorphically added to the running tally. The tally ciphertext reveals nothing.

5. **7 days later**, the tally runner detects the poll has ended, calls `requestTallyReveal`, waits for the Threshold Network to decrypt each option, and calls `publishTallyResult` for each. The transaction writes verified plaintexts on-chain.

6. **Anyone** visits the Results page and sees the ranked outcome — read directly from `revealedTallies`. No trust in ZKPoll required.

---

## Prerequisites

- Node.js 18+
- An EVM wallet (MetaMask, Rainbow, or any WalletConnect-compatible wallet)

## Quick start

### 1. Verifier

```bash
cd verifier
cp .env.example .env
# Fill in: VERIFIER_PRIVATE_KEY, FHENIX_CONTRACT_ADDRESS
# Optional: ALCHEMY_API_KEY, TWITTER_*, DISCORD_*, GITHUB_*, TELEGRAM_*, PINATA_*
npm install
npm run dev
```

Runs on `http://localhost:3001`.

### 2. Frontend

```bash
cd frontend
cp .env.example .env
# Set VITE_CONTRACT_ADDRESS and VITE_VERIFIER_URL
npm install
npm run dev
```

Runs on `http://localhost:5173`.

## Environment variables

### `frontend/.env`

| Variable | Description |
|---|---|
| `VITE_CONTRACT_ADDRESS` | Deployed FhenixPoll contract address |
| `VITE_VERIFIER_URL` | Verifier backend URL (default: `http://localhost:3001`) |
| `VITE_CHAIN_ID` | Chain ID — `421614` for Arbitrum Sepolia |
| `VITE_DEV_MODE` | Set `true` to use raw block counts for poll duration (for testing) |

### `verifier/.env`

| Variable | Required | Description |
|---|---|---|
| `FHENIX_CONTRACT_ADDRESS` | Yes | Deployed FhenixPoll contract address |
| `VERIFIER_PRIVATE_KEY` | Yes | EVM private key — signs EIP-712 attestations + submits tally txs |
| `FHENIX_RPC_URL` | No | RPC endpoint (default: Arbitrum Sepolia public RPC) |
| `ADMIN_SECRET` | No | Secret header for `POST /admin/tally/:pollId` |
| `ALCHEMY_API_KEY` | EVM checks | Token balance, NFT, on-chain activity requirements |
| `TWITTER_BEARER_TOKEN` | X follow | Twitter API v2 bearer token |
| `TWITTER_CLIENT_ID/SECRET` | X OAuth | For X connect flow |
| `DISCORD_BOT_TOKEN` | Discord | Guild membership checks |
| `DISCORD_CLIENT_ID/SECRET` | Discord OAuth | For Discord connect flow |
| `GITHUB_CLIENT_ID/SECRET` | GitHub OAuth | For GitHub connect flow |
| `TELEGRAM_BOT_TOKEN` | Telegram | Widget auth verification |
| `TELEGRAM_BOT_USERNAME` | Telegram | Bot username (without @) |
| `PINATA_JWT` | Optional | IPFS pinning for community/poll metadata |
| `PINATA_GATEWAY` | Optional | Pinata gateway subdomain only |
| `APP_URL` | OAuth | Verifier's own public URL for OAuth callbacks |
| `PORT` | Optional | Verifier port (default: `3001`) |

## Requirement types

Communities can gate membership with any combination of:

| Type | What it checks |
|---|---|
| `FREE` | Open to everyone |
| `ALLOWLIST` | EVM address in a predefined list |
| `TOKEN_BALANCE` | ERC-20 balance ≥ threshold (via Alchemy) |
| `NFT_OWNERSHIP` | ERC-721/1155 ownership (via Alchemy) |
| `ONCHAIN_ACTIVITY` | Minimum tx count on EVM chain |
| `DOMAIN_OWNERSHIP` | ENS / domain ownership |
| `X_FOLLOW` | Follows a specific X/Twitter account |
| `DISCORD_MEMBER` | Member of a Discord server |
| `DISCORD_ROLE` | Holds a specific Discord role |
| `GITHUB_ACCOUNT` | Has a GitHub account |
| `TELEGRAM_MEMBER` | Member of a Telegram group |

Requirements are grouped with `AND`/`OR` logic. Each type carries a configurable `vote_weight` that determines the voter's `EligibleVotes (EV)`.

## Voting power decay

Voting power decays over 5 periods (each ~90 days at 7200 blocks/day):

```
Period 1: 100%  →  Period 2: 50%  →  Period 3: 25%  →  Period 4: 12.5%  →  Period 5: 6.25%  →  deactivated
```

`CountedVotes (CV) = EligibleVotes × VotingPower%`

Voters can recast their ballot at any time to restore 100% voting power.

## Verifier API

Full API reference: [`VERIFIER_API.md`](./VERIFIER_API.md)

Key endpoints:

| Method | Path | Description |
|---|---|---|
| `GET` | `/communities` | List all communities |
| `POST` | `/communities` | Create community (called after on-chain `registerCommunity`) |
| `POST` | `/communities/:id/polls` | Register poll metadata (called after on-chain `createPoll`) |
| `POST` | `/verify/check` | Check requirements, return pass/fail per requirement |
| `POST` | `/verify/attest` | Verify + return EIP-712 attestation for `issueCredential` |
| `POST` | `/admin/tally/:pollId` | Manually trigger tally (requires `x-admin-secret` header) |

## Tally

The tally runner polls every 60 seconds for ended polls. For each ended poll it:
1. Calls `requestTallyReveal()` — sets `tallyRevealed = true`, exposes ctHashes publicly, queues FHE decryption
2. For each option, calls `decryptForTx(ctHash)` against the CoFHE Threshold Network
3. Calls `publishTallyResult(pollId, optionId, plaintext, signature)` — the contract verifies the Threshold Network signature and writes the plaintext

Manual tally trigger: `POST /admin/tally/:pollId` with header `x-admin-secret: <ADMIN_SECRET>`.

## Deployment

### Frontend (Vercel)

```bash
cd frontend
npm run build
# deploy dist/ to Vercel — vercel.json already configures SPA rewrites
```

Set env vars in Vercel dashboard matching `frontend/.env`.

### Verifier (Render / Railway / VPS)

```bash
cd verifier
npm run build
npm start
```

Set env vars in your hosting dashboard. The `communities/` directory is ephemeral on Render free tier — community and poll configs are automatically restored from Pinata IPFS on startup if `PINATA_JWT` and `PINATA_GATEWAY` are set.

## Contract functions

All in `FhenixPoll.sol` (Arbitrum Sepolia):

| Function | Caller | Description |
|---|---|---|
| `registerCommunity` | Community creator | Register community on-chain with config hash |
| `createPoll` | Community creator | Create poll with FHE-encrypted zero tallies |
| `issueCredential` | Voter (after verifier EIP-712 attest) | Mark address as credentialed for a community |
| `castVote` | Voter | Submit FHE-encrypted per-option weights |
| `requestTallyReveal` | Poll creator (after poll ends) | `FHE.allowPublic` + `FHE.decrypt` per option |
| `publishTallyResult` | Tally runner | Verify Threshold Network signature + write plaintext |

## Security notes

- Vote totals accumulate homomorphically under FHE — the plaintext is never exposed until the poll ends
- `msg.sender` (voter address) is public by design — privacy is about *what* you voted, not *that* you voted
- Double-vote prevention via on-chain nullifier mapping
- `publishTallyResult` verifies the Threshold Network's signature — results cannot be forged
- Poll creation is enforced creator-only both in the UI and at the verifier API level

## Future enhancements

- **Hierarchical polls** — root + sub-options, separate vote transaction per layer
- **On-chain community config hash verification** — verify IPFS CID against the on-chain config hash
- **Delegated voting** — allow credential holders to delegate their CV to another address
- **Poll templates** — pre-built requirement group templates for common DAO setups
- **Multi-network EVM support** — expand Alchemy-based checks beyond current supported chains
