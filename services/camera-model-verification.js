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
      // RF Mount (Mirrorless)
      'EOS R1', 'EOS R5 II', 'EOS R5', 'EOS R6 II', 'EOS R6', 'EOS R3', 'EOS R', 'EOS RP', 'EOS R7', 'EOS R8', 'EOS R10', 'EOS R50', 'EOS R100',
      // Full Frame DSLR
      'EOS 5D Mark IV', 'EOS 5D Mark III', 'EOS 5D Mark II', 'EOS 5D',
      'EOS 6D Mark II', 'EOS 6D',
      'EOS-1D X Mark III', 'EOS-1D X Mark II', 'EOS-1D X', 'EOS-1D Mark IV', 'EOS-1Ds Mark III',
      // APS-C DSLR
      'EOS 7D Mark II', 'EOS 7D',
      'EOS 90D', 'EOS 80D', 'EOS 70D', 'EOS 60D', 'EOS 50D', 'EOS 40D', 'EOS 30D', 'EOS 20D',
      'EOS Rebel T8i', 'EOS Rebel T7i', 'EOS Rebel T7', 'EOS Rebel T6i', 'EOS Rebel T6', 'EOS Rebel T5i', 'EOS Rebel T5',
      'EOS Rebel SL3', 'EOS Rebel SL2', 'EOS 850D', 'EOS 800D', 'EOS 750D', 'EOS 700D', 'EOS 650D', 'EOS 600D', 'EOS 550D',
      // EOS M (Mirrorless APS-C)
      'EOS M50 Mark II', 'EOS M50', 'EOS M6 Mark II', 'EOS M6', 'EOS M5', 'EOS M3', 'EOS M',
      // PowerShot
      'PowerShot G7 X Mark III', 'PowerShot G7 X Mark II', 'PowerShot G5 X Mark II', 'PowerShot G1 X Mark III',
      // Cinema
      'EOS C70', 'EOS C300 Mark III', 'EOS C500 Mark II'
    ],
    releaseYears: {
      // RF Mount
      'EOS R1': 2024, 'EOS R5 II': 2024, 'EOS R5': 2020, 'EOS R6 II': 2022, 'EOS R6': 2020, 'EOS R3': 2021, 'EOS R': 2018, 'EOS RP': 2019, 'EOS R7': 2022, 'EOS R8': 2023, 'EOS R10': 2022, 'EOS R50': 2023, 'EOS R100': 2023,
      // Full Frame DSLR
      'EOS 5D Mark IV': 2016, 'EOS 5D Mark III': 2012, 'EOS 5D Mark II': 2008, 'EOS 5D': 2005,
      'EOS 6D Mark II': 2017, 'EOS 6D': 2012,
      'EOS-1D X Mark III': 2020, 'EOS-1D X Mark II': 2016, 'EOS-1D X': 2011, 'EOS-1D Mark IV': 2009, 'EOS-1Ds Mark III': 2007,
      // APS-C DSLR
      'EOS 7D Mark II': 2014, 'EOS 7D': 2009,
      'EOS 90D': 2019, 'EOS 80D': 2016, 'EOS 70D': 2013, 'EOS 60D': 2010, 'EOS 50D': 2008, 'EOS 40D': 2007, 'EOS 30D': 2006, 'EOS 20D': 2004,
      'EOS Rebel T8i': 2020, 'EOS Rebel T7i': 2017, 'EOS Rebel T7': 2018, 'EOS Rebel T6i': 2015, 'EOS Rebel T6': 2016, 'EOS Rebel T5i': 2013, 'EOS Rebel T5': 2014,
      'EOS Rebel SL3': 2019, 'EOS Rebel SL2': 2017, 'EOS 850D': 2020, 'EOS 800D': 2017, 'EOS 750D': 2015, 'EOS 700D': 2013, 'EOS 650D': 2012, 'EOS 600D': 2011, 'EOS 550D': 2010,
      // EOS M
      'EOS M50 Mark II': 2020, 'EOS M50': 2018, 'EOS M6 Mark II': 2019, 'EOS M6': 2017, 'EOS M5': 2016, 'EOS M3': 2015, 'EOS M': 2012,
      // PowerShot
      'PowerShot G7 X Mark III': 2019, 'PowerShot G7 X Mark II': 2016, 'PowerShot G5 X Mark II': 2019, 'PowerShot G1 X Mark III': 2017,
      // Cinema
      'EOS C70': 2020, 'EOS C300 Mark III': 2020, 'EOS C500 Mark II': 2019
    }
  },

  // Nikon cameras
  'Nikon': {
    models: [
      'Z9', 'Z8', 'Z7 II', 'Z7', 'Z6 III', 'Z6 II', 'Z6', 'Z5', 'Z50', 'Z30', 'Zfc',
      'D850', 'D810', 'D800', 'D780', 'D750', 'D700', 'D610', 'D600',
      'D6', 'D5', 'D4S', 'D4', 'D3X', 'D3S', 'D3',
      'D500', 'D7500', 'D7200', 'D7100', 'D7000', 'D5600', 'D5500', 'D5300', 'D5200', 'D5100',
      'D3500', 'D3400', 'D3300', 'D3200', 'D3100', 'D90', 'D80', 'D70', 'D60', 'D50', 'D40'
    ],
    releaseYears: {
      'Z9': 2021, 'Z8': 2023, 'Z7 II': 2020, 'Z7': 2018, 'Z6 III': 2024, 'Z6 II': 2020, 'Z6': 2018, 'Z5': 2020, 'Z50': 2019, 'Z30': 2022, 'Zfc': 2021,
      'D850': 2017, 'D810': 2014, 'D800': 2012, 'D780': 2020, 'D750': 2014, 'D700': 2008, 'D610': 2013, 'D600': 2012,
      'D6': 2020, 'D5': 2016, 'D4S': 2014, 'D4': 2012, 'D3X': 2008, 'D3S': 2009, 'D3': 2007,
      'D500': 2016, 'D7500': 2017, 'D7200': 2015, 'D7100': 2013, 'D7000': 2010, 'D5600': 2016, 'D5500': 2015, 'D5300': 2013, 'D5200': 2012, 'D5100': 2011,
      'D3500': 2018, 'D3400': 2016, 'D3300': 2014, 'D3200': 2012, 'D3100': 2010, 'D90': 2008, 'D80': 2006, 'D70': 2004, 'D60': 2008, 'D50': 2005, 'D40': 2006
    }
  },

 // Sony cameras (includes both α names and ILCE codes as EXIF reports ILCE)
  'Sony': {
    models: [
      // Alpha marketing names
      'α7 IV', 'α7 III', 'α7 II', 'α7', 'α7R V', 'α7R IV', 'α7R III', 'α7R II', 'α7R',
      'α7S III', 'α7S II', 'α7S', 'α1', 'α9 II', 'α9',
      'α6700', 'α6600', 'α6500', 'α6400', 'α6300', 'α6100', 'α6000', 'α5100',
      'ZV-E1', 'ZV-E10', 'ZV-1', 'ZV-1F',
      'α99 II', 'α77 II', 'α68', 'α58',
      'RX100 VII', 'RX100 VI', 'RX100 V', 'RX100 IV', 'RX100 III', 'RX10 IV',
      // ILCE codes (how cameras report in EXIF)
      'ILCE-1', 'ILCE-9M2', 'ILCE-9', 
      'ILCE-7RM5', 'ILCE-7RM4', 'ILCE-7RM3', 'ILCE-7RM2', 'ILCE-7R',
      'ILCE-7M4', 'ILCE-7M3', 'ILCE-7M2', 'ILCE-7',
      'ILCE-7SM3', 'ILCE-7SM2', 'ILCE-7S',
      'ILCE-6700', 'ILCE-6600', 'ILCE-6500', 'ILCE-6400', 'ILCE-6300', 'ILCE-6100', 'ILCE-6000', 'ILCE-5100',
      // DSC codes (Cyber-shot / RX series)
      'DSC-RX100M7', 'DSC-RX100M6', 'DSC-RX100M5', 'DSC-RX100M4', 'DSC-RX100M3', 'DSC-RX10M4'
    ],
    releaseYears: {
      'α7 IV': 2021, 'α7 III': 2018, 'α7 II': 2014, 'α7': 2013, 'α7R V': 2022, 'α7R IV': 2019, 'α7R III': 2017, 'α7R II': 2015, 'α7R': 2013,
      'α7S III': 2020, 'α7S II': 2015, 'α7S': 2014, 'α1': 2021, 'α9 II': 2019, 'α9': 2017,
      'α6700': 2023, 'α6600': 2019, 'α6500': 2016, 'α6400': 2019, 'α6300': 2016, 'α6100': 2019, 'α6000': 2014, 'α5100': 2014,
      'ZV-E1': 2023, 'ZV-E10': 2021, 'ZV-1': 2020, 'ZV-1F': 2022,
      'α99 II': 2016, 'α77 II': 2014, 'α68': 2016, 'α58': 2014,
      'RX100 VII': 2019, 'RX100 VI': 2018, 'RX100 V': 2016, 'RX100 IV': 2015, 'RX100 III': 2014, 'RX10 IV': 2017,
      // ILCE codes
      'ILCE-1': 2021, 'ILCE-9M2': 2019, 'ILCE-9': 2017,
      'ILCE-7RM5': 2022, 'ILCE-7RM4': 2019, 'ILCE-7RM3': 2017, 'ILCE-7RM2': 2015, 'ILCE-7R': 2013,
      'ILCE-7M4': 2021, 'ILCE-7M3': 2018, 'ILCE-7M2': 2014, 'ILCE-7': 2013,
      'ILCE-7SM3': 2020, 'ILCE-7SM2': 2015, 'ILCE-7S': 2014,
      'ILCE-6700': 2023, 'ILCE-6600': 2019, 'ILCE-6500': 2016, 'ILCE-6400': 2019, 'ILCE-6300': 2016, 'ILCE-6100': 2019, 'ILCE-6000': 2014, 'ILCE-5100': 2014,
      // DSC codes
      'DSC-RX100M7': 2019, 'DSC-RX100M6': 2018, 'DSC-RX100M5': 2016, 'DSC-RX100M4': 2015, 'DSC-RX100M3': 2014, 'DSC-RX10M4': 2017
    }
  },

  // Samsung phones
  'Samsung': {
    models: [
      'Galaxy S24', 'Galaxy S24+', 'Galaxy S24 Ultra',
      'Galaxy S23', 'Galaxy S23+', 'Galaxy S23 Ultra', 'Galaxy S23 FE',
      'Galaxy S22', 'Galaxy S22+', 'Galaxy S22 Ultra',
      'Galaxy S21', 'Galaxy S21+', 'Galaxy S21 Ultra', 'Galaxy S21 FE',
      'Galaxy S20', 'Galaxy S20+', 'Galaxy S20 Ultra', 'Galaxy S20 FE',
      'Galaxy S10', 'Galaxy S10+', 'Galaxy S10e',
      'Galaxy S9', 'Galaxy S9+', 'Galaxy S8', 'Galaxy S8+', 'Galaxy S7', 'Galaxy S7 Edge',
      'Galaxy Note 20', 'Galaxy Note 20 Ultra', 'Galaxy Note 10', 'Galaxy Note 10+',
      'Galaxy Note 9', 'Galaxy Note 8',
      'Galaxy A54', 'Galaxy A53', 'Galaxy A52', 'Galaxy A51', 'Galaxy A50',
      'Galaxy Z Fold 5', 'Galaxy Z Fold 4', 'Galaxy Z Fold 3',
      'Galaxy Z Flip 5', 'Galaxy Z Flip 4', 'Galaxy Z Flip 3'
    ],
    releaseYears: {
      'Galaxy S24': 2024, 'Galaxy S24+': 2024, 'Galaxy S24 Ultra': 2024,
      'Galaxy S23': 2023, 'Galaxy S23+': 2023, 'Galaxy S23 Ultra': 2023, 'Galaxy S23 FE': 2023,
      'Galaxy S22': 2022, 'Galaxy S22+': 2022, 'Galaxy S22 Ultra': 2022,
      'Galaxy S21': 2021, 'Galaxy S21+': 2021, 'Galaxy S21 Ultra': 2021, 'Galaxy S21 FE': 2022,
      'Galaxy S20': 2020, 'Galaxy S20+': 2020, 'Galaxy S20 Ultra': 2020, 'Galaxy S20 FE': 2020,
      'Galaxy S10': 2019, 'Galaxy S10+': 2019, 'Galaxy S10e': 2019,
      'Galaxy S9': 2018, 'Galaxy S9+': 2018, 'Galaxy S8': 2017, 'Galaxy S8+': 2017, 'Galaxy S7': 2016, 'Galaxy S7 Edge': 2016,
      'Galaxy Note 20': 2020, 'Galaxy Note 20 Ultra': 2020, 'Galaxy Note 10': 2019, 'Galaxy Note 10+': 2019,
      'Galaxy Note 9': 2018, 'Galaxy Note 8': 2017,
      'Galaxy A54': 2023, 'Galaxy A53': 2022, 'Galaxy A52': 2021, 'Galaxy A51': 2020, 'Galaxy A50': 2019,
      'Galaxy Z Fold 5': 2023, 'Galaxy Z Fold 4': 2022, 'Galaxy Z Fold 3': 2021,
      'Galaxy Z Flip 5': 2023, 'Galaxy Z Flip 4': 2022, 'Galaxy Z Flip 3': 2021
    }
  },

  // Google Pixel
  'Google': {
    models: [
      'Pixel 9', 'Pixel 9 Pro', 'Pixel 9 Pro XL',
      'Pixel 8', 'Pixel 8 Pro', 'Pixel 8a',
      'Pixel 7', 'Pixel 7 Pro', 'Pixel 7a',
      'Pixel 6', 'Pixel 6 Pro', 'Pixel 6a',
      'Pixel 5', 'Pixel 5a',
      'Pixel 4', 'Pixel 4 XL', 'Pixel 4a',
      'Pixel 3', 'Pixel 3 XL', 'Pixel 3a', 'Pixel 3a XL',
      'Pixel 2', 'Pixel 2 XL',
      'Pixel', 'Pixel XL'
    ],
    releaseYears: {
      'Pixel 9': 2024, 'Pixel 9 Pro': 2024, 'Pixel 9 Pro XL': 2024,
      'Pixel 8': 2023, 'Pixel 8 Pro': 2023, 'Pixel 8a': 2024,
      'Pixel 7': 2022, 'Pixel 7 Pro': 2022, 'Pixel 7a': 2023,
      'Pixel 6': 2021, 'Pixel 6 Pro': 2021, 'Pixel 6a': 2022,
      'Pixel 5': 2020, 'Pixel 5a': 2021,
      'Pixel 4': 2019, 'Pixel 4 XL': 2019, 'Pixel 4a': 2020,
      'Pixel 3': 2018, 'Pixel 3 XL': 2018, 'Pixel 3a': 2019, 'Pixel 3a XL': 2019,
      'Pixel 2': 2017, 'Pixel 2 XL': 2017,
      'Pixel': 2016, 'Pixel XL': 2016
    }
  },

  // Fujifilm cameras
  'FUJIFILM': {
    models: [
      'X-T5', 'X-T4', 'X-T3', 'X-T2', 'X-T30 II', 'X-T30', 'X-T20',
      'X-H2', 'X-H2S', 'X-H1',
      'X-Pro3', 'X-Pro2', 'X-E4', 'X-E3',
      'X100V', 'X100F', 'X100T',
      'GFX100S', 'GFX 50S II', 'GFX 50R'
    ],
    releaseYears: {
      'X-T5': 2022, 'X-T4': 2020, 'X-T3': 2018, 'X-T2': 2016, 'X-T30 II': 2021, 'X-T30': 2019, 'X-T20': 2017,
      'X-H2': 2022, 'X-H2S': 2022, 'X-H1': 2018,
      'X-Pro3': 2019, 'X-Pro2': 2016, 'X-E4': 2021, 'X-E3': 2017,
      'X100V': 2020, 'X100F': 2017, 'X100T': 2014,
      'GFX100S': 2021, 'GFX 50S II': 2021, 'GFX 50R': 2018
    }
  },

  // Panasonic cameras
  'Panasonic': {
    models: [
      'LUMIX S5 II', 'LUMIX S5', 'LUMIX S1', 'LUMIX S1R', 'LUMIX S1H',
      'LUMIX GH6', 'LUMIX GH5 II', 'LUMIX GH5', 'LUMIX G9',
      'LUMIX G100', 'LUMIX GX9', 'LUMIX GX85'
    ],
    releaseYears: {
      'LUMIX S5 II': 2023, 'LUMIX S5': 2020, 'LUMIX S1': 2019, 'LUMIX S1R': 2019, 'LUMIX S1H': 2019,
      'LUMIX GH6': 2022, 'LUMIX GH5 II': 2021, 'LUMIX GH5': 2017, 'LUMIX G9': 2018,
      'LUMIX G100': 2020, 'LUMIX GX9': 2018, 'LUMIX GX85': 2016
    }
  },

  // DJI drones
  'DJI': {
    models: [
      'Mavic 3 Pro', 'Mavic 3', 'Mavic Air 2S', 'Mavic Air 2', 'Mavic Mini',
      'Mini 4 Pro', 'Mini 3 Pro', 'Mini 3', 'Mini 2',
      'Phantom 4 Pro V2.0', 'Phantom 4 Pro', 'Phantom 4',
      'Air 3', 'Air 2S'
    ],
    releaseYears: {
      'Mavic 3 Pro': 2023, 'Mavic 3': 2021, 'Mavic Air 2S': 2021, 'Mavic Air 2': 2020, 'Mavic Mini': 2019,
      'Mini 4 Pro': 2023, 'Mini 3 Pro': 2022, 'Mini 3': 2022, 'Mini 2': 2020,
      'Phantom 4 Pro V2.0': 2018, 'Phantom 4 Pro': 2016, 'Phantom 4': 2016,
      'Air 3': 2023, 'Air 2S': 2021
    }
  },

  // GoPro cameras
  'GoPro': {
    models: [
      'HERO12 Black', 'HERO11 Black', 'HERO10 Black', 'HERO9 Black', 'HERO8 Black',
      'HERO7 Black', 'HERO6 Black', 'HERO5 Black', 'HERO5 Session',
      'MAX'
    ],
    releaseYears: {
      'HERO12 Black': 2023, 'HERO11 Black': 2022, 'HERO10 Black': 2021, 'HERO9 Black': 2020, 'HERO8 Black': 2019,
      'HERO7 Black': 2018, 'HERO6 Black': 2017, 'HERO5 Black': 2016, 'HERO5 Session': 2016,
      'MAX': 2019
    }
  }
};

