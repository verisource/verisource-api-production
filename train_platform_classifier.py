"""
VeriSource Platform Detection Classifier — Training Pipeline
=============================================================
Trains a multi-class classifier to identify which social media platform(s)
processed an image, and how many compression generations it has undergone.

Platform Classes (32+):
  native, whatsapp, instagram_feed, instagram_story, facebook_hq, facebook_lq,
  twitter, telegram, tiktok, imessage, linkedin, reddit, screenshot,
  photoshop_instagram, lightroom_facebook, vsco_instagram, snapseed_whatsapp,
  instagram_filter_feed, brightness_twitter, sharpened_linkedin,
  noise_reduced_facebook, cropped_instagram, cropped_whatsapp, rotated_facebook,
  double_compressed, triple_compressed, instagram_whatsapp, facebook_whatsapp,
  whatsapp_screenshot, tiktok_screenshot, edited_instagram_whatsapp,
  instagram_facebook, facebook_instagram, instagram_tiktok, tiktok_instagram,
  tiktok_facebook

Multi-task outputs:
  1. Platform label (which platform(s) processed the image)
  2. Compression generation count (1-5)

Usage:
  python3 train_platform_classifier.py
  python3 train_platform_classifier.py --epochs 20 --batch-size 32
  python3 train_platform_classifier.py --dataset-dir /mnt/verisource/training-data/platform/synthetic
"""

import os
import sys
import json
import random
import argparse
from pathlib import Path
from collections import defaultdict, Counter

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms, models as tv_models
from PIL import Image
from tqdm import tqdm

# ─── Platform Classes ─────────────────────────────────────────

PLATFORM_CLASSES = [
    'native',
    'whatsapp',
    'instagram_feed',
    'instagram_story',
    'facebook_hq',
    'facebook_lq',
    'twitter',
    'telegram',
    'tiktok',
    'imessage',
    'linkedin',
    'reddit',
    'screenshot',
    'photoshop_instagram',
    'lightroom_facebook',
    'vsco_instagram',
    'snapseed_whatsapp',
    'instagram_filter_feed',
    'brightness_twitter',
    'sharpened_linkedin',
    'noise_reduced_facebook',
    'cropped_instagram',
    'cropped_whatsapp',
    'rotated_facebook',
    'double_compressed',
    'triple_compressed',
    'instagram_whatsapp',
    'facebook_whatsapp',
    'whatsapp_screenshot',
    'tiktok_screenshot',
    'edited_instagram_whatsapp',
    'instagram_facebook',
    'facebook_instagram',
    'instagram_tiktok',
    'tiktok_instagram',
    'tiktok_facebook',
]

NUM_CLASSES = len(PLATFORM_CLASSES)
CLASS_TO_IDX = {c: i for i, c in enumerate(PLATFORM_CLASSES)}
IDX_TO_CLASS = {i: c for i, c in enumerate(PLATFORM_CLASSES)}

# Compression generation buckets for regression
MAX_COMPRESSION_GENS = 5

# ─── Args ─────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument('--dataset-dir', default='/mnt/verisource/training-data/platform/synthetic')
    p.add_argument('--output-dir',  default='/mnt/verisource/models')
    p.add_argument('--epochs',      type=int,   default=20)
    p.add_argument('--batch-size',  type=int,   default=32)
    p.add_argument('--lr',          type=float, default=1e-4)
    p.add_argument('--img-size',    type=int,   default=224)
    p.add_argument('--max-samples', type=int,   default=5000)
    p.add_argument('--val-split',   type=float, default=0.15)
    p.add_argument('--num-workers', type=int,   default=4)
    p.add_argument('--seed',        type=int,   default=42)
    return p.parse_args()

# ─── Dataset ──────────────────────────────────────────────────

class PlatformDataset(Dataset):
    def __init__(self, samples, transform=None):
        self.samples = samples
        self.transform = transform

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        file_path, platform_idx, compression_gens = self.samples[idx]
        try:
            img = Image.open(file_path).convert('RGB')
        except Exception:
            img = Image.new('RGB', (224, 224), (128, 128, 128))
        if self.transform:
            img = self.transform(img)
        return img, platform_idx, min(compression_gens - 1, MAX_COMPRESSION_GENS - 1)

# ─── Model ────────────────────────────────────────────────────

