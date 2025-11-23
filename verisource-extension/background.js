// VeriSource - Ultra-Reliable Version
const API_URL = 'https://verisource-api-production-production.up.railway.app/verify';

console.log('VeriSource background script loaded');

// Create context menu
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'verisource-verify',
    title: 'Verify with VeriSource',
    contexts: ['image']
  });
  console.log('✅ Context menu created');
});

// Handle context menu click - INJECT EVERY TIME
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'verisource-verify') {
    console.log('🖱️ Context menu clicked:', info.srcUrl);
    
    try {
      // ALWAYS inject fresh (guarantees it works)
      console.log('💉 Injecting scripts...');
      
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['styles.css']
      });
      
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      
      console.log('✅ Scripts injected');
      
      // Wait for script to load
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Send verification request
      await verifyImage(info.srcUrl, tab.id);
      
    } catch (error) {
      console.error('❌ Injection failed:', error);
      alert('VeriSource: Please refresh the page and try again');
    }
  }
});

async function verifyImage(imageUrl, tabId) {
  try {
    console.log('🔍 Verifying:', imageUrl);
    
    // Show loading
    await chrome.tabs.sendMessage(tabId, {
      action: 'showLoading',
      imageUrl
    }).catch(err => console.log('Loading message failed:', err));
    
    // Check usage
    const usage = await checkUsageLimit();
    if (!usage.allowed) {
      await chrome.tabs.sendMessage(tabId, {
        action: 'showLimitReached',
        imageUrl
      });
      return;
    }
    
    // Fetch image
    console.log('⬇️ Downloading image...');
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    
    if (blob.size > 10 * 1024 * 1024) {
      throw new Error('Image too large (max 10MB)');
    }
    
    // Send to API
    console.log('📤 Sending to API...');
    const formData = new FormData();
    formData.append('file', blob, 'image.jpg');
    
    const apiResponse = await fetch(API_URL, {
      method: 'POST',
      body: formData
    });
    
    if (!apiResponse.ok) {
      throw new Error(`API error: ${apiResponse.status}`);
    }
    
    const result = await apiResponse.json();
    console.log('✅ Got result:', result.confidence?.label);
    
    // Increment usage
    await incrementUsage();
    
    // Show result
    await chrome.tabs.sendMessage(tabId, {
      action: 'showResult',
      imageUrl,
      result
    });
    
  } catch (error) {
    console.error('❌ Verification failed:', error);
    await chrome.tabs.sendMessage(tabId, {
      action: 'showError',
      imageUrl,
      error: error.message
    }).catch(() => {});
  }
}

async function checkUsageLimit() {
  const data = await chrome.storage.local.get(['usage', 'lastReset', 'isPro']);
  const now = new Date();
  const lastReset = data.lastReset ? new Date(data.lastReset) : new Date(0);

  if (data.isPro) {
    return { allowed: true, remaining: 999 };
  }

  if (now.toDateString() !== lastReset.toDateString()) {
    await chrome.storage.local.set({ usage: 0, lastReset: now.toISOString() });
    return { allowed: true, remaining: 100 };
  }

  const usage = data.usage || 0;
  return {
    allowed: usage < 100,
    remaining: Math.max(100 - usage, 0)
  };
}

async function incrementUsage() {
  const data = await chrome.storage.local.get(['usage']);
  await chrome.storage.local.set({ usage: (data.usage || 0) + 1 });
}

// Popup messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getUsage') {
    checkUsageLimit().then(sendResponse);
    return true;
  }
  if (request.action === 'upgradeToPro') {
    chrome.tabs.create({ url: 'https://verisource.com/pricing' });
  }
});
