// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FHE, euint32, InEuint32} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @title FhenixPoll
/// @notice Privacy-preserving ranked-choice voting with FHE-encrypted tallies.
///         Communities gate polls behind EIP-712 signed credentials.
///         Rankings stay private; only aggregate tallies are revealed after poll close.
contract FhenixPoll is EIP712 {

    // ─── Structs ──────────────────────────────────────────────────────────────

    struct Community {
        bytes32 id;
        address creator;
        bytes32 configHash;  // IPFS CID (keccak256 padded) for off-chain metadata
        uint8   credType;    // 0=open, 1=gated, 2=multi-gate
        bool    exists;
    }

    struct Poll {
        bytes32  id;
        bytes32  communityId;
        address  creator;
        uint8    credType;
        uint32   startBlock;
        uint32   endBlock;
        uint8    optionCount;
        bool     tallyRevealed;
        bool     exists;
    }

    struct Credential {
        address  holder;
        bytes32  communityId;
        uint8    credType;
        uint64   votingWeight;  // scaled by 1e6 (1_000_000 = 100%)
        uint32   issuedAt;      // block number
        uint32   expiry;        // block number
        bool     exists;
    }

    /// @dev EIP-712 attestation struct signed by the off-chain verifier.
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

    // ─── Storage ──────────────────────────────────────────────────────────────

    mapping(bytes32 => Community) public communities;
    mapping(bytes32 => Poll)      public polls;

    // pollId => optionId => encrypted running tally
    mapping(bytes32 => mapping(uint8 => euint32)) private _tallies;

    // pollId => optionId => revealed plaintext tally
    mapping(bytes32 => mapping(uint8 => uint32)) public revealedTallies;

    // pollId => optionId => ctHash (bytes32) — populated when requestTallyReveal is called
    mapping(bytes32 => mapping(uint8 => bytes32)) public tallyCtHashes;

    // Double-vote prevention
    mapping(bytes32 => mapping(address => bool)) public hasVoted;

    // Credentials: holder => communityId => Credential
    mapping(address => mapping(bytes32 => Credential)) public credentials;

    // Anti-sybil & replay prevention
    address public immutable verifierAddress;
    mapping(bytes32 => bool) public usedSocialNullifiers;
    mapping(uint256 => bool) public usedNonces;

    // ─── Events ───────────────────────────────────────────────────────────────

    event CommunityRegistered(bytes32 indexed id, address indexed creator);
    event PollCreated(bytes32 indexed pollId, bytes32 indexed communityId, uint32 endBlock);
    event VoteCast(bytes32 indexed pollId, address indexed voter);
    event TallyRevealed(bytes32 indexed pollId, uint8 optionCount);
    event TallyPublished(bytes32 indexed pollId, uint8 indexed optionId, uint32 plaintext);
    event CredentialIssued(address indexed recipient, bytes32 indexed communityId, bytes32 nullifier);

    // ─── EIP-712 ──────────────────────────────────────────────────────────────

    bytes32 private constant ATTESTATION_TYPEHASH = keccak256(
        "CredentialAttestation(address recipient,bytes32 communityId,bytes32 nullifier,"
        "uint8 credType,uint64 votingWeight,uint32 expiryBlock,uint32 issuedAt,uint256 nonce)"
    );

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address _verifierAddress) EIP712("FhenixPoll", "1") {
        require(_verifierAddress != address(0), "Zero verifier address");
        verifierAddress = _verifierAddress;
    }

    // ─── Community ────────────────────────────────────────────────────────────

    function registerCommunity(
        bytes32 communityId,
        bytes32 configHash,
        uint8   credType
    ) external {
        require(!communities[communityId].exists, "Community exists");
        communities[communityId] = Community({
            id:         communityId,
            creator:    msg.sender,
            configHash: configHash,
            credType:   credType,
            exists:     true
        });
        emit CommunityRegistered(communityId, msg.sender);
    }

    // ─── Polls ────────────────────────────────────────────────────────────────

    function createPoll(
        bytes32 pollId,
        bytes32 communityId,
        uint8   credType,
        uint32  durationBlocks,
        uint8   optionCount
    ) external {
        require(communities[communityId].exists, "Community not found");
        require(communities[communityId].creator == msg.sender, "Not community creator");
        require(!polls[pollId].exists, "Poll exists");
        require(optionCount >= 2 && optionCount <= 8, "Options: 2-8");

        polls[pollId] = Poll({
            id:            pollId,
            communityId:   communityId,
            creator:       msg.sender,
            credType:      credType,
            startBlock:    uint32(block.number),
            endBlock:      uint32(block.number) + durationBlocks,
            optionCount:   optionCount,
            tallyRevealed: false,
            exists:        true
        });
        emit PollCreated(pollId, communityId, uint32(block.number) + durationBlocks);
    }

    // ─── Voting ───────────────────────────────────────────────────────────────

    /// @notice Cast a vote with FHE-encrypted per-option weights.
    /// @param pollId   The poll to vote in.
    /// @param weights  InEuint32 array — one per option, in order.
    ///                 weights[i] = encrypted score contribution to option i.
    ///                 Computed client-side: weight = floor(votingPower * (1_000_000 / rank)) / 1_000_000
    function castVote(
        bytes32              pollId,
        InEuint32[] calldata weights
    ) external {
        Poll storage poll = polls[pollId];
        require(poll.exists,                          "Poll not found");
        require(block.number <= poll.endBlock,        "Poll closed");
        require(!hasVoted[pollId][msg.sender],        "Already voted");
        require(weights.length == poll.optionCount,   "Wrong option count");

        // Check credential for gated polls
        if (poll.credType != 0) {
            Credential storage cred = credentials[msg.sender][poll.communityId];
            require(cred.exists,                    "No credential");
            require(block.number <= cred.expiry,    "Credential expired");
        }

        // Accumulate encrypted weights into FHE tallies
        for (uint8 i = 0; i < poll.optionCount; i++) {
            euint32 encWeight = FHE.asEuint32(weights[i]);
            // Allow the contract to operate on the ciphertext
            FHE.allowThis(encWeight);
            if (euint32.unwrap(_tallies[pollId][i]) == 0) {
                _tallies[pollId][i] = encWeight;
            } else {
                _tallies[pollId][i] = FHE.add(_tallies[pollId][i], encWeight);
                FHE.allowThis(_tallies[pollId][i]);
            }
        }

        hasVoted[pollId][msg.sender] = true;
        emit VoteCast(pollId, msg.sender);
    }

    // ─── Tally Reveal ─────────────────────────────────────────────────────────

    /// @notice Request decryption of all tallies for a closed poll.
    ///         Decryption is async — results returned via Threshold Network callback.
    function requestTallyReveal(bytes32 pollId) external {
        Poll storage poll = polls[pollId];
        require(poll.exists,            "Poll not found");
        require(block.number > poll.endBlock, "Poll still open");
        require(!poll.tallyRevealed,    "Already revealed");

        for (uint8 i = 0; i < poll.optionCount; i++) {
            // Store ctHash so frontend can look it up for publishTallyResult
            tallyCtHashes[pollId][i] = euint32.unwrap(_tallies[pollId][i]);
            // Allow public decryption via decryptForTx(.withoutPermit())
            FHE.allowPublic(_tallies[pollId][i]);
            // Request async decryption from the Threshold Network
            FHE.decrypt(_tallies[pollId][i]);
        }
        poll.tallyRevealed = true;
        emit TallyRevealed(pollId, poll.optionCount);
    }

    /// @notice Publish a Threshold-Network-signed decrypt result for one option tally.
    ///         Anyone can call this once they have the (plaintext, signature) from decryptForTx.
    function publishTallyResult(
        bytes32 pollId,
        uint8   optionId,
        uint32  plaintext,
        bytes calldata signature
    ) external {
        require(polls[pollId].tallyRevealed, "Reveal not requested");
        require(optionId < polls[pollId].optionCount, "Invalid optionId");
        FHE.publishDecryptResult(_tallies[pollId][optionId], plaintext, signature);
        revealedTallies[pollId][optionId] = plaintext;
        emit TallyPublished(pollId, optionId, plaintext);
    }

    // ─── Credentials ──────────────────────────────────────────────────────────

    /// @notice Issue a credential using a verifier-signed EIP-712 attestation.
    ///         Prevents sybil attacks (nullifier) and fake issuance (signature check).
    function issueCredential(
        CredentialAttestation calldata attestation,
        bytes calldata signature
    ) external {
        require(attestation.recipient == msg.sender,           "Not your credential");
        require(communities[attestation.communityId].exists,   "Community not found");
        require(!usedSocialNullifiers[attestation.nullifier],  "Nullifier already used");
        require(!usedNonces[attestation.nonce],                "Nonce already used");

        bytes32 digest = _hashAttestation(attestation);
        address signer = ECDSA.recover(digest, signature);
        require(signer == verifierAddress, "Invalid verifier signature");

        usedSocialNullifiers[attestation.nullifier] = true;
        usedNonces[attestation.nonce]               = true;

        credentials[attestation.recipient][attestation.communityId] = Credential({
            holder:       attestation.recipient,
            communityId:  attestation.communityId,
            credType:     attestation.credType,
            votingWeight: attestation.votingWeight,
            issuedAt:     attestation.issuedAt,
            expiry:       attestation.expiryBlock,
            exists:       true
        });

        emit CredentialIssued(attestation.recipient, attestation.communityId, attestation.nullifier);
    }

    function _hashAttestation(CredentialAttestation calldata a) internal view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            ATTESTATION_TYPEHASH,
            a.recipient, a.communityId, a.nullifier,
            a.credType, a.votingWeight, a.expiryBlock, a.issuedAt, a.nonce
        )));
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getPoll(bytes32 pollId) external view returns (Poll memory) {
        return polls[pollId];
    }

    function getCommunity(bytes32 communityId) external view returns (Community memory) {
        return communities[communityId];
    }

    function getRevealedTally(bytes32 pollId, uint8 optionId) external view returns (uint32) {
        return revealedTallies[pollId][optionId];
    }

    function getCredential(address holder, bytes32 communityId) external view returns (Credential memory) {
        return credentials[holder][communityId];
    }
}
