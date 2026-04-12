"""
VeriSource Generator Detection Classifier — Training Pipeline
=============================================================
Trains a multi-class classifier to identify the AI generator used
to create an image. Uses the same CLIP + Frequency CNN ensemble
architecture as the binary AI/authentic classifier.

Generator Classes:
  0: authentic          — real photographs
  1: stable_diffusion   — Civitai/SD models
  2: sdxl_realistic     — SDXL RealVis, SDXL fine-tunes
  3: dall_e_3           — OpenAI DALL-E 3
  4: grok               — xAI Grok image generation
  5: gemini_flash       — Google Gemini 2.5 Flash (Nano Banana)
  6: flux               — Black Forest Labs Flux
  7: unknown            — OOD / mixed / unidentified

OOD Detection:
  At inference time, softmax confidence thresholds determine output:
  > 80%   -> specific generator label + confidence
  50-80%  -> "Possibly [generator]" + confidence
  < 50%   -> "Unknown AI Generator" + confidence

Usage:
  python3 train_generator_classifier.py --dataset-dir /workspace/training-data
  python3 train_generator_classifier.py --dataset-dir /workspace/training-data --epochs 20

Requirements:
  pip install torch torchvision transformers pillow scikit-learn tqdm --break-system-packages
"""

import os
import sys
import json
import argparse
import random
from pathlib import Path
from collections import defaultdict, Counter

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms, models
from PIL import Image
from tqdm import tqdm

try:
    from transformers import CLIPProcessor, CLIPModel
    CLIP_AVAILABLE = True
except ImportError:
    print("Warning: transformers not available - CLIP features disabled")
    CLIP_AVAILABLE = False

# ---- Generator Classes -------------------------------------------------------

GENERATOR_CLASSES = [
    'stable_diffusion',
    'sdxl_realistic',
    'dall_e_3',
    'grok',
    'gemini_flash',
    'midjourney',
    'flux',
    'gpt_image1',
]

NUM_CLASSES    = len(GENERATOR_CLASSES)
CLASS_TO_IDX   = {c: i for i, c in enumerate(GENERATOR_CLASSES)}
IDX_TO_CLASS   = {i: c for i, c in enumerate(GENERATOR_CLASSES)}

OOD_HIGH = 0.80
OOD_MED  = 0.50

# ---- Args --------------------------------------------------------------------

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument('--dataset-dir',  default='/workspace/training-data')
    p.add_argument('--output-dir',   default='/mnt/verisource/models')
    p.add_argument('--epochs',       type=int,   default=15)
    p.add_argument('--batch-size',   type=int,   default=32)
    p.add_argument('--lr',           type=float, default=1e-4)
    p.add_argument('--img-size',     type=int,   default=224)
    p.add_argument('--min-samples',  type=int,   default=50)
    p.add_argument('--max-samples',  type=int,   default=5000)
    p.add_argument('--val-split',    type=float, default=0.15)
    p.add_argument('--use-clip',     action='store_true', default=True)
    p.add_argument('--clip-model',   default='openai/clip-vit-large-patch14')
    p.add_argument('--num-workers',  type=int,   default=4)
    p.add_argument('--seed',         type=int,   default=42)
    return p.parse_args()

# ---- Dataset -----------------------------------------------------------------

class GeneratorDataset(Dataset):
    def __init__(self, samples, transform=None):
        self.samples   = samples
        self.transform = transform

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        file_path, label_idx = self.samples[idx]
        try:
            img = Image.open(file_path).convert('RGB')
        except Exception:
            img = Image.new('RGB', (224, 224), (128, 128, 128))
        if self.transform:
            img = self.transform(img)
        return img, label_idx

# ---- Frequency CNN -----------------------------------------------------------

class FrequencyCNN(nn.Module):
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

# ---- Generator Classifier ----------------------------------------------------

