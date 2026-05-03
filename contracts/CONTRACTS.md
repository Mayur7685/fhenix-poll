# FhenixPoll — Smart Contract Guide

**Contract:** `FhenixPoll.sol`  
**Network:** Arbitrum Sepolia (Chain ID: `421614`)  
**Deployed address:** `0x9dC0044FdB877F1F017D5853150b0B9725b26397`  
**Solidity:** `^0.8.28` (EVM version: Cancun)

---

## Overview

`FhenixPoll` is a privacy-preserving voting contract using **Fully Homomorphic Encryption (FHE)** via the Fhenix CoFHE library. Votes are submitted as FHE-encrypted `euint32` weights. The contract accumulates them homomorphically — the running tally is always ciphertext until the poll closes and the Threshold Network decrypts each option.

**Wave 3 additions:** On-chain hierarchical option tree (`createHierarchicalPoll`), on-chain sub-category rollup (`rolledUpTallies`).  
**Wave 4 additions:** Community posts (`createPost`), community quests with FHE-encrypted progress (`createQuest`, `recordQuestProgress`, `requestProgressReveal`, `publishProgressResult`).

---

## Key FHE Pattern (Fhenix SDK v0.5+)

```
castVote()          → FHE.asEuint32 + FHE.add + FHE.allowThis
requestTallyReveal() → FHE.allowPublic only (NOT FHE.decrypt)
off-chain           → client.decryptForTx(ctHash).withoutPermit().execute()
publishTallyResult() → FHE.publishDecryptResult(tally, plaintext, signature)
```

> `FHE.decrypt` is the **old deprecated pattern** and causes reverts. Only `FHE.allowPublic` is called on-chain.

---

## Data Structures

### `Poll`
```solidity
struct Poll {
    bytes32  id;
    bytes32  communityId;
    address  creator;
    uint8    credType;
    uint32   startBlock;
    uint32   endBlock;        // L1 Ethereum block (not L2)
    uint8    optionCount;     // 2–32
    bool     tallyRevealed;
    bool     exists;
    bool     isHierarchical;
}
```

### `PollOption` (Wave 3)
```solidity
struct PollOption {
    uint8   optionId;    // 1-based
    uint8   parentId;    // 0 = root
    uint8   childCount;
    bytes32 labelHash;   // keccak256(label) — label stored off-chain
    bool    exists;
}
```

### `Post` (Wave 4)
```solidity
struct Post {
    bytes32 id;
    bytes32 communityId;
    address author;
    bytes32 contentHash;  // keccak256(IPFS CID)
    uint32  createdAt;
    bool    exists;
}
```

### `Quest` (Wave 4)
```solidity
enum QuestType { VOTE_COUNT, REFERRAL_COUNT, CREDENTIAL_AGE }

struct Quest {
    bytes32   id;
    bytes32   communityId;
    address   creator;
    QuestType questType;
    uint32    target;
    bytes32   rewardHash;
    uint32    expiryBlock;
    bool      exists;
}
```

---

## Functions

### Voting

#### `createPoll(pollId, communityId, credType, durationBlocks, optionCount)`
Creates a flat poll. `optionCount` must be 2–32.

#### `createHierarchicalPoll(pollId, communityId, credType, durationBlocks, optionCount, parentIds[], labelHashes[])`
Creates a poll with an on-chain option tree. `parentIds[i]` = parent of option `(i+1)` (1-based); `0` = root. Parent must precede child (no cycles).

#### `castVote(pollId, InEuint32[] weights)`
Submit FHE-encrypted per-option weights. `weights.length` must equal `optionCount`. Each weight is accumulated via `FHE.add` + `FHE.allowThis`.

#### `requestTallyReveal(pollId)`
After poll closes. Calls `FHE.allowPublic` per non-zero option tally. Stores ctHashes in `tallyCtHashes`. Options with zero votes (no submissions) are skipped.

#### `publishTallyResult(pollId, optionId, plaintext, signature)`
Verifies Threshold Network signature via `FHE.publishDecryptResult`, writes to `revealedTallies`. For hierarchical polls, also accumulates `plaintext` into `rolledUpTallies` for all ancestor nodes.

