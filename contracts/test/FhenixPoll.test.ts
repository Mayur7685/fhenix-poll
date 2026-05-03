import hre from 'hardhat';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Encryptable } from '@cofhe/sdk';
import { mock_getPlaintext } from '@cofhe/hardhat-plugin';
import type { FhenixPoll } from '../typechain-types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const COMMUNITY_ID = ethers.keccak256(ethers.toUtf8Bytes('test-community'));
const POLL_ID      = ethers.keccak256(ethers.toUtf8Bytes('test-poll'));
const CONFIG_HASH  = ethers.keccak256(ethers.toUtf8Bytes('bafybeig...'));

// Mock decrypt-result signer key (from @cofhe/sdk MOCKS_DECRYPT_RESULT_SIGNER_PRIVATE_KEY)
const MOCK_DECRYPT_SIGNER = new ethers.Wallet(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
);

/** Sign a decrypt result the same way MockTaskManager._verifyDecryptResult expects (raw hash, no eth prefix) */
async function signDecryptResult(ctHash: string, plaintext: number): Promise<string> {
  const msg = ethers.solidityPackedKeccak256(['uint256', 'uint256'], [BigInt(ctHash), BigInt(plaintext)])
  // Sign raw hash — MockTaskManager uses ECDSA.tryRecover without toEthSignedMessageHash
  return MOCK_DECRYPT_SIGNER.signingKey.sign(msg).serialized
}

