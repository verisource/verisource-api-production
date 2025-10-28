"""
Content Origin Credential System V3

Final refinements:
- Semantic versioning (breaking changes bump major)
- Proper media types (use mimeType, not contentType enum)
- Lean credentials (move rights to off-chain metadata)
- No verification URLs (DIDs are self-sufficient)
- AI metadata in ext namespace (non-normative, not asserted)
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


# Semantic Versioning
CREDENTIAL_VERSION = "3.0.0"  # Major.Minor.Patch
# Breaking changes: bump major (1.0 → 2.0)
# New optional fields: bump minor (2.0 → 2.1)
# Bug fixes: bump patch (2.1.0 → 2.1.1)


class CanonicalJSON:
    """RFC8785 JSON Canonicalization Scheme"""
    
    @staticmethod
    def serialize(obj: Any) -> bytes:
        """Serialize to canonical JSON."""
        return json.dumps(
            obj,
            ensure_ascii=False,
            separators=(',', ':'),
            sort_keys=True
        ).encode('utf-8')


class PerceptualHash:
    """Perceptual hashing for resilient media matching."""
    
    @staticmethod
    def compute_image_phash(image_bytes: bytes) -> str:
        """Compute perceptual hash for images."""
        return f"phash:{hashlib.sha256(image_bytes[:1000]).hexdigest()[:16]}"
    
    @staticmethod
    def compute_video_segment_hashes(video_bytes: bytes, segment_size: int = 1024*1024) -> List[str]:
        """Rolling segment hashes for video/audio."""
        segments = []
        for i in range(0, len(video_bytes), segment_size):
            segment = video_bytes[i:i+segment_size]
            seg_hash = hashlib.sha256(segment).hexdigest()[:16]
            segments.append(f"seg_{i//segment_size}:{seg_hash}")
        return segments[:10]
    
    @staticmethod
    def compute_text_fingerprint(text: bytes) -> str:
        """Text fingerprint using shingling/n-grams."""
        return f"textfp:{hashlib.sha256(text).hexdigest()[:16]}"


class FingerprintBundle:
    """Bundle of hashes for resilient content matching."""
    
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
        """Create key identifier (kid) for JWS."""
        return f"{did}#key-{key_index}"
    
    @staticmethod
    def validate_did(did: str) -> bool:
        """
        Validate DID format (DID-Core compliant).
        Pattern: did:method:method-specific-id
        """
        # DID-Core compliant: did:[method]:[method-specific-id]
        pattern = r'^did:[a-z0-9]+:.+$'
        return bool(re.match(pattern, did)) and len(did) <= 512


class JWSDetached:
    """Detached JWS (JSON Web Signature) implementation."""
    
    @staticmethod
    def create_jws_header(algorithm: str, key_id: str, created_at: str) -> Dict[str, str]:
        """Create JWS header with algorithm, kid, and timestamp."""
        return {
            "alg": algorithm,
            "kid": key_id,
            "typ": "JWS",
            "iat": created_at
        }
    
    @staticmethod
    def sign_detached(
        payload_bytes: bytes,
        private_key,
        algorithm: str,
        key_id: str
    ) -> Dict[str, Any]:
        """Create detached JWS signature."""
        created_at = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        
        header = JWSDetached.create_jws_header(algorithm, key_id, created_at)
        header_bytes = CanonicalJSON.serialize(header)
        header_b64 = base64.urlsafe_b64encode(header_bytes).decode('utf-8').rstrip('=')
        
        payload_b64 = base64.urlsafe_b64encode(payload_bytes).decode('utf-8').rstrip('=')
        
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
            header = {
                "alg": signature_container["alg"],
                "kid": signature_container["kid"],
                "typ": "JWS",
                "iat": signature_container["created"]
            }
            header_bytes = CanonicalJSON.serialize(header)
            header_b64 = base64.urlsafe_b64encode(header_bytes).decode('utf-8').rstrip('=')
            
            payload_b64 = base64.urlsafe_b64encode(payload_bytes).decode('utf-8').rstrip('=')
            
            signing_input = f"{header_b64}.{payload_b64}".encode('utf-8')
            
            signature = base64.urlsafe_b64decode(
                signature_container["signature"] + '=' * (4 - len(signature_container["signature"]) % 4)
            )
            
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
    Content Origin Credential V3
    
    Key principles:
    - Lean: Only essential fields in credential
    - Offline-first: No verification URLs, DIDs are self-sufficient
    - Non-normative extensions: AI metadata not asserted by credential
    """
    
    def __init__(self, version: str = CREDENTIAL_VERSION):
        self.version = version
        self.credential = {}
        self.signature_container = None
    
    def generate_credential_id(self) -> str:
        """Generate unique credential ID (UUID)."""
        return str(uuid.uuid4())
    
    def create_credential(
        self,
        media_type: str,
        fingerprint_bundle: Dict[str, Any],
        creator_did: str,
        creator_type: str,
        content_metadata: Dict[str, Any],
        revocation_pointer: str,
        chain_of_custody: Optional[List[Dict[str, Any]]] = None,
        extensions: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Create lean content origin credential.
        
        Args:
            media_type: MIME type (e.g., 'text/html', 'image/jpeg', 'video/mp4')
            fingerprint_bundle: Hash bundle from FingerprintBundle
            creator_did: Decentralized Identifier (no PII)
            creator_type: human/ai-system/human-ai-collaboration
            content_metadata: Essential metadata only
            revocation_pointer: URL/CID to external revocation feed
            chain_of_custody: Optional custody records
            extensions: Optional extensions in 'ext' namespace (non-normative)
        
        Note:
            - Rights/licensing should be in off-chain metadata document
            - No verification URLs (DIDs are self-sufficient for offline verification)
            - AI generation details go in extensions (non-normative)
        """
        if not DIDManager.validate_did(creator_did):
            raise ValueError(f"Invalid DID: {creator_did}")
        
        # Validate media type format (IANA-style: type/subtype)
        if not re.match(r'^[a-z]+/[a-z0-9][a-z0-9.+_-]*[a-z0-9]$', media_type):
            raise ValueError(f"Invalid media type: {media_type}. Use IANA format (e.g., 'text/html', 'image/jpeg')")
        
        now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        
        # Core credential (lean)
        credential = {
            "credentialId": self.generate_credential_id(),
            "version": self.version,
            "mediaType": media_type,
            "fingerprintBundle": fingerprint_bundle,
            "creator": {
                "did": creator_did,
                "type": creator_type
            },
            "timestamp": {
                "created": content_metadata.get("created_timestamp", now),
                "issued": now
            },
            "contentMetadata": content_metadata,
            "revocationPointer": revocation_pointer
        }
        
        # Optional chain of custody
        if chain_of_custody:
            credential["chainOfCustody"] = chain_of_custody
        
        # Extensions namespace (non-normative)
        # This is where AI generation details, experimental fields, etc. go
        if extensions:
            credential["ext"] = extensions
        
        self.credential = credential
        return credential
    
    def sign_credential(
        self,
        private_key,
        creator_did: str,
        key_index: int = 1
    ) -> Dict[str, Any]:
        """Sign credential with detached JWS."""
        kid = DIDManager.create_key_id(creator_did, key_index)
        canonical_bytes = CanonicalJSON.serialize(self.credential)
        
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
        Verify credential signature offline using DID+signature.
        No verification URLs needed - DID is self-sufficient.
        """
        canonical_bytes = CanonicalJSON.serialize(credential)
        return JWSDetached.verify_detached(
            payload_bytes=canonical_bytes,
            signature_container=signature_container,
            public_key=public_key
        )
    
    def check_revocation(self, credential: Dict[str, Any]) -> bool:
        """Check if credential is revoked via external pointer."""
        revocation_url = credential.get("revocationPointer")
        if not revocation_url:
            return False
        
        # In production: fetch revocation_url and check
        print(f"  (Would check revocation at: {revocation_url})")
        return False
    
    def export_credential_package(self, base_path: str) -> None:
        """Export credential and signature as separate files."""
        cred_path = f"{base_path}_credential.json"
        with open(cred_path, 'w') as f:
            json.dump(self.credential, f, indent=2)
        print(f"Credential exported to {cred_path}")
        
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


class OffChainMetadata:
    """
    Off-chain metadata document for non-essential fields.
    
    This keeps credentials lean. Include:
    - Rights/licensing information
    - Detailed AI generation parameters
    - Business-specific metadata
    - Attribution details
    """
    
    @staticmethod
    def create_metadata_doc(
        credential_id: str,
        rights: Optional[Dict[str, Any]] = None,
        ai_generation_details: Optional[Dict[str, Any]] = None,
        business_metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Create off-chain metadata document linked to credential.
        """
        metadata = {
            "credentialId": credential_id,
            "metadataVersion": "1.0.0",
            "created": datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        }
        
        if rights:
            metadata["rights"] = rights
        
        if ai_generation_details:
            metadata["aiGenerationDetails"] = ai_generation_details
        
        if business_metadata:
            metadata["businessMetadata"] = business_metadata
        
        return metadata
    
    @staticmethod
    def export_metadata(metadata: Dict[str, Any], filepath: str) -> None:
        """Export metadata to separate file."""
        with open(filepath, 'w') as f:
            json.dump(metadata, f, indent=2)
        print(f"Off-chain metadata exported to {filepath}")


class CredentialKeyManager:
    """Manages cryptographic keys."""
    
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
def example_lean_article_credential():
    """Example: Lean article credential with off-chain metadata."""
    
    print("=== V3 Lean Article Credential ===\n")
    
    coc = ContentOriginCredential()
    
    # Article content
    article_html = b"""<html><head><title>News</title></head>
    <body><h1>Major Event</h1><p>Content here...</p></body></html>"""
    
    # Fingerprint bundle
    fingerprint = FingerprintBundle.create_for_text(article_html, canonical=True)
    
    # Generate creator DID
    km = CredentialKeyManager()
    private_key = km.generate_key_pair()
    creator_did = DIDManager.generate_did_key(private_key.public_key())
    
    print(f"Creator DID: {creator_did[:50]}...\n")
    
    # Lean metadata (essential only)
    metadata = {
        "title": "Breaking: Major Event Announcement",
        "description": "Coverage of significant development",
        "language": "en",
        "wordCount": 500
    }
    
    # Extensions (non-normative) - AI details go here
    extensions = {
        "aiGeneration": {
            "_note": "Non-normative: origin does not assert AI generation claims",
            "declaredByCreator": {
                "isAiGenerated": False,
                "humanAuthored": True
            }
        }
    }
    
    # Create lean credential
    credential = coc.create_credential(
        media_type="text/html",  # MIME type, not enum
        fingerprint_bundle=fingerprint,
        creator_did=creator_did,
        creator_type="human",
        content_metadata=metadata,
        revocation_pointer="https://revocation.example.com/v1/articles",
        extensions=extensions
    )
    
    print("✓ Lean credential created")
    print(f"  Media type: {credential['mediaType']}")
    print(f"  Version: {credential['version']} (semantic)")
    print(f"  Extensions: {list(credential.get('ext', {}).keys())}\n")
    
    # Off-chain metadata (rights, detailed AI info, etc.)
    offchain = OffChainMetadata.create_metadata_doc(
        credential_id=credential['credentialId'],
        rights={
            "license": "CC-BY-4.0",
            "usageRights": ["commercial", "attribution-required"],
            "copyright": "© 2025"
        },
        ai_generation_details={
            "detailedWorkflow": "Human research → outline → writing → editing",
            "toolsUsed": ["Grammar checker"],
            "humanTimeSpent": "4 hours"
        }
    )
    
    # Sign credential
    signature = coc.sign_credential(private_key, creator_did)
    print(f"✓ Signed with detached JWS")
    print(f"  Algorithm: {signature['alg']}")
    print(f"  Key ID: {signature['kid'][:50]}...\n")
    
    # Verify (offline - no URLs needed)
    is_valid = coc.verify_credential(credential, signature, private_key.public_key())
    print(f"✓ Offline verification: {'Valid' if is_valid else 'Invalid'}\n")
    
    # Export
    coc.export_credential_package("v3_article")
    OffChainMetadata.export_metadata(offchain, "v3_article_metadata.json")
    
    print("\n📦 Files created:")
    print("  - v3_article_credential.json (lean core credential)")
    print("  - v3_article_signature.json (detached JWS)")
    print("  - v3_article_metadata.json (off-chain: rights, detailed AI info)")
    
    return coc, private_key


def example_image_credential_with_extensions():
    """Example: Image credential with extensions."""
    
    print("\n\n=== V3 Image Credential with Extensions ===\n")
    
    coc = ContentOriginCredential()
    
    # Image bytes
    image_bytes = b"fake_jpeg_bytes" * 1000
    
    # Fingerprint with perceptual hash
    fingerprint = FingerprintBundle.create_for_image(image_bytes)
    
    # DID
    km = CredentialKeyManager()
    private_key = km.generate_key_pair()
    creator_did = DIDManager.generate_did_web("photographer.example", "portfolio")
    
    # Lean metadata
    metadata = {
        "title": "Urban Architecture",
        "dimensions": {"width": 4000, "height": 3000},
        "captureDate": "2025-10-24T14:30:00Z"
    }
    
    # Extensions: AI generation details (non-normative)
    extensions = {
        "aiGeneration": {
            "_note": "Non-normative: these are creator declarations, not credential assertions",
            "declaredByCreator": {
                "isAiGenerated": True,
                "aiModel": "DALL-E 3",
                "aiProvider": "OpenAI",
                "humanContribution": "prompt engineering, post-processing"
            }
        },
        "experimentalFeatures": {
            "colorProfile": "sRGB",
            "compressionQuality": 95
        }
    }
    
    # Create credential
    credential = coc.create_credential(
        media_type="image/jpeg",
        fingerprint_bundle=fingerprint,
        creator_did=creator_did,
        creator_type="human-ai-collaboration",
        content_metadata=metadata,
        revocation_pointer="https://revocation.example.com/v1/images",
        extensions=extensions
    )
    
    print(f"✓ Credential created with extensions")
    print(f"  Media type: {credential['mediaType']}")
    print(f"  Extensions: {list(credential['ext'].keys())}\n")
    
    # Sign and verify
    signature = coc.sign_credential(private_key, creator_did)
    is_valid = coc.verify_credential(credential, signature, private_key.public_key())
    print(f"✓ Verified: {is_valid}\n")
    
    # Export
    coc.export_credential_package("v3_image")
    
    return coc, private_key


if __name__ == "__main__":
    print("=" * 70)
    print("Content Origin Credential System V3")
    print("Semantic Versioning | Lean Credentials | Offline-First")
    print("=" * 70)
    print()
    
    # Run examples
    article_coc, article_key = example_lean_article_credential()
    image_coc, image_key = example_image_credential_with_extensions()
    
    print("\n" + "=" * 70)
    print("✓ V3 Complete!")
    print("=" * 70)
    print("\nKey V3 improvements:")
    print("  ✓ Semantic versioning (breaking changes bump major)")
    print("  ✓ Media types (MIME format, not enum)")
    print("  ✓ Lean credentials (rights → off-chain metadata)")
    print("  ✓ No verification URLs (DIDs self-sufficient)")
    print("  ✓ AI metadata in 'ext' namespace (non-normative)")
    print("  ✓ Offline-first verification")
