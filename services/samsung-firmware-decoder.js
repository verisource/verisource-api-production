/**
 * Samsung Firmware Decoder
 * Decodes Samsung firmware strings to identify device models
 * 
 * Firmware format: [Model Code][Carrier][Region][Version]
 * Example: S928USQS4CYK2
 *   - S928 = Galaxy S24 Ultra
 *   - U = USA Unlocked
 *   - SQS4CYK2 = Firmware version
 */

// Samsung model codes to device names
const SAMSUNG_MODEL_CODES = {
  // Galaxy S24 series (2024)
  'S928': { name: 'Galaxy S24 Ultra', year: 2024 },
  'S926': { name: 'Galaxy S24+', year: 2024 },
  'S921': { name: 'Galaxy S24', year: 2024 },
  
  // Galaxy S23 series (2023)
  'S918': { name: 'Galaxy S23 Ultra', year: 2023 },
  'S916': { name: 'Galaxy S23+', year: 2023 },
  'S911': { name: 'Galaxy S23', year: 2023 },
  'S711': { name: 'Galaxy S23 FE', year: 2023 },
  
  // Galaxy S22 series (2022)
  'S908': { name: 'Galaxy S22 Ultra', year: 2022 },
  'S906': { name: 'Galaxy S22+', year: 2022 },
  'S901': { name: 'Galaxy S22', year: 2022 },
  
  // Galaxy S21 series (2021)
  'G998': { name: 'Galaxy S21 Ultra', year: 2021 },
  'G996': { name: 'Galaxy S21+', year: 2021 },
  'G991': { name: 'Galaxy S21', year: 2021 },
  'G990': { name: 'Galaxy S21 FE', year: 2022 },
  
  // Galaxy S20 series (2020)
  'G988': { name: 'Galaxy S20 Ultra', year: 2020 },
  'G986': { name: 'Galaxy S20+', year: 2020 },
  'G981': { name: 'Galaxy S20', year: 2020 },
  'G780': { name: 'Galaxy S20 FE', year: 2020 },
  
  // Galaxy S10 series (2019)
  'G975': { name: 'Galaxy S10+', year: 2019 },
  'G973': { name: 'Galaxy S10', year: 2019 },
  'G970': { name: 'Galaxy S10e', year: 2019 },
  
  // Galaxy S9 series (2018)
  'G965': { name: 'Galaxy S9+', year: 2018 },
  'G960': { name: 'Galaxy S9', year: 2018 },
  
  // Galaxy S8 series (2017)
  'G955': { name: 'Galaxy S8+', year: 2017 },
  'G950': { name: 'Galaxy S8', year: 2017 },
  
  // Galaxy S7 series (2016)
  'G935': { name: 'Galaxy S7 Edge', year: 2016 },
  'G930': { name: 'Galaxy S7', year: 2016 },
  
  // Galaxy S6 series (2015)
  'G928': { name: 'Galaxy S6 Edge+', year: 2015 },
  'G925': { name: 'Galaxy S6 Edge', year: 2015 },
  'G920': { name: 'Galaxy S6', year: 2015 },
  
  // Galaxy S5 (2014)
  'G900': { name: 'Galaxy S5', year: 2014 },
  
  // Galaxy Note series
  'N986': { name: 'Galaxy Note 20 Ultra', year: 2020 },
  'N981': { name: 'Galaxy Note 20', year: 2020 },
  'N985': { name: 'Galaxy Note 20 Ultra', year: 2020 },
  'N980': { name: 'Galaxy Note 20', year: 2020 },
  'N976': { name: 'Galaxy Note 10+ 5G', year: 2019 },
  'N975': { name: 'Galaxy Note 10+', year: 2019 },
  'N971': { name: 'Galaxy Note 10 5G', year: 2019 },
  'N970': { name: 'Galaxy Note 10', year: 2019 },
  'N960': { name: 'Galaxy Note 9', year: 2018 },
  'N950': { name: 'Galaxy Note 8', year: 2017 },
  'N920': { name: 'Galaxy Note 5', year: 2015 },
  'N910': { name: 'Galaxy Note 4', year: 2014 },
  'N900': { name: 'Galaxy Note 3', year: 2013 },
  
  // Galaxy Z Fold series
  'F946': { name: 'Galaxy Z Fold 5', year: 2023 },
  'F936': { name: 'Galaxy Z Fold 4', year: 2022 },
  'F926': { name: 'Galaxy Z Fold 3', year: 2021 },
  'F916': { name: 'Galaxy Z Fold 2', year: 2020 },
  'F900': { name: 'Galaxy Fold', year: 2019 },
  
  // Galaxy Z Flip series
  'F731': { name: 'Galaxy Z Flip 5', year: 2023 },
  'F721': { name: 'Galaxy Z Flip 4', year: 2022 },
  'F711': { name: 'Galaxy Z Flip 3', year: 2021 },
  'F700': { name: 'Galaxy Z Flip', year: 2020 },
  
  // Galaxy A series (selected popular models)
  'A546': { name: 'Galaxy A54', year: 2023 },
  'A536': { name: 'Galaxy A53', year: 2022 },
  'A526': { name: 'Galaxy A52', year: 2021 },
  'A516': { name: 'Galaxy A51 5G', year: 2020 },
  'A515': { name: 'Galaxy A51', year: 2020 },
  'A505': { name: 'Galaxy A50', year: 2019 },
  'A346': { name: 'Galaxy A34', year: 2023 },
  'A336': { name: 'Galaxy A33', year: 2022 },
  'A256': { name: 'Galaxy A25', year: 2023 },
  'A156': { name: 'Galaxy A15', year: 2023 }
};

