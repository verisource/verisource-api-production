/**
 * Authority Integration Service
 * Connects Google Vision web_entities with Wikidata authority detection
 */

const { checkAuthorityFigure, calculateDeepfakeRisk } = require('./authority-detection');

function extractNamesFromWebEntities(webEntities) {
  if (!webEntities || !Array.isArray(webEntities)) return [];
  const names = [];
  for (const entity of webEntities) {
    if (!entity.description) continue;
    const desc = entity.description.trim();
    const score = entity.score || 0;
    if (score < 0.5) continue;
    const skipTerms = ['photo', 'image', 'video', 'screenshot', 'meme', 'news', 'official', 'portrait', 'face', 'person', 'man', 'woman', 'photograph', 'picture', 'media', 'social'];
    if (skipTerms.some(term => desc.toLowerCase().includes(term))) continue;
    const words = desc.split(' ');
    if (words.length >= 2 && words.length <= 4) {
      const allCapitalized = words.every(w => w[0] === w[0].toUpperCase());
      if (allCapitalized) {
        names.push({ name: desc, score });
      }
    }
  }
  return names.sort((a, b) => b.score - a.score).slice(0, 3);
}

async function checkAuthorityInVisionResults(googleVisionResult) {
  const result = { checked: false, authorityDetected: false, authorities: [], highestRisk: 'none', adjustments: [], alerts: [] };
  if (!googleVisionResult || !googleVisionResult.results) return result;
  const webEntities = googleVisionResult.results.web_detection?.web_entities || [];
  const potentialNames = extractNamesFromWebEntities(webEntities);
  if (potentialNames.length === 0) { result.checked = true; return result; }
  console.log('   👤 Checking ' + potentialNames.length + ' potential names...');
  for (const { name, score } of potentialNames) {
    try {
      const authorityResult = await checkAuthorityFigure(name);
      if (authorityResult.isAuthority) {
        result.authorityDetected = true;
        result.authorities.push({ name: authorityResult.name, role: authorityResult.primaryRole, riskLevel: authorityResult.riskLevel, wikidataId: authorityResult.wikidataId, visionScore: score });
        const riskOrder = ['none', 'low', 'medium', 'high', 'critical'];
        if (riskOrder.indexOf(authorityResult.riskLevel) > riskOrder.indexOf(result.highestRisk)) {
          result.highestRisk = authorityResult.riskLevel;
        }
      }
    } catch (err) { console.error('   Authority check error:', err.message); }
  }
  result.checked = true;
  return result;
}

function getAuthorityAdjustment(authorityResult, aiSignals) {
  if (!authorityResult.authorityDetected) return { adjustment: 0, adjustments: [], alerts: [] };
  const hasAISignals = aiSignals && (aiSignals.aiResolution || aiSignals.aiEncoder || aiSignals.noAudio || aiSignals.lowFlicker || aiSignals.noDeviceMetadata || aiSignals.highFrameAI);
  const hasAuthenticSignals = aiSignals && (aiSignals.authenticDevice || aiSignals.authenticGOP || aiSignals.authenticAudio);
  const adjustments = [];
  const alerts = [];
  let adjustment = 0;
  const topAuthority = authorityResult.authorities[0];
  if (hasAISignals && !hasAuthenticSignals) {
    const riskBoost = { 'critical': 35, 'high': 25, 'medium': 15, 'low': 10 }[authorityResult.highestRisk] || 0;
    adjustment = riskBoost;
    adjustments.push('Authority deepfake risk (' + topAuthority.name + '): +' + riskBoost + '%');
    alerts.push('DEEPFAKE_RISK: Possible deepfake of ' + topAuthority.name + ' (' + topAuthority.role + ')');
  } else if (hasAuthenticSignals) {
    adjustments.push('Authority figure (' + topAuthority.name + ') with authentic device');
  }
  return { adjustment, adjustments, alerts };
}

module.exports = { extractNamesFromWebEntities, checkAuthorityInVisionResults, getAuthorityAdjustment };
