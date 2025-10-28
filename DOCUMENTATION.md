# Content Origin Credential System - Complete Documentation

## Overview

This Content Origin Credential System is designed to prove the authenticity of digital content including articles, images, videos, and AI-generated content. It provides a robust framework for:

- **Content Authentication**: Cryptographically verify content hasn't been tampered with
- **Creator Attribution**: Clearly identify who created the content (human or AI)
- **Chain of Custody**: Track the complete history of content handling
- **Rights Management**: Define and enforce usage rights and licensing
- **AI Transparency**: Clearly label and track AI-generated or AI-assisted content

## Core Concept

Each piece of content receives a unique **Content Origin Credential** - a digitally signed JSON document containing:

1. **Content Identity**: Hash of the actual content for integrity verification
2. **Creator Information**: Who created it (human, AI, or collaboration)
3. **Timestamps**: When created, modified, and credentialed
4. **Metadata**: Description, format, dimensions, etc.
5. **Verification**: Digital signatures to prove authenticity
6. **Rights**: Copyright and licensing information
7. **Provenance**: Complete chain of custody

## Key Features

### 1. Content Type Support
- **Articles** (text/HTML/markdown)
- **Images** (JPEG, PNG, etc.)
- **Videos** (MP4, etc.)
- **AI-Generated Content** (any type created by AI)
- **Mixed Media**

### 2. Verification Methods
- **Digital Signatures**: RSA-based cryptographic signing
- **Blockchain**: Optional blockchain anchoring for immutability
- **Certificate Authority**: X.509 certificate chain support
- **API Keys**: For automated systems

### 3. AI Content Transparency
Special fields for AI-generated content:
- AI model name and version
- AI provider
- Level of human involvement
- Original prompts (optional)
- Training data cutoff date

### 4. Content Integrity
- Cryptographic hashing (SHA-256, SHA-512, SHA3-256)
- Perceptual fingerprinting for fuzzy matching
- Watermark tracking

## Credential Structure

### Required Fields

```json
{
  "credentialId": "unique-uuid",
  "version": "1.0.0",
  "contentType": "article|image|video|ai-generated-*",
  "contentHash": {
    "algorithm": "SHA-256",
    "value": "hash-value"
  },
  "creator": {
    "name": "Creator Name",
    "type": "human|ai-system|human-ai-collaboration"
  },
  "timestamp": {
    "created": "ISO-8601-timestamp"
  },
  "contentMetadata": {
    "title": "Content Title",
    "description": "Description"
  }
}
```

### Optional but Recommended Fields

- **aiGenerationDetails**: Required if AI was involved
- **sourceInformation**: Original URLs and references
- **verification**: Digital signatures and verification URLs
- **rights**: Copyright and licensing
- **chainOfCustody**: Complete history
- **technicalDetails**: EXIF, capture device, software
- **status**: Active/revoked state

## Implementation Guide

### Installation Requirements

```bash
pip install cryptography --break-system-packages
```

### Basic Usage

#### 1. Generate Key Pair (One-time Setup)

```python
from credential_system import CredentialKeyManager

key_manager = CredentialKeyManager()
private_key = key_manager.generate_key_pair()
key_manager.save_private_key(private_key, "my_private_key.pem", password=b"secure_password")
key_manager.save_public_key(private_key.public_key(), "my_public_key.pem")
```

#### 2. Create a Credential for New Content

```python
from credential_system import ContentOriginCredential

# Initialize
coc = ContentOriginCredential()

# Read your content
with open("my_article.html", "rb") as f:
    content = f.read()

# Calculate hash
content_hash = coc.calculate_content_hash(content)

# Define creator
creator = {
    "name": "Your Name",
    "type": "human",
    "email": "you@example.com",
    "organization": "Your Company"
}

# Define metadata
metadata = {
    "title": "My Article Title",
    "description": "Article description",
    "fileName": "my_article.html",
    "fileSize": len(content),
    "mimeType": "text/html",
    "language": "en"
}

# Create credential
credential = coc.create_credential(
    content_type="article",
    content_hash=content_hash,
    creator=creator,
    content_metadata=metadata,
    ai_generation_details={"isAiGenerated": False}
)

# Sign it
private_key = key_manager.load_private_key("my_private_key.pem", password=b"secure_password")
coc.sign_credential(private_key)

# Export
coc.export_credential("my_article_credential.json")
```

#### 3. Verify a Credential

```python
# Load credential
credential = ContentOriginCredential.load_credential("my_article_credential.json")

# Verify
coc = ContentOriginCredential()
is_valid = coc.verify_credential(credential)

if is_valid:
    print("✓ Credential is authentic and valid")
else:
    print("✗ Credential verification failed")
```

#### 4. Create Credential for AI-Generated Content

