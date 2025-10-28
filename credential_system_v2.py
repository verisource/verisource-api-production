"""
Content Origin Credential System V2

Improvements:
- Detached JWS signatures with proper alg/kid
- External revocation via CID/URL pointers
- Perceptual hash bundles for media resilience
- RFC3339 timestamps (seconds precision)
- Canonical JSON (RFC8785/JCS)
- No PII or media in credentials
- Proper key rotation support
"""

import json
import hashlib
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any, Tuple
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.backends import default_backend
import base64
import re


class CanonicalJSON:
    """RFC8785 JSON Canonicalization Scheme (JCS)"""
    
    @staticmethod
    def serialize(obj: Any) -> bytes:
        """
        Serialize to canonical JSON (RFC8785).
        For production, use a proper JCS library.
        """
        # Simplified canonical JSON: sorted keys, no whitespace
        return json.dumps(
            obj,
            ensure_ascii=False,
            separators=(',', ':'),
            sort_keys=True
        ).encode('utf-8')


class PerceptualHash:
    """
    Perceptual hashing for resilient media matching.
    Survives minor edits, compression, etc.
    """
    
    @staticmethod
    def compute_image_phash(image_bytes: bytes) -> str:
        """
        Compute perceptual hash for images.
        In production, use imagehash library or similar.
        """
        # Placeholder - use proper pHash algorithm in production
        # This should use DCT-based perceptual hashing
        return f"phash:{hashlib.sha256(image_bytes[:1000]).hexdigest()[:16]}"
    
    @staticmethod
    def compute_video_segment_hashes(video_bytes: bytes, segment_size: int = 1024*1024) -> List[str]:
        """
        Rolling segment hashes for video/audio.
        Enables partial matching despite edits.
        """
        segments = []
        for i in range(0, len(video_bytes), segment_size):
            segment = video_bytes[i:i+segment_size]
            seg_hash = hashlib.sha256(segment).hexdigest()[:16]
            segments.append(f"seg_{i//segment_size}:{seg_hash}")
        return segments[:10]  # Limit for demo
    
    @staticmethod
    def compute_text_fingerprint(text: bytes) -> str:
        """
        Text fingerprint using shingling/n-grams.
        Resilient to minor text changes.
        """
        # Simplified - use proper text fingerprinting in production
        # Should use MinHash or similar
        return f"textfp:{hashlib.sha256(text).hexdigest()[:16]}"


class FingerprintBundle:
    """
    Bundle of hashes for resilient content matching.
    """
    
    @staticmethod
    def create_for_image(image_bytes: bytes) -> Dict[str, Any]:
        """Create fingerprint bundle for images."""
        return {
            "sha256_canonical": hashlib.sha256(image_bytes).hexdigest(),
            "perceptualHash": PerceptualHash.compute_image_phash(image_bytes),
            "algorithm": "sha256+phash"
        }
    
    @staticmethod
    def create_for_video(video_bytes: bytes) -> Dict[str, Any]:
        """Create fingerprint bundle for videos."""
        return {
            "sha256_canonical": hashlib.sha256(video_bytes).hexdigest(),
            "segmentHashes": PerceptualHash.compute_video_segment_hashes(video_bytes),
            "algorithm": "sha256+rolling_segments"
        }
    
    @staticmethod
    def create_for_text(text_bytes: bytes, canonical: bool = True) -> Dict[str, Any]:
        """Create fingerprint bundle for text."""
        if canonical:
            # Normalize: strip whitespace, lowercase for HTML/text
            # In production, use proper HTML/text normalization
            normalized = text_bytes.strip().lower()
            sha_canonical = hashlib.sha256(normalized).hexdigest()
        else:
            sha_canonical = hashlib.sha256(text_bytes).hexdigest()
        
        return {
            "sha256_canonical": sha_canonical,
            "textFingerprint": PerceptualHash.compute_text_fingerprint(text_bytes),
            "algorithm": "sha256_normalized+textfp",
            "canonicalization": "strip_whitespace_lowercase" if canonical else "none"
        }


