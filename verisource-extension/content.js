// VeriSource Browser Extension - Content Script (Reliability Improved)

let currentOverlay = null;
let updateThrottle = null;

// Keep-alive port for reliable messaging
let port = null;

// Establish connection on load
try {
  port = chrome.runtime.connect({ name: 'verisource' });
  port.onMessage.addListener((request) => {
    handleMessage(request);
  });
  port.onDisconnect.addListener(() => {
    console.log('Port disconnected, reconnecting...');
    setTimeout(() => {
      port = chrome.runtime.connect({ name: 'verisource' });
    }, 1000);
  });
} catch (error) {
  console.error('Failed to establish port connection:', error);
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    sendResponse({ status: 'ready' });
    return;
  }
  
  handleMessage(request);
});

function handleMessage(request) {
  switch (request.action) {
    case 'showLoading':
      showLoadingOverlay(request.imageUrl);
      break;
    case 'showResult':
      showResultOverlay(request.imageUrl, request.result);
      break;
    case 'showError':
      showErrorOverlay(request.imageUrl, request.error);
      break;
    case 'showLimitReached':
      showLimitOverlay(request.imageUrl);
      break;
  }
}

// Security: Sanitize text content
function sanitizeText(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = String(text).substring(0, 500);
  return div.textContent;
}

// IMPROVEMENT: Better image finding (handles picture, background-image, shadow DOM)
function findImageElement(imageUrl) {
  // Try direct img elements
  const images = document.querySelectorAll('img');
  for (const img of images) {
    if (img.src === imageUrl || img.currentSrc === imageUrl) {
      return img;
    }
  }
  
  // Try picture > source elements
  const pictures = document.querySelectorAll('picture');
  for (const picture of pictures) {
    const sources = picture.querySelectorAll('source');
    for (const source of sources) {
      if (source.srcset && source.srcset.includes(imageUrl)) {
        return picture.querySelector('img') || picture;
      }
    }
  }
  
  // Try CSS background images
  const allElements = document.querySelectorAll('*');
  for (const el of allElements) {
    const bg = window.getComputedStyle(el).backgroundImage;
    if (bg && bg.includes(imageUrl)) {
      return el;
    }
  }
  
  return null;
}

function removeCurrentOverlay() {
  if (currentOverlay) {
    if (currentOverlay._cleanup) {
      currentOverlay._cleanup();
    }
    currentOverlay.remove();
    currentOverlay = null;
  }
}

// IMPROVEMENT: Throttled position updates (75ms throttle)
function createOverlay(imgElement, type) {
  removeCurrentOverlay();

  const overlay = document.createElement('div');
  overlay.className = `verisource-overlay verisource-${type}`;

  const updatePosition = () => {
    const r = imgElement.getBoundingClientRect();
    overlay.style.top = `${r.top + window.scrollY + 8}px`;
    overlay.style.left = `${r.right + window.scrollX - 8 - 220}px`;
  };

  // Initial position
  const rect = imgElement.getBoundingClientRect();
  overlay.style.position = 'fixed';
  overlay.style.top = `${rect.top + window.scrollY + 8}px`;
  overlay.style.left = `${rect.right + window.scrollX - 8 - 220}px`;
  overlay.style.width = `220px`;
  overlay.style.zIndex = '2147483647';

  document.body.appendChild(overlay);

  // Throttled scroll/resize handlers
  let lastUpdate = 0;
  const throttledUpdate = () => {
    const now = Date.now();
    if (now - lastUpdate > 75) { // 75ms throttle
      lastUpdate = now;
      updatePosition();
    }
  };

  window.addEventListener('scroll', throttledUpdate, { passive: true });
  window.addEventListener('resize', throttledUpdate, { passive: true });

  overlay._cleanup = () => {
    window.removeEventListener('scroll', throttledUpdate);
    window.removeEventListener('resize', throttledUpdate);
  };

  currentOverlay = overlay;
  return overlay;
}

