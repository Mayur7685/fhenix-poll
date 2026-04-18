# FhenixPoll — Smart Contract Guide

**Contract:** `FhenixPoll.sol`  
**Network:** Arbitrum Sepolia (Chain ID: `421614`)  
**Deployed address:** `0xd9836FA54D71c2745A26dABa48551E9745983676`  
**Solidity:** `^0.8.28` (EVM version: Cancun)  
**Framework:** Hardhat + `@cofhe/hardhat-plugin`

---

## Overview

`FhenixPoll` is a privacy-preserving voting contract that uses **Fully Homomorphic Encryption (FHE)** via the Fhenix CoFHE library. Votes are submitted as FHE-encrypted `euint32` weights. The contract accumulates them homomorphically — the running tally is always ciphertext, revealing nothing until the poll closes and the Threshold Network decrypts each option.

### Key design choices

| Property | Detail |
|---|---|
| Encryption | FHE `euint32` via `@fhenixprotocol/cofhe-contracts` |
| Tally decryption | Async — Threshold Network signs plaintext via `decryptForTx` |
| Credential issuance | EIP-712 attestations signed by an off-chain verifier |
| Anti-sybil | Social nullifiers (per identity per community) + nonces |
| Access control | `msg.sender` checked against stored `verifierAddress` (immutable) |

---

## File Structure

```
contracts/
├── contracts/
│   └── FhenixPoll.sol          # The contract
├── scripts/
│   └── deploy.ts               # Hardhat deploy script
├── test/
│   └── FhenixPoll.test.ts      # Full test suite
├── hardhat.config.ts           # Hardhat + CoFHE config
├── .env                        # PRIVATE_KEY + VERIFIER_PRIVATE_KEY
└── package.json
```

---

## Architecture: FHE Voting Flow

```
                    ┌─────────────────────────────────────────┐
                    │           FhenixPoll.sol                 │
                    │                                         │
  castVote()  ──►  │  _tallies[pollId][i] = FHE.add(tally,  │
  (euint32[])       │    FHE.asEuint32(weights[i]))           │
                    │  (ciphertext — never readable)           │
                    │                                         │
  requestTally ──►  │  FHE.allowPublic(_tallies[pollId][i])   │
  Reveal()          │  FHE.decrypt(_tallies[pollId][i])        │
                    │  tallyCtHashes[pollId][i] = ctHash      │
                    │                                         │
  publishTally ──►  │  FHE.publishDecryptResult(tally,        │
  Result()          │    plaintext, thresholdSig)             │
                    │  revealedTallies[pollId][i] = plaintext  │
                    └─────────────────────────────────────────┘
```

---

## Contract: `FhenixPoll.sol`

### Imports

```solidity
import {FHE, euint32, InEuint32} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
```

- **`FHE`** — Fhenix FHE library: `asEuint32`, `add`, `allowPublic`, `allowThis`, `decrypt`, `publishDecryptResult`
- **`euint32`** — FHE-encrypted uint32 type
- **`InEuint32`** — input struct for submitting ciphertext from the client
- **`ECDSA` / `EIP712`** — OpenZeppelin for verifier signature verification

### Constructor

```solidity
constructor(address _verifierAddress) EIP712("FhenixPoll", "1")
```

Sets `verifierAddress` as an **immutable** — the only address allowed to sign EIP-712 credential attestations. This is derived from `VERIFIER_PRIVATE_KEY` in the deploy script.

---

## Data Structures

### `Community`
```solidity
struct Community {
    bytes32 id;
    address creator;
    bytes32 configHash;  // keccak256 of IPFS CID — off-chain metadata pointer
    uint8   credType;    // 0=open, 1=gated, 2=multi-gate
    bool    exists;
}
```

### `Poll`
```solidity
struct Poll {
    bytes32  id;
    bytes32  communityId;
    address  creator;
    uint8    credType;
    uint32   startBlock;
    uint32   endBlock;       // L1 Ethereum block number (not L2)
    uint8    optionCount;    // 2–8 options
    bool     tallyRevealed;
    bool     exists;
}
```

> **Important:** `block.number` in the contract equals the **L1 Ethereum block number** on Arbitrum Sepolia, not the L2 block. When comparing against `endBlock` off-chain, read `l1BlockNumber` from Arbitrum block headers.

### `Credential`
```solidity
struct Credential {
    address  holder;
    bytes32  communityId;
    uint8    credType;
    uint64   votingWeight;  // scaled by 1e6 (1_000_000 = 100%)
    uint32   issuedAt;
    uint32   expiry;        // L1 block number
    bool     exists;
}
```