class FrequencyCNN(nn.Module):
    """DCT-based frequency feature extractor — key for compression artifact detection."""
    def __init__(self, num_classes):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(1, 32, 3, padding=1), nn.BatchNorm2d(32), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(32, 64, 3, padding=1), nn.BatchNorm2d(64), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(64, 128, 3, padding=1), nn.BatchNorm2d(128), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(128, 256, 3, padding=1), nn.BatchNorm2d(256), nn.ReLU(),
            nn.AdaptiveAvgPool2d((4, 4)),
        )
        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Linear(256 * 4 * 4, 512), nn.ReLU(), nn.Dropout(0.5),
            nn.Linear(512, num_classes),
        )

    def forward(self, x):
        gray = x.mean(dim=1, keepdim=True)
        return self.classifier(self.features(gray))


class PlatformClassifier(nn.Module):
    """
    Multi-task platform detection model.
    - EfficientNet-B2: visual features (dimensions, aspect ratio, color patterns)
    - FrequencyCNN: compression artifact patterns (DCT quantization signatures)
    - Two heads: platform classification + compression generation count
    """
    def __init__(self, num_platform_classes, max_compression_gens=5):
        super().__init__()
        self.num_platform_classes = num_platform_classes
        self.max_compression_gens = max_compression_gens

        # Visual branch — detects resize patterns, dimensions, color space changes
        self.visual_cnn = tv_models.efficientnet_b2(weights=tv_models.EfficientNet_B2_Weights.DEFAULT)
        in_features = self.visual_cnn.classifier[1].in_features
        self.visual_cnn.classifier = nn.Identity()  # Remove original classifier

        # Frequency branch — detects DCT quantization artifacts
        self.freq_cnn = FrequencyCNN(256)  # Feature extractor, not classifier

        # Shared feature projection
        self.shared_fc = nn.Sequential(
            nn.Linear(in_features + 256, 512),
            nn.ReLU(),
            nn.Dropout(0.4),
        )

        # Platform classification head
        self.platform_head = nn.Linear(512, num_platform_classes)

        # Compression generation head (ordinal regression)
        self.compression_head = nn.Linear(512, max_compression_gens)

        # Learnable fusion weights
        self.fusion_weight = nn.Parameter(torch.tensor(0.5))

    def forward(self, images):
        # Visual features
        visual_feats = self.visual_cnn(images)

        # Frequency features — extract from frequency CNN backbone
        gray = images.mean(dim=1, keepdim=True)
        freq_feats = self.freq_cnn.features(gray)
        freq_feats = freq_feats.flatten(1)
        freq_feats = self.freq_cnn.classifier[0](freq_feats)  # Flatten
        freq_feats = self.freq_cnn.classifier[1](freq_feats)  # Linear 256*4*4 -> 512
        freq_feats = self.freq_cnn.classifier[2](freq_feats)  # ReLU
        freq_feats = self.freq_cnn.classifier[3](freq_feats)  # Dropout
        freq_feats = self.freq_cnn.classifier[4](freq_feats)  # Linear 512 -> num_classes (256 here)

        # Fuse visual and frequency features
        combined = torch.cat([visual_feats, freq_feats], dim=1)
        shared = self.shared_fc(combined)

        # Multi-task outputs
        platform_logits = self.platform_head(shared)
        compression_logits = self.compression_head(shared)

        return platform_logits, compression_logits

# ─── Data Loading ─────────────────────────────────────────────

