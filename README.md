# VeriSource Browser Extension

## Features
- Right-click any image to verify authenticity
- Instant AI detection results
- Beautiful overlay UI
- Free tier: 10 verifications per day
- Pro tier: Unlimited verifications

## Installation (Development)
1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select this directory
5. Extension is now installed!

## Usage
1. Visit any website with images
2. Right-click on any image
3. Select "Verify with VeriSource"
4. See instant verification results

## Files
- `manifest.json` - Extension configuration
- `background.js` - Service worker (API calls, usage tracking)
- `content.js` - Content script (UI injection)
- `popup.html` - Extension popup UI
- `popup.js` - Popup logic
- `styles.css` - Styling
- `icons/` - Extension icons

## TODO Before Publishing
- [ ] Replace placeholder icons with actual PNG files (16x16, 48x48, 128x128)
- [ ] Update API_URL to production endpoint
- [ ] Update pricing page URL in background.js
- [ ] Add privacy policy URL to manifest
- [ ] Test on multiple websites
- [ ] Add error handling for CORS issues
- [ ] Create Chrome Web Store listing

## API Requirements
The extension requires a VeriSource API endpoint at:
- `POST /verify` - Accepts multipart file upload
- Returns JSON with verification results

## Privacy
- Images are sent to VeriSource API for analysis
- Usage data stored locally in browser
- No tracking or analytics

## License
Proprietary
# Polygon timestamping enabled