// Region/carrier codes
const SAMSUNG_REGION_CODES = {
  'U': 'USA (Unlocked)',
  'A': 'USA (AT&T)',
  'T': 'USA (T-Mobile)',
  'V': 'USA (Verizon)',
  'S': 'USA (Sprint)',
  'W': 'Canada',
  'B': 'Global/Europe',
  'F': 'International',
  'G': 'Global',
  'N': 'Korea',
  'K': 'Korea (KT)',
  'L': 'Korea (LG U+)',
  'I': 'India',
  'C': 'China',
  'J': 'Japan',
  'P': 'Europe',
  'X': 'Australia'
};

/**
 * Decode Samsung firmware string to device info
 * @param {string} firmware - Firmware string (e.g., "S928USQS4CYK2")
 * @returns {Object} Decoded device information
 */
function decodeSamsungFirmware(firmware) {
  const result = {
    decoded: false,
    device: null,
    model_code: null,
    region: null,
    region_name: null,
    firmware_version: null,
    release_year: null,
    is_original: true,
    is_firmware: false
  };
  
  if (!firmware || typeof firmware !== 'string') {
    return result;
  }
  
  const fw = firmware.trim().toUpperCase();
  
  // Check if this looks like Samsung firmware
  // Patterns: S928USQS4CYK2, G998BXXU5CVJA, N986BXXS3DVL1
  const firmwarePattern = /^([SGFNA]\d{3})([A-Z])([A-Z0-9]+)$/;
  const match = fw.match(firmwarePattern);
  
  if (!match) {
    // Try alternate pattern for older devices
    const altPattern = /^([SGFNA]\d{3})([A-Z])(.+)$/i;
    const altMatch = fw.match(altPattern);
    if (!altMatch) {
      return result;
    }
  }
  
  // Extract model code (first 4 characters)
  const modelCode = fw.substring(0, 4);
  const deviceInfo = SAMSUNG_MODEL_CODES[modelCode];
  
  if (!deviceInfo) {
    // Unknown model code but still looks like firmware
    result.is_firmware = true;
    result.model_code = modelCode;
    return result;
  }
  
  result.decoded = true;
  result.is_firmware = true;
  result.device = deviceInfo.name;
  result.model_code = modelCode;
  result.release_year = deviceInfo.year;
  
  // Extract region code (5th character)
  if (fw.length > 4) {
    const regionCode = fw.charAt(4);
    result.region = regionCode;
    result.region_name = SAMSUNG_REGION_CODES[regionCode] || 'Unknown';
  }
  
  // Extract firmware version (remaining characters)
  if (fw.length > 5) {
    result.firmware_version = fw.substring(5);
  }
  
  return result;
}

/**
 * Check if a software string is Samsung firmware (not editing software)
 * @param {string} software - Software field from EXIF
 * @returns {boolean}
 */
function isSamsungFirmware(software) {
  if (!software || typeof software !== 'string') {
    return false;
  }
  
  const sw = software.trim().toUpperCase();
  
  // Samsung firmware patterns
  const patterns = [
    /^[SGFNA]\d{3}[A-Z][A-Z0-9]+$/,  // S928USQS4CYK2
    /^SM-[A-Z]\d{3}[A-Z]?$/,           // SM-S928U (model number, not firmware)
  ];
  
  // Check if matches firmware pattern
  if (patterns[0].test(sw)) {
    return true;
  }
  
  // Check if starts with known model codes
  const modelCode = sw.substring(0, 4);
  return SAMSUNG_MODEL_CODES.hasOwnProperty(modelCode);
}

/**
 * Detect known editing software
 * @param {string} software - Software field from EXIF
 * @returns {Object}
 */