### Posts (Wave 4)

#### `createPost(postId, communityId, contentHash)`
Stores `keccak256(IPFS CID)` on-chain. Gated communities require a valid credential.

#### `getCommunityPostIds(communityId) → bytes32[]`

### Quests (Wave 4)

#### `createQuest(questId, communityId, questType, target, rewardHash, expiryBlock)`
Community creator only.

#### `recordQuestProgress(questId, participant, InEuint32 encProgress)`
Verifier wallet only. FHE-accumulates encrypted progress increment.

#### `requestProgressReveal(questId, participant)`
Calls `FHE.allowPublic` on the participant's progress ciphertext.

#### `publishProgressResult(questId, participant, plaintext, signature)`
Verifies Threshold Network signature. Marks `questCompleted[questId][participant] = true` if `plaintext >= quest.target`.

---

## Storage

| Mapping | Purpose |
|---|---|
| `_tallies[pollId][optionId]` | FHE-encrypted running tally (private, 0-based index) |
| `revealedTallies[pollId][optionId]` | Decrypted plaintext per option |
| `rolledUpTallies[pollId][optionId]` | Sum of option + all descendants (hierarchical only, 1-based) |
| `tallyCtHashes[pollId][optionId]` | ctHash set by `requestTallyReveal` |
| `pollOptions[pollId][optionId]` | On-chain option tree (1-based optionId) |
| `_questProgress[questId][address]` | FHE-encrypted quest progress (private) |
| `questProgressCtHash[questId][address]` | ctHash set by `requestProgressReveal` |
| `questCompleted[questId][address]` | Completion flag |

> **Index note:** `_tallies` uses 0-based index (loop variable `i`). `pollOptions` uses 1-based `optionId`. `publishTallyResult` converts: `pollOptions[pollId][optionId + 1]` for rollup lookup.

---

## Events

| Event | Fields |
|---|---|
| `CommunityRegistered` | `id`, `creator` |
| `PollCreated` | `pollId`, `communityId`, `endBlock` |
| `VoteCast` | `pollId`, `voter` |
| `TallyRevealed` | `pollId`, `optionCount` |
| `TallyPublished` | `pollId`, `optionId`, `plaintext` |
| `CredentialIssued` | `recipient`, `communityId`, `nullifier` |
| `PostCreated` | `postId`, `communityId`, `author` |
| `QuestCreated` | `questId`, `communityId` |
| `QuestProgressUpdated` | `questId`, `participant` |
| `QuestCompleted` | `questId`, `participant` |

---

## Deploy

```bash
cd contracts
npx hardhat run scripts/deploy.ts --network arbitrumSepolia
```

Writes ABI + address to `frontend/src/lib/abi.json` automatically.

**Required `.env`:**
```env
PRIVATE_KEY=<deployer key, no 0x>
VERIFIER_PRIVATE_KEY=<same key used in verifier/.env>
```

---

## Tests

```bash
cd contracts && npx hardhat test
# 34 passing
```

Key test patterns:
- `hre.cofhe.createClientWithBatteries(signer)` — CoFHE client for local mock
- `mock_getPlaintext(provider, ctHash)` — get decrypted value in mock env
- `MOCK_DECRYPT_SIGNER.signingKey.sign(hash)` — sign raw hash for `publishDecryptResult` (key: `0x59c6995e...`)

---

## Common Errors

| Revert | Cause |
|---|---|
| `Options: 2-32` | `optionCount` outside valid range |
| `parentIds length mismatch` | `parentIds.length != optionCount` |
| `Parent must precede child` | `parentIds[i] >= i+1` (cycle or forward reference) |
| `Poll still open` | `requestTallyReveal` before `endBlock` |
| `Already revealed` | `requestTallyReveal` called twice |
| `No credential` | Voter has no credential for this community |
| `Only verifier` | `recordQuestProgress` called by non-verifier |
| `Quest expired` | `block.number > quest.expiryBlock` |
