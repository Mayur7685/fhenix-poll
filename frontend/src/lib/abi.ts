// ABI + deployed address for FhenixPoll.sol.
// This file is overwritten by `npm run deploy:local` / `deploy:helium` in contracts/.
// For local dev: run `npm run deploy:local` in zkpoll/contracts/ first.

// Contract address — set via env var after deployment.
// Run `npm run deploy:local` in zkpoll/contracts/ to generate abi.json,
// then set VITE_CONTRACT_ADDRESS in frontend/.env.
export const CONTRACT_ADDRESS: `0x${string}` =
  (import.meta.env.VITE_CONTRACT_ADDRESS as `0x${string}`) ??
  '0x0000000000000000000000000000000000000000'

export const FHENIX_POLL_ABI = [
  // Community
  {
    type: 'function', name: 'registerCommunity',
    inputs: [
      { name: 'communityId', type: 'bytes32' },
      { name: 'configHash',  type: 'bytes32' },
      { name: 'credType',    type: 'uint8'   },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'getCommunity',
    inputs: [{ name: 'communityId', type: 'bytes32' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'id',         type: 'bytes32'  },
        { name: 'creator',    type: 'address'  },
        { name: 'configHash', type: 'bytes32'  },
        { name: 'credType',   type: 'uint8'    },
        { name: 'exists',     type: 'bool'     },
      ],
    }],
    stateMutability: 'view',
  },
  // Polls
  {
    type: 'function', name: 'createPoll',
    inputs: [
      { name: 'pollId',          type: 'bytes32' },
      { name: 'communityId',     type: 'bytes32' },
      { name: 'credType',        type: 'uint8'   },
      { name: 'durationBlocks',  type: 'uint32'  },
      { name: 'optionCount',     type: 'uint8'   },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // Wave 3: hierarchical poll
  {
    type: 'function', name: 'createHierarchicalPoll',
    inputs: [
      { name: 'pollId',         type: 'bytes32'   },
      { name: 'communityId',    type: 'bytes32'   },
      { name: 'credType',       type: 'uint8'     },
      { name: 'durationBlocks', type: 'uint32'    },
      { name: 'optionCount',    type: 'uint8'     },
      { name: 'parentIds',      type: 'uint8[]'   },
      { name: 'labelHashes',    type: 'bytes32[]' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'getPollOption',
    inputs: [
      { name: 'pollId',   type: 'bytes32' },
      { name: 'optionId', type: 'uint8'   },
    ],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'optionId',   type: 'uint8'   },
        { name: 'parentId',   type: 'uint8'   },
        { name: 'childCount', type: 'uint8'   },
        { name: 'labelHash',  type: 'bytes32' },
        { name: 'exists',     type: 'bool'    },
      ],
    }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'rolledUpTallies',
    inputs: [
      { name: 'pollId',   type: 'bytes32' },
      { name: 'optionId', type: 'uint8'   },
    ],
    outputs: [{ type: 'uint32' }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'getPoll',
    inputs: [{ name: 'pollId', type: 'bytes32' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'id',              type: 'bytes32' },
        { name: 'communityId',     type: 'bytes32' },
        { name: 'creator',         type: 'address' },
        { name: 'credType',        type: 'uint8'   },
        { name: 'startBlock',      type: 'uint32'  },
        { name: 'endBlock',        type: 'uint32'  },
        { name: 'optionCount',     type: 'uint8'   },
        { name: 'tallyRevealed',   type: 'bool'    },
        { name: 'exists',          type: 'bool'    },
        { name: 'isHierarchical',  type: 'bool'    },
      ],
    }],
    stateMutability: 'view',
  },
  // Voting
  {
    type: 'function', name: 'castVote',
    inputs: [
      { name: 'pollId',  type: 'bytes32' },
      {
        // Must match InEuint32 struct in ICofhe.sol exactly —
        // { uint256 ctHash; uint8 securityZone; uint8 utype; bytes signature; }
        name: 'weights', type: 'tuple[]',
        components: [
          { name: 'ctHash',       type: 'uint256' },
          { name: 'securityZone', type: 'uint8'   },
          { name: 'utype',        type: 'uint8'   },
          { name: 'signature',    type: 'bytes'   },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'hasVoted',
    inputs: [
      { name: 'pollId', type: 'bytes32' },
      { name: 'voter',  type: 'address' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  // Tally
  {
    type: 'function', name: 'requestTallyReveal',
    inputs: [{ name: 'pollId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'getRevealedTally',
    inputs: [
      { name: 'pollId',   type: 'bytes32' },
      { name: 'optionId', type: 'uint8'   },
    ],
    outputs: [{ type: 'uint32' }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'tallyCtHashes',
    inputs: [
      { name: 'pollId',   type: 'bytes32' },
      { name: 'optionId', type: 'uint8'   },
    ],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'publishTallyResult',
    inputs: [
      { name: 'pollId',    type: 'bytes32' },
      { name: 'optionId',  type: 'uint8'   },
      { name: 'plaintext', type: 'uint32'  },
      { name: 'signature', type: 'bytes'   },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // Credentials
  {
    type: 'function', name: 'issueCredential',
    inputs: [
      {
        name: 'attestation', type: 'tuple',
        components: [
          { name: 'recipient',    type: 'address' },
          { name: 'communityId',  type: 'bytes32' },
          { name: 'nullifier',    type: 'bytes32' },
          { name: 'credType',     type: 'uint8'   },
          { name: 'votingWeight', type: 'uint64'  },
          { name: 'expiryBlock',  type: 'uint32'  },
          { name: 'issuedAt',     type: 'uint32'  },
          { name: 'nonce',        type: 'uint256' },
        ],
      },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'getCredential',
    inputs: [
      { name: 'holder',      type: 'address' },
      { name: 'communityId', type: 'bytes32' },
    ],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'holder',       type: 'address' },
        { name: 'communityId',  type: 'bytes32' },
        { name: 'credType',     type: 'uint8'   },
        { name: 'votingWeight', type: 'uint64'  },
        { name: 'issuedAt',     type: 'uint32'  },
        { name: 'expiry',       type: 'uint32'  },
        { name: 'exists',       type: 'bool'    },
      ],
    }],
    stateMutability: 'view',
  },
  // Verifier
  {
    type: 'function', name: 'verifierAddress',
    inputs: [],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
  // Wave 4: Posts
  {
    type: 'function', name: 'createPost',
    inputs: [
      { name: 'postId',      type: 'bytes32' },
      { name: 'communityId', type: 'bytes32' },
      { name: 'contentHash', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'getPost',
    inputs: [{ name: 'postId', type: 'bytes32' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'id',          type: 'bytes32' },
        { name: 'communityId', type: 'bytes32' },
        { name: 'author',      type: 'address' },
        { name: 'contentHash', type: 'bytes32' },
        { name: 'createdAt',   type: 'uint32'  },
        { name: 'exists',      type: 'bool'    },
      ],
    }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'getCommunityPostIds',
    inputs: [{ name: 'communityId', type: 'bytes32' }],
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  // Wave 4: Quests
  {
    type: 'function', name: 'createQuest',
    inputs: [
      { name: 'questId',     type: 'bytes32' },
      { name: 'communityId', type: 'bytes32' },
      { name: 'questType',   type: 'uint8'   },
      { name: 'target',      type: 'uint32'  },
      { name: 'rewardHash',  type: 'bytes32' },
      { name: 'expiryBlock', type: 'uint32'  },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'getQuest',
    inputs: [{ name: 'questId', type: 'bytes32' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'id',          type: 'bytes32' },
        { name: 'communityId', type: 'bytes32' },
        { name: 'creator',     type: 'address' },
        { name: 'questType',   type: 'uint8'   },
        { name: 'target',      type: 'uint32'  },
        { name: 'rewardHash',  type: 'bytes32' },
        { name: 'expiryBlock', type: 'uint32'  },
        { name: 'exists',      type: 'bool'    },
      ],
    }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'getCommunityQuestIds',
    inputs: [{ name: 'communityId', type: 'bytes32' }],
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'requestProgressReveal',
    inputs: [
      { name: 'questId',     type: 'bytes32' },
      { name: 'participant', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'publishProgressResult',
    inputs: [
      { name: 'questId',     type: 'bytes32' },
      { name: 'participant', type: 'address' },
      { name: 'plaintext',   type: 'uint32'  },
      { name: 'signature',   type: 'bytes'   },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'questCompleted',
    inputs: [
      { name: 'questId',     type: 'bytes32' },
      { name: 'participant', type: 'address' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'questProgressCtHash',
    inputs: [
      { name: 'questId',     type: 'bytes32' },
      { name: 'participant', type: 'address' },
    ],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'view',
  },
  // Events
  {
    type: 'event', name: 'CommunityRegistered',
    inputs: [
      { name: 'id',      type: 'bytes32', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event', name: 'PollCreated',
    inputs: [
      { name: 'pollId',      type: 'bytes32', indexed: true },
      { name: 'communityId', type: 'bytes32', indexed: true },
      { name: 'endBlock',    type: 'uint32',  indexed: false },
    ],
  },
  {
    type: 'event', name: 'VoteCast',
    inputs: [
      { name: 'pollId', type: 'bytes32', indexed: true },
      { name: 'voter',  type: 'address', indexed: true },
    ],
  },
  {
    type: 'event', name: 'TallyRevealed',
    inputs: [
      { name: 'pollId',      type: 'bytes32', indexed: true },
      { name: 'optionCount', type: 'uint8',   indexed: false },
    ],
  },
  {
    type: 'event', name: 'TallyPublished',
    inputs: [
      { name: 'pollId',    type: 'bytes32', indexed: true },
      { name: 'optionId',  type: 'uint8',   indexed: true  },
      { name: 'plaintext', type: 'uint32',  indexed: false },
    ],
  },
  {
    type: 'event', name: 'CredentialIssued',
    inputs: [
      { name: 'recipient',   type: 'address', indexed: true },
      { name: 'communityId', type: 'bytes32', indexed: true },
      { name: 'nullifier',   type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event', name: 'PostCreated',
    inputs: [
      { name: 'postId',      type: 'bytes32', indexed: true },
      { name: 'communityId', type: 'bytes32', indexed: true },
      { name: 'author',      type: 'address', indexed: true },
    ],
  },
  {
    type: 'event', name: 'QuestCreated',
    inputs: [
      { name: 'questId',     type: 'bytes32', indexed: true },
      { name: 'communityId', type: 'bytes32', indexed: true },
    ],
  },
  {
    type: 'event', name: 'QuestCompleted',
    inputs: [
      { name: 'questId',     type: 'bytes32', indexed: true },
      { name: 'participant', type: 'address', indexed: true },
    ],
  },
] as const
