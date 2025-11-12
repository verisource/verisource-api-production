/**
 * C2PA/CAI Content Credentials Verification Service
 * Coalition for Content Provenance and Authenticity
 * 
 * What it does:
 * - Extracts and validates C2PA content credentials
 * - Verifies cryptographic signatures
 * - Checks edit history and chain of custody
 * - Validates creation device and timestamp
 * - Provides blockchain-anchored provenance when available
 * 
 * Accuracy boost: +40-50% when credentials present
 */

const { exec } = require('child_process');
const util = require('util');
const fs = require('fs').promises;
const crypto = require('crypto');
const path = require('path');
const execPromise = util.promisify(exec);

class C2PAVerificationService {
  constructor() {
    this.c2paToolInstalled = null;
    this.exiftoolInstalled = null;
  }

  /**
   * Main verification entry point
   */
  async verifyContent(filePath, fileType) {
    const result = {
      has_c2pa_credentials: false,
      credentials_valid: false,
      confidence_boost: 0,
      provenance: null,
      signature: null,
      edit_history: null,
      blockchain_anchored: false,
      errors: []
    };

    try {
      // Check tool availability
      await this.checkTools();

      // Extract C2PA manifest
      const manifest = await this.extractC2PAManifest(filePath);
      
      if (manifest && !manifest.error) {
        result.has_c2pa_credentials = true;
        result.provenance = this.parseProvenance(manifest);
        result.signature = this.parseSignature(manifest);
        result.edit_history = this.parseEditHistory(manifest);
        
        // Validate signature
        result.credentials_valid = this.validateSignature(manifest);
        
        // Check blockchain anchoring
        result.blockchain_anchored = this.checkBlockchainAnchor(manifest);
        
        // Calculate confidence boost
        if (result.credentials_valid) {
          result.confidence_boost = this.calculateConfidenceBoost(result);
        }
      } else if (manifest && manifest.error) {
        result.errors.push(manifest.error);
      }

      // Try alternative extraction methods if C2PA not found
      if (!result.has_c2pa_credentials) {
        const altCredentials = await this.extractAlternativeCredentials(filePath);
        if (altCredentials) {
          result.has_c2pa_credentials = true;
          result.provenance = altCredentials;
          result.confidence_boost = 20; // Lower boost for non-standard credentials
        }
      }

    } catch (error) {
      result.errors.push(`C2PA verification error: ${error.message}`);
    }

    return result;
  }

  /**
   * Check if required tools are installed
   */
  async checkTools() {
    if (this.c2paToolInstalled === null) {
      try {
        await execPromise('which c2pa-tool');
        this.c2paToolInstalled = true;
      } catch {
        // Try npm global c2pa package
        try {
          await execPromise('which c2patool');
          this.c2paToolInstalled = true;
        } catch {
          this.c2paToolInstalled = false;
        }
      }
    }

    if (this.exiftoolInstalled === null) {
      try {
        await execPromise('which exiftool');
        this.exiftoolInstalled = true;
      } catch {
        this.exiftoolInstalled = false;
      }
    }
  }

  /**
   * Extract C2PA manifest using c2pa-tool or c2patool
   */
  async extractC2PAManifest(filePath) {
    if (!this.c2paToolInstalled) {
      return { error: 'C2PA tool not installed' };
    }

    try {
      // Try c2pa-tool first (Rust-based official tool)
      let command = `c2pa-tool ${filePath} --output json`;
      
      try {
        const { stdout } = await execPromise(command, { 
          timeout: 30000,
          maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large manifests
        });
        
        if (stdout && stdout.trim()) {
          return JSON.parse(stdout);
        }
      } catch (err) {
        // Try c2patool alternative
        command = `c2patool ${filePath} --output json`;
        const { stdout } = await execPromise(command, {
          timeout: 30000,
          maxBuffer: 10 * 1024 * 1024
        });
        
        if (stdout && stdout.trim()) {
          return JSON.parse(stdout);
        }
      }

      return null;

    } catch (error) {
      if (error.message.includes('No claim found')) {
        return null; // File has no C2PA credentials
      }
      return { error: `Manifest extraction failed: ${error.message}` };
    }
  }

