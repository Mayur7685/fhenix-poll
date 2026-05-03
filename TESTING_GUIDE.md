# ZKPoll — Testing Guide

**Contract:** `FhenixPoll.sol` on Arbitrum Sepolia (`0x9dC0044FdB877F1F017D5853150b0B9725b26397`)  
**Chain ID:** 421614 (Arbitrum Sepolia)

---

## Prerequisites

- MetaMask or any EVM wallet on Arbitrum Sepolia
- ~0.01 Arbitrum Sepolia ETH ([faucet](https://faucet.quicknode.com/arbitrum/sepolia))
- Node.js 18+

---

## Local Setup

### 1. Verifier
```bash
cd zkpoll/verifier
cp .env.example .env
# Required: VERIFIER_PRIVATE_KEY, FHENIX_CONTRACT_ADDRESS, DEPLOYMENT_L2_BLOCK
npm install && npm run dev
# → http://localhost:3001
```

### 2. Frontend
```bash
cd zkpoll/frontend
cp .env.example .env
# Set: VITE_CONTRACT_ADDRESS=0x9dC0044FdB877F1F017D5853150b0B9725b26397
# Set: VITE_VERIFIER_URL=http://localhost:3001
npm install && npm run dev
# → http://localhost:5173
```

### 3. Unit tests
```bash
cd zkpoll/contracts && npx hardhat test
# 34 passing
```

---

## Feature Testing

### Community
1. Connect wallet → **Create Community**
2. Fill name, description, credential type (use **Open** for fastest testing)
3. Approve wallet tx → community appears in feed

### Credential (Open community)
1. Community page → **Get Credential** → **Verify**
2. Approve `issueCredential` tx
3. EV/VP%/CV panel appears

### Flat Poll
1. Community page → **+ Poll** → select **Flat** type
2. Duration: `1blk` (dev mode — closes in ~12s)
3. Add 3+ options → **Deploy** → approve tx

### Hierarchical Poll
1. **+ Poll** → select **Hierarchical** type
2. Add root options, click **+ Sub** to add children
3. Deploy → verify tree on-chain:
```bash
cast call 0x9dC0044FdB877F1F017D5853150b0B9725b26397 \
  "getPollOption(bytes32,uint8)((uint8,uint8,uint8,bytes32,bool))" \
  <POLL_ID> 3 --rpc-url https://sepolia-rollup.arbitrum.io/rpc
```

### Vote
1. Open poll → **Vote** tab → rank options → **Submit Vote**
2. Confirm modal shows all ranked options (including sub-options)
3. Approve tx → "Vote Submitted" screen

### Tally (automated)
Tally runner checks every 60s. After poll closes (~12s for 1blk):
```
[tally] requestTallyReveal confirmed: 0x...
[tally] option 0: published plaintext=1000000
[tally] Poll fully tallied.
```

Manual trigger:
```bash
curl -X POST http://localhost:3001/admin/tally/<POLL_ID> \
  -H "x-admin-secret: <ADMIN_SECRET>"
```

### Results
- Navigate to poll → **Results →**
- Flat poll: bar chart sorted by score
- Hierarchical poll: nested tree with parent rollup totals and "subtotal" badge

Verify on-chain:
```bash
cast call 0x9dC0044FdB877F1F017D5853150b0B9725b26397 \
  "getRevealedTally(bytes32,uint8)(uint32)" <POLL_ID> 0 \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc

# For hierarchical rollup:
cast call 0x9dC0044FdB877F1F017D5853150b0B9725b26397 \
  "rolledUpTallies(bytes32,uint8)(uint32)" <POLL_ID> 1 \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc
```

### Posts
1. Community page → **Posts** tab → **View Posts** → **+ New Post**
2. Fill title + body → **Publish** → approve tx
3. Post appears with IPFS link

### Quests (community creator only)
1. Community page → **Quests** tab → **View Quests** → **+ New Quest**
2. Type: `VOTE_COUNT`, Target: `2`, Expires: `30` days → **Create Quest**
3. Vote in 2 polls → quest runner auto-records progress (120s interval)
4. Quest card → **Check progress** → progress bar updates

Manual progress update:
```bash
curl -X POST http://localhost:3001/quests/<QUEST_ID>/progress \
  -H "x-admin-secret: <ADMIN_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"participant":"<ADDRESS>","progress":2,"completed":false}'
```

---

## Common Issues

| Symptom | Fix |
|---|---|
| Tally reverts with no reason | Poll has no votes — tally runner skips it automatically |
| "FHE key error" on vote | Fhenix testnet node temporarily unavailable — retry in a few minutes |
| Results page stuck loading | Hard refresh; check browser console for errors |
| Old polls not tallying | Clear verifier cache: `rm -rf verifier/communities/*` and restart |
| "Poll still open" revert | Tally runner waits `endBlock + 2` L1 blocks before attempting reveal |

---

## Arbiscan

- Contract: https://sepolia.arbiscan.io/address/0x9dC0044FdB877F1F017D5853150b0B9725b26397
- Events: https://sepolia.arbiscan.io/address/0x9dC0044FdB877F1F017D5853150b0B9725b26397#events