def load_dataset(dataset_dir, max_samples, val_split):
    dataset_dir = Path(dataset_dir)
    labels_path = dataset_dir / 'labels.json'

    samples_by_class = defaultdict(list)

    if labels_path.exists():
        print("Loading from labels.json...")
        with open(labels_path) as f:
            data = json.load(f)
        for sample in data.get('samples', []):
            platform = sample.get('platform', '')
            if platform not in CLASS_TO_IDX:
                continue
            compression_gens = sample.get('compression_gens', 1)
            file_path = sample.get('path', '')
            if Path(file_path).exists():
                samples_by_class[platform].append((file_path, compression_gens))
    else:
        print("No labels.json found — scanning directories...")
        for platform in PLATFORM_CLASSES:
            platform_dir = dataset_dir / platform
            if not platform_dir.exists():
                continue
            files = list(platform_dir.glob('*.jpg'))
            for f in files:
                samples_by_class[platform].append((str(f), 1))

    print(f"\nRaw class distribution:")
    for cls in PLATFORM_CLASSES:
        count = len(samples_by_class.get(cls, []))
        if count > 0:
            print(f"  {cls}: {count}")

    # Balance classes
    all_samples = []
    print(f"\nBalancing classes (max {max_samples} per class):")
    for platform, items in samples_by_class.items():
        if platform not in CLASS_TO_IDX:
            continue
        random.shuffle(items)
        selected = items[:max_samples]
        platform_idx = CLASS_TO_IDX[platform]
        all_samples.extend([(path, platform_idx, gens) for path, gens in selected])
        print(f"  {platform}: {len(selected)}")

    random.shuffle(all_samples)
    n_val = int(len(all_samples) * val_split)
    val_samples = all_samples[:n_val]
    train_samples = all_samples[n_val:]

    print(f"\nTotal: {len(all_samples)} | Train: {len(train_samples)} | Val: {len(val_samples)}")
    return train_samples, val_samples

# ─── Training ─────────────────────────────────────────────────

def train_epoch(model, loader, optimizer, platform_criterion, compression_criterion, device):
    model.train()
    total_loss = platform_correct = compression_correct = total = 0

    for images, platform_labels, compression_labels in tqdm(loader, desc='Train', leave=False):
        images = images.to(device)
        platform_labels = platform_labels.to(device)
        compression_labels = compression_labels.to(device)

        optimizer.zero_grad()
        platform_logits, compression_logits = model(images)

        platform_loss = platform_criterion(platform_logits, platform_labels)
        compression_loss = compression_criterion(compression_logits, compression_labels)
        loss = platform_loss + 0.3 * compression_loss

        loss.backward()
        optimizer.step()

        total_loss += loss.item()
        platform_correct += (platform_logits.argmax(1) == platform_labels).sum().item()
        compression_correct += (compression_logits.argmax(1) == compression_labels).sum().item()
        total += len(images)

    return total_loss / len(loader), platform_correct / total, compression_correct / total


@torch.no_grad()
def eval_epoch(model, loader, platform_criterion, compression_criterion, device):
    model.eval()
    total_loss = platform_correct = compression_correct = total = 0
    all_platform_preds, all_platform_labels = [], []

    for images, platform_labels, compression_labels in tqdm(loader, desc='Val', leave=False):
        images = images.to(device)
        platform_labels = platform_labels.to(device)
        compression_labels = compression_labels.to(device)

        platform_logits, compression_logits = model(images)
        platform_loss = platform_criterion(platform_logits, platform_labels)
        compression_loss = compression_criterion(compression_logits, compression_labels)
        loss = platform_loss + 0.3 * compression_loss

        total_loss += loss.item()
        platform_correct += (platform_logits.argmax(1) == platform_labels).sum().item()
        compression_correct += (compression_logits.argmax(1) == compression_labels).sum().item()
        total += len(images)

        all_platform_preds.extend(platform_logits.argmax(1).cpu().tolist())
        all_platform_labels.extend(platform_labels.cpu().tolist())

    return (total_loss / len(loader), platform_correct / total,
            compression_correct / total, all_platform_preds, all_platform_labels)

# ─── Main ─────────────────────────────────────────────────────

