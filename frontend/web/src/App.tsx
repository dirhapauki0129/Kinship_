import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface DNARelativeData {
  id: string;
  name: string;
  encryptedDNAScore: string;
  relationType: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [relatives, setRelatives] = useState<DNARelativeData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingRelative, setCreatingRelative] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newRelativeData, setNewRelativeData] = useState({ name: "", dnaScore: "", relation: "" });
  const [selectedRelative, setSelectedRelative] = useState<DNARelativeData | null>(null);
  const [decryptedScore, setDecryptedScore] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("all");

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const relativesList: DNARelativeData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          relativesList.push({
            id: businessId,
            name: businessData.name,
            encryptedDNAScore: businessId,
            relationType: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setRelatives(relativesList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createRelative = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingRelative(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating relative record with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const dnaScoreValue = parseInt(newRelativeData.dnaScore) || 0;
      const businessId = `dna-relative-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, dnaScoreValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newRelativeData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newRelativeData.relation) || 0,
        0,
        newRelativeData.relation
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Relative record created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewRelativeData({ name: "", dnaScore: "", relation: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingRelative(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "DNA score decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available and ready!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredRelatives = relatives.filter(relative => {
    const matchesSearch = relative.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         relative.relationType.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesTab = activeTab === "all" || 
                      (activeTab === "verified" && relative.isVerified) ||
                      (activeTab === "pending" && !relative.isVerified);
    return matchesSearch && matchesTab;
  });

  const stats = {
    total: relatives.length,
    verified: relatives.filter(r => r.isVerified).length,
    highMatch: relatives.filter(r => r.publicValue1 >= 80).length,
    recent: relatives.filter(r => Date.now()/1000 - r.timestamp < 604800).length
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🧬 Private DNA Matching</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="dna-helix"></div>
            <h2>Connect to Discover Your Roots</h2>
            <p>Securely match DNA with potential relatives using fully homomorphic encryption</p>
            <div className="feature-grid">
              <div className="feature">
                <div className="feature-icon">🔐</div>
                <h4>Encrypted Matching</h4>
                <p>Your DNA data remains encrypted throughout the matching process</p>
              </div>
              <div className="feature">
                <div className="feature-icon">👪</div>
                <h4>Family Discovery</h4>
                <p>Find long-lost relatives while preserving privacy</p>
              </div>
              <div className="feature">
                <div className="feature-icon">⚡</div>
                <h4>Zama FHE Technology</h4>
                <p>Advanced homomorphic encryption for secure computations</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="dna-loader"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="dna-loader"></div>
      <p>Loading encrypted DNA database...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🧬 Private DNA Matching</h1>
          <span>FHE-Powered Relative Discovery</span>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="availability-btn">
            Check System
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + Add Relative
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Total Records</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.verified}</div>
            <div className="stat-label">Verified Matches</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.highMatch}</div>
            <div className="stat-label">High Probability</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.recent}</div>
            <div className="stat-label">Recent Adds</div>
          </div>
        </div>
        
        <div className="controls-section">
          <div className="search-filter">
            <input 
              type="text" 
              placeholder="Search relatives..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <div className="tab-group">
              <button 
                className={`tab ${activeTab === "all" ? "active" : ""}`}
                onClick={() => setActiveTab("all")}
              >
                All
              </button>
              <button 
                className={`tab ${activeTab === "verified" ? "active" : ""}`}
                onClick={() => setActiveTab("verified")}
              >
                Verified
              </button>
              <button 
                className={`tab ${activeTab === "pending" ? "active" : ""}`}
                onClick={() => setActiveTab("pending")}
              >
                Pending
              </button>
            </div>
          </div>
          
          <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        
        <div className="relatives-grid">
          {filteredRelatives.length === 0 ? (
            <div className="empty-state">
              <div className="dna-icon">🧬</div>
              <h3>No relative records found</h3>
              <p>Start by adding your first relative match</p>
              <button onClick={() => setShowCreateModal(true)} className="create-btn">
                Add First Relative
              </button>
            </div>
          ) : (
            filteredRelatives.map((relative, index) => (
              <div 
                key={index} 
                className={`relative-card ${relative.isVerified ? "verified" : ""}`}
                onClick={() => setSelectedRelative(relative)}
              >
                <div className="card-header">
                  <h3>{relative.name}</h3>
                  <span className={`status ${relative.isVerified ? "verified" : "pending"}`}>
                    {relative.isVerified ? "✅ Verified" : "⏳ Pending"}
                  </span>
                </div>
                <div className="card-content">
                  <p className="relation">{relative.relationType}</p>
                  <div className="dna-info">
                    <span>Match Score: {relative.publicValue1}%</span>
                    <span>Added: {new Date(relative.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="card-footer">
                  <span className="creator">By: {relative.creator.substring(0, 8)}...</span>
                  <button className="view-btn">View Details</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      
      {showCreateModal && (
        <CreateRelativeModal 
          onSubmit={createRelative} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingRelative} 
          relativeData={newRelativeData} 
          setRelativeData={setNewRelativeData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedRelative && (
        <RelativeDetailModal 
          relative={selectedRelative} 
          onClose={() => { 
            setSelectedRelative(null); 
            setDecryptedScore(null); 
          }} 
          decryptedScore={decryptedScore} 
          setDecryptedScore={setDecryptedScore} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedRelative.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            {transactionStatus.status === "pending" && <div className="spinner"></div>}
            {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
            {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            <span>{transactionStatus.message}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const CreateRelativeModal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  relativeData: any;
  setRelativeData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, relativeData, setRelativeData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'dnaScore') {
      const intValue = value.replace(/[^\d]/g, '');
      setRelativeData({ ...relativeData, [name]: intValue });
    } else {
      setRelativeData({ ...relativeData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Add Relative Match</h2>
          <button onClick={onClose} className="close-btn">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>🔐 FHE Encryption Active</strong>
            <p>DNA match score will be encrypted using Zama FHE technology</p>
          </div>
          
          <div className="form-group">
            <label>Relative Name *</label>
            <input 
              type="text" 
              name="name" 
              value={relativeData.name} 
              onChange={handleChange} 
              placeholder="Enter relative's name..." 
            />
          </div>
          
          <div className="form-group">
            <label>DNA Match Score (0-100) *</label>
            <input 
              type="number" 
              name="dnaScore" 
              value={relativeData.dnaScore} 
              onChange={handleChange} 
              placeholder="Enter match score..." 
              min="0"
              max="100"
            />
            <div className="encryption-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Relationship Type *</label>
            <select name="relation" value={relativeData.relation} onChange={handleChange}>
              <option value="">Select relationship...</option>
              <option value="Parent">Parent</option>
              <option value="Sibling">Sibling</option>
              <option value="Cousin">Cousin</option>
              <option value="Grandparent">Grandparent</option>
              <option value="Aunt/Uncle">Aunt/Uncle</option>
            </select>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !relativeData.name || !relativeData.dnaScore || !relativeData.relation} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Add Relative"}
          </button>
        </div>
      </div>
    </div>
  );
};

const RelativeDetailModal: React.FC<{
  relative: DNARelativeData;
  onClose: () => void;
  decryptedScore: number | null;
  setDecryptedScore: (value: number | null) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ relative, onClose, decryptedScore, setDecryptedScore, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedScore !== null) { 
      setDecryptedScore(null); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedScore(decrypted);
    }
  };

  const kinshipProbability = (score: number) => {
    if (score >= 90) return "Very High";
    if (score >= 75) return "High";
    if (score >= 50) return "Moderate";
    return "Low";
  };

  return (
    <div className="modal-overlay">
      <div className="detail-modal">
        <div className="modal-header">
          <h2>Relative Details</h2>
          <button onClick={onClose} className="close-btn">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="relative-info">
            <div className="info-row">
              <span>Name:</span>
              <strong>{relative.name}</strong>
            </div>
            <div className="info-row">
              <span>Relationship:</span>
              <strong>{relative.relationType}</strong>
            </div>
            <div className="info-row">
              <span>Added:</span>
              <strong>{new Date(relative.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-row">
              <span>Creator:</span>
              <strong>{relative.creator}</strong>
            </div>
          </div>
          
          <div className="dna-section">
            <h3>DNA Matching Results</h3>
            
            <div className="score-display">
              <div className="score-label">Encrypted Match Score:</div>
              <div className="score-value">
                {relative.isVerified && relative.decryptedValue ? 
                  `${relative.decryptedValue}% (Verified)` : 
                  decryptedScore !== null ? 
                  `${decryptedScore}% (Decrypted)` : 
                  "🔒 Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(relative.isVerified || decryptedScore !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "Decrypting..." : 
                 relative.isVerified ? "✅ Verified" : 
                 decryptedScore !== null ? "🔄 Re-decrypt" : 
                 "🔓 Decrypt Score"}
              </button>
            </div>
            
            {(relative.isVerified || decryptedScore !== null) && (
              <div className="probability-info">
                <div className="probability-badge">
                  Kinship Probability: {kinshipProbability(relative.isVerified ? relative.decryptedValue! : decryptedScore!)}
                </div>
                <div className="confidence-meter">
                  <div 
                    className="confidence-fill" 
                    style={{ width: `${relative.isVerified ? relative.decryptedValue! : decryptedScore!}%` }}
                  ></div>
                </div>
              </div>
            )}
          </div>
          
          <div className="fhe-explanation">
            <h4>🔐 FHE Protection Process</h4>
            <p>Your DNA match score is encrypted on-chain using Zama FHE technology. 
               Decryption happens client-side with zero-knowledge proofs for verification.</p>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!relative.isVerified && (
            <button onClick={handleDecrypt} disabled={isDecrypting} className="verify-btn">
              Verify on-chain
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

