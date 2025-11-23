// VeriSource Browser Extension - Revised Popup Script
document.addEventListener('DOMContentLoaded', async () => {
  // Usage
  const usage = await chrome.runtime.sendMessage({ action: 'getUsage' });
  const remainingEl = document.getElementById('remaining');
  const limitEl = document.getElementById('limit');
  const usageFill = document.getElementById('usageFill');
  
  const limit = usage.limit ?? 10;
  const remaining = usage.remaining ?? 0;
  const used = Math.max(limit - remaining, 0);
  
  remainingEl.textContent = remaining;
  limitEl.textContent = limit;
  
  const pct = limit === Infinity ? 0 : Math.min((used / limit) * 100, 100);
  usageFill.style.width = `${pct}%`;
  
  // Upgrade button
  document.getElementById('upgradeBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'upgradeToPro' });
  });
  
  // Last result
  const last = await chrome.runtime.sendMessage({ action: 'getLastResult' });
  if (last && last.lastResult) {
    renderLastResult(last.lastResult);
  }
  
  // Dashboard link
  document.getElementById('openDashboard').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://verisource.com/dashboard' }); // TODO: real URL
  });
});

function renderLastResult(lastResult) {
  const { imageUrl, result } = lastResult;
  
  // Use API labels directly
  const apiLabel = result?.confidence?.label || 'UNKNOWN';
  const confidencePercentage = result?.confidence?.percentage || 0;
  const confidenceLevel = result?.confidence?.level || 'LOW';
  const aiConfidence = result?.ai_detection?.ai_confidence ?? 0;
  
  // Determine icon and status class from API label
  let icon = '❓';
  let statusClass = 'status-neutral';
  
  if (apiLabel.includes('AI-GENERATED')) {
    icon = '⚠️';
    statusClass = 'status-ai';
  } else if (apiLabel.includes('CAMERA-CAPTURED') || apiLabel.includes('VERIFIED')) {
    icon = '✅';
    statusClass = 'status-auth';
  } else if (apiLabel.includes('EDITED')) {
    icon = '✏️';
    statusClass = 'status-edited';
  } else if (apiLabel.includes('DEEPFAKE')) {
    icon = '🚨';
    statusClass = 'status-ai';
  }
  
  const statusIconEl = document.getElementById('statusIcon');
  const statusMainEl = document.getElementById('statusMain');
  const statusSubEl = document.getElementById('statusSub');
  const explanationEl = document.getElementById('explanation');
  const metaLineEl = document.getElementById('metaLine');
  const statusRowEl = document.getElementById('statusRow');
  
  statusIconEl.textContent = icon;
  statusMainEl.textContent = apiLabel;
  statusSubEl.textContent = `${confidencePercentage}% confidence`;
  
  explanationEl.textContent = `AI Detection: ${aiConfidence}% • Level: ${confidenceLevel}`;
  explanationEl.style.display = 'block';
  
  metaLineEl.textContent = imageUrl;
  metaLineEl.style.display = 'block';
  
  statusRowEl.classList.remove('status-ai', 'status-auth', 'status-edited', 'status-neutral');
  statusRowEl.classList.add(statusClass);
}
