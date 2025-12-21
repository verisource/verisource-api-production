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

  // Samsung phones (includes both marketing names and SM- model codes as EXIF reports SM-)
  'Samsung': {
    models: [
      // Marketing names
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
      'Galaxy Z Flip 5', 'Galaxy Z Flip 4', 'Galaxy Z Flip 3',
      // SM- model codes (how Samsung phones report in EXIF)
      // Galaxy S24 series
      'SM-S928U', 'SM-S928B', 'SM-S928N', 'SM-S928W',
      'SM-S926U', 'SM-S926B', 'SM-S926N', 'SM-S926W',
      'SM-S921U', 'SM-S921B', 'SM-S921N', 'SM-S921W',
      // Galaxy S23 series
      'SM-S918U', 'SM-S918B', 'SM-S918N', 'SM-S918W',
      'SM-S916U', 'SM-S916B', 'SM-S916N', 'SM-S916W',
      'SM-S911U', 'SM-S911B', 'SM-S911N', 'SM-S911W',
      'SM-S711U', 'SM-S711B', // S23 FE
      // Galaxy S22 series
      'SM-S908U', 'SM-S908B', 'SM-S908N', 'SM-S908W',
      'SM-S906U', 'SM-S906B', 'SM-S906N', 'SM-S906W',
      'SM-S901U', 'SM-S901B', 'SM-S901N', 'SM-S901W',
      // Galaxy S21 series
      'SM-G998U', 'SM-G998B', 'SM-G998N', 'SM-G998W',
      'SM-G996U', 'SM-G996B', 'SM-G996N', 'SM-G996W',
      'SM-G991U', 'SM-G991B', 'SM-G991N', 'SM-G991W',
      'SM-G990U', 'SM-G990B', // S21 FE
      // Galaxy S20 series
      'SM-G988U', 'SM-G988B', 'SM-G988N', 'SM-G988W',
      'SM-G986U', 'SM-G986B', 'SM-G986N', 'SM-G986W',
      'SM-G981U', 'SM-G981B', 'SM-G981N', 'SM-G981W',
      'SM-G780F', 'SM-G780G', // S20 FE
      // Galaxy S10 series
      'SM-G975U', 'SM-G975F', 'SM-G975N', 'SM-G975W',
      'SM-G973U', 'SM-G973F', 'SM-G973N', 'SM-G973W',
      'SM-G970U', 'SM-G970F', 'SM-G970N', 'SM-G970W',
      // Galaxy S9 series
      'SM-G965U', 'SM-G965F', 'SM-G965N', 'SM-G965W',
      'SM-G960U', 'SM-G960F', 'SM-G960N', 'SM-G960W',
      // Galaxy S8 series
      'SM-G955U', 'SM-G955F', 'SM-G955N', 'SM-G955W',
      'SM-G950U', 'SM-G950F', 'SM-G950N', 'SM-G950W',
      // Galaxy S7 series
      'SM-G935F', 'SM-G935U', 'SM-G935A', 'SM-G935V',
      'SM-G930F', 'SM-G930U', 'SM-G930A', 'SM-G930V',
      // Galaxy Note series
      'SM-N986U', 'SM-N986B', 'SM-N985F', // Note 20 Ultra
      'SM-N981U', 'SM-N981B', 'SM-N980F', // Note 20
      'SM-N976U', 'SM-N976B', 'SM-N975F', // Note 10+
      'SM-N971U', 'SM-N971N', 'SM-N970F', // Note 10
      'SM-N960U', 'SM-N960F', 'SM-N960N', // Note 9
      'SM-N950U', 'SM-N950F', 'SM-N950N', // Note 8
      // Galaxy Z Fold series
      'SM-F946U', 'SM-F946B', 'SM-F946N', 'SM-F946W', // Fold 5
      'SM-F936U', 'SM-F936B', 'SM-F936N', 'SM-F936W', // Fold 4
      'SM-F926U', 'SM-F926B', 'SM-F926N', 'SM-F926W', // Fold 3
      // Galaxy Z Flip series
      'SM-F731U', 'SM-F731B', 'SM-F731N', 'SM-F731W', // Flip 5
      'SM-F721U', 'SM-F721B', 'SM-F721N', 'SM-F721W', // Flip 4
      'SM-F711U', 'SM-F711B', 'SM-F711N', 'SM-F711W', // Flip 3
      // Galaxy A series
      'SM-A546U', 'SM-A546B', 'SM-A546E', // A54
      'SM-A536U', 'SM-A536B', 'SM-A536E', // A53
      'SM-A526U', 'SM-A526B', 'SM-A526F', // A52
      'SM-A516U', 'SM-A516B', 'SM-A516F', // A51
      'SM-A505U', 'SM-A505F', 'SM-A505G',  // A50
      // Older Galaxy S series

      'Galaxy S6', 'Galaxy S6 Edge', 'Galaxy S6 Edge+',
      'Galaxy S5', 'Galaxy S5 Active', 'Galaxy S5 Mini',
      'Galaxy S4', 'Galaxy S4 Active', 'Galaxy S4 Mini',
      'Galaxy S3', 'Galaxy S3 Mini',
      'Galaxy S2', 'Galaxy S',
      // Older Galaxy Note series
      'Galaxy Note 5', 'Galaxy Note 4', 'Galaxy Note 3', 'Galaxy Note 2', 'Galaxy Note',
      // Older SM- codes (Galaxy S6)
      'SM-G920F', 'SM-G920I', 'SM-G920S', 'SM-G920K', 'SM-G920L', 'SM-G920T', 'SM-G920A', 'SM-G920V', 'SM-G920W8',
      'SM-G925F', 'SM-G925I', 'SM-G925S', 'SM-G925K', 'SM-G925L', 'SM-G925T', 'SM-G925A', 'SM-G925V', 'SM-G925W8',
      'SM-G928F', 'SM-G928G', 'SM-G928S', 'SM-G928K', 'SM-G928L', 'SM-G928T', 'SM-G928A', 'SM-G928V', 'SM-G928W8',
      // Older SM- codes (Galaxy S5)
      'SM-G900F', 'SM-G900I', 'SM-G900H', 'SM-G900S', 'SM-G900K', 'SM-G900L', 'SM-G900T', 'SM-G900A', 'SM-G900V', 'SM-G900W8',
      // Older SM- codes (Galaxy Note 5/4/3)
      'SM-N920F', 'SM-N920G', 'SM-N920S', 'SM-N920K', 'SM-N920L', 'SM-N920T', 'SM-N920A', 'SM-N920V', 'SM-N920W8',
      'SM-N910F', 'SM-N910G', 'SM-N910H', 'SM-N910S', 'SM-N910K', 'SM-N910L', 'SM-N910T', 'SM-N910A', 'SM-N910V', 'SM-N910W8',
      'SM-N900', 'SM-N9005', 'SM-N9000Q', 'SM-N900S', 'SM-N900K', 'SM-N900L', 'SM-N900T', 'SM-N900A', 'SM-N900V', 'SM-N900W8',
      // GT- codes (Galaxy S4 and older)
      'GT-I9500', 'GT-I9505', 'GT-I9506', 'GT-I9507', 'GT-I9508',
      'GT-I9300', 'GT-I9305', 'GT-I9308',
      'GT-I9100', 'GT-I9105',
      'GT-I9000', 'GT-I9001',
      // GT- codes (older Galaxy Note)
      'GT-N7100', 'GT-N7105',
      'GT-N7000'
    ],
    releaseYears: {
      // Marketing names
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
      'Galaxy Z Flip 5': 2023, 'Galaxy Z Flip 4': 2022, 'Galaxy Z Flip 3': 2021,
      // SM- model codes - S24 series
      'SM-S928U': 2024, 'SM-S928B': 2024, 'SM-S928N': 2024, 'SM-S928W': 2024,
      'SM-S926U': 2024, 'SM-S926B': 2024, 'SM-S926N': 2024, 'SM-S926W': 2024,
      'SM-S921U': 2024, 'SM-S921B': 2024, 'SM-S921N': 2024, 'SM-S921W': 2024,
      // SM- model codes - S23 series
      'SM-S918U': 2023, 'SM-S918B': 2023, 'SM-S918N': 2023, 'SM-S918W': 2023,
      'SM-S916U': 2023, 'SM-S916B': 2023, 'SM-S916N': 2023, 'SM-S916W': 2023,
      'SM-S911U': 2023, 'SM-S911B': 2023, 'SM-S911N': 2023, 'SM-S911W': 2023,
      'SM-S711U': 2023, 'SM-S711B': 2023,
      // SM- model codes - S22 series
      'SM-S908U': 2022, 'SM-S908B': 2022, 'SM-S908N': 2022, 'SM-S908W': 2022,
      'SM-S906U': 2022, 'SM-S906B': 2022, 'SM-S906N': 2022, 'SM-S906W': 2022,
      'SM-S901U': 2022, 'SM-S901B': 2022, 'SM-S901N': 2022, 'SM-S901W': 2022,
      // SM- model codes - S21 series
      'SM-G998U': 2021, 'SM-G998B': 2021, 'SM-G998N': 2021, 'SM-G998W': 2021,
      'SM-G996U': 2021, 'SM-G996B': 2021, 'SM-G996N': 2021, 'SM-G996W': 2021,
      'SM-G991U': 2021, 'SM-G991B': 2021, 'SM-G991N': 2021, 'SM-G991W': 2021,
      'SM-G990U': 2022, 'SM-G990B': 2022,
      // SM- model codes - S20 series
      'SM-G988U': 2020, 'SM-G988B': 2020, 'SM-G988N': 2020, 'SM-G988W': 2020,
      'SM-G986U': 2020, 'SM-G986B': 2020, 'SM-G986N': 2020, 'SM-G986W': 2020,
      'SM-G981U': 2020, 'SM-G981B': 2020, 'SM-G981N': 2020, 'SM-G981W': 2020,
      'SM-G780F': 2020, 'SM-G780G': 2020,
      // SM- model codes - S10 series
      'SM-G975U': 2019, 'SM-G975F': 2019, 'SM-G975N': 2019, 'SM-G975W': 2019,
      'SM-G973U': 2019, 'SM-G973F': 2019, 'SM-G973N': 2019, 'SM-G973W': 2019,
      'SM-G970U': 2019, 'SM-G970F': 2019, 'SM-G970N': 2019, 'SM-G970W': 2019,
      // SM- model codes - S9 series
      'SM-G965U': 2018, 'SM-G965F': 2018, 'SM-G965N': 2018, 'SM-G965W': 2018,
      'SM-G960U': 2018, 'SM-G960F': 2018, 'SM-G960N': 2018, 'SM-G960W': 2018,
      // SM- model codes - S8 series
      'SM-G955U': 2017, 'SM-G955F': 2017, 'SM-G955N': 2017, 'SM-G955W': 2017,
      'SM-G950U': 2017, 'SM-G950F': 2017, 'SM-G950N': 2017, 'SM-G950W': 2017,
      // SM- model codes - S7 series
      'SM-G935F': 2016, 'SM-G935U': 2016, 'SM-G935A': 2016, 'SM-G935V': 2016,
      'SM-G930F': 2016, 'SM-G930U': 2016, 'SM-G930A': 2016, 'SM-G930V': 2016,
      // SM- model codes - Note series
      'SM-N986U': 2020, 'SM-N986B': 2020, 'SM-N985F': 2020,
      'SM-N981U': 2020, 'SM-N981B': 2020, 'SM-N980F': 2020,
      'SM-N976U': 2019, 'SM-N976B': 2019, 'SM-N975F': 2019,
      'SM-N971U': 2019, 'SM-N971N': 2019, 'SM-N970F': 2019,
      'SM-N960U': 2018, 'SM-N960F': 2018, 'SM-N960N': 2018,
      'SM-N950U': 2017, 'SM-N950F': 2017, 'SM-N950N': 2017,
      // SM- model codes - Fold series
      'SM-F946U': 2023, 'SM-F946B': 2023, 'SM-F946N': 2023, 'SM-F946W': 2023,
      'SM-F936U': 2022, 'SM-F936B': 2022, 'SM-F936N': 2022, 'SM-F936W': 2022,
      'SM-F926U': 2021, 'SM-F926B': 2021, 'SM-F926N': 2021, 'SM-F926W': 2021,
      // SM- model codes - Flip series
      'SM-F731U': 2023, 'SM-F731B': 2023, 'SM-F731N': 2023, 'SM-F731W': 2023,
      'SM-F721U': 2022, 'SM-F721B': 2022, 'SM-F721N': 2022, 'SM-F721W': 2022,
      'SM-F711U': 2021, 'SM-F711B': 2021, 'SM-F711N': 2021, 'SM-F711W': 2021,
      // SM- model codes - A series
      'SM-A546U': 2023, 'SM-A546B': 2023, 'SM-A546E': 2023,
      'SM-A536U': 2022, 'SM-A536B': 2022, 'SM-A536E': 2022,
      'SM-A526U': 2021, 'SM-A526B': 2021, 'SM-A526F': 2021,
      'SM-A516U': 2020, 'SM-A516B': 2020, 'SM-A516F': 2020,
      'SM-A505U': 2019, 'SM-A505F': 2019, 'SM-A505G': 2019,

      // Older Galaxy S series
      'Galaxy S6': 2015, 'Galaxy S6 Edge': 2015, 'Galaxy S6 Edge+': 2015,
      'Galaxy S5': 2014, 'Galaxy S5 Active': 2014, 'Galaxy S5 Mini': 2014,
      'Galaxy S4': 2013, 'Galaxy S4 Active': 2013, 'Galaxy S4 Mini': 2013,
      'Galaxy S3': 2012, 'Galaxy S3 Mini': 2012,
      'Galaxy S2': 2011, 'Galaxy S': 2010,
      // Older Galaxy Note series
      'Galaxy Note 5': 2015, 'Galaxy Note 4': 2014, 'Galaxy Note 3': 2013, 'Galaxy Note 2': 2012, 'Galaxy Note': 2011,
      // SM- codes (Galaxy S6)
      'SM-G920F': 2015, 'SM-G920I': 2015, 'SM-G920S': 2015, 'SM-G920K': 2015, 'SM-G920L': 2015, 'SM-G920T': 2015, 'SM-G920A': 2015, 'SM-G920V': 2015, 'SM-G920W8': 2015,
      'SM-G925F': 2015, 'SM-G925I': 2015, 'SM-G925S': 2015, 'SM-G925K': 2015, 'SM-G925L': 2015, 'SM-G925T': 2015, 'SM-G925A': 2015, 'SM-G925V': 2015, 'SM-G925W8': 2015,
      'SM-G928F': 2015, 'SM-G928G': 2015, 'SM-G928S': 2015, 'SM-G928K': 2015, 'SM-G928L': 2015, 'SM-G928T': 2015, 'SM-G928A': 2015, 'SM-G928V': 2015, 'SM-G928W8': 2015,
      // SM- codes (Galaxy S5)
      'SM-G900F': 2014, 'SM-G900I': 2014, 'SM-G900H': 2014, 'SM-G900S': 2014, 'SM-G900K': 2014, 'SM-G900L': 2014, 'SM-G900T': 2014, 'SM-G900A': 2014, 'SM-G900V': 2014, 'SM-G900W8': 2014,
      // SM- codes (Galaxy Note 5)
      'SM-N920F': 2015, 'SM-N920G': 2015, 'SM-N920S': 2015, 'SM-N920K': 2015, 'SM-N920L': 2015, 'SM-N920T': 2015, 'SM-N920A': 2015, 'SM-N920V': 2015, 'SM-N920W8': 2015,
      // SM- codes (Galaxy Note 4)
      'SM-N910F': 2014, 'SM-N910G': 2014, 'SM-N910H': 2014, 'SM-N910S': 2014, 'SM-N910K': 2014, 'SM-N910L': 2014, 'SM-N910T': 2014, 'SM-N910A': 2014, 'SM-N910V': 2014, 'SM-N910W8': 2014,
      // SM- codes (Galaxy Note 3)
      'SM-N900': 2013, 'SM-N9005': 2013, 'SM-N9000Q': 2013, 'SM-N900S': 2013, 'SM-N900K': 2013, 'SM-N900L': 2013, 'SM-N900T': 2013, 'SM-N900A': 2013, 'SM-N900V': 2013, 'SM-N900W8': 2013,
      // GT- codes (Galaxy S4)
      'GT-I9500': 2013, 'GT-I9505': 2013, 'GT-I9506': 2013, 'GT-I9507': 2013, 'GT-I9508': 2013,
      // GT- codes (Galaxy S3)
      'GT-I9300': 2012, 'GT-I9305': 2012, 'GT-I9308': 2012,
      // GT- codes (Galaxy S2)
      'GT-I9100': 2011, 'GT-I9105': 2011,
      // GT- codes (Galaxy S)
      'GT-I9000': 2010, 'GT-I9001': 2010,
      // GT- codes (Galaxy Note 2)
      'GT-N7100': 2012, 'GT-N7105': 2012,
      // GT- codes (Galaxy Note)
      'GT-N7000': 2011
    }
  },

  // Xiaomi phones (includes Mi, Redmi, POCO, and model codes)
  'Xiaomi': {
    models: [
      // Xiaomi numbered series
      'Xiaomi 14', 'Xiaomi 14 Pro', 'Xiaomi 14 Ultra',
      'Xiaomi 13', 'Xiaomi 13 Pro', 'Xiaomi 13 Ultra', 'Xiaomi 13 Lite', 'Xiaomi 13T', 'Xiaomi 13T Pro',
      'Xiaomi 12', 'Xiaomi 12 Pro', 'Xiaomi 12 Ultra', 'Xiaomi 12 Lite', 'Xiaomi 12T', 'Xiaomi 12T Pro',
      'Xiaomi 11', 'Xiaomi 11 Pro', 'Xiaomi 11 Ultra', 'Xiaomi 11 Lite', 'Xiaomi 11T', 'Xiaomi 11T Pro',
      // Mi series (older naming)
      'Mi 11', 'Mi 11 Pro', 'Mi 11 Ultra', 'Mi 11 Lite',
      'Mi 10', 'Mi 10 Pro', 'Mi 10 Ultra', 'Mi 10 Lite',
      'Mi 9', 'Mi 9 Pro', 'Mi 9 SE', 'Mi 9 Lite',
      'Mi 8', 'Mi 8 Pro', 'Mi 8 SE', 'Mi 8 Lite',
      'Mi Note 10', 'Mi Note 10 Pro', 'Mi Note 10 Lite',
      'Mi Mix 4', 'Mi Mix 3', 'Mi Mix 2S', 'Mi Mix 2',
      // Redmi series
      'Redmi Note 13', 'Redmi Note 13 Pro', 'Redmi Note 13 Pro+',
      'Redmi Note 12', 'Redmi Note 12 Pro', 'Redmi Note 12 Pro+',
      'Redmi Note 11', 'Redmi Note 11 Pro', 'Redmi Note 11 Pro+',
      'Redmi Note 10', 'Redmi Note 10 Pro', 'Redmi Note 10 Pro Max',
      'Redmi Note 9', 'Redmi Note 9 Pro', 'Redmi Note 9 Pro Max',
      'Redmi Note 8', 'Redmi Note 8 Pro',
      'Redmi 13', 'Redmi 12', 'Redmi 11', 'Redmi 10', 'Redmi 9', 'Redmi 8',
      'Redmi K70', 'Redmi K70 Pro', 'Redmi K60', 'Redmi K60 Pro', 'Redmi K50', 'Redmi K40',
      // POCO series
      'POCO F6', 'POCO F6 Pro', 'POCO F5', 'POCO F5 Pro', 'POCO F4', 'POCO F4 GT', 'POCO F3', 'POCO F2 Pro', 'POCO F1',
      'POCO X6', 'POCO X6 Pro', 'POCO X5', 'POCO X5 Pro', 'POCO X4', 'POCO X4 Pro', 'POCO X3', 'POCO X3 Pro',
      'POCO M6', 'POCO M6 Pro', 'POCO M5', 'POCO M5s', 'POCO M4', 'POCO M4 Pro', 'POCO M3',
      'POCO C65', 'POCO C55', 'POCO C40',
      // Model codes (how they report in EXIF)
      '2311DRK48G', '23127PN0CG', '2210132G', '2207122MC', // Xiaomi 14 series
      '2211133G', '2211133C', '2210132C', '2304FPN6DC', // Xiaomi 13 series
      '2201123G', '2201123C', '2203129G', '2207116BG', // Xiaomi 12 series
      '2107113SG', '2107113SR', 'M2102K1G', 'M2101K9G', // Xiaomi 11 series
      'M2007J3SG', 'M2007J3SP', 'M2007J1SC', // Mi 10 series
      '23049RAD8C', '23053RN02A', '22101316G', // Redmi Note series
      '23013RK75C', '22041219PG', '21091116AG', // Redmi K series
      '23049PCD8G', '22021211RG', '21121210G' // POCO series
    ],
    releaseYears: {
      // Xiaomi numbered series
      'Xiaomi 14': 2024, 'Xiaomi 14 Pro': 2024, 'Xiaomi 14 Ultra': 2024,
      'Xiaomi 13': 2023, 'Xiaomi 13 Pro': 2023, 'Xiaomi 13 Ultra': 2023, 'Xiaomi 13 Lite': 2023, 'Xiaomi 13T': 2023, 'Xiaomi 13T Pro': 2023,
      'Xiaomi 12': 2022, 'Xiaomi 12 Pro': 2022, 'Xiaomi 12 Ultra': 2022, 'Xiaomi 12 Lite': 2022, 'Xiaomi 12T': 2022, 'Xiaomi 12T Pro': 2022,
      'Xiaomi 11': 2021, 'Xiaomi 11 Pro': 2021, 'Xiaomi 11 Ultra': 2021, 'Xiaomi 11 Lite': 2021, 'Xiaomi 11T': 2021, 'Xiaomi 11T Pro': 2021,
      // Mi series
      'Mi 11': 2021, 'Mi 11 Pro': 2021, 'Mi 11 Ultra': 2021, 'Mi 11 Lite': 2021,
      'Mi 10': 2020, 'Mi 10 Pro': 2020, 'Mi 10 Ultra': 2020, 'Mi 10 Lite': 2020,
      'Mi 9': 2019, 'Mi 9 Pro': 2019, 'Mi 9 SE': 2019, 'Mi 9 Lite': 2019,
      'Mi 8': 2018, 'Mi 8 Pro': 2018, 'Mi 8 SE': 2018, 'Mi 8 Lite': 2018,
      'Mi Note 10': 2019, 'Mi Note 10 Pro': 2019, 'Mi Note 10 Lite': 2020,
      'Mi Mix 4': 2021, 'Mi Mix 3': 2018, 'Mi Mix 2S': 2018, 'Mi Mix 2': 2017,
      // Redmi Note series
      'Redmi Note 13': 2024, 'Redmi Note 13 Pro': 2024, 'Redmi Note 13 Pro+': 2024,
      'Redmi Note 12': 2023, 'Redmi Note 12 Pro': 2023, 'Redmi Note 12 Pro+': 2023,
      'Redmi Note 11': 2022, 'Redmi Note 11 Pro': 2022, 'Redmi Note 11 Pro+': 2022,
      'Redmi Note 10': 2021, 'Redmi Note 10 Pro': 2021, 'Redmi Note 10 Pro Max': 2021,
      'Redmi Note 9': 2020, 'Redmi Note 9 Pro': 2020, 'Redmi Note 9 Pro Max': 2020,
      'Redmi Note 8': 2019, 'Redmi Note 8 Pro': 2019,
      'Redmi 13': 2024, 'Redmi 12': 2023, 'Redmi 11': 2022, 'Redmi 10': 2021, 'Redmi 9': 2020, 'Redmi 8': 2019,
      'Redmi K70': 2024, 'Redmi K70 Pro': 2024, 'Redmi K60': 2023, 'Redmi K60 Pro': 2023, 'Redmi K50': 2022, 'Redmi K40': 2021,
      // POCO series
      'POCO F6': 2024, 'POCO F6 Pro': 2024, 'POCO F5': 2023, 'POCO F5 Pro': 2023, 'POCO F4': 2022, 'POCO F4 GT': 2022, 'POCO F3': 2021, 'POCO F2 Pro': 2020, 'POCO F1': 2018,
      'POCO X6': 2024, 'POCO X6 Pro': 2024, 'POCO X5': 2023, 'POCO X5 Pro': 2023, 'POCO X4': 2022, 'POCO X4 Pro': 2022, 'POCO X3': 2020, 'POCO X3 Pro': 2021,
      'POCO M6': 2024, 'POCO M6 Pro': 2024, 'POCO M5': 2022, 'POCO M5s': 2022, 'POCO M4': 2022, 'POCO M4 Pro': 2021, 'POCO M3': 2020,
      'POCO C65': 2023, 'POCO C55': 2023, 'POCO C40': 2022,
      // Model codes
      '2311DRK48G': 2024, '23127PN0CG': 2024, '2210132G': 2022, '2207122MC': 2022,
      '2211133G': 2023, '2211133C': 2023, '2210132C': 2022, '2304FPN6DC': 2023,
      '2201123G': 2022, '2201123C': 2022, '2203129G': 2022, '2207116BG': 2022,
      '2107113SG': 2021, '2107113SR': 2021, 'M2102K1G': 2021, 'M2101K9G': 2021,
      'M2007J3SG': 2020, 'M2007J3SP': 2020, 'M2007J1SC': 2020,
      '23049RAD8C': 2024, '23053RN02A': 2024, '22101316G': 2022,
      '23013RK75C': 2024, '22041219PG': 2022, '21091116AG': 2021,
      '23049PCD8G': 2024, '22021211RG': 2022, '21121210G': 2021
    }
  },

  // OnePlus phones
  'OnePlus': {
    models: [
      // Numbered series
      'OnePlus 12', 'OnePlus 12R',
      'OnePlus 11', 'OnePlus 11R',
      'OnePlus 10 Pro', 'OnePlus 10T', 'OnePlus 10R',
      'OnePlus 9', 'OnePlus 9 Pro', 'OnePlus 9R', 'OnePlus 9RT',
      'OnePlus 8', 'OnePlus 8 Pro', 'OnePlus 8T',
      'OnePlus 7', 'OnePlus 7 Pro', 'OnePlus 7T', 'OnePlus 7T Pro',
      'OnePlus 6', 'OnePlus 6T',
      'OnePlus 5', 'OnePlus 5T',
      'OnePlus 3', 'OnePlus 3T',
      // Nord series
      'OnePlus Nord 4', 'OnePlus Nord 3', 'OnePlus Nord 2T', 'OnePlus Nord 2', 'OnePlus Nord',
      'OnePlus Nord CE 4', 'OnePlus Nord CE 3', 'OnePlus Nord CE 2', 'OnePlus Nord CE',
      'OnePlus Nord N30', 'OnePlus Nord N20', 'OnePlus Nord N10', 'OnePlus Nord N100',
      // Open (foldable)
      'OnePlus Open',
      // Model codes (how they report in EXIF)
      'CPH2573', 'CPH2575', // OnePlus 12
      'CPH2449', 'CPH2451', // OnePlus 11
      'CPH2487', 'NE2210', 'NE2215', // OnePlus 10 Pro
      'CPH2413', 'LE2115', 'LE2111', // OnePlus 9
      'LE2125', 'LE2123', 'LE2121', // OnePlus 9 Pro
      'IN2025', 'IN2023', 'IN2021', 'IN2020', // OnePlus 8 Pro
      'IN2015', 'IN2013', 'IN2011', 'IN2010', // OnePlus 8
      'KB2005', 'KB2003', 'KB2001', 'KB2000', // OnePlus 8T
      'GM1917', 'GM1915', 'GM1913', 'GM1911', // OnePlus 7 Pro
      'GM1905', 'GM1903', 'GM1901', 'GM1900', // OnePlus 7
      'HD1907', 'HD1905', 'HD1903', 'HD1901', // OnePlus 7T Pro
      'HD1917', 'HD1913', 'HD1910', 'HD1900', // OnePlus 7T
      'A6013', 'A6010', 'A6003', 'A6000', // OnePlus 6T
      'A6003', 'A6000', // OnePlus 6
      'A5010', 'A5000', // OnePlus 5T / 5
      'CPH2581', 'CPH2585', // OnePlus Open
      'CPH2493', 'CPH2497', // Nord 3
      'IV2201', 'CPH2409', // Nord 2
      'AC2003', 'AC2001' // Nord
    ],
    releaseYears: {
      // Numbered series
      'OnePlus 12': 2024, 'OnePlus 12R': 2024,
      'OnePlus 11': 2023, 'OnePlus 11R': 2023,
      'OnePlus 10 Pro': 2022, 'OnePlus 10T': 2022, 'OnePlus 10R': 2022,
      'OnePlus 9': 2021, 'OnePlus 9 Pro': 2021, 'OnePlus 9R': 2021, 'OnePlus 9RT': 2021,
      'OnePlus 8': 2020, 'OnePlus 8 Pro': 2020, 'OnePlus 8T': 2020,
      'OnePlus 7': 2019, 'OnePlus 7 Pro': 2019, 'OnePlus 7T': 2019, 'OnePlus 7T Pro': 2019,
      'OnePlus 6': 2018, 'OnePlus 6T': 2018,
      'OnePlus 5': 2017, 'OnePlus 5T': 2017,
      'OnePlus 3': 2016, 'OnePlus 3T': 2016,
      // Nord series
      'OnePlus Nord 4': 2024, 'OnePlus Nord 3': 2023, 'OnePlus Nord 2T': 2022, 'OnePlus Nord 2': 2021, 'OnePlus Nord': 2020,
      'OnePlus Nord CE 4': 2024, 'OnePlus Nord CE 3': 2023, 'OnePlus Nord CE 2': 2022, 'OnePlus Nord CE': 2021,
      'OnePlus Nord N30': 2023, 'OnePlus Nord N20': 2022, 'OnePlus Nord N10': 2020, 'OnePlus Nord N100': 2020,
      // Foldable
      'OnePlus Open': 2023,
      // Model codes
      'CPH2573': 2024, 'CPH2575': 2024,
      'CPH2449': 2023, 'CPH2451': 2023,
      'CPH2487': 2022, 'NE2210': 2022, 'NE2215': 2022,
      'CPH2413': 2021, 'LE2115': 2021, 'LE2111': 2021,
      'LE2125': 2021, 'LE2123': 2021, 'LE2121': 2021,
      'IN2025': 2020, 'IN2023': 2020, 'IN2021': 2020, 'IN2020': 2020,
      'IN2015': 2020, 'IN2013': 2020, 'IN2011': 2020, 'IN2010': 2020,
      'KB2005': 2020, 'KB2003': 2020, 'KB2001': 2020, 'KB2000': 2020,
      'GM1917': 2019, 'GM1915': 2019, 'GM1913': 2019, 'GM1911': 2019,
      'GM1905': 2019, 'GM1903': 2019, 'GM1901': 2019, 'GM1900': 2019,
      'HD1907': 2019, 'HD1905': 2019, 'HD1903': 2019, 'HD1901': 2019,
      'HD1917': 2019, 'HD1913': 2019, 'HD1910': 2019, 'HD1900': 2019,
      'A6013': 2018, 'A6010': 2018, 'A6003': 2018, 'A6000': 2018,
      'A5010': 2017, 'A5000': 2017,
      'CPH2581': 2023, 'CPH2585': 2023,
      'CPH2493': 2023, 'CPH2497': 2023,
      'IV2201': 2021, 'CPH2409': 2021,
      'AC2003': 2020, 'AC2001': 2020
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
  
  // Add these to the CAMERA_MAX_RESOLUTIONS object:

  // Xiaomi
  'Xiaomi 14 Ultra': { maxWidth: 8192, maxHeight: 6144, megapixels: 50 },
  'Xiaomi 14 Pro': { maxWidth: 8192, maxHeight: 6144, megapixels: 50 },
  'Xiaomi 14': { maxWidth: 8192, maxHeight: 6144, megapixels: 50 },
  'Xiaomi 13 Ultra': { maxWidth: 8192, maxHeight: 6144, megapixels: 50 },
  'Xiaomi 13 Pro': { maxWidth: 8192, maxHeight: 6144, megapixels: 50 },
  'Xiaomi 12 Ultra': { maxWidth: 8192, maxHeight: 6144, megapixels: 50 },
  'Mi 11 Ultra': { maxWidth: 8192, maxHeight: 6144, megapixels: 50 },
  'Mi Note 10 Pro': { maxWidth: 12032, maxHeight: 9024, megapixels: 108 },
  'Mi Note 10': { maxWidth: 12032, maxHeight: 9024, megapixels: 108 },
  'Redmi Note 13 Pro+': { maxWidth: 9248, maxHeight: 6936, megapixels: 200 },
  'Redmi Note 12 Pro+': { maxWidth: 9248, maxHeight: 6936, megapixels: 200 },
  
  // OnePlus
  'OnePlus 12': { maxWidth: 8192, maxHeight: 6144, megapixels: 50 },
  'OnePlus 11': { maxWidth: 8192, maxHeight: 6144, megapixels: 50 },
  'OnePlus 10 Pro': { maxWidth: 8192, maxHeight: 6144, megapixels: 48 },
  'OnePlus 9 Pro': { maxWidth: 8192, maxHeight: 6144, megapixels: 48 },
  'OnePlus 9': { maxWidth: 8192, maxHeight: 6144, megapixels: 48 },
  'OnePlus Open': { maxWidth: 8192, maxHeight: 6144, megapixels: 48 },
  
  // Samsung (add these if missing)
  'SM-S928U': { maxWidth: 9248, maxHeight: 6936, megapixels: 200 },
  'SM-S928B': { maxWidth: 9248, maxHeight: 6936, megapixels: 200 },
  'SM-S918U': { maxWidth: 9248, maxHeight: 6936, megapixels: 200 },
  'SM-S918B': { maxWidth: 9248, maxHeight: 6936, megapixels: 200 },
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
