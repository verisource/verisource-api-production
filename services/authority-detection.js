/**
 * Authority Figure Detection Service
 * Detects politicians, executives, celebrities, and other high-value deepfake targets
 * Uses Wikidata API for identification
 */

const https = require('https');

// High-risk occupation Wikidata IDs
const AUTHORITY_OCCUPATIONS = {
  'Q82955': { role: 'politician', risk: 'high' },
  'Q484876': { role: 'executive', risk: 'high' },
  'Q17125263': { role: 'celebrity', risk: 'high' },
  'Q1930187': { role: 'journalist', risk: 'medium' },
  'Q47064': { role: 'military_officer', risk: 'high' },
  'Q16533': { role: 'judge', risk: 'high' },
  'Q48352': { role: 'head_of_state', risk: 'critical' },
  'Q30461': { role: 'president', risk: 'critical' },
  'Q14212': { role: 'prime_minister', risk: 'critical' },
  'Q116': { role: 'monarch', risk: 'critical' },
  'Q1097498': { role: 'government_minister', risk: 'high' },
  'Q83460': { role: 'ceo', risk: 'high' },
  'Q3665646': { role: 'ceo', risk: 'high' },
  'Q212238': { role: 'billionaire', risk: 'high' },
  'Q33999': { role: 'actor', risk: 'medium' },
  'Q10800557': { role: 'film_actor', risk: 'medium' },
  'Q177220': { role: 'singer', risk: 'medium' },
  'Q639669': { role: 'musician', risk: 'medium' },
  'Q2066131': { role: 'athlete', risk: 'medium' },
  'Q901': { role: 'scientist', risk: 'low' },
  'Q1622272': { role: 'tv_presenter', risk: 'medium' },
  'Q245068': { role: 'news_anchor', risk: 'medium' },
};

// Position Wikidata IDs (P39 - position held)
const AUTHORITY_POSITIONS = {
  'Q11696': { role: 'president_of_usa', risk: 'critical' },
  'Q30461': { role: 'president', risk: 'critical' },
  'Q14212': { role: 'prime_minister', risk: 'critical' },
  'Q193391': { role: 'senator', risk: 'high' },
  'Q13217683': { role: 'congressperson', risk: 'high' },
  'Q83307': { role: 'cabinet_minister', risk: 'high' },
  'Q30185': { role: 'mayor', risk: 'medium' },
  'Q889821': { role: 'governor', risk: 'high' },
};

/**
 * Search Wikidata for a person by name
 */