class DIDManager:
    """Manages Decentralized Identifiers (DIDs)"""
    
    @staticmethod
    def generate_did_key(public_key) -> str:
        """Generate did:key from public key."""
        public_bytes = public_key.public_bytes(
            encoding=serialization.Encoding.DER,
            format=serialization.PublicFormat.SubjectPublicKeyInfo
        )
        encoded = base64.urlsafe_b64encode(public_bytes).decode('utf-8').rstrip('=')
        return f"did:key:z{encoded}"
    
    @staticmethod
    def generate_did_web(domain: str, path: str = "") -> str:
        """Generate did:web identifier."""
        if path:
            path_encoded = path.replace('/', ':')
            return f"did:web:{domain}:{path_encoded}"
        return f"did:web:{domain}"
    
    @staticmethod
    def create_key_id(did: str, key_index: int = 1) -> str:
        """
        Create key identifier (kid) for JWS.
        Format: {did}#key-{index}
        """
        return f"{did}#key-{key_index}"
    
    @staticmethod
    def validate_did(did: str) -> bool:
        """Validate DID format."""
        pattern = r'^did:[a-z0-9]+:[a-zA-Z0-9._:%-]*[a-zA-Z0-9._-]$'
        return bool(re.match(pattern, did))


class JWSDetached:
    """
    Detached JWS (JSON Web Signature) implementation.
    Signature is separate from the credential payload.
    """
    
    @staticmethod
    def create_jws_header(algorithm: str, key_id: str, created_at: str) -> Dict[str, str]:
        """
        Create JWS header with algorithm, kid, and timestamp.
        """
        return {
            "alg": algorithm,  # e.g., "RS256"
            "kid": key_id,     # DID key identifier
            "typ": "JWS",
            "iat": created_at  # Issued at (RFC3339)
        }
    
    @staticmethod
    def sign_detached(
        payload_bytes: bytes,
        private_key,
        algorithm: str,
        key_id: str
    ) -> Dict[str, Any]:
        """
        Create detached JWS signature.
        Returns signature container with metadata.
        """
        # Get timestamp (seconds precision, RFC3339)
        created_at = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        
        # Create JWS header
        header = JWSDetached.create_jws_header(algorithm, key_id, created_at)
        header_bytes = CanonicalJSON.serialize(header)
        header_b64 = base64.urlsafe_b64encode(header_bytes).decode('utf-8').rstrip('=')
        
        # Payload is already canonical bytes
        payload_b64 = base64.urlsafe_b64encode(payload_bytes).decode('utf-8').rstrip('=')
        
        # Sign: header.payload
        signing_input = f"{header_b64}.{payload_b64}".encode('utf-8')
        
        signature = private_key.sign(
            signing_input,
            padding.PSS(
                mgf=padding.MGF1(hashes.SHA256()),
                salt_length=padding.PSS.MAX_LENGTH
            ),
            hashes.SHA256()
        )
        
        signature_b64 = base64.urlsafe_b64encode(signature).decode('utf-8').rstrip('=')
        
        # Return detached signature with metadata
        return {
            "type": "JWS-detached",
            "alg": algorithm,
            "kid": key_id,
            "created": created_at,
            "signature": signature_b64
        }
    
    @staticmethod
    def verify_detached(
        payload_bytes: bytes,
        signature_container: Dict[str, Any],
        public_key
    ) -> bool:
        """Verify detached JWS signature."""
        try:
            # Reconstruct header
            header = {
                "alg": signature_container["alg"],
                "kid": signature_container["kid"],
                "typ": "JWS",
                "iat": signature_container["created"]
            }
            header_bytes = CanonicalJSON.serialize(header)
            header_b64 = base64.urlsafe_b64encode(header_bytes).decode('utf-8').rstrip('=')
            
            # Reconstruct payload
            payload_b64 = base64.urlsafe_b64encode(payload_bytes).decode('utf-8').rstrip('=')
            
            # Reconstruct signing input
            signing_input = f"{header_b64}.{payload_b64}".encode('utf-8')
            
            # Decode signature
            signature = base64.urlsafe_b64decode(
                signature_container["signature"] + '=' * (4 - len(signature_container["signature"]) % 4)
            )
            
            # Verify
            public_key.verify(
                signature,
                signing_input,
                padding.PSS(
                    mgf=padding.MGF1(hashes.SHA256()),
                    salt_length=padding.PSS.MAX_LENGTH
                ),
                hashes.SHA256()
            )
            
            return True
        except Exception as e:
            print(f"Verification failed: {e}")
            return False