### `CredentialAttestation` (EIP-712)
```solidity
struct CredentialAttestation {
    address  recipient;
    bytes32  communityId;
    bytes32  nullifier;     // keccak256(VERIFIER_SECRET + platform + socialId + communityId)
    uint8    credType;
    uint64   votingWeight;
    uint32   expiryBlock;
    uint32   issuedAt;
    uint256  nonce;
}
```

The verifier signs this struct off-chain using EIP-712. The contract recovers the signer and checks it equals `verifierAddress`.

---

## Storage Mappings

| Mapping | Type | Purpose |
|---|---|---|
| `communities` | `bytes32 → Community` | All registered communities |
| `polls` | `bytes32 → Poll` | All polls |
| `_tallies` | `bytes32 → uint8 → euint32` | FHE-encrypted running tallies (private) |
| `revealedTallies` | `bytes32 → uint8 → uint32` | Decrypted plaintext tallies (public) |
| `tallyCtHashes` | `bytes32 → uint8 → bytes32` | ctHash per option (set by `requestTallyReveal`) |
| `hasVoted` | `bytes32 → address → bool` | Double-vote prevention |
| `credentials` | `address → bytes32 → Credential` | Holder credentials per community |
| `usedSocialNullifiers` | `bytes32 → bool` | Anti-sybil: one credential per social identity |
| `usedNonces` | `uint256 → bool` | Replay prevention for attestations |

---

## Functions

### `registerCommunity(bytes32 communityId, bytes32 configHash, uint8 credType)`

Registers a new community on-chain.

- `communityId` — `keccak256(communitySlug)` computed off-chain
- `configHash` — `keccak256` of the IPFS CID pointing to the community's JSON config
- `credType` — `0` = open, `1` = gated, `2` = multi-gate
- `msg.sender` becomes the community creator — only they can later call `createPoll`

Emits: `CommunityRegistered(communityId, creator)`

---

### `createPoll(bytes32 pollId, bytes32 communityId, uint8 credType, uint32 durationBlocks, uint8 optionCount)`

Creates a poll under a community.

- Caller must be the community creator
- `durationBlocks` is added to `block.number` (L1) to compute `endBlock`
- `optionCount` must be between 2 and 8
- Initialises `_tallies` implicitly at zero (FHE zero is the default)

Emits: `PollCreated(pollId, communityId, endBlock)`

---

### `castVote(bytes32 pollId, InEuint32[] calldata weights)`

Submit a ranked vote with FHE-encrypted per-option weights.

**Inputs:**
- `weights[i]` — encrypted contribution to option `i`, computed client-side:
  ```
  weight = floor(votingWeight * (1_000_000 / rank)) / 1_000_000
  ```
  Where `votingWeight` is the voter's `Credential.votingWeight` (scaled by 1e6) and `rank` is their ranking position for option `i` (1 = top choice).

**Checks:**
- Poll exists and is still open (`block.number <= endBlock`)
- `!hasVoted[pollId][msg.sender]`
- `weights.length == poll.optionCount`
- If `poll.credType != 0`: voter has a valid, non-expired credential for the poll's community

**FHE accumulation:**
```solidity
euint32 encWeight = FHE.asEuint32(weights[i]);
FHE.allowThis(encWeight);
if (euint32.unwrap(_tallies[pollId][i]) == 0) {
    _tallies[pollId][i] = encWeight;
} else {
    _tallies[pollId][i] = FHE.add(_tallies[pollId][i], encWeight);
    FHE.allowThis(_tallies[pollId][i]);
}
```

Emits: `VoteCast(pollId, voter)`

---

### `requestTallyReveal(bytes32 pollId)`

Triggers FHE decryption for all options after a poll closes.

**Checks:**
- `block.number > poll.endBlock` — poll must be closed
- `!poll.tallyRevealed` — idempotent guard

**What it does per option:**
1. Stores `euint32.unwrap(_tallies[pollId][i])` in `tallyCtHashes[pollId][i]` — the raw ciphertext handle readable by the tally runner
2. Calls `FHE.allowPublic(_tallies[pollId][i])` — permits public access via `decryptForTx(.withoutPermit())`
3. Calls `FHE.decrypt(_tallies[pollId][i])` — queues async decryption with the Threshold Network

**After this call:** Anyone can call `cofheClient.decryptForTx(ctHash).withoutPermit().execute()` against the Threshold Network to get `{ decryptedValue, signature }`.

Emits: `TallyRevealed(pollId, optionCount)`

