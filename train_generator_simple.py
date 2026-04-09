python3 << 'PYEOF'
script = '''
import json, random, torch, torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms, models
from PIL import Image
from collections import Counter

LABELS = {"stable_diffusion":0,"sdxl_realistic":1,"dall_e_3":2,"grok":3,"gemini_flash":4,"midjourney":5,"authentic":6}
LABEL_NAMES = {v:k for k,v in LABELS.items()}
NUM_CLASSES = len(LABELS)
DEVICE = torch.device("cuda")
MAX_PER_CLASS = 5000

with open("/tmp/generator_samples.json") as f: all_samples = json.load(f)
by_class = {}
for s in all_samples:
    l = s["label"]
    if l not in by_class: by_class[l] = []
    by_class[l].append(s)

samples = []
for label, items in by_class.items():
    random.shuffle(items)
    samples.extend(items[:MAX_PER_CLASS])
    print(f"{label}: {min(len(items), MAX_PER_CLASS)}")

random.shuffle(samples)
n_val = int(len(samples) * 0.1)
val_samples = samples[:n_val]
train_samples = samples[n_val:]
print(f"Train: {len(train_samples)} | Val: {len(val_samples)}")

class GenDataset(Dataset):
    def __init__(self, samples, transform):
        self.samples = samples
        self.transform = transform
    def __len__(self): return len(self.samples)
    def __getitem__(self, idx):
        s = self.samples[idx]
        try:
            img = Image.open(s["path"]).convert("RGB")
            return self.transform(img), LABELS[s["label"]]
        except:
            return torch.zeros(3,224,224), LABELS[s["label"]]

train_tf = transforms.Compose([transforms.Resize((224,224)), transforms.RandomHorizontalFlip(), transforms.ColorJitter(0.1,0.1,0.1), transforms.ToTensor(), transforms.Normalize([0.485,0.456,0.406],[0.229,0.224,0.225])])
val_tf = transforms.Compose([transforms.Resize((224,224)), transforms.ToTensor(), transforms.Normalize([0.485,0.456,0.406],[0.229,0.224,0.225])])
train_loader = DataLoader(GenDataset(train_samples, train_tf), batch_size=64, shuffle=True, num_workers=4, pin_memory=True)
val_loader = DataLoader(GenDataset(val_samples, val_tf), batch_size=64, shuffle=False, num_workers=4, pin_memory=True)

backbone = models.resnet50(weights=models.ResNet50_Weights.IMAGENET1K_V2)
backbone.fc = nn.Sequential(nn.Dropout(0.3), nn.Linear(2048, NUM_CLASSES))
model = backbone.to(DEVICE)
optimizer = torch.optim.AdamW(model.parameters(), lr=1e-4, weight_decay=1e-4)
scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=20)
criterion = nn.CrossEntropyLoss()

best_acc = 0
for epoch in range(1, 21):
    model.train()
    correct, total = 0, 0
    for imgs, labels in train_loader:
        imgs, labels = imgs.to(DEVICE), labels.to(DEVICE)
        optimizer.zero_grad()
        out = model(imgs)
        loss = criterion(out, labels)
        loss.backward()
        optimizer.step()
        correct += (out.argmax(1) == labels).sum().item()
        total += labels.size(0)
    scheduler.step()
    train_acc = 100.*correct/total
    model.eval()
    correct, total = 0, 0
    per_class = Counter()
    per_class_total = Counter()
    with torch.no_grad():
        for imgs, labels in val_loader:
            imgs, labels = imgs.to(DEVICE), labels.to(DEVICE)
            out = model(imgs)
            preds = out.argmax(1)
            correct += (preds == labels).sum().item()
            total += labels.size(0)
            for p, l in zip(preds.cpu(), labels.cpu()):
                per_class_total[l.item()] += 1
                if p == l: per_class[l.item()] += 1
    val_acc = 100.*correct/total
    marker = "★" if val_acc > best_acc else ""
    if val_acc > best_acc:
        best_acc = val_acc
        torch.save({"model_state_dict": model.state_dict(), "labels": LABELS, "val_acc": val_acc}, "/mnt/verisource/models/generator_classifier.pth")
    print(f"Epoch {epoch}/20 train:{train_acc:.1f}% val:{val_acc:.1f}% {marker}")
    for cls, cnt in per_class_total.items():
        print(f"  {LABEL_NAMES[cls]}: {100.*per_class[cls]/cnt:.1f}%")
print(f"Best: {best_acc:.1f}%")
'''
with open("/tmp/train_generator_simple.py", "w") as f:
    f.write(script)
print("Script written successfully")
PYEOF