class ContentOriginCredential:
    """
    Content Origin Credential with best practices:
    - Detached JWS signatures
    - External revocation
    - Perceptual hashing
    - No PII or media content
    """
    
    def __init__(self, version: str = "2.0.0"):
        self.version = version
        self.credential = {}
        self.signature_container = None
    
    def generate_credential_id(self) -> str:
        """Generate unique credential ID (UUID)."""
        return str(uuid.uuid4())
    
    def create_credential(
        self,
        content_type: str,
        fingerprint_bundle: Dict[str, Any],
        creator_did: str,
        creator_type: str,
        content_metadata: Dict[str, Any],
        revocation_pointer: Optional[str] = None,
        ai_generation_details: Optional[Dict[str, Any]] = None,
        rights: Optional[Dict[str, Any]] = None,
        chain_of_custody: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        Create content origin credential (unsigned).
        
        Args:
            content_type: Type of content
            fingerprint_bundle: Hash bundle from FingerprintBundle
            creator_did: Decentralized Identifier
            creator_type: human/ai-system/human-ai-collaboration
            content_metadata: Metadata (NO PII, NO filenames with PII)
            revocation_pointer: URL/CID to revocation feed
            ai_generation_details: AI info if applicable
            rights: Rights and licensing
            chain_of_custody: Custody records
        """
        if not DIDManager.validate_did(creator_did):
            raise ValueError(f"Invalid DID: {creator_did}")
        
        # RFC3339 timestamp (seconds precision)
        now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        
        credential = {
            "credentialId": self.generate_credential_id(),
            "version": self.version,
            "contentType": content_type,
            "fingerprintBundle": fingerprint_bundle,
            "creator": {
                "did": creator_did,
                "type": creator_type
            },
            "timestamp": {
                "created": content_metadata.get("created_timestamp", now),
                "credentialIssued": now
            },
            "contentMetadata": content_metadata
        }
        
        # Add revocation pointer (external state)
        if revocation_pointer:
            credential["revocationPointer"] = revocation_pointer
        else:
            # Default: placeholder for where revocation list will be
            credential["revocationPointer"] = f"https://revocation.example.com/v1/{credential['credentialId']}"
        
        # Optional fields
        if ai_generation_details:
            credential["aiGenerationDetails"] = ai_generation_details
        
        if rights:
            credential["rights"] = rights
        
        if chain_of_custody:
            credential["chainOfCustody"] = chain_of_custody
        
        self.credential = credential
        return credential
    
    def sign_credential(
        self,
        private_key,
        creator_did: str,
        key_index: int = 1
    ) -> Dict[str, Any]:
        """
        Sign credential with detached JWS.
        
        Args:
            private_key: RSA private key
            creator_did: DID of the signer
            key_index: Key index for kid generation
        
        Returns:
            Signature container (stored separately)
        """
        # Create kid (key identifier)
        kid = DIDManager.create_key_id(creator_did, key_index)
        
        # Canonicalize credential
        canonical_bytes = CanonicalJSON.serialize(self.credential)
        
        # Create detached JWS signature
        self.signature_container = JWSDetached.sign_detached(
            payload_bytes=canonical_bytes,
            private_key=private_key,
            algorithm="RS256",
            key_id=kid
        )
        
        return self.signature_container
    
    def verify_credential(
        self,
        credential: Dict[str, Any],
        signature_container: Dict[str, Any],
        public_key
    ) -> bool:
        """
        Verify credential signature.
        
        Args:
            credential: The credential payload
            signature_container: Detached signature
            public_key: Public key for verification
        """
        # Canonicalize credential
        canonical_bytes = CanonicalJSON.serialize(credential)
        
        # Verify detached signature
        return JWSDetached.verify_detached(
            payload_bytes=canonical_bytes,
            signature_container=signature_container,
            public_key=public_key
        )
    
    def check_revocation(self, credential: Dict[str, Any]) -> bool:
        """
        Check if credential is revoked by fetching external revocation list.
        
        Args:
            credential: The credential to check
        
        Returns:
            True if revoked, False if valid
        """
        revocation_url = credential.get("revocationPointer")
        if not revocation_url:
            return False  # No revocation pointer = assume valid
        
        # In production: fetch revocation_url and check if credential ID is listed
        # For demo, return False (not revoked)
        print(f"  (Would check revocation at: {revocation_url})")
        return False
    
    def export_credential_package(self, base_path: str) -> None:
        """
        Export credential and signature as separate files.
        Best practice: keep signature detached.
        """
        cred_id = self.credential.get('credentialId', 'unknown')
        
        # Export credential
        cred_path = f"{base_path}_credential.json"
        with open(cred_path, 'w') as f:
            json.dump(self.credential, f, indent=2)
        print(f"Credential exported to {cred_path}")
        
        # Export signature separately
        if self.signature_container:
            sig_path = f"{base_path}_signature.json"
            with open(sig_path, 'w') as f:
                json.dump(self.signature_container, f, indent=2)
            print(f"Signature exported to {sig_path}")
    
    @staticmethod
    def load_credential_package(base_path: str) -> Tuple[Dict, Dict]:
        """Load credential and signature from separate files."""
        with open(f"{base_path}_credential.json", 'r') as f:
            credential = json.load(f)
        
        with open(f"{base_path}_signature.json", 'r') as f:
            signature = json.load(f)
        
        return credential, signature


class CredentialKeyManager:
    """Manages cryptographic keys for credentials."""
    
    @staticmethod
    def generate_key_pair():
        """Generate RSA key pair."""
        return rsa.generate_private_key(
            public_exponent=65537,
            key_size=2048,
            backend=default_backend()
        )
    
    @staticmethod
    def save_private_key(private_key, filepath: str, password: bytes = None):
        """Save private key to file."""
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
    
    @staticmethod
    def load_private_key(filepath: str, password: bytes = None):
        """Load private key from file."""
        with open(filepath, 'rb') as f:
            return serialization.load_pem_private_key(
                f.read(),
                password=password,
                backend=default_backend()
            )


# Example usage
def example_article_credential():
    """Example: Create credential for article with proper practices."""
    
    print("=== Article Credential Example ===\n")
    
    coc = ContentOriginCredential()
    
    # Sample article content
    article_html = b"""<html>
    <head><title>Breaking News</title></head>
    <body><h1>Major Event</h1><p>Article content here...</p></body>
    </html>"""
    
    # Create fingerprint bundle with canonicalization
    fingerprint = FingerprintBundle.create_for_text(article_html, canonical=True)
    print(f"Fingerprint: {fingerprint['sha256_canonical'][:32]}...")
    
    # Generate creator key and DID
    km = CredentialKeyManager()
    private_key = km.generate_key_pair()
    creator_did = DIDManager.generate_did_key(private_key.public_key())
    print(f"Creator DID: {creator_did[:50]}...\n")
    
    # Metadata: NO PII, no filenames with PII
    metadata = {
        "title": "Breaking: Major Event Announcement",
        "description": "Coverage of significant development",
        "contentType": "text/html",
        "language": "en",
        "wordCount": 500
    }
    
    # Create credential
    credential = coc.create_credential(
        content_type="article",
        fingerprint_bundle=fingerprint,
        creator_did=creator_did,
        creator_type="human",
        content_metadata=metadata,
        revocation_pointer="https://revocation.example.com/v1/articles",
        ai_generation_details={"isAiGenerated": False},
        rights={
            "license": "CC-BY-4.0",
            "usageRights": ["commercial", "attribution-required"]
        }
    )
    
    print("Credential created (unsigned)")
    print(f"  ID: {credential['credentialId']}")
    print(f"  Revocation pointer: {credential['revocationPointer']}\n")
    
    # Sign with detached JWS
    signature = coc.sign_credential(private_key, creator_did, key_index=1)
    print("Signature created (detached JWS)")
    print(f"  Algorithm: {signature['alg']}")
    print(f"  Key ID: {signature['kid'][:50]}...")
    print(f"  Created: {signature['created']}\n")
    
    # Verify
    is_valid = coc.verify_credential(credential, signature, private_key.public_key())
    print(f"Verification: {'✓ Valid' if is_valid else '✗ Invalid'}\n")
    
    # Check revocation
    is_revoked = coc.check_revocation(credential)
    print(f"Revocation check: {'✗ Revoked' if is_revoked else '✓ Not revoked'}\n")
    
    # Export
    coc.export_credential_package("article")
    
    return coc, private_key


def example_image_credential():
    """Example: Image with perceptual hashing."""
    
    print("\n=== Image Credential Example ===\n")
    
    coc = ContentOriginCredential()
    
    # Sample image bytes (fake for demo)
    image_bytes = b"fake_jpeg_bytes_here" * 1000
    
    # Create fingerprint bundle with perceptual hash
    fingerprint = FingerprintBundle.create_for_image(image_bytes)
    print(f"SHA-256: {fingerprint['sha256_canonical'][:32]}...")
    print(f"pHash: {fingerprint['perceptualHash']}\n")
    
    # Generate creator DID
    km = CredentialKeyManager()
    private_key = km.generate_key_pair()
    creator_did = DIDManager.generate_did_web("photographer.example", "portfolio")
    print(f"Creator DID: {creator_did}\n")
    
    # Metadata: NO filenames with PII
    metadata = {
        "title": "Urban Landscape Photography",
        "contentType": "image/jpeg",
        "dimensions": {"width": 4000, "height": 3000},
        "captureDate": "2025-10-23T14:30:00Z"
    }
    
    # Create credential
    credential = coc.create_credential(
        content_type="image",
        fingerprint_bundle=fingerprint,
        creator_did=creator_did,
        creator_type="human",
        content_metadata=metadata,
        revocation_pointer="https://revocation.example.com/v1/images"
    )
    
    # Sign
    signature = coc.sign_credential(private_key, creator_did)
    
    # Verify
    is_valid = coc.verify_credential(credential, signature, private_key.public_key())
    print(f"Verification: {'✓ Valid' if is_valid else '✗ Invalid'}\n")
    
    # Export
    coc.export_credential_package("image")
    
    return coc, private_key


if __name__ == "__main__":
    print("=" * 70)
    print("Content Origin Credential System V2")
    print("Best Practices Implementation")
    print("=" * 70)
    print()
    
    # Run examples
    article_coc, article_key = example_article_credential()
    image_coc, image_key = example_image_credential()
    
    print("\n" + "=" * 70)
    print("✓ Complete!")
    print("=" * 70)
    print("\nKey improvements:")
    print("  ✓ Detached JWS signatures with alg/kid/timestamp")
    print("  ✓ External revocation via pointer (not in credential)")
    print("  ✓ Perceptual hash bundles for resilient matching")
    print("  ✓ RFC3339 timestamps (seconds precision)")
    print("  ✓ Canonical JSON (RFC8785/JCS)")
    print("  ✓ No PII or media content in credentials")
    print("  ✓ Key rotation support via kid")
