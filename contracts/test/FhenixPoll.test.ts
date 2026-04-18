import hre from 'hardhat';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Encryptable } from '@cofhe/sdk';
import type { FhenixPoll } from '../typechain-types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const COMMUNITY_ID = ethers.keccak256(ethers.toUtf8Bytes('test-community'));
const POLL_ID      = ethers.keccak256(ethers.toUtf8Bytes('test-poll'));
const CONFIG_HASH  = ethers.keccak256(ethers.toUtf8Bytes('bafybeig...'));

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
        .to.be.revertedWith('Options: 2-8');
    });

    it('rejects poll with too many options', async () => {
      await expect(contract.createPoll(POLL_ID, COMMUNITY_ID, 0, 100, 9))
        .to.be.revertedWith('Options: 2-8');
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
});
