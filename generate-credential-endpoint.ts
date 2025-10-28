/**
 * API endpoint for generating credentials
 * Add this to your server-production.ts
 */

import { Request, Response } from "express";
import crypto from "crypto";
import sharp from "sharp";

// Add this interface
interface ImageFingerprint {
  sha256_canonical: string;
  perceptualHash: string;
  canonicalization: string;
  width: number;
  height: number;
}

/**
 * Canonicalize image to img:v2 and compute fingerprints
 */
async function canonicalizeImageV2(imageBuffer: Buffer): Promise<ImageFingerprint> {
  // Step 1: Apply img:v2 canonicalization
  // - EXIF orientation
  // - Convert to sRGB
  // - Max 2048px (longest side)
  // - Flatten alpha to white
  // - PNG with cl9 compression
  
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  
  // Apply transformations
  let canonical = image
    .rotate() // Apply EXIF orientation
    .toColorspace("srgb") // Convert to sRGB
    .flatten({ background: { r: 255, g: 255, b: 255 } }); // Flatten alpha to white
  
  // Resize if needed (max 2048px longest side)
  if (metadata.width && metadata.height) {
    const maxSide = Math.max(metadata.width, metadata.height);
    if (maxSide > 2048) {
      const scale = 2048 / maxSide;
      const newWidth = Math.round(metadata.width * scale);
      const newHeight = Math.round(metadata.height * scale);
      canonical = canonical.resize(newWidth, newHeight, {
        kernel: "lanczos3",
        fit: "fill"
      });
    }
  }
  
  // Convert to PNG with deterministic settings
  const canonicalBytes = await canonical
    .png({
      compressionLevel: 9,
      palette: false,
      progressive: false
    })
    .toBuffer();
  
  // Step 2: Compute SHA-256
  const sha256_canonical = crypto
    .createHash("sha256")
    .update(canonicalBytes)
    .digest("hex");
  
  // Step 3: Compute perceptual hash
  const perceptualHash = await computePHash(canonicalBytes);
  
  const finalMeta = await sharp(canonicalBytes).metadata();
  
  return {
    sha256_canonical,
    perceptualHash: `phash:${perceptualHash}`,
    canonicalization: "img:v2:exif-orient|srgb|max2048|flatten-white|png(cl9,palette0,prog0)",
    width: finalMeta.width || 0,
    height: finalMeta.height || 0
  };
}

/**
 * Compute DCT-based perceptual hash
 */
async function computePHash(imageBuffer: Buffer): Promise<string> {
  // Resize to 32x32 grayscale
  const small = await sharp(imageBuffer)
    .resize(32, 32, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer();
  
  // Apply DCT (simplified - use proper DCT in production)
  // This is a placeholder - in production, use the full DCT implementation
  const hash = crypto
    .createHash("sha256")
    .update(small)
    .digest("hex")
    .substring(0, 16);
  
  return hash;
}

/**
 * Generate UUID v4
 */
function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * Generate a did:key (placeholder - use proper DID library in production)
 */
function generateDID(): string {
  const randomBytes = crypto.randomBytes(32);
  const base58 = randomBytes.toString("base64url");
  return `did:key:z${base58}`;
}

/**
 * POST /generate-credential
 * Generate a V3 credential for an uploaded image
 * 
 * Request:
 *   - file: image file (multipart)
 *   - creatorDid (optional): Creator's DID
 *   - creatorType (optional): human|ai-system|human-ai-collaboration
 *   - title (optional): Content title
 *   - description (optional): Content description
 *   - tags (optional): Comma-separated tags
 * 
 * Response:
 *   - Full V3 credential JSON
 */
export async function generateCredential(req: Request, res: Response) {
  let tmpPath: string | null = null;
  const startTime = Date.now();
  
  try {
    // Check for uploaded file
    if (!req.file?.path) {
      return res.status(400).json({ 
        error: "Provide image file in 'file' field (multipart/form-data)" 
      });
    }
    tmpPath = req.file.path;
    
    // Read image
    const imageBuffer = fs.readFileSync(tmpPath);
    
    // Canonicalize and compute fingerprints
    console.log("Canonicalizing image...");
    const fingerprint = await canonicalizeImageV2(imageBuffer);
    console.log(`✓ Image canonicalized (${fingerprint.width}x${fingerprint.height})`);
    
    // Extract parameters
    const creatorDid = req.body.creatorDid || generateDID();
    const creatorType = req.body.creatorType || "human";
    const title = req.body.title;
    const description = req.body.description;
    const tags = req.body.tags ? String(req.body.tags).split(",").map(t => t.trim()).filter(Boolean) : [];
    
    // Validate creator type
    if (!["human", "ai-system", "human-ai-collaboration"].includes(creatorType)) {
      return res.status(400).json({ 
        error: "Invalid creatorType. Must be: human, ai-system, or human-ai-collaboration" 
      });
    }
    
    // Detect media type from file
    const ext = path.extname(req.file.originalname).toLowerCase();
    const mediaTypeMap: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".gif": "image/gif"
    };
    const mediaType = mediaTypeMap[ext] || "image/jpeg";
    
    // Generate credential
    const credentialId = generateUUID();
    const now = new Date().toISOString();
    
    const credential: any = {
      credentialId,
      version: "3.0.0",
      mediaType,
      
      fingerprintBundle: {
        sha256_canonical: fingerprint.sha256_canonical,
        algorithm: "sha256+phash",
        perceptualHash: fingerprint.perceptualHash,
        canonicalization: fingerprint.canonicalization
      },
      
      creator: {
        did: creatorDid,
        type: creatorType
      },
      
      timestamp: {
        created: now,
        issued: now
      },
      
      revocationPointer: `https://verisource.io/revocation/${credentialId}`
    };
    
    // Add content metadata if provided
    if (title || description || tags.length > 0) {
      credential.contentMetadata = {};
      
      if (title) credential.contentMetadata.title = title;
      if (description) credential.contentMetadata.description = description;
      if (tags.length > 0) credential.contentMetadata.tags = tags;
    }
    
    const duration = Date.now() - startTime;
    console.log(`✓ Credential generated in ${duration}ms`);
    
    return res.json({
      credential,
      metadata: {
        processingTimeMs: duration,
        imageWidth: fingerprint.width,
        imageHeight: fingerprint.height
      }
    });
    
  } catch (e: any) {
    const duration = Date.now() - startTime;
    const msg = e?.message || String(e);
    console.error(`❌ Credential generation failed after ${duration}ms:`, msg);
    
    return res.status(500).json({ 
      error: msg,
      processingTimeMs: duration
    });
    
  } finally {
    // Cleanup
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
    if (tmpPath && !req.file?.path) {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  }
}

// Add this route to your server:
// app.post("/generate-credential", upload.single("file"), generateCredential);