// Add max resolutions to cameras (max megapixels the sensor can produce)
const CAMERA_MAX_RESOLUTIONS = {
  // Canon
  'EOS R5': { maxWidth: 8192, maxHeight: 5464, megapixels: 45 },
  'EOS R6': { maxWidth: 5472, maxHeight: 3648, megapixels: 20 },
  'EOS 5D Mark IV': { maxWidth: 6720, maxHeight: 4480, megapixels: 30 },
  'EOS 5D Mark III': { maxWidth: 5760, maxHeight: 3840, megapixels: 22 },
  'EOS 5D Mark II': { maxWidth: 5616, maxHeight: 3744, megapixels: 21 },
  'EOS 40D': { maxWidth: 3888, maxHeight: 2592, megapixels: 10 },
  'EOS 7D': { maxWidth: 5184, maxHeight: 3456, megapixels: 18 },
  'EOS 90D': { maxWidth: 6960, maxHeight: 4640, megapixels: 32 },
  
  // Nikon
  'D850': { maxWidth: 8256, maxHeight: 5504, megapixels: 45 },
  'D750': { maxWidth: 6016, maxHeight: 4016, megapixels: 24 },
  'D7500': { maxWidth: 5568, maxHeight: 3712, megapixels: 20 },
  
  // Sony
  'α7R V': { maxWidth: 9504, maxHeight: 6336, megapixels: 60 },
  'α7 IV': { maxWidth: 7008, maxHeight: 4672, megapixels: 33 },
  'α7 III': { maxWidth: 6000, maxHeight: 4000, megapixels: 24 },
  
  // iPhones (48MP sensors on Pro models, but default to 12MP)
  'iPhone 15 Pro': { maxWidth: 8064, maxHeight: 6048, megapixels: 48 },
  'iPhone 15 Pro Max': { maxWidth: 8064, maxHeight: 6048, megapixels: 48 },
  'iPhone 14 Pro': { maxWidth: 8064, maxHeight: 6048, megapixels: 48 },
  'iPhone 13 Pro': { maxWidth: 4032, maxHeight: 3024, megapixels: 12 },
  'iPhone 12 Pro': { maxWidth: 4032, maxHeight: 3024, megapixels: 12 },
  'iPhone 11': { maxWidth: 4032, maxHeight: 3024, megapixels: 12 },
  
  // Samsung
  'Galaxy S24 Ultra': { maxWidth: 9248, maxHeight: 6936, megapixels: 200 },
  'Galaxy S23 Ultra': { maxWidth: 9248, maxHeight: 6936, megapixels: 200 },
  
  // Default for unknown models (generous limit)
  '_default': { maxWidth: 12000, maxHeight: 9000, megapixels: 108 }
};