async function searchWikidata(name) {
  return new Promise((resolve, reject) => {
    const encodedName = encodeURIComponent(name);
    const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodedName}&language=en&type=item&limit=5&format=json`;
    
    https.get(url, { headers: { 'User-Agent': 'VeriSource/1.0 (https://verisource.io; contact@verisource.io)' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result.search || []);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

/**
 * Get detailed entity info from Wikidata
 */
async function getEntityDetails(entityId) {
  return new Promise((resolve, reject) => {
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${entityId}&props=claims|labels|descriptions&languages=en&format=json`;
    
    https.get(url, { headers: { 'User-Agent': 'VeriSource/1.0 (https://verisource.io; contact@verisource.io)' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result.entities?.[entityId] || null);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

/**
 * Extract occupations and positions from entity claims
 */
function extractRoles(entity) {
  const roles = [];
  const claims = entity?.claims || {};
  
  // P106 = occupation
  const occupations = claims['P106'] || [];
  for (const occ of occupations) {
    const occId = occ?.mainsnak?.datavalue?.value?.id;
    if (occId && AUTHORITY_OCCUPATIONS[occId]) {
      roles.push({
        type: 'occupation',
        wikidataId: occId,
        ...AUTHORITY_OCCUPATIONS[occId]
      });
    }
  }
  
  // P39 = position held
  const positions = claims['P39'] || [];
  for (const pos of positions) {
    const posId = pos?.mainsnak?.datavalue?.value?.id;
    if (posId && AUTHORITY_POSITIONS[posId]) {
      roles.push({
        type: 'position',
        wikidataId: posId,
        ...AUTHORITY_POSITIONS[posId]
      });
    }
  }
  
  return roles;
}

/**
 * Get the highest risk level from roles
 */
function getHighestRisk(roles) {
  const riskLevels = { 'critical': 4, 'high': 3, 'medium': 2, 'low': 1 };
  let highest = 'none';
  let highestScore = 0;
  
  for (const role of roles) {
    const score = riskLevels[role.risk] || 0;
    if (score > highestScore) {
      highestScore = score;
      highest = role.risk;
    }
  }
  
  return highest;
}

/**
 * Main function: Check if a name is an authority figure
 */
async function checkAuthorityFigure(name) {
  try {
    if (!name || name.length < 2) {
      return { isAuthority: false, reason: 'Invalid name' };
    }
    
    console.log(`   🔍 Checking authority: ${name}`);
    
    // Search Wikidata
    const searchResults = await searchWikidata(name);
    
    if (!searchResults || searchResults.length === 0) {
      return { 
        isAuthority: false, 
        confidence: 0,
        reason: 'No Wikidata match' 
      };
    }
    
    // Check top result (most likely match)
    const topResult = searchResults[0];
    const entity = await getEntityDetails(topResult.id);
    
    if (!entity) {
      return { 
        isAuthority: false, 
        confidence: 0,
        reason: 'Could not fetch entity details' 
      };
    }
    
    // Extract roles
    const roles = extractRoles(entity);
    
    if (roles.length === 0) {
      return {
        isAuthority: false,
        wikidataId: topResult.id,
        name: topResult.label,
        description: topResult.description,
        confidence: 30,
        reason: 'Person found but no authority roles detected'
      };
    }
    
    const riskLevel = getHighestRisk(roles);
    const primaryRole = roles[0];
    
    return {
      isAuthority: true,
      wikidataId: topResult.id,
      name: topResult.label,
      description: topResult.description,
      roles: roles,
      primaryRole: primaryRole.role,
      riskLevel: riskLevel,
      confidence: riskLevel === 'critical' ? 95 : riskLevel === 'high' ? 85 : 70,
      reason: `${primaryRole.role} (${riskLevel} risk)`
    };
    
  } catch (err) {
    console.error('   Authority detection error:', err.message);
    return { 
      isAuthority: false, 
      error: err.message,
      reason: 'API error'
    };
  }
}

/**
 * Calculate deepfake risk score based on authority status and AI signals
 */
function calculateDeepfakeRisk(authorityResult, aiSignals) {
  const result = {
    riskScore: 0,
    riskLevel: 'low',
    isHighRiskDeepfake: false,
    adjustments: [],
    alerts: []
  };
  
  if (!authorityResult.isAuthority) {
    return result;
  }
  
  const { riskLevel, primaryRole, name } = authorityResult;
  
  // Base risk from authority status
  const baseRisk = {
    'critical': 40,
    'high': 30,
    'medium': 20,
    'low': 10
  }[riskLevel] || 0;
  
  // Check AI signals
  const hasAISignals = aiSignals && (
    aiSignals.aiResolution ||
    aiSignals.aiEncoder ||
    aiSignals.noAudio ||
    aiSignals.lowFlicker ||
    aiSignals.noDeviceMetadata
  );
  
  if (hasAISignals) {
    result.riskScore = baseRisk;
    result.isHighRiskDeepfake = true;
    result.riskLevel = riskLevel;
    result.adjustments.push(`Authority figure (${primaryRole}): +${baseRisk}%`);
    result.alerts.push(`DEEPFAKE_RISK: Possible deepfake of ${name} (${primaryRole})`);
  } else {
    // Authority figure but authentic device signals
    result.riskScore = 0;
    result.adjustments.push(`Authority figure (${primaryRole}) with authentic signals`);
  }
  
  return result;
}

module.exports = {
  checkAuthorityFigure,
  calculateDeepfakeRisk,
  searchWikidata,
  getEntityDetails,
  AUTHORITY_OCCUPATIONS,
  AUTHORITY_POSITIONS
};
