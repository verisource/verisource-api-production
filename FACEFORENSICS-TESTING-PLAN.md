# FaceForensics++ Testing Plan

**Date:** November 10, 2025  
**Status:** Approved for dataset access  
**Goal:** Validate VeriSource accuracy with industry-standard dataset

---

## 📊 About FaceForensics++

**Industry Standard:** Used by major research papers and companies  
**Content:** 1,000+ videos with real and manipulated faces  
**Manipulation Types:**
- FaceSwap
- Face2Face
- DeepFakes
- NeuralTextures

**Why It Matters:** Credible accuracy metrics for investors and customers

---

## 🎯 Testing Strategy

### **Phase 1: Download & Setup (30 min)**
1. Download FaceForensics++ dataset
2. Extract sample videos (20 real, 20 fake)
3. Organize into test structure

### **Phase 2: Basic Testing (1 hour)**
Test 40 videos (20 real + 20 deepfakes):
- Upload each to VeriSource API
- Record: confidence %, label, AI detection
- Calculate accuracy metrics

### **Phase 3: Detailed Analysis (2 hours)**
Test 100+ videos across all manipulation types:
- Real videos
- FaceSwap deepfakes
- Face2Face deepfakes
- DeepFakes method
- NeuralTextures

### **Phase 4: Metrics & Report (1 hour)**
Calculate:
- Overall accuracy
- True positive rate (deepfakes detected)
- True negative rate (real videos verified)
- False positive rate
- False negative rate
- Precision, Recall, F1 Score

---

## 📝 Test Script Template
```bash
# Test automation script
for video in real/*.mp4; do
  echo "Testing: $video"
  curl -X POST https://api.verisource.io/verify \
    -F "file=@$video" \
    > results/$(basename $video).json
done

for video in fake/*.mp4; do
  echo "Testing: $video"
  curl -X POST https://api.verisource.io/verify \
    -F "file=@$video" \
    > results/$(basename $video).json
done

# Analyze results
python3 analyze_results.py
```

---

## 📈 Expected Outcomes

### **Conservative Estimate:**
- Real videos: 85-90% correctly identified
- Deepfakes: 75-85% correctly detected
- Overall accuracy: 80-87%

### **Best Case:**
- Real videos: 90-95% correct
- Deepfakes: 85-90% detected
- Overall accuracy: 87-92%

### **Investor-Ready Claim:**
> "VeriSource achieves XX% accuracy on the industry-standard FaceForensics++ dataset, correctly identifying deepfakes in XX% of cases while maintaining a false positive rate of only XX%."

---

## 🎯 Next Steps

**Immediate:**
1. Download FaceForensics++ dataset
2. Create test automation script
3. Run initial 40-video test

**This Week:**
1. Complete 100+ video testing
2. Generate accuracy report
3. Update investor materials

**Deliverables:**
- Accuracy metrics report
- Comparison to published research
- Updated marketing materials
- Confidence in pitching to investors

---

## 💼 Business Impact

**For Investors:**
- Credible, third-party validated accuracy
- Industry-standard benchmarking
- Comparable to academic research

**For Marketing:**
- "Tested on FaceForensics++"
- Specific accuracy percentages
- Better than "100% on our test set"

**For Product:**
- Identify weaknesses
- Guide improvements
- Prioritize development