async function mineBlocks(n: number) {
  for (let i = 0; i < n; i++) {
    await hre.network.provider.send('evm_mine', []);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FhenixPoll', () => {
  let contract: FhenixPoll;
  let deployer: Awaited<ReturnType<typeof hre.ethers.getSigner>>;
  let voter:    Awaited<ReturnType<typeof hre.ethers.getSigner>>;
  let verifier: Awaited<ReturnType<typeof hre.ethers.getSigner>>;

  beforeEach(async () => {
    [deployer, voter, verifier] = await hre.ethers.getSigners();

    const Factory = await hre.ethers.getContractFactory('FhenixPoll');
    contract = (await Factory.deploy(verifier.address)) as unknown as FhenixPoll;
    await contract.waitForDeployment();
  });

  // ── Community ───────────────────────────────────────────────────────────────

  describe('Community', () => {
    it('registers a community', async () => {
      await expect(contract.registerCommunity(COMMUNITY_ID, CONFIG_HASH, 0))
        .to.emit(contract, 'CommunityRegistered')
        .withArgs(COMMUNITY_ID, deployer.address);

      const c = await contract.getCommunity(COMMUNITY_ID);
      expect(c.creator).to.equal(deployer.address);
      expect(c.configHash).to.equal(CONFIG_HASH);
      expect(c.credType).to.equal(0);
      expect(c.exists).to.be.true;
    });

    it('rejects duplicate community id', async () => {
      await contract.registerCommunity(COMMUNITY_ID, CONFIG_HASH, 0);
      await expect(contract.registerCommunity(COMMUNITY_ID, CONFIG_HASH, 0))
        .to.be.revertedWith('Community exists');
    });
  });

  // ── Polls ────────────────────────────────────────────────────────────────────

  describe('Polls', () => {
    beforeEach(async () => {
      await contract.registerCommunity(COMMUNITY_ID, CONFIG_HASH, 0);
    });

    it('creates a poll', async () => {
      await expect(contract.createPoll(POLL_ID, COMMUNITY_ID, 0, 100, 3))
        .to.emit(contract, 'PollCreated');

      const p = await contract.getPoll(POLL_ID);
      expect(p.optionCount).to.equal(3);
      expect(p.credType).to.equal(0);
      expect(p.exists).to.be.true;
    });

    it('rejects poll from non-community-creator', async () => {
      await expect(
        contract.connect(voter).createPoll(POLL_ID, COMMUNITY_ID, 0, 100, 3)
      ).to.be.revertedWith('Not community creator');
    });

    it('rejects poll with too few options', async () => {
      await expect(contract.createPoll(POLL_ID, COMMUNITY_ID, 0, 100, 1))
        .to.be.revertedWith('Options: 2-32');
    });

    it('rejects poll with too many options', async () => {
      await expect(contract.createPoll(POLL_ID, COMMUNITY_ID, 0, 100, 33))
        .to.be.revertedWith('Options: 2-32');
    });
  });

  // ── Voting ───────────────────────────────────────────────────────────────────

  describe('Voting (open poll)', () => {
    const OPTION_COUNT = 3;

    beforeEach(async () => {
      await contract.registerCommunity(COMMUNITY_ID, CONFIG_HASH, 0);
      await contract.createPoll(POLL_ID, COMMUNITY_ID, 0, 200, OPTION_COUNT);
    });

    it('casts an encrypted vote', async () => {
      const client = await hre.cofhe.createClientWithBatteries(voter);

      // Compute weights: rank 1 → 1_000_000, rank 2 → 500_000, rank 3 → 333_333
      const rawWeights = [1_000_000n, 500_000n, 333_333n];
      const encrypted = await client
        .encryptInputs(rawWeights.map(w => Encryptable.uint32(w)))
        .execute();

      await expect(
        contract.connect(voter).castVote(POLL_ID, encrypted)
      )
        .to.emit(contract, 'VoteCast')
        .withArgs(POLL_ID, voter.address);

      expect(await contract.hasVoted(POLL_ID, voter.address)).to.be.true;
    });

    it('prevents double voting', async () => {
      const client = await hre.cofhe.createClientWithBatteries(voter);
      const weights = await client
        .encryptInputs([Encryptable.uint32(1_000_000n), Encryptable.uint32(0n), Encryptable.uint32(0n)])
        .execute();

      await contract.connect(voter).castVote(POLL_ID, weights);

      const weights2 = await client
        .encryptInputs([Encryptable.uint32(1_000_000n), Encryptable.uint32(0n), Encryptable.uint32(0n)])
        .execute();

      await expect(
        contract.connect(voter).castVote(POLL_ID, weights2)
      ).to.be.revertedWith('Already voted');
    });

    it('rejects wrong option count', async () => {
      const client = await hre.cofhe.createClientWithBatteries(voter);
      // Only 2 weights for a 3-option poll
      const weights = await client
        .encryptInputs([Encryptable.uint32(1_000_000n), Encryptable.uint32(0n)])
        .execute();

      await expect(
        contract.connect(voter).castVote(POLL_ID, weights)
      ).to.be.revertedWith('Wrong option count');
    });

    it('rejects vote on closed poll', async () => {
      await mineBlocks(201);

      const client = await hre.cofhe.createClientWithBatteries(voter);
      const weights = await client
        .encryptInputs([Encryptable.uint32(0n), Encryptable.uint32(0n), Encryptable.uint32(1_000_000n)])
        .execute();

      await expect(
        contract.connect(voter).castVote(POLL_ID, weights)
      ).to.be.revertedWith('Poll closed');
    });
  });

  // ── Tally Reveal ─────────────────────────────────────────────────────────────

  describe('Tally Reveal', () => {
    const OPTION_COUNT = 2;

    beforeEach(async () => {
      await contract.registerCommunity(COMMUNITY_ID, CONFIG_HASH, 0);
      await contract.createPoll(POLL_ID, COMMUNITY_ID, 0, 50, OPTION_COUNT);
    });

    it('requests tally reveal after poll closes', async () => {
      const client = await hre.cofhe.createClientWithBatteries(voter);
      const weights = await client
        .encryptInputs([Encryptable.uint32(1_000_000n), Encryptable.uint32(0n)])
        .execute();

      await contract.connect(voter).castVote(POLL_ID, weights);
      await mineBlocks(51);

      await expect(contract.requestTallyReveal(POLL_ID))
        .to.emit(contract, 'TallyRevealed')
        .withArgs(POLL_ID, OPTION_COUNT);

      const poll = await contract.getPoll(POLL_ID);
      expect(poll.tallyRevealed).to.be.true;
    });

    it('rejects reveal while poll is open', async () => {
      await expect(contract.requestTallyReveal(POLL_ID))
        .to.be.revertedWith('Poll still open');
    });

    it('rejects double reveal', async () => {
      // Cast a vote so tallies are non-zero (FHE.allowPublic requires a real ctHash)
      const client = await hre.cofhe.createClientWithBatteries(voter);
      const weights = await client
        .encryptInputs([Encryptable.uint32(1_000_000n), Encryptable.uint32(0n)])
        .execute();
      await contract.connect(voter).castVote(POLL_ID, weights);
      await mineBlocks(51);
      await contract.requestTallyReveal(POLL_ID);
      await expect(contract.requestTallyReveal(POLL_ID))
        .to.be.revertedWith('Already revealed');
    });
  });

  // ── Credentials ──────────────────────────────────────────────────────────────

  describe('Credentials', () => {
    beforeEach(async () => {
      await contract.registerCommunity(COMMUNITY_ID, CONFIG_HASH, 1); // credType=1 (gated)
    });

    async function buildAndSignAttestation(
      recipientAddr: string,
      overrides: Partial<{
        nullifier: string;
        nonce: bigint;
        expiryBlock: number;
      }> = {}
    ) {
      const blockNum = await hre.ethers.provider.getBlockNumber();
      const attestation = {
        recipient:    recipientAddr,
        communityId:  COMMUNITY_ID,
        nullifier:    overrides.nullifier ?? ethers.keccak256(ethers.toUtf8Bytes('social-id-1')),
        credType:     1,
        votingWeight: 1_000_000n,
        expiryBlock:  overrides.expiryBlock ?? blockNum + 10_000,
        issuedAt:     blockNum,
        nonce:        overrides.nonce ?? BigInt(Date.now()),
      };

      const contractAddress = await contract.getAddress();
      const chainId = (await hre.ethers.provider.getNetwork()).chainId;

      const domain = {
        name: 'FhenixPoll',
        version: '1',
        chainId,
        verifyingContract: contractAddress,
      };

      const types = {
        CredentialAttestation: [
          { name: 'recipient',    type: 'address' },
          { name: 'communityId',  type: 'bytes32'  },
          { name: 'nullifier',    type: 'bytes32'  },
          { name: 'credType',     type: 'uint8'    },
          { name: 'votingWeight', type: 'uint64'   },
          { name: 'expiryBlock',  type: 'uint32'   },
          { name: 'issuedAt',     type: 'uint32'   },
          { name: 'nonce',        type: 'uint256'  },
        ],
      };

      const signature = await verifier.signTypedData(domain, types, attestation);
      return { attestation, signature };
    }

    it('issues a credential with valid attestation', async () => {
      const { attestation, signature } = await buildAndSignAttestation(voter.address);

      await expect(
        contract.connect(voter).issueCredential(attestation, signature)
      )
        .to.emit(contract, 'CredentialIssued')
        .withArgs(voter.address, COMMUNITY_ID, attestation.nullifier);

      const cred = await contract.getCredential(voter.address, COMMUNITY_ID);
      expect(cred.exists).to.be.true;
      expect(cred.votingWeight).to.equal(1_000_000n);
    });

    it('rejects credential with wrong signer', async () => {
      const { attestation, signature } = await buildAndSignAttestation(voter.address);
      // Sign with deployer instead of verifier
      const badSig = await deployer.signTypedData(
        {
          name: 'FhenixPoll',
          version: '1',
          chainId: (await hre.ethers.provider.getNetwork()).chainId,
          verifyingContract: await contract.getAddress(),
        },
        {
          CredentialAttestation: [
            { name: 'recipient',    type: 'address' },
            { name: 'communityId',  type: 'bytes32'  },
            { name: 'nullifier',    type: 'bytes32'  },
            { name: 'credType',     type: 'uint8'    },
            { name: 'votingWeight', type: 'uint64'   },
            { name: 'expiryBlock',  type: 'uint32'   },
            { name: 'issuedAt',     type: 'uint32'   },
            { name: 'nonce',        type: 'uint256'  },
          ],
        },
        attestation
      );
      void signature; // suppress unused warning
      await expect(
        contract.connect(voter).issueCredential(attestation, badSig)
      ).to.be.revertedWith('Invalid verifier signature');
    });

    it('rejects replayed nullifier', async () => {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('same-social-id'));
      const { attestation: a1, signature: s1 } = await buildAndSignAttestation(voter.address, { nullifier, nonce: 1n });
      await contract.connect(voter).issueCredential(a1, s1);

      // Second wallet tries same social identity
      const [, , , secondWallet] = await hre.ethers.getSigners();
      const { attestation: a2, signature: s2 } = await buildAndSignAttestation(secondWallet.address, { nullifier, nonce: 2n });
      await expect(
        contract.connect(secondWallet).issueCredential(a2, s2)
      ).to.be.revertedWith('Nullifier already used');
    });

    it('rejects replayed nonce', async () => {
      const nonce = 99n;
      const { attestation: a1, signature: s1 } = await buildAndSignAttestation(
        voter.address, { nonce, nullifier: ethers.keccak256(ethers.toUtf8Bytes('social-1')) }
      );
      await contract.connect(voter).issueCredential(a1, s1);

      // Different nullifier but same nonce
      const { attestation: a2, signature: s2 } = await buildAndSignAttestation(
        voter.address, { nonce, nullifier: ethers.keccak256(ethers.toUtf8Bytes('social-2')) }
      );
      await expect(
        contract.connect(voter).issueCredential(a2, s2)
      ).to.be.revertedWith('Nonce already used');
    });

    it('enforces credential gate on gated poll', async () => {
      const pollId = ethers.keccak256(ethers.toUtf8Bytes('gated-poll'));
      await contract.createPoll(pollId, COMMUNITY_ID, 1, 200, 2);

      const client = await hre.cofhe.createClientWithBatteries(voter);
      const weights = await client
        .encryptInputs([Encryptable.uint32(1_000_000n), Encryptable.uint32(0n)])
        .execute();

      // Voter has no credential — should revert
      await expect(
        contract.connect(voter).castVote(pollId, weights)
      ).to.be.revertedWith('No credential');

      // Issue credential, then vote should succeed
      const { attestation, signature } = await buildAndSignAttestation(voter.address);
      await contract.connect(voter).issueCredential(attestation, signature);

      const weights2 = await client
        .encryptInputs([Encryptable.uint32(1_000_000n), Encryptable.uint32(0n)])
        .execute();
      await expect(
        contract.connect(voter).castVote(pollId, weights2)
      ).to.emit(contract, 'VoteCast');
    });
  });

  // ── Hierarchical Polls ───────────────────────────────────────────────────────

  describe('Hierarchical Polls', () => {
    const HIER_POLL_ID = ethers.keccak256(ethers.toUtf8Bytes('hier-poll'));

    beforeEach(async () => {
      await contract.registerCommunity(COMMUNITY_ID, CONFIG_HASH, 0);
    });

    // 4 root options (1-4) + 2 children each (5-12) = 12 total
    // parentIds[i] = parent of option (i+1): roots have 0, children point to parent
    const parentIds   = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4];
    const labelHashes = parentIds.map((_, i) =>
      ethers.keccak256(ethers.toUtf8Bytes(`option-${i + 1}`))
    );

    it('creates a hierarchical poll and stores option tree', async () => {
      await expect(
        contract.createHierarchicalPoll(HIER_POLL_ID, COMMUNITY_ID, 0, 100, 12, parentIds, labelHashes)
      ).to.emit(contract, 'PollCreated');

      const poll = await contract.getPoll(HIER_POLL_ID);
      expect(poll.isHierarchical).to.be.true;
      expect(poll.optionCount).to.equal(12);

      // Root option 1 should have 2 children (options 5 and 6)
      const opt1 = await contract.getPollOption(HIER_POLL_ID, 1);
      expect(opt1.parentId).to.equal(0);
      expect(opt1.childCount).to.equal(2);

      // Child option 5 should have parent 1
      const opt5 = await contract.getPollOption(HIER_POLL_ID, 5);
      expect(opt5.parentId).to.equal(1);
      expect(opt5.childCount).to.equal(0);
    });

    it('rejects parentIds with wrong length', async () => {
      await expect(
        contract.createHierarchicalPoll(HIER_POLL_ID, COMMUNITY_ID, 0, 100, 12, [0, 0], labelHashes)
      ).to.be.revertedWith('parentIds length mismatch');
    });

    it('rejects parent that does not precede child', async () => {
      // parentIds[0] = 5 means option 1 has parent 5, but 5 > 1 — cycle
      const badParents = [5, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4];
      await expect(
        contract.createHierarchicalPoll(HIER_POLL_ID, COMMUNITY_ID, 0, 100, 12, badParents, labelHashes)
      ).to.be.revertedWith('Parent must precede child');
    });

    it('rolls up tally to parent on publishTallyResult', async () => {
      await contract.createHierarchicalPoll(HIER_POLL_ID, COMMUNITY_ID, 0, 100, 12, parentIds, labelHashes);

      const client = await hre.cofhe.createClientWithBatteries(voter);
      // Vote: give option 5 (child of 1) weight 500_000, everything else 0
      const rawWeights = new Array(12).fill(0n);
      rawWeights[4] = 500_000n; // option 5 is index 4 (0-based)
      const encrypted = await client
        .encryptInputs(rawWeights.map(w => Encryptable.uint32(w)))
        .execute();

      await contract.connect(voter).castVote(HIER_POLL_ID, encrypted);
      await mineBlocks(101);
      await contract.requestTallyReveal(HIER_POLL_ID);

      // Simulate Threshold Network: publish result for option 5 (index 4)
      const ctHash = await contract.tallyCtHashes(HIER_POLL_ID, 4);
      const decryptedValue = await mock_getPlaintext(hre.ethers.provider, ctHash);
      const sig = await signDecryptResult(ctHash, Number(decryptedValue));
      await contract.publishTallyResult(HIER_POLL_ID, 4, decryptedValue, sig);

      // rolledUpTallies for parent option 1 (1-based, stored at index 1) should include child's tally
      const rolled = await contract.rolledUpTallies(HIER_POLL_ID, 1);
      expect(rolled).to.equal(decryptedValue);
    });
  });

  // ── Posts ────────────────────────────────────────────────────────────────────

  describe('Posts', () => {
    const POST_ID    = ethers.keccak256(ethers.toUtf8Bytes('post-1'));
    const CONTENT_H  = ethers.keccak256(ethers.toUtf8Bytes('ipfs://bafybeig...'));

    beforeEach(async () => {
      await contract.registerCommunity(COMMUNITY_ID, CONFIG_HASH, 0); // open
    });

    it('creates a post on an open community', async () => {
      await expect(contract.connect(voter).createPost(POST_ID, COMMUNITY_ID, CONTENT_H))
        .to.emit(contract, 'PostCreated')
        .withArgs(POST_ID, COMMUNITY_ID, voter.address);

      const post = await contract.getPost(POST_ID);
      expect(post.author).to.equal(voter.address);
      expect(post.contentHash).to.equal(CONTENT_H);
      expect(post.exists).to.be.true;
    });

    it('rejects duplicate post id', async () => {
      await contract.connect(voter).createPost(POST_ID, COMMUNITY_ID, CONTENT_H);
      await expect(contract.connect(voter).createPost(POST_ID, COMMUNITY_ID, CONTENT_H))
        .to.be.revertedWith('Post exists');
    });

    it('rejects post on gated community without credential', async () => {
      const gatedId = ethers.keccak256(ethers.toUtf8Bytes('gated-comm'));
      await contract.registerCommunity(gatedId, CONFIG_HASH, 1);
      await expect(contract.connect(voter).createPost(POST_ID, gatedId, CONTENT_H))
        .to.be.revertedWith('No credential');
    });

    it('getCommunityPostIds returns post ids', async () => {
      await contract.connect(voter).createPost(POST_ID, COMMUNITY_ID, CONTENT_H);
      const ids = await contract.getCommunityPostIds(COMMUNITY_ID);
      expect(ids).to.include(POST_ID);
    });
  });

  // ── Quests ───────────────────────────────────────────────────────────────────

  describe('Quests', () => {
    const QUEST_ID   = ethers.keccak256(ethers.toUtf8Bytes('quest-1'));
    const REWARD_H   = ethers.keccak256(ethers.toUtf8Bytes('reward-metadata'));
    const VOTE_COUNT = 0; // QuestType.VOTE_COUNT

    beforeEach(async () => {
      await contract.registerCommunity(COMMUNITY_ID, CONFIG_HASH, 0);
    });

    async function createQuest(target = 3) {
      const blockNum = await hre.ethers.provider.getBlockNumber();
      return contract.createQuest(QUEST_ID, COMMUNITY_ID, VOTE_COUNT, target, REWARD_H, blockNum + 10_000);
    }

    it('creates a quest', async () => {
      await expect(createQuest())
        .to.emit(contract, 'QuestCreated')
        .withArgs(QUEST_ID, COMMUNITY_ID);

      const quest = await contract.getQuest(QUEST_ID);
      expect(quest.target).to.equal(3);
      expect(quest.exists).to.be.true;
    });

    it('rejects quest from non-creator', async () => {
      const blockNum = await hre.ethers.provider.getBlockNumber();
      await expect(
        contract.connect(voter).createQuest(QUEST_ID, COMMUNITY_ID, VOTE_COUNT, 3, REWARD_H, blockNum + 10_000)
      ).to.be.revertedWith('Not community creator');
    });

    it('rejects quest with zero target', async () => {
      const blockNum = await hre.ethers.provider.getBlockNumber();
      await expect(
        contract.createQuest(QUEST_ID, COMMUNITY_ID, VOTE_COUNT, 0, REWARD_H, blockNum + 10_000)
      ).to.be.revertedWith('Target must be > 0');
    });

    it('recordQuestProgress accumulates FHE values', async () => {
      await createQuest(3);
      const client = await hre.cofhe.createClientWithBatteries(verifier);

      const [enc1] = await client.encryptInputs([Encryptable.uint32(1n)]).execute();
      await expect(
        contract.connect(verifier).recordQuestProgress(QUEST_ID, voter.address, enc1)
      ).to.emit(contract, 'QuestProgressUpdated').withArgs(QUEST_ID, voter.address);

      const [enc2] = await client.encryptInputs([Encryptable.uint32(1n)]).execute();
      await contract.connect(verifier).recordQuestProgress(QUEST_ID, voter.address, enc2);
    });

    it('rejects recordQuestProgress from non-verifier', async () => {
      await createQuest(3);
      const client = await hre.cofhe.createClientWithBatteries(voter);
      const [enc] = await client.encryptInputs([Encryptable.uint32(1n)]).execute();
      await expect(
        contract.connect(voter).recordQuestProgress(QUEST_ID, voter.address, enc)
      ).to.be.revertedWith('Only verifier');
    });

    it('marks quest complete when progress >= target', async () => {
      await createQuest(2);
      const client = await hre.cofhe.createClientWithBatteries(verifier);

      // Record 2 increments
      for (let i = 0; i < 2; i++) {
        const [enc] = await client.encryptInputs([Encryptable.uint32(1n)]).execute();
        await contract.connect(verifier).recordQuestProgress(QUEST_ID, voter.address, enc);
      }

      await contract.requestProgressReveal(QUEST_ID, voter.address);
      const ctHash = await contract.questProgressCtHash(QUEST_ID, voter.address);
      const decryptedValue = await mock_getPlaintext(hre.ethers.provider, ctHash);
      const sig = await signDecryptResult(ctHash, Number(decryptedValue));

      await expect(
        contract.publishProgressResult(QUEST_ID, voter.address, decryptedValue, sig)
      ).to.emit(contract, 'QuestCompleted').withArgs(QUEST_ID, voter.address);

      expect(await contract.questCompleted(QUEST_ID, voter.address)).to.be.true;
    });

    it('does not complete quest when progress < target', async () => {
      await createQuest(5);
      const client = await hre.cofhe.createClientWithBatteries(verifier);
      const [enc] = await client.encryptInputs([Encryptable.uint32(1n)]).execute();
      await contract.connect(verifier).recordQuestProgress(QUEST_ID, voter.address, enc);

      await contract.requestProgressReveal(QUEST_ID, voter.address);
      const ctHash = await contract.questProgressCtHash(QUEST_ID, voter.address);
      const decryptedValue = await mock_getPlaintext(hre.ethers.provider, ctHash);
      const sig = await signDecryptResult(ctHash, Number(decryptedValue));

      // Should NOT emit QuestCompleted
      const tx = await contract.publishProgressResult(QUEST_ID, voter.address, decryptedValue, sig);
      const receipt = await tx.wait();
      const completed = receipt?.logs.some((l: any) => l.fragment?.name === 'QuestCompleted');
      expect(completed).to.be.false;
      expect(await contract.questCompleted(QUEST_ID, voter.address)).to.be.false;
    });

    it('getCommunityQuestIds returns quest ids', async () => {
      await createQuest();
      const ids = await contract.getCommunityQuestIds(COMMUNITY_ID);
      expect(ids).to.include(QUEST_ID);
    });
  });
});