class GeneratorClassifier(nn.Module):
    def __init__(self, num_classes, use_clip=True, clip_dim=768):
        super().__init__()
        self.use_clip    = use_clip
        self.num_classes = num_classes

        self.freq_cnn = FrequencyCNN(num_classes)

        self.visual_cnn = models.efficientnet_b2(weights=models.EfficientNet_B2_Weights.DEFAULT)
        in_features = self.visual_cnn.classifier[1].in_features
        self.visual_cnn.classifier = nn.Sequential(
            nn.Dropout(0.3),
            nn.Linear(in_features, num_classes),
        )

        if use_clip:
            self.clip_head = nn.Sequential(
                nn.Linear(clip_dim, 512), nn.ReLU(), nn.Dropout(0.3),
                nn.Linear(512, num_classes),
            )

        n_branches = 3 if use_clip else 2
        self.ensemble_weights = nn.Parameter(torch.ones(n_branches) / n_branches)

    def forward(self, images, clip_features=None):
        freq_logits   = self.freq_cnn(images)
        visual_logits = self.visual_cnn(images)
        weights = F.softmax(self.ensemble_weights, dim=0)

        if self.use_clip and clip_features is not None:
            clip_logits = self.clip_head(clip_features)
            return (weights[0] * freq_logits +
                    weights[1] * visual_logits +
                    weights[2] * clip_logits)
        else:
            w = F.softmax(self.ensemble_weights[:2], dim=0)
            return w[0] * freq_logits + w[1] * visual_logits

# ---- Data Loading ------------------------------------------------------------

def load_dataset(dataset_dir, min_samples, max_samples):
    dataset_dir = Path(dataset_dir)
    samples_by_class = defaultdict(list)

    splits_path   = dataset_dir / 'splits.json'
    metadata_path = dataset_dir / 'metadata.json'

    if splits_path.exists():
        print("Loading from splits.json...")
        with open(splits_path) as f:
            splits = json.load(f)
        for img_id, info in splits.get('splits', {}).items():
            gen_label = info.get('generator_label', 'unknown')
            label_str = info.get('label', 'real')
            filename  = info.get('filename', '')
            if gen_label not in CLASS_TO_IDX:
                gen_label = 'authentic' if label_str == 'real' else 'unknown'
            label_dir = 'ai' if label_str == 'ai' else 'real'
            file_path = dataset_dir / label_dir / filename
            if file_path.exists():
                samples_by_class[gen_label].append(str(file_path))

    elif metadata_path.exists():
        print("Loading from metadata.json...")
        with open(metadata_path) as f:
            meta = json.load(f)
        for img in meta.get('images', []):
            gen_label = img.get('generator_label', 'unknown')
            label_str = img.get('label', 'real')
            if gen_label not in CLASS_TO_IDX:
                gen_label = 'authentic' if label_str == 'real' else 'unknown'
            label_dir = 'ai' if label_str == 'ai' else 'real'
            file_path = dataset_dir / label_dir / (img.get('id', '') + '.jpg')
            if file_path.exists():
                samples_by_class[gen_label].append(str(file_path))

    else:
        print("No metadata found - scanning directories directly...")
        scan_dirs = {
            'stable_diffusion': Path('/mnt/verisource/training-data/ai/civitai'),
            'sdxl_realistic':   Path('/mnt/verisource/training-data/ai/portrait'),
            'dall_e_3':         Path('/mnt/verisource/training-data/ai/dalle3'),
            'grok':             Path('/mnt/verisource/training-data/ai/grok'),
            'gemini_flash':     Path('/mnt/verisource/training-data/ai/nanobana'),
            'midjourney':       Path('/mnt/verisource/training-data/ai/midjourney'),
            'flux':             Path('/mnt/verisource/training-data/ai/flux'),
            'gpt_image1':       Path('/mnt/verisource/training-data/ai/gpt_image1'),
        }
        for gen_label, dir_path in scan_dirs.items():
            if not dir_path.exists():
                continue
            files = [str(f) for f in dir_path.rglob('*')
                     if f.suffix.lower() in {'.jpg', '.jpeg', '.png', '.webp'}
                     and f.stat().st_size > 1000]
            samples_by_class[gen_label].extend(files)

    print("\nRaw class distribution:")
    for cls in GENERATOR_CLASSES:
        print(f"  {cls}: {len(samples_by_class.get(cls, []))}")

    valid = {cls: files for cls, files in samples_by_class.items()
             if len(files) >= min_samples and cls in CLASS_TO_IDX}

    if not valid:
        raise ValueError(f"No classes have >= {min_samples} samples.")

    print(f"\nBalancing classes (max {max_samples} per class):")
    all_samples = []
    for cls, files in valid.items():
        random.shuffle(files)
        selected = files[:max_samples]
        all_samples.extend([(f, CLASS_TO_IDX[cls]) for f in selected])
        print(f"  {cls}: {len(selected)}")

    random.shuffle(all_samples)
    return all_samples, list(valid.keys())