function showLoadingOverlay(imageUrl) {
  const img = findImageElement(imageUrl);
  if (!img) return;

  const overlay = createOverlay(img, 'loading');
  
  const card = document.createElement('div');
  card.className = 'verisource-card';
  
  const header = document.createElement('div');
  header.className = 'verisource-header-row';
  
  const logo = document.createElement('span');
  logo.className = 'verisource-logo';
  logo.textContent = '🔍 VeriSource';
  
  const closeBtn = document.createElement('button');
  closeBtn.className = 'verisource-close';
  closeBtn.textContent = '×';
  closeBtn.onclick = () => {
    overlay._cleanup?.();
    removeCurrentOverlay();
  };
  
  header.appendChild(logo);
  header.appendChild(closeBtn);
  
  const body = document.createElement('div');
  body.className = 'verisource-body';
  
  const status = document.createElement('div');
  status.className = 'verisource-status neutral';
  
  const icon = document.createElement('div');
  icon.className = 'verisource-status-icon';
  icon.textContent = '⏳';
  
  const statusText = document.createElement('div');
  statusText.className = 'verisource-status-text';
  
  const title = document.createElement('div');
  title.className = 'vs-title';
  title.textContent = 'Verifying…';
  
  const sub = document.createElement('div');
  sub.className = 'vs-sub';
  sub.textContent = 'Analyzing image authenticity';
  
  statusText.appendChild(title);
  statusText.appendChild(sub);
  status.appendChild(icon);
  status.appendChild(statusText);
  body.appendChild(status);
  card.appendChild(header);
  card.appendChild(body);
  overlay.appendChild(card);
}

function showResultOverlay(imageUrl, result) {
  const img = findImageElement(imageUrl);
  if (!img) return;

  const apiLabel = sanitizeText(result?.confidence?.label || 'UNKNOWN');
  const confidenceLevel = sanitizeText(result?.confidence?.level || 'LOW');
  const confidencePercentage = Number(result?.confidence?.percentage) || 0;
  const aiConfidence = Number(result?.ai_detection?.ai_confidence) || 0;
  
  let statusType = 'neutral';
  let icon = '❓';
  
  if (apiLabel.includes('AI-GENERATED')) {
    statusType = 'ai';
    icon = '⚠️';
  } else if (apiLabel.includes('CAMERA-CAPTURED') || apiLabel.includes('VERIFIED')) {
    statusType = 'authentic';
    icon = '✅';
  } else if (apiLabel.includes('EDITED')) {
    statusType = 'edited';
    icon = '✏️';
  } else if (apiLabel.includes('DEEPFAKE')) {
    statusType = 'deepfake';
    icon = '🚨';
  }
  
  const cameraModel = sanitizeText(result?.camera_verification?.details?.model || '');
  const cameraInfo = cameraModel ? ` • ${cameraModel}` : '';

  const overlay = createOverlay(img, 'result');
  
  const card = document.createElement('div');
  card.className = 'verisource-card';
  
  const header = document.createElement('div');
  header.className = 'verisource-header-row';
  
  const logo = document.createElement('span');
  logo.className = 'verisource-logo';
  logo.textContent = 'VeriSource';
  
  const closeBtn = document.createElement('button');
  closeBtn.className = 'verisource-close';
  closeBtn.textContent = '×';
  closeBtn.onclick = () => {
    overlay._cleanup?.();
    removeCurrentOverlay();
  };
  
  header.appendChild(logo);
  header.appendChild(closeBtn);
  
  const body = document.createElement('div');
  body.className = 'verisource-body';
  
  const status = document.createElement('div');
  status.className = `verisource-status ${statusType}`;
  
  const statusIcon = document.createElement('div');
  statusIcon.className = 'verisource-status-icon';
  statusIcon.textContent = icon;
  
  const statusText = document.createElement('div');
  statusText.className = 'verisource-status-text';
  
  const title = document.createElement('div');
  title.className = 'vs-title';
  title.textContent = apiLabel;
  
  const sub = document.createElement('div');
  sub.className = 'vs-sub';
  sub.textContent = `${confidencePercentage}% confidence${cameraInfo}`;
  
  statusText.appendChild(title);
  statusText.appendChild(sub);
  status.appendChild(statusIcon);
  status.appendChild(statusText);
  
  const explainer = document.createElement('div');
  explainer.className = 'verisource-explainer';
  explainer.textContent = `AI Detection: ${aiConfidence}% • Level: ${confidenceLevel}`;
  
  const actions = document.createElement('div');
  actions.className = 'verisource-actions';
  
  const shareBtn = document.createElement('button');
  shareBtn.className = 'vs-btn vs-primary vs-share';
  shareBtn.textContent = 'Share Result';
  shareBtn.onclick = () => shareResult(result, imageUrl);
  
  actions.appendChild(shareBtn);
  body.appendChild(status);
  body.appendChild(explainer);
  body.appendChild(actions);
  card.appendChild(header);
  card.appendChild(body);
  overlay.appendChild(card);

  setTimeout(() => {
    if (currentOverlay === overlay) {
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 0.4s';
      setTimeout(() => {
        overlay._cleanup?.();
        removeCurrentOverlay();
      }, 400);
    }
  }, 10000);
}