// Common aspect ratios
const COMMON_ASPECT_RATIOS = [
  { name: '4:3', ratio: 4/3 },
  { name: '3:2', ratio: 3/2 },
  { name: '16:9', ratio: 16/9 },
  { name: '1:1', ratio: 1 },
  { name: '3:4', ratio: 3/4 },
  { name: '2:3', ratio: 2/3 },
  { name: '9:16', ratio: 9/16 }
];

function validateResolution(recognizedModel, imageWidth, imageHeight) {
  const result = {
    valid: true,
    confidence: 100,
    warnings: [],
    indicators: []
  };
  
  if (!imageWidth || !imageHeight) {
    result.valid = null;
    result.confidence = 0;
    result.warnings.push('No image dimensions available');
    return result;
  }
  
  const specs = CAMERA_MAX_RESOLUTIONS[recognizedModel] || CAMERA_MAX_RESOLUTIONS['_default'];
  
  // Check if resolution exceeds camera's physical limits
  const imagePixels = imageWidth * imageHeight;
  const maxPixels = specs.maxWidth * specs.maxHeight;
  
  // Allow 5% tolerance for slight variations
  if (imagePixels > maxPixels * 1.05) {
    result.valid = false;
    result.confidence = 0;
    result.warnings.push(
      `IMPOSSIBLE: Image resolution ${imageWidth}x${imageHeight} (${(imagePixels/1000000).toFixed(1)}MP) exceeds ${recognizedModel} maximum (${specs.megapixels}MP)`
    );
    return result;
  }
  
  // Check aspect ratio is reasonable
  const imageRatio = Math.max(imageWidth, imageHeight) / Math.min(imageWidth, imageHeight);
  const isCommonRatio = COMMON_ASPECT_RATIOS.some(ar => {
    const targetRatio = Math.max(ar.ratio, 1/ar.ratio);
    return Math.abs(imageRatio - targetRatio) < 0.1; // 10% tolerance
  });
  
  if (!isCommonRatio && imageRatio > 3) {
    // Very unusual aspect ratio (not panorama)
    result.warnings.push(`Unusual aspect ratio: ${imageRatio.toFixed(2)}:1`);
    result.confidence = Math.max(70, result.confidence - 15);
  }
  
  // Downscaled images are fine - add positive indicator
  if (imagePixels < maxPixels * 0.5) {
    result.indicators.push(`Downscaled from original (${(imagePixels/1000000).toFixed(1)}MP of ${specs.megapixels}MP max)`);
  } else if (imagePixels >= maxPixels * 0.9) {
    result.indicators.push(`Full resolution image (${(imagePixels/1000000).toFixed(1)}MP)`);
  }
  
  return result;
}
function verifyCameraModel(exifData, imageDimensions = null) {
  const result = {
    camera_found: false,
    is_valid: null,
    confidence: 0,
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
  
  // Start with valid assumption if camera recognized
  result.is_valid = true;
  result.confidence = 100;
  
  // Check capture date validity
  if (dateTime) {
    const captureYear = extractYear(dateTime);
    const currentYear = new Date().getFullYear();
    
    // Check for suspicious default dates
    if (captureYear === 1970 || captureYear === 2000 || captureYear === 1980) {
      result.warnings.push(`Suspicious date: ${captureYear} (likely default/unset EXIF date)`);
      result.confidence = Math.max(0, result.confidence - 30);
    }
    
    // Check for future dates (more than 2 days ahead)
    const captureDateObj = typeof dateTime === 'number' ? new Date(dateTime * 1000) : new Date(dateTime);
    const twoDaysFromNow = new Date();
    twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);
    
    if (captureDateObj > twoDaysFromNow) {
      result.warnings.push(`SUSPICIOUS: Photo dated in the future (${captureDateObj.toISOString().split('T')[0]})`);
      result.confidence = Math.max(0, result.confidence - 40);
    }
    
    // Check release year vs capture date
    const releaseYear = cameraData.releaseYears[knownModel];
    if (releaseYear && captureYear) {
      if (captureYear < releaseYear) {
        result.is_valid = false;
        result.confidence = 0;
        result.warnings.push(
          `IMPOSSIBLE: Photo dated ${captureYear} but ${knownModel} was released in ${releaseYear}`
        );
      }
      
      result.details.release_year = releaseYear;
      result.details.capture_year = captureYear;
    }
  }
  

  // Check resolution validity if dimensions provided
  if (imageDimensions && imageDimensions.width && imageDimensions.height && result.camera_found) {
    const resolutionCheck = validateResolution(
      result.details.recognized_model,
      imageDimensions.width,
      imageDimensions.height
    );
    
    result.resolution_validation = resolutionCheck;
    
    if (resolutionCheck.valid === false) {
      result.is_valid = false;
      result.confidence = 0;
    } else if (resolutionCheck.confidence < 100) {
      result.confidence = Math.min(result.confidence, resolutionCheck.confidence);
    }
    
    result.warnings.push(...resolutionCheck.warnings);
    result.details.resolution_indicators = resolutionCheck.indicators;
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

/**
 * Precise device model matching that avoids false positives
 * e.g., "Galaxy S24" should NOT match "Galaxy S"
 */
function matchesDeviceModel(fullModel, targetDevice) {
  if (!fullModel || !targetDevice) return false;
  
  const modelLower = fullModel.toLowerCase();
  const targetLower = targetDevice.toLowerCase();
  
  const index = modelLower.indexOf(targetLower);
  if (index === -1) return false;
  
  const afterMatch = modelLower.substring(index + targetLower.length);
  
  // Exact match or word boundary
  if (afterMatch.length === 0) return true;
  if (afterMatch[0] === ' ' || afterMatch[0] === '-' || afterMatch[0] === '_') return true;
  
  // If followed by a number, it's a DIFFERENT model (e.g., S24 != S)
  if (/^\d/.test(afterMatch)) return false;
  
  // If followed by 's' (Apple suffix), it's different (e.g., 6s != 6)
  if (/^s\b/i.test(afterMatch)) return false;
  
  return true;
}
/**
 * Detect if photo is likely historical (old camera, old date)
 * Returns adjustment to reduce AI false positives on old photos
 */
function detectHistoricalPhoto(exifData, imageDimensions = null) {
  const result = {
    isHistorical: false,
    era: null,
    confidence: 0,
    aiScoreReduction: 0,
    reasons: []
  };
  
  if (!exifData) return result;
  
  const make = exifData.Make || exifData.make || "";
  const model = exifData.Model || exifData.model || "";
  const dateTime = exifData.DateTimeOriginal || exifData.DateTime || exifData.CreateDate;
  
  // Check capture date age
  let photoAge = 0;
  if (dateTime) {
    const captureYear = extractYear(dateTime);
    const currentYear = new Date().getFullYear();
    photoAge = currentYear - captureYear;
    
    if (photoAge >= 8) {
      result.isHistorical = true;
      result.era = captureYear + "-era";
      result.reasons.push("Photo is " + photoAge + " years old");
      result.aiScoreReduction += Math.min(25, photoAge * 2);
      result.confidence += 40;
    } else if (photoAge >= 5) {
      result.reasons.push("Photo is " + photoAge + " years old");
      result.aiScoreReduction += 10;
      result.confidence += 20;
    }
  }
  
  // Check for old camera models
  const oldDevices = {
    "iPhone 4": 2010, "iPhone 4S": 2011, "iPhone 5": 2012, "iPhone 5s": 2013, "iPhone 5c": 2013,
    "iPhone 6": 2014, "iPhone 6 Plus": 2014, "iPhone 6s": 2015, "iPhone 6s Plus": 2015,
    "GT-I9000": 2010, "Galaxy S2": 2011, "Galaxy S3": 2012, "Galaxy S4": 2013, "Galaxy S5": 2014,
    "EOS 550D": 2010, "EOS 600D": 2011, "EOS 650D": 2012, "EOS 700D": 2013,
    "D3100": 2010, "D5100": 2011, "D3200": 2012, "D5200": 2012,
    "COOLPIX": 2005, "PowerShot": 2008, "FinePix": 2006
  };
  
  // Sort by length (longest first) to match specific names first
  const sortedDevices = Object.entries(oldDevices)
    .sort((a, b) => b[0].length - a[0].length);
  
  for (const [device, year] of sortedDevices) {
    if (matchesDeviceModel(model, device)) {
      const deviceAge = new Date().getFullYear() - year;
      result.isHistorical = true;
      result.era = year + "-era";
      result.reasons.push("Old device: " + device + " (" + year + ")");
      result.aiScoreReduction += Math.min(20, deviceAge);
      result.confidence += 50;
      break;
    }
  }
  
  // Cap reduction
  result.aiScoreReduction = Math.min(35, result.aiScoreReduction);
  result.confidence = Math.min(100, result.confidence);
  
  return result;
}

module.exports = { verifyCameraModel, detectHistoricalPhoto, KNOWN_CAMERAS };
