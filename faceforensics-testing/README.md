# FaceForensics++ Testing for VeriSource

## Setup

1. Download FaceForensics++ videos
2. Place videos in appropriate folders:
   - Real videos → `videos/real/`
   - Fake videos → `videos/fake/`

## Running Tests
```bash
# Run all tests
./test_videos.sh

# Analyze results
python3 analyze_results.py
```

## Directory Structure
```
faceforensics-testing/
├── videos/
│   ├── real/        # Real videos from FaceForensics++
│   └── fake/        # Deepfake videos
├── results/         # JSON results from API
├── reports/         # Analysis reports
├── test_videos.sh   # Testing script
└── analyze_results.py  # Results analyzer
```

## What You'll Get

- Overall accuracy percentage
- True positive/negative rates
- False positive/negative rates
- Precision, Recall, F1 Score
- Investor-ready accuracy claim
