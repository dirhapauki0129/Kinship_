pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract KinshipMatcher is ZamaEthereumConfig {
    struct DNARecord {
        euint32 encryptedSequence;
        uint256 publicMetadata;
        address owner;
        uint256 timestamp;
        bool isMatched;
    }

    mapping(string => DNARecord) public dnaRecords;
    string[] public recordIds;

    event DNARecordCreated(string indexed recordId, address indexed owner);
    event KinshipMatchFound(string indexed recordId1, string indexed recordId2, uint32 similarityScore);

    constructor() ZamaEthereumConfig() {}

    function submitDNA(
        string calldata recordId,
        externalEuint32 encryptedSequence,
        bytes calldata inputProof,
        uint256 publicMetadata
    ) external {
        require(bytes(dnaRecords[recordId].owner).length == 0, "Record already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedSequence, inputProof)), "Invalid encrypted input");

        dnaRecords[recordId] = DNARecord({
            encryptedSequence: FHE.fromExternal(encryptedSequence, inputProof),
            publicMetadata: publicMetadata,
            owner: msg.sender,
            timestamp: block.timestamp,
            isMatched: false
        });

        FHE.allowThis(dnaRecords[recordId].encryptedSequence);
        FHE.makePubliclyDecryptable(dnaRecords[recordId].encryptedSequence);
        recordIds.push(recordId);

        emit DNARecordCreated(recordId, msg.sender);
    }

    function findKinship(
        string calldata recordId1,
        string calldata recordId2,
        bytes calldata computationProof
    ) external {
        require(bytes(dnaRecords[recordId1].owner).length > 0, "Record 1 does not exist");
        require(bytes(dnaRecords[recordId2].owner).length > 0, "Record 2 does not exist");
        require(!dnaRecords[recordId1].isMatched, "Record 1 already matched");
        require(!dnaRecords[recordId2].isMatched, "Record 2 already matched");

        euint32 seq1 = dnaRecords[recordId1].encryptedSequence;
        euint32 seq2 = dnaRecords[recordId2].encryptedSequence;

        euint32 similarity = FHE.mul(seq1, seq2);
        bytes memory proof = FHE.computeProof(computationProof, similarity);

        require(FHE.verifyProof(proof), "Invalid computation proof");

        uint32 similarityScore = FHE.decrypt(similarity);
        require(similarityScore > 80, "Insufficient similarity");

        dnaRecords[recordId1].isMatched = true;
        dnaRecords[recordId2].isMatched = true;

        emit KinshipMatchFound(recordId1, recordId2, similarityScore);
    }

    function getDNARecord(string calldata recordId) external view returns (
        uint256 publicMetadata,
        address owner,
        uint256 timestamp,
        bool isMatched
    ) {
        require(bytes(dnaRecords[recordId].owner).length > 0, "Record does not exist");
        DNARecord storage record = dnaRecords[recordId];

        return (
            record.publicMetadata,
            record.owner,
            record.timestamp,
            record.isMatched
        );
    }

    function getAllRecordIds() external view returns (string[] memory) {
        return recordIds;
    }

    function getEncryptedSequence(string calldata recordId) external view returns (euint32) {
        require(bytes(dnaRecords[recordId].owner).length > 0, "Record does not exist");
        return dnaRecords[recordId].encryptedSequence;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}