# ---- Train / Eval ------------------------------------------------------------

def train_epoch(model, loader, optimizer, criterion, device, clip_proc, clip_net):
    model.train()
    total_loss, correct, total = 0, 0, 0
    for images, labels in tqdm(loader, desc='Train', leave=False):
        images, labels = images.to(device), labels.to(device)
        optimizer.zero_grad()
        clip_feats = None
        if clip_proc and clip_net:
            with torch.no_grad():
                inp = clip_proc(images=images, return_tensors='pt', do_rescale=False).to(device)
                clip_feats = F.normalize(clip_net.get_image_features(**inp), dim=-1)
        logits = model(images, clip_feats)
        loss = criterion(logits, labels)
        loss.backward()
        optimizer.step()
        total_loss += loss.item()
        correct += (logits.argmax(1) == labels).sum().item()
        total += len(labels)
    return total_loss / len(loader), correct / total

@torch.no_grad()
def eval_epoch(model, loader, criterion, device, clip_proc, clip_net):
    model.eval()
    total_loss, correct, total = 0, 0, 0
    all_preds, all_labels = [], []
    for images, labels in tqdm(loader, desc='Val', leave=False):
        images, labels = images.to(device), labels.to(device)
        clip_feats = None
        if clip_proc and clip_net:
            inp = clip_proc(images=images, return_tensors='pt', do_rescale=False).to(device)
            clip_feats = F.normalize(clip_net.get_image_features(**inp), dim=-1)
        logits = model(images, clip_feats)
        loss = criterion(logits, labels)
        total_loss += loss.item()
        preds = logits.argmax(1)
        correct += (preds == labels).sum().item()
        total += len(labels)
        all_preds.extend(preds.cpu().tolist())
        all_labels.extend(labels.cpu().tolist())
    return total_loss / len(loader), correct / total, all_preds, all_labels

# ---- Main --------------------------------------------------------------------

