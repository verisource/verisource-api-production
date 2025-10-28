"""
Content Origin Credential Generator and Verifier

This module provides functionality to create, sign, and verify content origin credentials
for proving authenticity of articles, images, videos, and AI-generated content.

Uses Decentralized Identifiers (DIDs) instead of PII for privacy and reduced legal risk.
"""

import json
import hashlib
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.backends import default_backend
import base64
import re


class DIDManager:
    """
    Manages Decentralized Identifiers (DIDs) for privacy-preserving creator attribution.
    """
    
    @staticmethod
    def generate_did_key(public_key) -> str:
        """
        Generate a did:key from a public key.
        did:key is self-contained and doesn't require external resolution.
        
        Args:
            public_key: RSA public key object
            
        Returns:
            DID string in format did:key:z...
        """
        # Get public key bytes
        public_bytes = public_key.public_bytes(
            encoding=serialization.Encoding.DER,
            format=serialization.PublicFormat.SubjectPublicKeyInfo
        )
        
        # Multibase encode (base58btc with 'z' prefix)
        # For simplicity, using base64url here (in production, use proper multibase)
        encoded = base64.urlsafe_b64encode(public_bytes).decode('utf-8').rstrip('=')
        
        return f"did:key:z{encoded}"
    
    @staticmethod
    def generate_did_web(domain: str, path: str = "") -> str:
        """
        Generate a did:web identifier.
        did:web uses domain names for resolution.
        
        Args:
            domain: Domain name (e.g., "example.com")
            path: Optional path (e.g., "users/alice")
            
        Returns:
            DID string in format did:web:...
        """
        if path:
            # URL encode the path
            path_encoded = path.replace('/', ':')
            return f"did:web:{domain}:{path_encoded}"
        return f"did:web:{domain}"
    
    @staticmethod
    def validate_did(did: str) -> bool:
        """
        Validate DID format.
        
        Args:
            did: DID string to validate
            
        Returns:
            True if valid DID format
        """
        # DID format: did:method:method-specific-id
        pattern = r'^did:[a-z0-9]+:[a-zA-Z0-9._:%-]*[a-zA-Z0-9._-]$'
        return bool(re.match(pattern, did))
    
    @staticmethod
    def create_verification_method(did: str, key_id: str = "key-1") -> str:
        """
        Create a verification method reference.
        
        Args:
            did: Base DID
            key_id: Key identifier (default: "key-1")
            
        Returns:
            Verification method reference (DID with fragment)
        """
        return f"{did}#{key_id}"