  /**
   * Parse provenance information from manifest
   */
  parseProvenance(manifest) {
    const provenance = {
      claim_generator: null,
      claim_generator_info: null,
      capture_device: null,
      capture_time: null,
      creator: null,
      digital_source_type: null,
      software_agent: null
    };

    try {
      // Get active manifest
      const active = manifest.active_manifest || manifest;

      // Claim generator (who created the credentials)
      if (active.claim_generator) {
        provenance.claim_generator = active.claim_generator;
      }

      if (active.claim_generator_info) {
        provenance.claim_generator_info = active.claim_generator_info;
      }

      // Parse assertions for device and creation info
      if (active.assertions) {
        for (const assertion of active.assertions) {
          const label = assertion.label || '';
          const data = assertion.data || {};

          // Capture device information
          if (label.includes('stds.exif')) {
            provenance.capture_device = {
              make: data.Make || data['exif:Make'],
              model: data.Model || data['exif:Model'],
              serial: data.SerialNumber || data['exif:SerialNumber']
            };
            
            provenance.capture_time = data.DateTimeOriginal || 
                                     data['exif:DateTimeOriginal'] ||
                                     data.CreateDate;
          }

          // Creator information
          if (label.includes('stds.schema-org.CreativeWork')) {
            provenance.creator = data.author || data.creator;
          }

          // Digital source type
          if (label.includes('c2pa.digital_source_type') || 
              label.includes('stds.iptc.DigitalSourceType')) {
            provenance.digital_source_type = data.value || data;
          }

          // Software agent
          if (label.includes('c2pa.software_agent') || 
              label.includes('stds.schema-org.SoftwareApplication')) {
            provenance.software_agent = data.name || data;
          }
        }
      }

    } catch (error) {
      console.error('Error parsing provenance:', error.message);
    }

    return provenance;
  }

  /**
   * Parse signature information
   */
  parseSignature(manifest) {
    const signature = {
      valid: false,
      issuer: null,
      time: null,
      certificate_chain: []
    };

    try {
      const active = manifest.active_manifest || manifest;
      
      if (active.signature_info) {
        signature.valid = active.signature_info.validated || false;
        signature.issuer = active.signature_info.issuer;
        signature.time = active.signature_info.time;
        
        if (active.signature_info.cert_chain) {
          signature.certificate_chain = active.signature_info.cert_chain;
        }
      }

    } catch (error) {
      console.error('Error parsing signature:', error.message);
    }

    return signature;
  }

  /**
   * Parse edit history from ingredients
   */
  parseEditHistory(manifest) {
    const history = {
      has_edits: false,
      ingredients: [],
      actions: []
    };

    try {
      const active = manifest.active_manifest || manifest;

      // Parse ingredients (source files)
      if (active.ingredients && active.ingredients.length > 0) {
        history.has_edits = true;
        
        for (const ingredient of active.ingredients) {
          history.ingredients.push({
            title: ingredient.title,
            format: ingredient.format,
            relationship: ingredient.relationship,
            document_id: ingredient.document_id,
            instance_id: ingredient.instance_id
          });
        }
      }

      // Parse actions (edits performed)
      if (active.assertions) {
        for (const assertion of active.assertions) {
          if (assertion.label && assertion.label.includes('c2pa.actions')) {
            const actions = assertion.data && assertion.data.actions;
            if (actions && Array.isArray(actions)) {
              history.has_edits = history.has_edits || actions.length > 0;
              history.actions = actions.map(action => ({
                action: action.action,
                when: action.when,
                software_agent: action.softwareAgent,
                parameters: action.parameters
              }));
            }
          }
        }
      }

    } catch (error) {
      console.error('Error parsing edit history:', error.message);
    }

    return history;
  }

