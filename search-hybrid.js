const { searchByFingerprint } = require('./search');

async function hybridSearch(fingerprint, imagePath, options = {}) {
  const { tier = 'free' } = options;
  
  try {
    // Try internal search
    const internalResults = await searchByFingerprint(fingerprint);
    
    return {
      internal: internalResults,
      external: null,
      search_strategy: {
        internal_searched: true,
        external_searched: false,
        tier: tier,
        recommendation: internalResults.found 
          ? 'File previously verified in our database'
          : 'File appears to be original - first verification'
      }
    };
  } catch (error) {
    console.error('Hybrid search error:', error);
    return {
      internal: {
        found: false,
        is_first_verification: true,
        message: 'Search temporarily unavailable'
      },
      external: null
    };
  }
}

module.exports = { hybridSearch };
