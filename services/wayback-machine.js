/**
 * Wayback Machine Service
 * Uses Internet Archive's API to find historical snapshots of images/pages
 * Critical for legal evidence and proving when content first appeared online
 */

const axios = require('axios');

class WaybackMachineService {
  constructor() {
    this.availabilityEndpoint = 'https://archive.org/wayback/available';
    this.cdxEndpoint = 'https://web.archive.org/cdx/search/cdx';
    this.saveEndpoint = 'https://web.archive.org/save';
  }

  /**
   * Check if a URL has been archived and get snapshots
   * @param {string} url - The URL to check
   * @returns {Object} Archive information
   */
  async checkUrl(url) {
    if (!url) {
      return {
        status: 'error',
        error: 'No URL provided'
      };
    }

    try {
      // Get all snapshots using CDX API
      const snapshots = await this.getSnapshots(url);
      
      // Get availability info
      const availability = await this.getAvailability(url);

      const hasSnapshots = snapshots.length > 0;
      
      let firstSnapshot = null;
      let lastSnapshot = null;
      let totalSnapshots = 0;

      if (hasSnapshots) {
        // Sort by timestamp
        snapshots.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        
        firstSnapshot = snapshots[0];
        lastSnapshot = snapshots[snapshots.length - 1];
        totalSnapshots = snapshots.length;
      }

      return {
        status: hasSnapshots ? 'found' : 'not_found',
        url_checked: url,
        archived: hasSnapshots,
        total_snapshots: totalSnapshots,
        first_snapshot: firstSnapshot ? {
          timestamp: this.formatTimestamp(firstSnapshot.timestamp),
          archive_url: `https://web.archive.org/web/${firstSnapshot.timestamp}/${url}`,
          age: this.calculateAge(firstSnapshot.timestamp)
        } : null,
        last_snapshot: lastSnapshot ? {
          timestamp: this.formatTimestamp(lastSnapshot.timestamp),
          archive_url: `https://web.archive.org/web/${lastSnapshot.timestamp}/${url}`
        } : null,
        closest_snapshot: availability?.archived_snapshots?.closest ? {
          timestamp: availability.archived_snapshots.closest.timestamp,
          archive_url: availability.archived_snapshots.closest.url,
          available: availability.archived_snapshots.closest.available
        } : null,
        snapshots_by_year: this.groupByYear(snapshots),
        legal_evidence: hasSnapshots ? {
          earliest_proof: this.formatTimestamp(firstSnapshot.timestamp),
          archive_org_url: `https://web.archive.org/web/${firstSnapshot.timestamp}/${url}`,
          verification_note: 'Internet Archive snapshots are court-admissible as evidence of when content appeared online'
        } : null
      };

    } catch (error) {
      console.error('Wayback Machine error:', error.message);
      return {
        status: 'error',
        error: error.message,
        url_checked: url
      };
    }
  }

  /**
   * Get all snapshots of a URL using CDX API
   */
  async getSnapshots(url) {
    try {
      const response = await axios.get(this.cdxEndpoint, {
        params: {
          url: url,
          output: 'json',
          fl: 'timestamp,original,mimetype,statuscode,digest',
          filter: 'statuscode:200',
          collapse: 'digest' // Remove duplicates
        },
        timeout: 10000
      });

      // First row is headers, rest is data
      if (!response.data || response.data.length <= 1) {
        return [];
      }

      const headers = response.data[0];
      const rows = response.data.slice(1);

      return rows.map(row => {
        const obj = {};
        headers.forEach((header, i) => {
          obj[header] = row[i];
        });
        return obj;
      });

    } catch (error) {
      console.error('CDX API error:', error.message);
      return [];
    }
  }

  /**
   * Get availability info for a URL
   */
  async getAvailability(url) {
    try {
      const response = await axios.get(this.availabilityEndpoint, {
        params: { url },
        timeout: 10000
      });
      return response.data;
    } catch (error) {
      console.error('Availability API error:', error.message);
      return null;
    }
  }

  /**
   * Search for archived images by checking known URLs from reverse image search
   * @param {Array} urls - Array of URLs to check
   * @returns {Object} Combined archive results
   */
  async checkMultipleUrls(urls) {
    if (!urls || urls.length === 0) {
      return {
        status: 'no_urls',
        results: []
      };
    }

    // Check up to 5 URLs in parallel (reduced from 10 to be respectful to API)
    const urlsToCheck = urls.slice(0, 5);
    
    // Run all checks in parallel
    const results = await Promise.all(
      urlsToCheck.map(async (url) => {
        try {
          const result = await this.checkUrl(url);
          return { url, ...result };
        } catch (error) {
          return { url, status: 'error', error: error.message };
        }
      })
    );

    // Find earliest snapshot across all results
    let earliestOverall = null;
    for (const result of results) {
      if (result.first_snapshot) {
        if (!earliestOverall || result.first_snapshot.timestamp < earliestOverall.timestamp) {
          earliestOverall = {
            ...result.first_snapshot,
            source_url: result.url
          };
        }
      }
    }

    return {
      status: 'completed',
      urls_checked: urlsToCheck.length,
      urls_with_archives: results.filter(r => r.archived).length,
      earliest_appearance: earliestOverall,
      results: results
    };
  }

  /**
   * Check if an image has been archived (by checking the image URL directly)
   * @param {string} imageUrl - Direct URL to an image
   */
  async checkImageUrl(imageUrl) {
    const result = await this.checkUrl(imageUrl);
    
    if (result.status === 'found') {
      result.image_archived = true;
      result.note = 'This specific image URL has been archived by Internet Archive';
    }
    
    return result;
  }

  /**
   * Format Wayback timestamp (YYYYMMDDHHmmss) to readable date
   */
  formatTimestamp(timestamp) {
    if (!timestamp || timestamp.length < 8) return null;
    
    const year = timestamp.substring(0, 4);
    const month = timestamp.substring(4, 6);
    const day = timestamp.substring(6, 8);
    const hour = timestamp.substring(8, 10) || '00';
    const minute = timestamp.substring(10, 12) || '00';
    const second = timestamp.substring(12, 14) || '00';
    
    return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  }

  /**
   * Calculate age from timestamp
   */
  calculateAge(timestamp) {
    if (!timestamp) return null;
    
    const date = new Date(this.formatTimestamp(timestamp));
    const now = new Date();
    const diffMs = now - date;
    
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const years = Math.floor(days / 365);
    const months = Math.floor((days % 365) / 30);
    const remainingDays = days % 30;

    return {
      days: days,
      years: years,
      months: months,
      remaining_days: remainingDays,
      human_readable: years > 0 
        ? `${years} year${years > 1 ? 's' : ''}, ${months} month${months !== 1 ? 's' : ''} old`
        : months > 0
          ? `${months} month${months > 1 ? 's' : ''}, ${remainingDays} day${remainingDays !== 1 ? 's' : ''} old`
          : `${days} day${days !== 1 ? 's' : ''} old`
    };
  }

  /**
   * Group snapshots by year for timeline display
   */
  groupByYear(snapshots) {
    const byYear = {};
    
    snapshots.forEach(snapshot => {
      const year = snapshot.timestamp.substring(0, 4);
      if (!byYear[year]) {
        byYear[year] = 0;
      }
      byYear[year]++;
    });

    return byYear;
  }

  /**
   * Helper delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
module.exports = new WaybackMachineService();