def main():
    args = parse_args()
    random.seed(args.seed)
    torch.manual_seed(args.seed)

    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"Device: {device}")
    if device.type == 'cuda':
        print(f"GPU: {torch.cuda.get_device_name(0)}")

    all_samples, active_classes = load_dataset(
        args.dataset_dir, args.min_samples, args.max_samples
    )
    print(f"\nTotal samples: {len(all_samples)}")

    n_val = int(len(all_samples) * args.val_split)
    val_samples   = all_samples[:n_val]
    train_samples = all_samples[n_val:]
    print(f"Train: {len(train_samples)} | Val: {len(val_samples)}")

    train_tf = transforms.Compose([
        transforms.Resize((args.img_size, args.img_size)),
        transforms.RandomHorizontalFlip(),
        transforms.ColorJitter(brightness=0.1, contrast=0.1, saturation=0.1),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])
    val_tf = transforms.Compose([
        transforms.Resize((args.img_size, args.img_size)),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])

    train_loader = DataLoader(GeneratorDataset(train_samples, train_tf),
                              batch_size=args.batch_size, shuffle=True,
                              num_workers=args.num_workers, pin_memory=True)
    val_loader   = DataLoader(GeneratorDataset(val_samples, val_tf),
                              batch_size=args.batch_size, shuffle=False,
                              num_workers=args.num_workers, pin_memory=True)

    clip_proc, clip_net = None, None
    clip_dim = 768
    if args.use_clip and CLIP_AVAILABLE:
        print(f"\nLoading CLIP: {args.clip_model}")
        try:
            clip_proc = CLIPProcessor.from_pretrained(args.clip_model)
            clip_net  = CLIPModel.from_pretrained(args.clip_model).to(device)
            clip_net.eval()
            clip_dim  = clip_net.config.projection_dim
            print(f"CLIP dim: {clip_dim}")
        except Exception as e:
            print(f"CLIP load failed: {e} - continuing without CLIP")

    model = GeneratorClassifier(NUM_CLASSES, use_clip=(clip_net is not None), clip_dim=clip_dim).to(device)
    print(f"Model parameters: {sum(p.numel() for p in model.parameters()):,}")

    class_counts = Counter([s[1] for s in train_samples])
    weights = torch.tensor([
        len(train_samples) / (NUM_CLASSES * max(class_counts.get(i, 1), 1))
        for i in range(NUM_CLASSES)
    ], dtype=torch.float).to(device)
    criterion = nn.CrossEntropyLoss(weight=weights)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    best_val_acc = 0.0

    print(f"\nTraining for {args.epochs} epochs...\n")

    for epoch in range(1, args.epochs + 1):
        train_loss, train_acc = train_epoch(model, train_loader, optimizer, criterion, device, clip_proc, clip_net)
        val_loss, val_acc, preds, labels = eval_epoch(model, val_loader, criterion, device, clip_proc, clip_net)
        scheduler.step()

        print(f"Epoch {epoch:2d}/{args.epochs} | "
              f"Train {train_acc*100:.1f}% loss {train_loss:.4f} | "
              f"Val {val_acc*100:.1f}% loss {val_loss:.4f}")

        if epoch % 5 == 0 or epoch == args.epochs:
            cc = defaultdict(int)
            ct = defaultdict(int)
            for p, l in zip(preds, labels):
                ct[l] += 1
                if p == l: cc[l] += 1
            print("  Per-class accuracy:")
            for i in range(NUM_CLASSES):
                if ct[i] > 0:
                    print(f"    {IDX_TO_CLASS[i]:20s}: {cc[i]/ct[i]*100:.1f}% ({ct[i]} samples)")

        if val_acc > best_val_acc:
            best_val_acc = val_acc
            torch.save({
                'epoch': epoch,
                'model_state_dict': model.state_dict(),
                'val_accuracy': val_acc,
                'class_to_idx': CLASS_TO_IDX,
                'idx_to_class': IDX_TO_CLASS,
                'ood_thresholds': {'high': OOD_HIGH, 'medium': OOD_MED},
                'active_classes': active_classes,
                'config': vars(args),
            }, output_dir / 'generator_classifier.pth')
            print(f"  Saved best model ({val_acc*100:.1f}%)")

    print(f"\nTraining complete! Best val accuracy: {best_val_acc*100:.1f}%")
    print(f"Model: {output_dir / 'generator_classifier.pth'}")
    print(f"\nOOD thresholds:")
    print(f"  > {OOD_HIGH*100:.0f}% -> specific generator label")
    print(f"  {OOD_MED*100:.0f}-{OOD_HIGH*100:.0f}% -> 'Possibly [generator]'")
    print(f"  < {OOD_MED*100:.0f}% -> 'Unknown AI Generator'")

if __name__ == '__main__':
    main()