---

### `publishTallyResult(bytes32 pollId, uint8 optionId, uint32 plaintext, bytes calldata signature)`

Writes the verified decrypted tally for one option.

- `plaintext` — the decrypted value returned by the Threshold Network
- `signature` — the Threshold Network's cryptographic proof that `plaintext` is correct for this ciphertext

**Verification:**
```solidity
FHE.publishDecryptResult(_tallies[pollId][optionId], plaintext, signature);
```
This calls `ITaskManager.publishDecryptResult` internally, which verifies the Threshold Network signature and reverts if it doesn't match.

**After verification:** stores `plaintext` in `revealedTallies[pollId][optionId]`.

Emits: `TallyPublished(pollId, optionId, plaintext)`

> This function is permissionless — anyone with a valid `(plaintext, signature)` pair from the Threshold Network can call it.

---

### `issueCredential(CredentialAttestation calldata attestation, bytes calldata signature)`

Issues a credential using a verifier-signed EIP-712 attestation.

**Checks:**
- `attestation.recipient == msg.sender` — can't claim someone else's credential
- Community exists
- `!usedSocialNullifiers[attestation.nullifier]` — prevents one social identity from getting multiple credentials
- `!usedNonces[attestation.nonce]` — replay prevention
- `ECDSA.recover(digest, signature) == verifierAddress` — verifies off-chain verifier signed it

**After checks:** writes `Credential` into `credentials[recipient][communityId]`, marks nullifier and nonce as used.

Emits: `CredentialIssued(recipient, communityId, nullifier)`

---

### View Functions

| Function | Returns |
|---|---|
| `getPoll(pollId)` | `Poll` struct |
| `getCommunity(communityId)` | `Community` struct |
| `getRevealedTally(pollId, optionId)` | `uint32` plaintext tally |
| `getCredential(holder, communityId)` | `Credential` struct |
| `tallyCtHashes(pollId, optionId)` | `bytes32` ctHash (public mapping) |
| `hasVoted(pollId, address)` | `bool` |
| `verifierAddress` | `address` (immutable) |

---

## Events

| Event | Emitted by | Fields |
|---|---|---|
| `CommunityRegistered` | `registerCommunity` | `id`, `creator` |
| `PollCreated` | `createPoll` | `pollId`, `communityId`, `endBlock` |
| `VoteCast` | `castVote` | `pollId`, `voter` |
| `TallyRevealed` | `requestTallyReveal` | `pollId`, `optionCount` |
| `TallyPublished` | `publishTallyResult` | `pollId`, `optionId`, `plaintext` |
| `CredentialIssued` | `issueCredential` | `recipient`, `communityId`, `nullifier` |

---

## EIP-712 Domain

```
name:              "FhenixPoll"
version:           "1"
chainId:           421614  (Arbitrum Sepolia)
verifyingContract: <deployed address>
```

**`CredentialAttestation` type hash:**
```
CredentialAttestation(
  address recipient,
  bytes32 communityId,
  bytes32 nullifier,
  uint8 credType,
  uint64 votingWeight,
  uint32 expiryBlock,
  uint32 issuedAt,
  uint256 nonce
)
```

---

## Voting Weight Encoding

`votingWeight` is scaled by `1_000_000` (1e6). A voter with full voting power gets `votingWeight = 1_000_000`.

Rankings map to encrypted weights submitted via `castVote`:

| Rank | Formula | Value (full weight) |
|---|---|---|
| 1st choice | `1_000_000 / 1` | `1_000_000` |
| 2nd choice | `1_000_000 / 2` | `500_000` |
| 3rd choice | `1_000_000 / 3` | `333_333` |
| 4th choice | `1_000_000 / 4` | `250_000` |
| ... | ... | ... |
| Not ranked | — | `0` |

The off-chain tally runner reads `revealedTallies[pollId][i]` after `publishTallyResult` and ranks options by their total accumulated weight.

---

## Deploy Script (`scripts/deploy.ts`)

The deploy script:
1. Reads `VERIFIER_PRIVATE_KEY` from env and derives the verifier EVM address using `viem/accounts`
2. Deploys `FhenixPoll(verifierAddress)` via Hardhat + Ethers
3. Writes the ABI + deployed address to `frontend/src/lib/abi.json` automatically

```bash
# Deploy to Arbitrum Sepolia
npm run deploy:arb-sepolia

# Deploy to local CoFHE node (for testing)
npm run deploy:local
```

