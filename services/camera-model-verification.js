/**
 * Camera Model Verification Service
 * Verifies camera models exist and metadata is consistent
 * Detects impossible combinations (e.g., future devices, invalid settings)
 */

// Known camera manufacturers and models database
const KNOWN_CAMERAS = {
  // Apple devices
  'Apple': {
    models: [
      'iPhone 16', 'iPhone 16 Pro', 'iPhone 16 Pro Max', 'iPhone 16 Plus',
      'iPhone 15', 'iPhone 15 Pro', 'iPhone 15 Pro Max', 'iPhone 15 Plus',
      'iPhone 14', 'iPhone 14 Pro', 'iPhone 14 Pro Max', 'iPhone 14 Plus',
      'iPhone 13', 'iPhone 13 Pro', 'iPhone 13 Pro Max', 'iPhone 13 mini',
      'iPhone 12', 'iPhone 12 Pro', 'iPhone 12 Pro Max', 'iPhone 12 mini',
      'iPhone 11', 'iPhone 11 Pro', 'iPhone 11 Pro Max',
      'iPhone XS', 'iPhone XS Max', 'iPhone XR',
      'iPhone X', 'iPhone 8', 'iPhone 8 Plus', 'iPhone 7', 'iPhone 7 Plus',
      'iPhone SE', 'iPhone SE (2nd generation)', 'iPhone SE (3rd generation)',
      'iPhone 6s', 'iPhone 6s Plus', 'iPhone 6', 'iPhone 6 Plus',
      'iPhone 5s', 'iPhone 5c', 'iPhone 5', 'iPhone 4S', 'iPhone 4'
    ],
    releaseYears: {
      'iPhone 16': 2024, 'iPhone 16 Pro': 2024, 'iPhone 16 Pro Max': 2024, 'iPhone 16 Plus': 2024,
      'iPhone 15': 2023, 'iPhone 15 Pro': 2023, 'iPhone 15 Pro Max': 2023, 'iPhone 15 Plus': 2023,
      'iPhone 14': 2022, 'iPhone 14 Pro': 2022, 'iPhone 14 Pro Max': 2022, 'iPhone 14 Plus': 2022,
      'iPhone 13': 2021, 'iPhone 13 Pro': 2021, 'iPhone 13 Pro Max': 2021, 'iPhone 13 mini': 2021,
      'iPhone 12': 2020, 'iPhone 12 Pro': 2020, 'iPhone 12 Pro Max': 2020, 'iPhone 12 mini': 2020,
      'iPhone 11': 2019, 'iPhone 11 Pro': 2019, 'iPhone 11 Pro Max': 2019,
      'iPhone XS': 2018, 'iPhone XS Max': 2018, 'iPhone XR': 2018,
      'iPhone X': 2017, 'iPhone 8': 2017, 'iPhone 8 Plus': 2017, 'iPhone 7': 2016, 'iPhone 7 Plus': 2016,
      'iPhone SE': 2016, 'iPhone SE (2nd generation)': 2020, 'iPhone SE (3rd generation)': 2022,
      'iPhone 6s': 2015, 'iPhone 6s Plus': 2015, 'iPhone 6': 2014, 'iPhone 6 Plus': 2014,
      'iPhone 5s': 2013, 'iPhone 5c': 2013, 'iPhone 5': 2012, 'iPhone 4S': 2011, 'iPhone 4': 2010
    }
  },
  
  // Canon cameras
  'Canon': {
    models: [
      // RF Mount Mirrorless (2018+)
      'EOS R5', 'EOS R6', 'EOS R3', 'EOS R', 'EOS RP', 'EOS R7', 'EOS R8', 'EOS R10', 'EOS R50',
      // EF Mount Full Frame (5D series)
      'EOS 5D Mark IV', 'EOS 5D Mark III', 'EOS 5D Mark II', 'EOS 5D',
      // EF Mount Full Frame (6D series)
      'EOS 6D Mark II', 'EOS 6D',
      // EF Mount Full Frame (1D series)
      'EOS-1D X Mark III', 'EOS-1D X Mark II', 'EOS-1D X', 'EOS-1D Mark IV', 'EOS-1Ds Mark III',
      // EF Mount APS-C (7D series)
      'EOS 7D Mark II', 'EOS 7D',
      // EF Mount APS-C (XXD series)
      'EOS 90D', 'EOS 80D', 'EOS 70D', 'EOS 60D', 'EOS 50D', 'EOS 40D', 'EOS 30D', 'EOS 20D',
      // EF Mount APS-C (Rebel/XXXD series)
      'EOS Rebel T8i', 'EOS Rebel T7i', 'EOS Rebel T7', 'EOS Rebel T6i', 'EOS Rebel T6', 'EOS Rebel T5i', 'EOS Rebel T5',
      'EOS Rebel SL3', 'EOS Rebel SL2', 'EOS 850D', 'EOS 800D', 'EOS 750D', 'EOS 700D', 'EOS 650D', 'EOS 600D', 'EOS 550D',
      // EF-M Mount Mirrorless
      'EOS M50 Mark II', 'EOS M50', 'EOS M6 Mark II', 'EOS M6', 'EOS M5', 'EOS M3', 'EOS M',
      // PowerShot Compact
      'PowerShot G7 X Mark III', 'PowerShot G7 X Mark II', 'PowerShot G5 X Mark II', 'PowerShot G1 X Mark III'
    ],
    releaseYears: {
      'EOS R5': 2020, 'EOS R6': 2020, 'EOS R3': 2021, 'EOS R': 2018, 'EOS RP': 2019, 'EOS R7': 2022, 'EOS R8': 2023, 'EOS R10': 2022, 'EOS R50': 2023,
      'EOS 5D Mark IV': 2016, 'EOS 5D Mark III': 2012, 'EOS 5D Mark II': 2008, 'EOS 5D': 2005,
      'EOS 6D Mark II': 2017, 'EOS 6D': 2012,
      'EOS-1D X Mark III': 2020, 'EOS-1D X Mark II': 2016, 'EOS-1D X': 2011, 'EOS-1D Mark IV': 2009, 'EOS-1Ds Mark III': 2007,
      'EOS 7D Mark II': 2014, 'EOS 7D': 2009,
      'EOS 90D': 2019, 'EOS 80D': 2016, 'EOS 70D': 2013, 'EOS 60D': 2010, 'EOS 50D': 2008, 'EOS 40D': 2007, 'EOS 30D': 2006, 'EOS 20D': 2004,
      'EOS Rebel T8i': 2020, 'EOS Rebel T7i': 2017, 'EOS Rebel T7': 2018, 'EOS Rebel T6i': 2015, 'EOS Rebel T6': 2016, 'EOS Rebel T5i': 2013, 'EOS Rebel T5': 2014,
      'EOS Rebel SL3': 2019, 'EOS Rebel SL2': 2017, 'EOS 850D': 2020, 'EOS 800D': 2017, 'EOS 750D': 2015, 'EOS 700D': 2013, 'EOS 650D': 2012, 'EOS 600D': 2011, 'EOS 550D': 2010,
      'EOS M50 Mark II': 2020, 'EOS M50': 2018, 'EOS M6 Mark II': 2019, 'EOS M6': 2017, 'EOS M5': 2016, 'EOS M3': 2015, 'EOS M': 2012,
      'PowerShot G7 X Mark III': 2019, 'PowerShot G7 X Mark II': 2016, 'PowerShot G5 X Mark II': 2019, 'PowerShot G1 X Mark III': 2017
    }
  },
  'Sony': {
    models: ['α7 IV', 'α7R V', 'α1', 'α7R IV', 'α7 III', 'α7R III', 'α6600', 'α6400', 'ZV-E10'],
    releaseYears: {
      'α7 IV': 2021, 'α7R V': 2022, 'α1': 2021, 'α7R IV': 2019,
      'α7 III': 2018, 'α7R III': 2017, 'α6600': 2019, 'α6400': 2019, 'ZV-E10': 2021
    }
  },
  
  // Nikon cameras
  'Nikon': {
    models: ['Z9', 'Z8', 'Z7 II', 'Z6 II', 'Z5', 'D850', 'D780', 'D500'],
    releaseYears: {
      'Z9': 2021, 'Z8': 2023, 'Z7 II': 2020, 'Z6 II': 2020,
      'Z5': 2020, 'D850': 2017, 'D780': 2020, 'D500': 2016
  // Nikon cameras
  'Nikon': {
    models: [
      // Z Mount Mirrorless
      'Z9', 'Z8', 'Z7 II', 'Z7', 'Z6 III', 'Z6 II', 'Z6', 'Z5', 'Z50', 'Z30', 'Zfc',
      // FX Full Frame DSLRs (D series)
      'D850', 'D810', 'D800', 'D780', 'D750', 'D700', 'D610', 'D600',
      // FX Pro DSLRs
      'D6', 'D5', 'D4S', 'D4', 'D3X', 'D3S', 'D3',
      // DX APS-C DSLRs
      'D500', 'D7500', 'D7200', 'D7100', 'D7000', 'D5600', 'D5500', 'D5300', 'D5200', 'D5100',
      'D3500', 'D3400', 'D3300', 'D3200', 'D3100', 'D90', 'D80', 'D70', 'D60', 'D50', 'D40'
    ],
    releaseYears: {
      'Z9': 2021, 'Z8': 2023, 'Z7 II': 2020, 'Z7': 2018, 'Z6 III': 2024, 'Z6 II': 2020, 'Z6': 2018, 'Z5': 2020, 'Z50': 2019, 'Z30': 2022, 'Zfc': 2021,
      'D850': 2017, 'D810': 2014, 'D800': 2012, 'D780': 2020, 'D750': 2014, 'D700': 2008, 'D610': 2013, 'D600': 2012,
      'D6': 2020, 'D5': 2016, 'D4S': 2014, 'D4': 2012, 'D3X': 2008, 'D3S': 2009, 'D3': 2007,
      'D500': 2016, 'D7500': 2017, 'D7200': 2015, 'D7100': 2013, 'D7000': 2010, 'D5600': 2016, 'D5500': 2015, 'D5300': 2013, 'D5200': 2012, 'D5100': 2011,
  // Sony cameras
  'Sony': {
    models: [
      // Alpha Full Frame Mirrorless
      'α7 IV', 'α7 III', 'α7 II', 'α7', 'α7R V', 'α7R IV', 'α7R III', 'α7R II', 'α7R',
      'α7S III', 'α7S II', 'α7S', 'α1', 'α9 II', 'α9',
      // Alpha APS-C Mirrorless
  // Samsung phones
  'Samsung': {
    models: [
      // Galaxy S Series
      'Galaxy S24', 'Galaxy S24+', 'Galaxy S24 Ultra',
      'Galaxy S23', 'Galaxy S23+', 'Galaxy S23 Ultra', 'Galaxy S23 FE',
      'Galaxy S22', 'Galaxy S22+', 'Galaxy S22 Ultra',
      'Galaxy S21', 'Galaxy S21+', 'Galaxy S21 Ultra', 'Galaxy S21 FE',
      'Galaxy S20', 'Galaxy S20+', 'Galaxy S20 Ultra', 'Galaxy S20 FE',
      'Galaxy S10', 'Galaxy S10+', 'Galaxy S10e', 'Galaxy S10 5G',
      'Galaxy S9', 'Galaxy S9+', 'Galaxy S8', 'Galaxy S8+', 'Galaxy S7', 'Galaxy S7 Edge',
      // Galaxy Note Series
      'Galaxy Note 20', 'Galaxy Note 20 Ultra', 'Galaxy Note 10', 'Galaxy Note 10+',
      'Galaxy Note 9', 'Galaxy Note 8', 'Galaxy Note 7',
      // Galaxy A Series
      'Galaxy A54', 'Galaxy A53', 'Galaxy A52', 'Galaxy A51', 'Galaxy A50',
      'Galaxy A34', 'Galaxy A33', 'Galaxy A32', 'Galaxy A14',
      // Galaxy Z Fold/Flip
      'Galaxy Z Fold 5', 'Galaxy Z Fold 4', 'Galaxy Z Fold 3', 'Galaxy Z Fold 2',
      'Galaxy Z Flip 5', 'Galaxy Z Flip 4', 'Galaxy Z Flip 3', 'Galaxy Z Flip'
    ],
    releaseYears: {
      'Galaxy S24': 2024, 'Galaxy S24+': 2024, 'Galaxy S24 Ultra': 2024,
      'Galaxy S23': 2023, 'Galaxy S23+': 2023, 'Galaxy S23 Ultra': 2023, 'Galaxy S23 FE': 2023,
      'Galaxy S22': 2022, 'Galaxy S22+': 2022, 'Galaxy S22 Ultra': 2022,
      'Galaxy S21': 2021, 'Galaxy S21+': 2021, 'Galaxy S21 Ultra': 2021, 'Galaxy S21 FE': 2022,
      'Galaxy S20': 2020, 'Galaxy S20+': 2020, 'Galaxy S20 Ultra': 2020, 'Galaxy S20 FE': 2020,
      'Galaxy S10': 2019, 'Galaxy S10+': 2019, 'Galaxy S10e': 2019, 'Galaxy S10 5G': 2019,
      'Galaxy S9': 2018, 'Galaxy S9+': 2018, 'Galaxy S8': 2017, 'Galaxy S8+': 2017, 'Galaxy S7': 2016, 'Galaxy S7 Edge': 2016,
      'Galaxy Note 20': 2020, 'Galaxy Note 20 Ultra': 2020, 'Galaxy Note 10': 2019, 'Galaxy Note 10+': 2019,
      'Galaxy Note 9': 2018, 'Galaxy Note 8': 2017, 'Galaxy Note 7': 2016,
      'Galaxy A54': 2023, 'Galaxy A53': 2022, 'Galaxy A52': 2021, 'Galaxy A51': 2020, 'Galaxy A50': 2019,
      'Galaxy A34': 2023, 'Galaxy A33': 2022, 'Galaxy A32': 2021, 'Galaxy A14': 2023,
      'Galaxy Z Fold 5': 2023, 'Galaxy Z Fold 4': 2022, 'Galaxy Z Fold 3': 2021, 'Galaxy Z Fold 2': 2020,
      'Galaxy Z Flip 5': 2023, 'Galaxy Z Flip 4': 2022, 'Galaxy Z Flip 3': 2021, 'Galaxy Z Flip': 2020
    }
  },
      'α7 IV': 2021, 'α7 III': 2018, 'α7 II': 2014, 'α7': 2013, 'α7R V': 2022, 'α7R IV': 2019, 'α7R III': 2017, 'α7R II': 2015, 'α7R': 2013,
      'α7S III': 2020, 'α7S II': 2015, 'α7S': 2013, 'α1': 2021, 'α9 II': 2019, 'α9': 2017,
      'α6700': 2023, 'α6600': 2019, 'α6500': 2016, 'α6400': 2019, 'α6300': 2016, 'α6100': 2019, 'α6000': 2014, 'α5100': 2014,
  // Google Pixel
  'Google': {
    models: [
      'Pixel 9', 'Pixel 9 Pro', 'Pixel 9 Pro XL', 'Pixel 9 Pro Fold',
      'Pixel 8', 'Pixel 8 Pro', 'Pixel 8a',
      'Pixel 7', 'Pixel 7 Pro', 'Pixel 7a',
      'Pixel 6', 'Pixel 6 Pro', 'Pixel 6a',
      'Pixel 5', 'Pixel 5a',
      'Pixel 4', 'Pixel 4 XL', 'Pixel 4a', 'Pixel 4a 5G',
      'Pixel 3', 'Pixel 3 XL', 'Pixel 3a', 'Pixel 3a XL',
      'Pixel 2', 'Pixel 2 XL',
      'Pixel', 'Pixel XL',
      'Pixel Fold'
    ],
    releaseYears: {
      'Pixel 9': 2024, 'Pixel 9 Pro': 2024, 'Pixel 9 Pro XL': 2024, 'Pixel 9 Pro Fold': 2024,
      'Pixel 8': 2023, 'Pixel 8 Pro': 2023, 'Pixel 8a': 2024,
      'Pixel 7': 2022, 'Pixel 7 Pro': 2022, 'Pixel 7a': 2023,
      'Pixel 6': 2021, 'Pixel 6 Pro': 2021, 'Pixel 6a': 2022,
      'Pixel 5': 2020, 'Pixel 5a': 2021,
      'Pixel 4': 2019, 'Pixel 4 XL': 2019, 'Pixel 4a': 2020, 'Pixel 4a 5G': 2020,
      'Pixel 3': 2018, 'Pixel 3 XL': 2018, 'Pixel 3a': 2019, 'Pixel 3a XL': 2019,
      'Pixel 2': 2017, 'Pixel 2 XL': 2017,
      'Pixel': 2016, 'Pixel XL': 2016,
      'Pixel Fold': 2023
    }
  }
      'Pixel 8': 2023, 'Pixel 8 Pro': 2023, 'Pixel 7': 2022, 'Pixel 7 Pro': 2022,
      'Pixel 6': 2021, 'Pixel 6 Pro': 2021, 'Pixel 5': 2020
    }
  }
};

function verifyCameraModel(exifData) {
  const result = {
    camera_found: false,
    is_valid: true,
    warnings: [],
    details: {}
  };
  
  if (!exifData) {
    result.warnings.push('No EXIF data available');
    return result;
  }
  
  // Extract camera info
  const make = exifData.Make || exifData.make || '';
  const model = exifData.Model || exifData.model || '';
  const dateTime = exifData.DateTimeOriginal || exifData.DateTime || exifData.CreateDate;
  
  result.details = {
    make: make,
    model: model,
    capture_date: dateTime
  };
  
  if (!make && !model) {
    result.warnings.push('No camera information in EXIF');
    return result;
  }
  
  // Check if manufacturer exists
  const knownMake = Object.keys(KNOWN_CAMERAS).find(m => 
    make.toLowerCase().includes(m.toLowerCase())
  );
  
  if (!knownMake) {
    result.warnings.push(`Unknown camera manufacturer: ${make}`);
    return result;
  }
  
  // Check if model exists for this manufacturer
  const cameraData = KNOWN_CAMERAS[knownMake];
  const knownModel = cameraData.models.find(m => 
    model.toLowerCase().includes(m.toLowerCase()) || m.toLowerCase().includes(model.toLowerCase())
  );
  
  if (!knownModel) {
    result.warnings.push(`Unknown camera model: ${model} from ${knownMake}`);
    result.details.suggestion = `Model not in database. Known ${knownMake} models: ${cameraData.models.slice(0, 5).join(', ')}...`;
    return result;
  }
  
  result.camera_found = true;
  result.details.recognized_model = knownModel;
  result.details.manufacturer = knownMake;
  
  // Check release year vs capture date
  const releaseYear = cameraData.releaseYears[knownModel];
  if (releaseYear && dateTime) {
    const captureYear = extractYear(dateTime);
    
    if (captureYear && captureYear < releaseYear) {
      result.is_valid = false;
      result.warnings.push(
        `IMPOSSIBLE: Photo dated ${captureYear} but ${knownModel} was released in ${releaseYear}`
      );
    }
    
    result.details.release_year = releaseYear;
    result.details.capture_year = captureYear;
  }
  
  return result;
}

function extractYear(dateTime) {
  if (!dateTime) return null;
  
  // Handle Unix timestamp
  if (typeof dateTime === 'number') {
    return new Date(dateTime * 1000).getFullYear();
  }
  
  // Handle string formats (YYYY:MM:DD or YYYY-MM-DD)
  const yearMatch = String(dateTime).match(/(\d{4})/);
  return yearMatch ? parseInt(yearMatch[1]) : null;
}

module.exports = { verifyCameraModel, KNOWN_CAMERAS };