class ContentOriginCredential:
    """
    A class to create and manage content origin credentials.
    """
    
    def __init__(self, version: str = "1.0.0"):
        self.version = version
        self.credential = {}
    
    def generate_credential_id(self) -> str:
        """Generate a unique credential ID."""
        return str(uuid.uuid4())
    
    def calculate_content_hash(self, content: bytes, algorithm: str = "SHA-256") -> Dict[str, str]:
        """
        Calculate cryptographic hash of content.
        
        Args:
            content: The content as bytes
            algorithm: Hash algorithm (SHA-256, SHA-512, SHA3-256)
        
        Returns:
            Dictionary with algorithm and hash value
        """
        if algorithm == "SHA-256":
            hash_obj = hashlib.sha256(content)
        elif algorithm == "SHA-512":
            hash_obj = hashlib.sha512(content)
        elif algorithm == "SHA3-256":
            hash_obj = hashlib.sha3_256(content)
        else:
            raise ValueError(f"Unsupported hash algorithm: {algorithm}")
        
        return {
            "algorithm": algorithm,
            "value": hash_obj.hexdigest()
        }
    
    def create_credential(
        self,
        content_type: str,
        content_hash: Dict[str, str],
        creator_did: str,
        creator_type: str,
        content_metadata: Dict[str, Any],
        verification_method: Optional[str] = None,
        ai_generation_details: Optional[Dict[str, Any]] = None,
        source_information: Optional[Dict[str, Any]] = None,
        rights: Optional[Dict[str, Any]] = None,
        chain_of_custody: Optional[List[Dict[str, Any]]] = None,
        technical_details: Optional[Dict[str, Any]] = None,
        additional_metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Create a complete content origin credential with DID-based attribution.
        
        Args:
            content_type: Type of content (article, image, video, etc.)
            content_hash: Hash dictionary from calculate_content_hash()
            creator_did: Decentralized Identifier of the creator (e.g., did:key:..., did:web:...)
            creator_type: Type of creator (human, ai-system, human-ai-collaboration)
            content_metadata: Metadata about the content
            verification_method: Optional DID verification method reference
            ai_generation_details: AI generation info (if applicable)
            source_information: Source and reference information
            rights: Rights and licensing information
            chain_of_custody: List of custody records
            technical_details: Technical metadata
            additional_metadata: Business-specific metadata
        
        Returns:
            Complete credential dictionary
        """
        # Validate DID format
        if not DIDManager.validate_did(creator_did):
            raise ValueError(f"Invalid DID format: {creator_did}")
        
        now = datetime.now(timezone.utc).isoformat()
        
        # Build creator object with DID (no PII)
        creator = {
            "did": creator_did,
            "type": creator_type
        }
        
        if verification_method:
            creator["verificationMethod"] = verification_method
        
        credential = {
            "credentialId": self.generate_credential_id(),
            "version": self.version,
            "contentType": content_type,
            "contentHash": content_hash,
            "creator": creator,
            "timestamp": {
                "created": content_metadata.get("created_timestamp", now),
                "credentialIssued": now
            },
            "contentMetadata": content_metadata,
            "status": {
                "isActive": True,
                "revoked": False
            }
        }
        
        # Add optional fields if provided
        if ai_generation_details:
            credential["aiGenerationDetails"] = ai_generation_details
        
        if source_information:
            credential["sourceInformation"] = source_information
        
        if rights:
            credential["rights"] = rights
        
        if chain_of_custody:
            credential["chainOfCustody"] = chain_of_custody
        
        if technical_details:
            credential["technicalDetails"] = technical_details
        
        if additional_metadata:
            credential["additionalMetadata"] = additional_metadata
        
        self.credential = credential
        return credential
    
    def sign_credential(self, private_key) -> Dict[str, Any]:
        """
        Sign the credential with a private key.
        
        Args:
            private_key: RSA private key object
        
        Returns:
            Verification dictionary with signature and public key
        """
        # Convert credential to JSON bytes
        credential_bytes = json.dumps(self.credential, sort_keys=True).encode('utf-8')
        
        # Sign the credential
        signature = private_key.sign(
            credential_bytes,
            padding.PSS(
                mgf=padding.MGF1(hashes.SHA256()),
                salt_length=padding.PSS.MAX_LENGTH
            ),
            hashes.SHA256()
        )
        
        # Get public key
        public_key = private_key.public_key()
        public_pem = public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo
        )
        
        verification = {
            "method": "digital-signature",
            "signature": base64.b64encode(signature).decode('utf-8'),
            "publicKey": public_pem.decode('utf-8'),
            "verificationUrl": f"https://verify.example.com/credentials/{self.credential['credentialId']}"
        }
        
        self.credential["verification"] = verification
        return verification
    
    def verify_credential(self, credential: Dict[str, Any], public_key_pem: str = None) -> bool:
        """
        Verify the authenticity of a credential.
        
        Args:
            credential: The credential to verify
            public_key_pem: Optional public key PEM string (if not in credential)
        
        Returns:
            True if valid, False otherwise
        """
        try:
            # Extract verification info
            verification = credential.get("verification", {})
            
            if verification.get("method") != "digital-signature":
                print("Verification method not supported or not present")
                return False
            
            # Get public key
            if public_key_pem is None:
                public_key_pem = verification.get("publicKey")
            
            if not public_key_pem:
                print("No public key available for verification")
                return False
            
            # Load public key
            public_key = serialization.load_pem_public_key(
                public_key_pem.encode('utf-8'),
                backend=default_backend()
            )
            
            # Get signature
            signature_b64 = verification.get("signature")
            if not signature_b64:
                print("No signature found")
                return False
            
            signature = base64.b64decode(signature_b64)
            
            # Create credential copy without verification for signing
            credential_copy = credential.copy()
            credential_copy.pop("verification", None)
            credential_bytes = json.dumps(credential_copy, sort_keys=True).encode('utf-8')
            
            # Verify signature
            public_key.verify(
                signature,
                credential_bytes,
                padding.PSS(
                    mgf=padding.MGF1(hashes.SHA256()),
                    salt_length=padding.PSS.MAX_LENGTH
                ),
                hashes.SHA256()
            )
            
            print("✓ Credential signature is valid")
            return True
            
        except Exception as e:
            print(f"✗ Credential verification failed: {str(e)}")
            return False
    
    def revoke_credential(self, reason: str) -> None:
        """Revoke a credential."""
        self.credential["status"]["isActive"] = False
        self.credential["status"]["revoked"] = True
        self.credential["status"]["revocationReason"] = reason
        self.credential["status"]["revocationDate"] = datetime.now(timezone.utc).isoformat()
    
    def export_credential(self, filepath: str) -> None:
        """Export credential to JSON file."""
        with open(filepath, 'w') as f:
            json.dump(self.credential, f, indent=2)
        print(f"Credential exported to {filepath}")
    
    @staticmethod
    def load_credential(filepath: str) -> Dict[str, Any]:
        """Load credential from JSON file."""
        with open(filepath, 'r') as f:
            return json.load(f)


class CredentialKeyManager:
    """Manages cryptographic keys for credential signing."""
    
    @staticmethod
    def generate_key_pair():
        """Generate RSA key pair for signing credentials."""
        private_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=2048,
            backend=default_backend()
        )
        return private_key
    
    @staticmethod
    def save_private_key(private_key, filepath: str, password: bytes = None):
        """Save private key to file (optionally encrypted)."""
        if password:
            encryption = serialization.BestAvailableEncryption(password)
        else:
            encryption = serialization.NoEncryption()
        
        pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=encryption
        )
        
        with open(filepath, 'wb') as f:
            f.write(pem)
        print(f"Private key saved to {filepath}")
    
    @staticmethod
    def load_private_key(filepath: str, password: bytes = None):
        """Load private key from file."""
        with open(filepath, 'rb') as f:
            private_key = serialization.load_pem_private_key(
                f.read(),
                password=password,
                backend=default_backend()
            )
        return private_key
    
    @staticmethod
    def save_public_key(public_key, filepath: str):
        """Save public key to file."""
        pem = public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo
        )
        
        with open(filepath, 'wb') as f:
            f.write(pem)
        print(f"Public key saved to {filepath}")


# Example usage functions
def create_article_credential_example():
    """Example: Create a credential for a human-written article using DID."""
    
    # Initialize credential generator
    coc = ContentOriginCredential()
    
    # Sample article content
    article_content = b"This is the content of the article..."
    
    # Calculate content hash
    content_hash = coc.calculate_content_hash(article_content)
    
    # Generate DID for creator (in production, creators would have persistent DIDs)
    key_manager = CredentialKeyManager()
    private_key = key_manager.generate_key_pair()
    public_key = private_key.public_key()
    
    # Create DID from public key
    creator_did = DIDManager.generate_did_key(public_key)
    verification_method = DIDManager.create_verification_method(creator_did)
    
    # Define content metadata (no PII here either)
    content_metadata = {
        "title": "Breaking News: Important Event",
        "description": "Article about an important event",
        "fileName": "important-event.html",
        "fileSize": len(article_content),
        "mimeType": "text/html",
        "language": "en"
    }
    
    # Define AI generation details (not AI-generated in this case)
    ai_details = {
        "isAiGenerated": False
    }
    
    # Define rights (can still include copyright without revealing identity)
    rights = {
        "copyright": "© 2025 - All Rights Reserved",
        "license": "All Rights Reserved",
        "usageRights": ["attribution-required"]
    }
    
    # Create credential with DID
    credential = coc.create_credential(
        content_type="article",
        content_hash=content_hash,
        creator_did=creator_did,
        creator_type="human",
        content_metadata=content_metadata,
        verification_method=verification_method,
        ai_generation_details=ai_details,
        rights=rights
    )
    
    # Sign credential
    coc.sign_credential(private_key)
    
    return coc, private_key


def create_ai_image_credential_example():
    """Example: Create a credential for AI-generated image using DID."""
    
    coc = ContentOriginCredential()
    
    # Sample image content (in practice, read actual image file)
    image_content = b"fake_image_bytes_here"
    content_hash = coc.calculate_content_hash(image_content)
    
    # Generate DID for creator organization
    key_manager = CredentialKeyManager()
    private_key = key_manager.generate_key_pair()
    
    # Use did:web for organization (they control the domain)
    creator_did = DIDManager.generate_did_web("creativestudio.example", "creators/studio-456")
    
    content_metadata = {
        "title": "AI Generated Landscape",
        "description": "Beautiful AI-generated landscape",
        "fileName": "landscape.png",
        "fileSize": len(image_content),
        "mimeType": "image/png",
        "dimensions": {
            "width": 1920,
            "height": 1080
        }
    }
    
    ai_details = {
        "isAiGenerated": True,
        "aiModel": "DALL-E 3",
        "aiProvider": "OpenAI",
        "humanContribution": "edited",
        "prompt": "A beautiful mountain landscape at sunset",
        "trainingDataCutoff": "2023-04-01"
    }
    
    rights = {
        "copyright": "© 2025 - Creative Commons",
        "license": "CC-BY-4.0",
        "usageRights": ["commercial", "attribution-required"],
        "watermarkApplied": True
    }
    
    credential = coc.create_credential(
        content_type="ai-generated-image",
        content_hash=content_hash,
        creator_did=creator_did,
        creator_type="human-ai-collaboration",
        content_metadata=content_metadata,
        ai_generation_details=ai_details,
        rights=rights
    )
    
    coc.sign_credential(private_key)
    
    return coc, private_key


if __name__ == "__main__":
    print("=== Content Origin Credential System (DID-Based) ===\n")
    print("✓ Privacy-preserving: Uses DIDs instead of PII")
    print("✓ No identity leakage: No names, emails, or organizations in credentials")
    print("✓ Reduced legal risk: No subpoena-able personal information\n")
    
    # Example 1: Article credential
    print("Example 1: Creating credential for human-written article...")
    article_coc, article_key = create_article_credential_example()
    article_coc.export_credential("article_credential.json")
    print(f"Article Credential ID: {article_coc.credential['credentialId']}")
    print(f"Creator DID: {article_coc.credential['creator']['did']}\n")
    
    # Verify the article credential
    print("Verifying article credential...")
    is_valid = article_coc.verify_credential(article_coc.credential)
    print(f"Verification result: {'✓ Valid' if is_valid else '✗ Invalid'}\n")
    
    # Example 2: AI-generated image credential
    print("Example 2: Creating credential for AI-generated image...")
    image_coc, image_key = create_ai_image_credential_example()
    image_coc.export_credential("ai_image_credential.json")
    print(f"Image Credential ID: {image_coc.credential['credentialId']}")
    print(f"Creator DID: {image_coc.credential['creator']['did']}\n")
    
    # Verify the image credential
    print("Verifying AI image credential...")
    is_valid = image_coc.verify_credential(image_coc.credential)
    print(f"Verification result: {'✓ Valid' if is_valid else '✗ Invalid'}\n")
    
    # Save keys for later use
    key_manager = CredentialKeyManager()
    key_manager.save_private_key(article_key, "private_key.pem")
    key_manager.save_public_key(article_key.public_key(), "public_key.pem")
    
    print("\n=== Complete! ===")
    print("Generated files:")
    print("  - article_credential.json (human-written article credential)")
    print("  - ai_image_credential.json (AI-generated image credential)")
    print("  - private_key.pem (signing key)")
    print("  - public_key.pem (verification key)")
    print("\n💡 Note: Credentials use DIDs - resolve to human-readable labels off-chain when needed")
    print("   Example: Store DID → name mapping in a separate, secured database")