**Required `.env`:**
```env
PRIVATE_KEY=<deployer private key, no 0x prefix>
VERIFIER_PRIVATE_KEY=<same key used in verifier/.env — the EIP-712 signer>
RPC_URL=https://sepolia-rollup.arbitrum.io/rpc  # optional override
```

> `PRIVATE_KEY` (deployer) and `VERIFIER_PRIVATE_KEY` (attestation signer) can be the same key for simplicity, or different keys for better security separation.

---

## Tests (`test/FhenixPoll.test.ts`)

Tests run against the local `localcofhe` network using `@cofhe/hardhat-plugin`, which provides a mock FHE environment — no real Threshold Network needed.

```bash
# Start local CoFHE node (in a separate terminal)
npx hardhat node --network localcofhe

# Run tests
npm test
```

### Test coverage

| Suite | Cases |
|---|---|
| **Community** | registers; rejects duplicate ID |
| **Polls** | creates; rejects non-creator; rejects <2 or >8 options |
| **Voting (open poll)** | casts encrypted vote; prevents double-vote; rejects wrong option count; rejects vote on closed poll |
| **Tally Reveal** | requests reveal after close; rejects while open; rejects double reveal |
| **Credentials** | issues with valid attestation; rejects wrong signer; rejects replayed nullifier; rejects replayed nonce; enforces credential gate |

### Key test pattern

The test helper `hre.cofhe.createClientWithBatteries(signer)` creates a CoFHE client wired to the local mock node. Use `client.encryptInputs([Encryptable.uint32(value)])` to produce `InEuint32[]` suitable for `castVote`:

```typescript
const client = await hre.cofhe.createClientWithBatteries(voter);
const weights = await client
  .encryptInputs([
    Encryptable.uint32(1_000_000n),  // rank 1
    Encryptable.uint32(500_000n),    // rank 2
    Encryptable.uint32(0n),          // not ranked
  ])
  .execute();
await contract.connect(voter).castVote(POLL_ID, weights);
```

EIP-712 signatures in tests use `signer.signTypedData(domain, types, value)` from ethers v6.

---

## Hardhat Configuration (`hardhat.config.ts`)

```typescript
cofhe: {
  gasWarning: false,   // suppress CoFHE gas estimation warnings
},
solidity: {
  version: '0.8.28',
  settings: {
    evmVersion: 'cancun',      // required for FHE transient storage opcodes
    optimizer: { enabled: true, runs: 200 },
  },
},
networks: {
  localcofhe:    { url: 'http://127.0.0.1:8545', chainId: 31337 },
  arbitrumSepolia: { url: process.env.RPC_URL ?? '...', chainId: 421614 },
},
```

> `evmVersion: 'cancun'` is required — the CoFHE precompiles depend on EIP-1153 transient storage introduced in Cancun.

---

## Security Notes

- **`verifierAddress` is immutable** — cannot be changed after deploy. If the verifier key is compromised, a new contract must be deployed.
- **Social nullifiers** prevent one social identity from getting multiple credentials even if they create multiple EVM wallets.
- **Nonces** prevent attestation replay — each attestation can only be used once.
- **`FHE.publishDecryptResult`** verifies the Threshold Network's signature on-chain — the tally runner cannot forge results; it can only submit a valid decryption.
- **`_tallies` is private storage** — the ciphertext cannot be read directly; only the contract's FHE operations can touch it.
- **`tallyCtHashes` is public** — populated only after `requestTallyReveal`, this lets the tally runner call `decryptForTx` without any privileged access.

---

## Common Errors

| Revert message | Cause |
|---|---|
| `Community exists` | `communityId` already registered |
| `Not community creator` | Caller is not the creator of the community |
| `Options: 2-8` | `optionCount` outside valid range |
| `Poll closed` | `block.number > poll.endBlock` at vote time |
| `Already voted` | Nullifier for this address+poll already set |
| `Wrong option count` | `weights.length != poll.optionCount` |
| `No credential` | Voter has no credential for this community |
| `Credential expired` | `block.number > cred.expiry` |
| `Poll still open` | `requestTallyReveal` called before `endBlock` |
| `Already revealed` | `requestTallyReveal` called twice |
| `Reveal not requested` | `publishTallyResult` called before `requestTallyReveal` |
| `Invalid optionId` | `optionId >= poll.optionCount` |
| `Not your credential` | `attestation.recipient != msg.sender` |
| `Nullifier already used` | Same social identity used in this community before |
| `Nonce already used` | Attestation nonce was already consumed |
| `Invalid verifier signature` | EIP-712 signature doesn't match `verifierAddress` |
