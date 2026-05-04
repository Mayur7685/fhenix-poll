# ZKPoll — Wave 3 Update

ZKPoll extended its confidential voting protocol with on-chain hierarchical voting, community posts, and FHE-encrypted quest progress. Live on Arbitrum Sepolia.

**Contract:** `0x9dC0044FdB877F1F017D5853150b0B9725b26397` 
**Demo:** [fhenix-poll.vercel.app](fhenix-poll.vercel.app)

---

## What Was Delivered

### 1. Hierarchical Voting — On-Chain Option Tree

`createHierarchicalPoll` registers up to 32 options with `parentId[]` and `labelHash[]` on-chain. `PollOption` stores `optionId`, `parentId`, `childCount`, `labelHash`. `rolledUpTallies[pollId][optionId]` accumulates sub-category totals — `publishTallyResult` walks the `parentId` chain and adds plaintext to every ancestor.

Fixed `requestTallyReveal` to use `FHE.allowPublic` only (removed `FHE.decrypt` — old pattern caused reverts in SDK v0.5+). Zero-vote options skip `FHE.allowPublic` to avoid zero-handle reverts. Fixed `castVote` to call `FHE.allowThis` after both initial assignment and `FHE.add`.

### 2. Community Posts

`createPost(postId, communityId, contentHash)` stores `keccak256(IPFS CID)` on-chain. Gated communities require a valid credential. Verifier adds pin/confirm/list routes. Frontend: `CommunityPosts` page, `CreatePostModal`, `usePosts` hook.

### 3. Community Quests

`createQuest` defines type (`VOTE_COUNT`, `REFERRAL_COUNT`, `CREDENTIAL_AGE`), target, and expiry. `recordQuestProgress` (verifier-only) FHE-accumulates encrypted progress — individual progress stays private. `publishProgressResult` marks complete if `plaintext >= target` after Threshold Network verification. Quest runner scans `VoteCast` events every 120s and auto-records progress on-chain.

### 4. Pinata SDK — Zero Local Storage

All data (communities, polls, posts, quests, submissions) persists on IPFS via the official `pinata` SDK. No local JSON files. Survives Render redeploys.

### 5. Frontend & SDK Fixes

Replaced `@cofhe/react` with `@cofhe/sdk/web` direct singleton — no iframe, no `CofheProvider`. `CreatePollWizard` has card-based Flat/Hierarchical selector and recursive tree builder with `+ Sub` buttons. `PollResults` renders nested tree with `rolledUpTallies` and "subtotal" badges. `CommunityDetail` has Polls/Posts/Quests tabs.

### 6. Tests — 34 Passing

New cases: hierarchical tree validation, cycle rejection, on-chain rollup, post creation, quest FHE progress accumulation, completion threshold. Uses `mock_getPlaintext` + mock signer key for `publishDecryptResult`.

---

## Future Waves

### Wave 5 — Weighted Delegation
Credential holders delegate voting weight FHE-encrypted — observer sees delegation happened but not how much. Delegated weight stacks with delegate's own credential, enabling liquid democracy without exposing the delegation graph.

### Wave 6 — Multi-Chain Credential Aggregation
Aggregate identity signals across chains in one attestation. Solana NFT holdings, Ethereum token balance, and Base transaction history feed into one `votingWeight`. Wave 6 adds Solana RPC and cross-chain weight aggregation.

### Wave 7 — Private Mid-Poll Snapshots
Poll creators request a private tally snapshot while the poll is open — decrypted only for the creator via FHE permit.

### Wave 8 — On-Chain Community Governance
Community requirement configs stored on-chain as encrypted `euint8` arrays. Rules are private — a community can gate membership on criteria that aren't publicly known.
