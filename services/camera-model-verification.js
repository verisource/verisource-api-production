/**
 * Camera Model Verification Service
 * Verifies camera models exist and metadata is consistent
 * Detects impossible combinations (e.g., future devices, invalid settings)
 */

// Known camera manufacturers and models database
const KNOWN_CAMERAS = {
  // Apple devices
  'Apple': {
    models: ['iPhone 15', 'iPhone 15 Pro', 'iPhone 15 Pro Max', 'iPhone 14', 'iPhone 14 Pro', 'iPhone 14 Pro Max',
             'iPhone 13', 'iPhone 13 Pro', 'iPhone 13 Pro Max', 'iPhone 12', 'iPhone 12 Pro', 'iPhone 12 Pro Max',
             'iPhone 11', 'iPhone 11 Pro', 'iPhone 11 Pro Max', 'iPhone XS', 'iPhone XS Max', 'iPhone XR',
             'iPhone X', 'iPhone 8', 'iPhone 8 Plus', 'iPhone 7', 'iPhone 7 Plus', 'iPhone SE'],
    releaseYears: {
      'iPhone 15': 2023, 'iPhone 15 Pro': 2023, 'iPhone 15 Pro Max': 2023,
      'iPhone 14': 2022, 'iPhone 14 Pro': 2022, 'iPhone 14 Pro Max': 2022,
      'iPhone 13': 2021, 'iPhone 13 Pro': 2021, 'iPhone 13 Pro Max': 2021,
      'iPhone 12': 2020, 'iPhone 12 Pro': 2020, 'iPhone 12 Pro Max': 2020,
      'iPhone 11': 2019, 'iPhone 11 Pro': 2019, 'iPhone 11 Pro Max': 2019,
      'iPhone XS': 2018, 'iPhone XS Max': 2018, 'iPhone XR': 2018,
      'iPhone X': 2017, 'iPhone 8': 2017, 'iPhone 8 Plus': 2017,
      'iPhone 7': 2016, 'iPhone 7 Plus': 2016, 'iPhone SE': 2016
    }
  },
  
  // Canon cameras
  'Canon': {
    models: ['EOS R5', 'EOS R6', 'EOS R3', 'EOS R', 'EOS RP', 'EOS 5D Mark IV', 'EOS 5D Mark III',
             'EOS 6D Mark II', 'EOS 90D', 'EOS M50', 'PowerShot G7 X Mark III'],
    releaseYears: {
      'EOS R5': 2020, 'EOS R6': 2020, 'EOS R3': 2021, 'EOS R': 2018, 'EOS RP': 2019,
      'EOS 5D Mark IV': 2016, 'EOS 5D Mark III': 2012, 'EOS 6D Mark II': 2017,
      'EOS 90D': 2019, 'EOS M50': 2018, 'PowerShot G7 X Mark III': 2019
    }
  },
  
  // Sony cameras
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
    }
  },
  
  // Samsung phones
  'Samsung': {
    models: ['Galaxy S24', 'Galaxy S23', 'Galaxy S22', 'Galaxy S21', 'Galaxy S20',
             'Galaxy Note 20', 'Galaxy A54', 'Galaxy A53'],
    releaseYears: {
      'Galaxy S24': 2024, 'Galaxy S23': 2023, 'Galaxy S22': 2022,
      'Galaxy S21': 2021, 'Galaxy S20': 2020, 'Galaxy Note 20': 2020,
      'Galaxy A54': 2023, 'Galaxy A53': 2022
    }
  },
  
  // Google Pixel
  'Google': {
    models: ['Pixel 8', 'Pixel 8 Pro', 'Pixel 7', 'Pixel 7 Pro', 'Pixel 6', 'Pixel 6 Pro', 'Pixel 5'],
    releaseYears: {
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