```python
# For AI-generated content, include AI details
ai_details = {
    "isAiGenerated": True,
    "aiModel": "GPT-4",
    "aiProvider": "OpenAI",
    "humanContribution": "edited",
    "prompt": "Create an article about...",
    "trainingDataCutoff": "2023-12-01"
}

credential = coc.create_credential(
    content_type="ai-generated-text",
    content_hash=content_hash,
    creator=creator,
    content_metadata=metadata,
    ai_generation_details=ai_details
)
```

## Use Cases

### 1. News Organizations
- Credential every article published
- Prove content hasn't been altered
- Track editorial chain
- Combat misinformation

### 2. Content Creators
- Protect original work
- Prove ownership
- License tracking
- Derivative work attribution

### 3. AI Content Platforms
- Transparently label AI content
- Track AI model versions
- Show human involvement level
- Comply with AI disclosure laws

### 4. Social Media Platforms
- Verify authentic content
- Combat deepfakes
- Track content origins
- Enable trust indicators

### 5. Legal & Compliance
- Evidence for copyright claims
- Regulatory compliance
- Audit trails
- Content authenticity verification

## Best Practices

### Security

1. **Protect Private Keys**: Store signing keys securely, use strong passwords
2. **Use Strong Hashing**: Prefer SHA-256 or SHA-512
3. **Regular Key Rotation**: Update signing keys periodically
4. **Secure Storage**: Use HSM or secure key management systems for production

### Content Management

1. **Immediate Credentialing**: Create credentials at content creation time
2. **Preserve Originals**: Keep original content with credentials
3. **Update Chain of Custody**: Record every modification
4. **Version Control**: Create new credentials for significant changes

### AI Content

1. **Always Disclose AI Use**: Be transparent about AI involvement
2. **Document Human Contribution**: Clearly state what humans contributed
3. **Include Model Info**: Record AI model and version
4. **Save Prompts**: Consider saving original prompts for transparency

### Rights Management

1. **Clear Licensing**: Always specify usage rights
2. **Copyright Info**: Include complete copyright statements
3. **Watermarking**: Apply watermarks to sensitive content
4. **Usage Tracking**: Monitor how credentialed content is used

## Integration Options

### API Integration

Create a REST API endpoint for credential generation:

```python
from flask import Flask, request, jsonify

@app.route('/api/credentials', methods=['POST'])
def create_credential():
    data = request.json
    coc = ContentOriginCredential()
    # ... create credential
    return jsonify(coc.credential)
```

### Blockchain Integration

For immutable records, add blockchain anchoring:

```python
# After signing credential
tx_id = blockchain_service.anchor_credential(coc.credential)
coc.credential['verification']['blockchainTxId'] = tx_id
```

### Database Storage

Store credentials in a database for quick lookup:

```sql
CREATE TABLE credentials (
    credential_id UUID PRIMARY KEY,
    content_type VARCHAR(50),
    content_hash VARCHAR(128),
    creator_name VARCHAR(255),
    created_at TIMESTAMP,
    credential_json JSONB,
    is_active BOOLEAN
);
```

## Verification Workflow

### For Content Consumers

1. **Obtain Credential**: Get credential JSON (embedded in content or via API)
2. **Check Content Hash**: Hash the content and compare with credential
3. **Verify Signature**: Use public key to verify digital signature
4. **Check Status**: Ensure credential hasn't been revoked
5. **Review Metadata**: Check creator, timestamps, AI involvement

### For Platforms

1. **Automated Verification**: Integrate verification into content ingestion
2. **Trust Indicators**: Show verified badges for credentialed content
3. **Revocation Checking**: Regularly check credential status
4. **User Education**: Help users understand what credentials mean

## Troubleshooting

### Common Issues

**Problem**: Signature verification fails
- **Solution**: Ensure you're using the correct public key
- **Solution**: Check that credential hasn't been modified after signing

**Problem**: Hash mismatch
- **Solution**: Verify you're hashing the exact same content
- **Solution**: Check for encoding issues (UTF-8 vs other)

**Problem**: Can't load private key
- **Solution**: Ensure correct password
- **Solution**: Check file permissions and path

## Future Enhancements

Potential additions to the system:

1. **Timestamping Authority**: Third-party timestamp verification
2. **Credential Revocation Lists**: Public lists of revoked credentials
3. **Multi-Signature Support**: Require multiple signatures
4. **Credential Templates**: Pre-defined templates for common use cases
5. **Mobile Verification**: Apps for easy credential checking
6. **Content Discovery**: Search for credentialed content
7. **Reputation System**: Track creator credibility
8. **Batch Processing**: Efficiently credential large volumes

## Compliance Considerations

This system can help comply with:

- **EU AI Act**: AI content labeling requirements
- **GDPR**: Data provenance and tracking
- **Copyright Law**: Proof of ownership and attribution
- **Content Authenticity Initiative**: Industry standards for authentic content

## Support & Contribution

This is a foundational system that can be extended based on your specific business needs. Consider adding:

- Webhooks for credential events
- Analytics dashboard
- Browser extensions for verification
- Integration with content management systems
- Automated credential generation pipelines

## License

[Add your business license here]

## Contact

[Add your business contact information]