def main():
    args = parse_args()
    random.seed(args.seed)
    torch.manual_seed(args.seed)

    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"Device: {device}")
    if device.type == 'cuda':
        print(f"GPU: {torch.cuda.get_device_name(0)}")
        vram = torch.cuda.get_device_properties(0).total_memory / 1e9
        print(f"VRAM: {vram:.1f} GB")

    train_samples, val_samples = load_dataset(
        args.dataset_dir, args.max_samples, args.val_split
    )

    train_tf = transforms.Compose([
        transforms.Resize((args.img_size, args.img_size)),
        transforms.RandomHorizontalFlip(),
        transforms.ColorJitter(brightness=0.05, contrast=0.05, saturation=0.05),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])
    val_tf = transforms.Compose([
        transforms.Resize((args.img_size, args.img_size)),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])

    train_loader = DataLoader(PlatformDataset(train_samples, train_tf),
                              batch_size=args.batch_size, shuffle=True,
                              num_workers=args.num_workers, pin_memory=True)
    val_loader = DataLoader(PlatformDataset(val_samples, val_tf),
                            batch_size=args.batch_size, shuffle=False,
                            num_workers=args.num_workers, pin_memory=True)

    # Count active classes
    active_classes = [cls for cls in PLATFORM_CLASSES
                      if any(s[1] == CLASS_TO_IDX[cls] for s in train_samples)]
    num_active = len(active_classes)
    print(f"\nActive classes: {num_active}/{NUM_CLASSES}")

    model = PlatformClassifier(num_active, MAX_COMPRESSION_GENS).to(device)
    print(f"Model parameters: {sum(p.numel() for p in model.parameters()):,}")

    # Weighted loss for class imbalance
    class_counts = Counter([s[1] for s in train_samples])
    active_idx = [CLASS_TO_IDX[cls] for cls in active_classes]
    weights = torch.tensor([
        len(train_samples) / (num_active * max(class_counts.get(i, 1), 1))
        for i in active_idx
    ], dtype=torch.float).to(device)

    # Remap labels to active class indices
    idx_remap = {old_idx: new_idx for new_idx, old_idx in enumerate(active_idx)}
    train_samples = [(p, idx_remap.get(l, 0), g) for p, l, g in train_samples]
    val_samples = [(p, idx_remap.get(l, 0), g) for p, l, g in val_samples]

    train_loader = DataLoader(PlatformDataset(train_samples, train_tf),
                              batch_size=args.batch_size, shuffle=True,
                              num_workers=args.num_workers, pin_memory=True)
    val_loader = DataLoader(PlatformDataset(val_samples, val_tf),
                            batch_size=args.batch_size, shuffle=False,
                            num_workers=args.num_workers, pin_memory=True)

    platform_criterion = nn.CrossEntropyLoss(weight=weights)
    compression_criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    best_val_acc = 0.0
    active_class_to_idx = {cls: i for i, cls in enumerate(active_classes)}
    active_idx_to_class = {i: cls for i, cls in enumerate(active_classes)}

    print(f"\nTraining for {args.epochs} epochs...\n")

    for epoch in range(1, args.epochs + 1):
        train_loss, train_platform_acc, train_comp_acc = train_epoch(
            model, train_loader, optimizer, platform_criterion, compression_criterion, device
        )
        val_loss, val_platform_acc, val_comp_acc, preds, labels = eval_epoch(
            model, val_loader, platform_criterion, compression_criterion, device
        )
        scheduler.step()

        print(f"Epoch {epoch:2d}/{args.epochs} | "
              f"Train platform {train_platform_acc*100:.1f}% comp {train_comp_acc*100:.1f}% | "
              f"Val platform {val_platform_acc*100:.1f}% comp {val_comp_acc*100:.1f}%")

        if epoch % 5 == 0 or epoch == args.epochs:
            cc = defaultdict(int)
            ct = defaultdict(int)
            for p, l in zip(preds, labels):
                ct[l] += 1
                if p == l:
                    cc[l] += 1
            print("  Per-class platform accuracy:")
            for i, cls in enumerate(active_classes):
                if ct[i] > 0:
                    print(f"    {cls:30s}: {cc[i]/ct[i]*100:.1f}% ({ct[i]} samples)")

        if val_platform_acc > best_val_acc:
            best_val_acc = val_platform_acc
            torch.save({
                'epoch': epoch,
                'model_state_dict': model.state_dict(),
                'val_platform_accuracy': val_platform_acc,
                'val_compression_accuracy': val_comp_acc,
                'active_classes': active_classes,
                'class_to_idx': active_class_to_idx,
                'idx_to_class': active_idx_to_class,
                'num_platform_classes': num_active,
                'max_compression_gens': MAX_COMPRESSION_GENS,
                'config': vars(args),
            }, output_dir / 'platform_classifier.pth')
            print(f"  Saved best model (platform {val_platform_acc*100:.1f}%, "
                  f"compression {val_comp_acc*100:.1f}%)")

    print(f"\nTraining complete!")
    print(f"Best platform accuracy: {best_val_acc*100:.1f}%")
    print(f"Model: {output_dir / 'platform_classifier.pth'}")


if __name__ == '__main__':
    main()