function detectEditingSoftware(software) {
  const result = {
    is_editing_software: false,
    software_name: null,
    software_type: null,
    is_professional: false
  };
  
  if (!software || typeof software !== 'string') {
    return result;
  }
  
  const sw = software.toLowerCase();
  
  const editingSoftware = {
    // Professional desktop
    'adobe photoshop': { name: 'Adobe Photoshop', type: 'professional_desktop', professional: true },
    'photoshop': { name: 'Adobe Photoshop', type: 'professional_desktop', professional: true },
    'adobe lightroom': { name: 'Adobe Lightroom', type: 'professional_desktop', professional: true },
    'lightroom': { name: 'Adobe Lightroom', type: 'professional_desktop', professional: true },
    'capture one': { name: 'Capture One', type: 'professional_desktop', professional: true },
    'phase one': { name: 'Capture One', type: 'professional_desktop', professional: true },
    'affinity photo': { name: 'Affinity Photo', type: 'professional_desktop', professional: true },
    'gimp': { name: 'GIMP', type: 'desktop', professional: false },
    'corel': { name: 'Corel', type: 'professional_desktop', professional: true },
    'paintshop': { name: 'PaintShop Pro', type: 'desktop', professional: false },
    'acdsee': { name: 'ACDSee', type: 'desktop', professional: false },
    'dxo': { name: 'DxO PhotoLab', type: 'professional_desktop', professional: true },
    'luminar': { name: 'Luminar', type: 'desktop', professional: false },
    'on1': { name: 'ON1 Photo RAW', type: 'professional_desktop', professional: true },
    'darktable': { name: 'darktable', type: 'desktop', professional: false },
    'rawtherapee': { name: 'RawTherapee', type: 'desktop', professional: false },
    
    // Mobile apps
    'snapseed': { name: 'Snapseed', type: 'mobile', professional: false },
    'vsco': { name: 'VSCO', type: 'mobile', professional: false },
    'instagram': { name: 'Instagram', type: 'social_media', professional: false },
    'snapchat': { name: 'Snapchat', type: 'social_media', professional: false },
    'facetune': { name: 'Facetune', type: 'mobile', professional: false },
    'picsart': { name: 'PicsArt', type: 'mobile', professional: false },
    'pixlr': { name: 'Pixlr', type: 'mobile', professional: false },
    'polarr': { name: 'Polarr', type: 'mobile', professional: false },
    'afterlight': { name: 'Afterlight', type: 'mobile', professional: false },
    'enlight': { name: 'Enlight', type: 'mobile', professional: false },
    'photoshop express': { name: 'Photoshop Express', type: 'mobile', professional: false },
    'lightroom mobile': { name: 'Lightroom Mobile', type: 'mobile', professional: true },
    
    // Native photo apps
    'photos': { name: 'Photos App', type: 'native', professional: false },
    'apple photos': { name: 'Apple Photos', type: 'native', professional: false },
    'google photos': { name: 'Google Photos', type: 'native', professional: false },
    'samsung gallery': { name: 'Samsung Gallery', type: 'native', professional: false },
    
    // Online editors
    'canva': { name: 'Canva', type: 'online', professional: false },
    'fotor': { name: 'Fotor', type: 'online', professional: false },
    'befunky': { name: 'BeFunky', type: 'online', professional: false },
    'photopea': { name: 'Photopea', type: 'online', professional: false }
  };
  
  for (const [keyword, info] of Object.entries(editingSoftware)) {
    if (sw.includes(keyword)) {
      result.is_editing_software = true;
      result.software_name = info.name;
      result.software_type = info.type;
      result.is_professional = info.professional;
      return result;
    }
  }
  
  return result;
}

/**
 * Analyze software field and return display info
 * @param {string} software - Software field from EXIF
 * @param {string} make - Camera make from EXIF
 * @returns {Object}
 */
function analyzeSoftwareField(software, make) {
  const result = {
    display_value: software || 'Unknown',
    display_label: 'Software',
    is_edited: false,
    is_firmware: false,
    decoded_device: null,
    editing_software: null
  };
  
  if (!software) {
    result.display_value = 'Unknown';
    return result;
  }
  
  // Check if Samsung firmware
  if (make && make.toLowerCase().includes('samsung')) {
    const firmwareInfo = decodeSamsungFirmware(software);
    if (firmwareInfo.decoded || firmwareInfo.is_firmware) {
      result.is_firmware = true;
      result.display_label = 'Edited With';
      result.display_value = 'Original (unedited)';
      result.decoded_device = firmwareInfo.device;
      return result;
    }
  }
  
  // Check for iOS version numbers (e.g., "16.1.2")
  if (/^\d+\.\d+(\.\d+)?$/.test(software.trim())) {
    result.is_firmware = true;
    result.display_label = 'Edited With';
    result.display_value = 'Original (unedited)';
    return result;
  }
  
  // Check for editing software
  const editingInfo = detectEditingSoftware(software);
  if (editingInfo.is_editing_software) {
    result.is_edited = true;
    result.display_label = 'Edited With';
    result.display_value = editingInfo.software_name;
    result.editing_software = editingInfo;
    return result;
  }
  
  // Default - show as-is
  result.display_value = software;
  return result;
}

module.exports = {
  decodeSamsungFirmware,
  isSamsungFirmware,
  detectEditingSoftware,
  analyzeSoftwareField,
  SAMSUNG_MODEL_CODES,
  SAMSUNG_REGION_CODES
};