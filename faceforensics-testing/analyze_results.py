#!/usr/bin/env python3
"""
Analyze FaceForensics++ test results from VeriSource API
Calculate accuracy, precision, recall, F1 score
"""

import json
import os
from pathlib import Path

def analyze_results():
    results_dir = Path('./results')
    
    # Counters
    real_videos = {'total': 0, 'correct': 0, 'incorrect': 0}
    fake_videos = {'total': 0, 'correct': 0, 'incorrect': 0}
    
    details = {
        'true_positives': [],   # Correctly identified fakes
        'true_negatives': [],   # Correctly identified real
        'false_positives': [],  # Real marked as fake
        'false_negatives': []   # Fake marked as real
    }
    
    # Analyze real videos
    for result_file in results_dir.glob('real_*.json'):
        with open(result_file, 'r') as f:
            try:
                data = json.load(f)
                real_videos['total'] += 1
                
                # Check if detected as AI/fake
                video_ai = data.get('video_analysis', {}).get('analysis', {}).get('aiPercentage', 0)
                ai_detected = data.get('ai_detection', {}).get('likely_ai_generated', False)
                
                # Real video should have LOW AI percentage
                if video_ai < 30 and not ai_detected:
                    real_videos['correct'] += 1
                    details['true_negatives'].append({
                        'file': result_file.name,
                        'ai_percentage': video_ai,
                        'label': data.get('confidence', {}).get('label', 'N/A')
                    })
                else:
                    real_videos['incorrect'] += 1
                    details['false_positives'].append({
                        'file': result_file.name,
                        'ai_percentage': video_ai,
                        'label': data.get('confidence', {}).get('label', 'N/A')
                    })
            except Exception as e:
                print(f"Error processing {result_file}: {e}")
    
    # Analyze fake videos
    for result_file in results_dir.glob('fake_*.json'):
        with open(result_file, 'r') as f:
            try:
                data = json.load(f)
                fake_videos['total'] += 1
                
                # Check if detected as AI/fake
                video_ai = data.get('video_analysis', {}).get('analysis', {}).get('aiPercentage', 0)
                ai_detected = data.get('ai_detection', {}).get('likely_ai_generated', False)
                
                # Fake video should have HIGH AI percentage OR be detected
                if video_ai >= 30 or ai_detected:
                    fake_videos['correct'] += 1
                    details['true_positives'].append({
                        'file': result_file.name,
                        'ai_percentage': video_ai,
                        'label': data.get('confidence', {}).get('label', 'N/A')
                    })
                else:
                    fake_videos['incorrect'] += 1
                    details['false_negatives'].append({
                        'file': result_file.name,
                        'ai_percentage': video_ai,
                        'label': data.get('confidence', {}).get('label', 'N/A')
                    })
            except Exception as e:
                print(f"Error processing {result_file}: {e}")
    
    # Calculate metrics
    total = real_videos['total'] + fake_videos['total']
    correct = real_videos['correct'] + fake_videos['correct']
    
    accuracy = (correct / total * 100) if total > 0 else 0
    
    tp = len(details['true_positives'])
    tn = len(details['true_negatives'])
    fp = len(details['false_positives'])
    fn = len(details['false_negatives'])
    
    precision = (tp / (tp + fp) * 100) if (tp + fp) > 0 else 0
    recall = (tp / (tp + fn) * 100) if (tp + fn) > 0 else 0
    f1_score = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0
    
    # Print report
    print("\n" + "="*60)
    print("VeriSource FaceForensics++ Test Results")
    print("="*60)
    print(f"\n📊 OVERALL RESULTS:")
    print(f"   Total Videos Tested: {total}")
    print(f"   Correct Classifications: {correct}")
    print(f"   Accuracy: {accuracy:.1f}%")
    
    print(f"\n✅ REAL VIDEOS:")
    print(f"   Total: {real_videos['total']}")
    print(f"   Correctly Identified: {real_videos['correct']} ({real_videos['correct']/real_videos['total']*100:.1f}%)")
    print(f"   Incorrectly Flagged: {real_videos['incorrect']}")
    
    print(f"\n🎭 FAKE VIDEOS (Deepfakes):")
    print(f"   Total: {fake_videos['total']}")
    print(f"   Correctly Detected: {fake_videos['correct']} ({fake_videos['correct']/fake_videos['total']*100:.1f}%)")
    print(f"   Missed: {fake_videos['incorrect']}")
    
    print(f"\n📈 DETAILED METRICS:")
    print(f"   True Positives (TP): {tp}")
    print(f"   True Negatives (TN): {tn}")
    print(f"   False Positives (FP): {fp}")
    print(f"   False Negatives (FN): {fn}")
    print(f"   Precision: {precision:.1f}%")
    print(f"   Recall: {recall:.1f}%")
    print(f"   F1 Score: {f1_score:.1f}")
    
    print("\n" + "="*60)
    print("💼 INVESTOR-READY CLAIM:")
    print("="*60)
    print(f"VeriSource achieves {accuracy:.1f}% accuracy on the")
    print(f"FaceForensics++ dataset, correctly detecting {recall:.1f}%")
    print(f"of deepfakes with a false positive rate of {fp/(fp+tn)*100:.1f}%.")
    print("="*60 + "\n")
    
    # Save detailed report
    report_path = Path('./reports/faceforensics_results.json')
    report_path.parent.mkdir(exist_ok=True)
    
    with open(report_path, 'w') as f:
        json.dump({
            'summary': {
                'total_videos': total,
                'accuracy': accuracy,
                'real_videos': real_videos,
                'fake_videos': fake_videos
            },
            'metrics': {
                'true_positives': tp,
                'true_negatives': tn,
                'false_positives': fp,
                'false_negatives': fn,
                'precision': precision,
                'recall': recall,
                'f1_score': f1_score
            },
            'details': details
        }, f, indent=2)
    
    print(f"📄 Detailed report saved to: {report_path}\n")

if __name__ == '__main__':
    analyze_results()