function showErrorOverlay(imageUrl, error) {
  const img = findImageElement(imageUrl);
  if (!img) return;

  const overlay = createOverlay(img, 'error');
  
  const card = document.createElement('div');
  card.className = 'verisource-card';
  
  const header = document.createElement('div');
  header.className = 'verisource-header-row';
  
  const logo = document.createElement('span');
  logo.className = 'verisource-logo';
  logo.textContent = 'VeriSource';
  
  const closeBtn = document.createElement('button');
  closeBtn.className = 'verisource-close';
  closeBtn.textContent = '×';
  closeBtn.onclick = () => {
    overlay._cleanup?.();
    removeCurrentOverlay();
  };
  
  header.appendChild(logo);
  header.appendChild(closeBtn);
  
  const body = document.createElement('div');
  body.className = 'verisource-body';
  
  const status = document.createElement('div');
  status.className = 'verisource-status error';
  
  const icon = document.createElement('div');
  icon.className = 'verisource-status-icon';
  icon.textContent = '⚠️';
  
  const statusText = document.createElement('div');
  statusText.className = 'verisource-status-text';
  
  const title = document.createElement('div');
  title.className = 'vs-title';
  title.textContent = 'Verification failed';
  
  const sub = document.createElement('div');
  sub.className = 'vs-sub';
  sub.textContent = sanitizeText(error || 'Unknown error');
  
  statusText.appendChild(title);
  statusText.appendChild(sub);
  status.appendChild(icon);
  status.appendChild(statusText);
  body.appendChild(status);
  card.appendChild(header);
  card.appendChild(body);
  overlay.appendChild(card);
}

function showLimitOverlay(imageUrl) {
  const img = findImageElement(imageUrl);
  if (!img) return;

  const overlay = createOverlay(img, 'limit');
  
  const card = document.createElement('div');
  card.className = 'verisource-card';
  
  const header = document.createElement('div');
  header.className = 'verisource-header-row';
  
  const logo = document.createElement('span');
  logo.className = 'verisource-logo';
  logo.textContent = 'VeriSource';
  
  const closeBtn = document.createElement('button');
  closeBtn.className = 'verisource-close';
  closeBtn.textContent = '×';
  closeBtn.onclick = () => {
    overlay._cleanup?.();
    removeCurrentOverlay();
  };
  
  header.appendChild(logo);
  header.appendChild(closeBtn);
  
  const body = document.createElement('div');
  body.className = 'verisource-body';
  
  const status = document.createElement('div');
  status.className = 'verisource-status limit';
  
  const icon = document.createElement('div');
  icon.className = 'verisource-status-icon';
  icon.textContent = '🚫';
  
  const statusText = document.createElement('div');
  statusText.className = 'verisource-status-text';
  
  const title = document.createElement('div');
  title.className = 'vs-title';
  title.textContent = 'Daily limit reached';
  
  const sub = document.createElement('div');
  sub.className = 'vs-sub';
  sub.textContent = 'Upgrade to Pro for unlimited checks';
  
  statusText.appendChild(title);
  statusText.appendChild(sub);
  status.appendChild(icon);
  status.appendChild(statusText);
  
  const actions = document.createElement('div');
  actions.className = 'verisource-actions';
  
  const upgradeBtn = document.createElement('button');
  upgradeBtn.className = 'vs-btn vs-primary vs-upgrade';
  upgradeBtn.textContent = 'Upgrade to Pro';
  upgradeBtn.onclick = () => {
    chrome.runtime.sendMessage({ action: 'upgradeToPro' });
    overlay._cleanup?.();
    removeCurrentOverlay();
  };
  
  actions.appendChild(upgradeBtn);
  body.appendChild(status);
  body.appendChild(actions);
  card.appendChild(header);
  card.appendChild(body);
  overlay.appendChild(card);
}

function shareResult(result, imageUrl) {
  const apiLabel = sanitizeText(result?.confidence?.label || 'UNKNOWN');
  const confidencePercentage = Number(result?.confidence?.percentage) || 0;
  
  let emoji = '🔍';
  if (apiLabel.includes('AI-GENERATED')) emoji = '⚠️';
  else if (apiLabel.includes('CAMERA-CAPTURED') || apiLabel.includes('VERIFIED')) emoji = '✅';
  else if (apiLabel.includes('EDITED')) emoji = '✏️';

  const text = `${emoji} ${apiLabel}\n${confidencePercentage}% confidence\nVerified with VeriSource\n${sanitizeText(imageUrl)}`;

  navigator.clipboard.writeText(text)
    .then(() => alert('VeriSource: result copied to clipboard'))
    .catch(() => alert('VeriSource: failed to copy result'));
}

// Log when content script loads
console.log('VeriSource content script loaded and ready');