  /**
   * Validate cryptographic signature
   */
  validateSignature(manifest) {
    try {
      const active = manifest.active_manifest || manifest;
      
      // Check if signature_info exists and is validated
      if (active.signature_info) {
        return active.signature_info.validated === true;
      }

      // Check validation_status array
      if (active.validation_status && Array.isArray(active.validation_status)) {
        // All validations should pass
        return active.validation_status.every(status => 
          status.code === 'ok' || status.code === 'success'
        );
      }

      return false;

    } catch (error) {
      console.error('Error validating signature:', error.message);
      return false;
    }
  }

  /**
   * Check if credentials are blockchain-anchored
   */
  checkBlockchainAnchor(manifest) {
    try {
      const active = manifest.active_manifest || manifest;

      // Check for blockchain-related assertions
      if (active.assertions) {
        for (const assertion of active.assertions) {
          const label = assertion.label || '';
          
          // Common blockchain provenance labels
          if (label.includes('blockchain') ||
              label.includes('timestamping') ||
              label.includes('numbers.protocol') ||
              label.includes('starling') ||
              label.includes('truepic')) {
            return true;
          }
        }
      }

      // Check for hard bindings (external verification)
      if (active.hard_bindings && active.hard_bindings.length > 0) {
        return true;
      }

      return false;

    } catch (error) {
      return false;
    }
  }

  /**
   * Calculate confidence boost based on credential quality
   */
  calculateConfidenceBoost(result) {
    let boost = 0;

    // Base boost for having valid credentials
    if (result.credentials_valid) {
      boost += 40;
    }

    // Additional boost for capture device info
    if (result.provenance && result.provenance.capture_device) {
      boost += 5;
    }

    // Additional boost for blockchain anchoring
    if (result.blockchain_anchored) {
      boost += 10;
    }

    // Additional boost for complete edit history
    if (result.edit_history && result.edit_history.actions && 
        result.edit_history.actions.length > 0) {
      boost += 5;
    }

    // Cap at 50% boost
    return Math.min(boost, 50);
  }

  /**
   * Extract alternative credentials (XMP, IPTC, etc.)
   */
  async extractAlternativeCredentials(filePath) {
    if (!this.exiftoolInstalled) {
      return null;
    }

    try {
      // Extract XMP metadata
      const { stdout } = await execPromise(`exiftool -XMP:all -json ${filePath}`, {
        timeout: 10000
      });

      if (!stdout || !stdout.trim()) {
        return null;
      }

      const metadata = JSON.parse(stdout)[0];
      
      // Look for content authenticity indicators in XMP
      const credentials = {};
      
      // Adobe Content Authenticity
      if (metadata['XMP-crs:AlreadyApplied'] || 
          metadata['XMP-xmp:CreatorTool']) {
        credentials.creator_tool = metadata['XMP-xmp:CreatorTool'];
      }

      // IPTC Digital Source Type
      if (metadata['XMP-iptcExt:DigitalSourceType']) {
        credentials.digital_source_type = metadata['XMP-iptcExt:DigitalSourceType'];
      }

      // Camera info
      if (metadata['Make'] || metadata['Model']) {
        credentials.capture_device = {
          make: metadata['Make'],
          model: metadata['Model']
        };
      }

      // Return only if we found meaningful credentials
      if (Object.keys(credentials).length > 0) {
        return credentials;
      }

      return null;

    } catch (error) {
      return null;
    }
  }

  /**
   * Get installation instructions if tools are missing
   */
  getInstallInstructions() {
    const instructions = [];

    if (!this.c2paToolInstalled) {
      instructions.push({
        tool: 'c2pa-tool',
        install: 'cargo install c2pa-tool',
        alternative: 'npm install -g c2pa-node'
      });
    }

    if (!this.exiftoolInstalled) {
      instructions.push({
        tool: 'exiftool',
        install: 'apt-get install libimage-exiftool-perl'
      });
    }

    return instructions;
  }
}

// Export singleton instance
module.exports = new C2PAVerificationService();