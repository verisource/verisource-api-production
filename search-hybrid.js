const { searchByFingerprint } = require('./search');
const { searchAllEngines } = require('./external-search');

async function hybridSearch(fingerprint, imagePath, options = {}) {
  const {
    alwaysSearchExternal = false,
    tier = 'free'
  } = options;
  
  const internalResults = await searchByFingerprint(fingerprint);
  
  let shouldSearchExternal = false;
  
  if (tier === 'free') {
    shouldSearchExternal = !internalResults.found && alwaysSearchExternal;
  } else if (tier === 'pro') {
    shouldSearchExternal = alwaysSearchExternal || !internalResults.found;
  } else if (tier === 'enterprise') {
    shouldSearchExternal = true;
  }
  
  let externalResults = null;
  
  if (shouldSearchExternal && imagePath) {
    try {
      externalResults = await searchAllEngines(imagePath, {
        enableGoogle: tier !== 'free',
        enableTinEye: tier === 'enterprise',
        enableBing: tier === 'pro' || tier === 'enterprise'
      });
    } catch (error) {
      console.error('External search error:', error);
      externalResults = {
        error: 'External search failed',
        message: error.message
      };
    }
  }
  
  return {
    internal: internalResults,
    external: externalResults,
    search_strategy: {
      internal_searched: true,
      external_searched: shouldSearchExternal,
      tier: tier,
      recommendation: internalResults.found 
        ? 'File previously verified in our database'
        : externalResults?.summary?.total_external_matches > 0
          ? 'File found online - may not be original'
          : 'File appears to be original - first verification'
    }
  };
}

module.exports = { hybridSearch };
