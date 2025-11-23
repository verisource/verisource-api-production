const fs = require('fs');
const { createCanvas } = require('canvas');

function createIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Background gradient
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#228be6');
  gradient.addColorStop(1, '#1971c2');
  
  // Rounded rectangle background
  const radius = size / 5;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, radius);
  ctx.fill();

  // White circle (magnifying glass)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.beginPath();
  ctx.arc(size * 0.5, size * 0.39, size * 0.22, 0, Math.PI * 2);
  ctx.fill();

  // Checkmark
  ctx.strokeStyle = '#228be6';
  ctx.lineWidth = size * 0.06;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(size * 0.35, size * 0.39);
  ctx.lineTo(size * 0.45, size * 0.5);
  ctx.lineTo(size * 0.62, size * 0.32);
  ctx.stroke();

  // "VS" text
  ctx.fillStyle = 'white';
  ctx.font = `bold ${size * 0.25}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('VS', size * 0.5, size * 0.82);

  return canvas;
}

// Create 16x16
const icon16 = createIcon(16);
fs.writeFileSync('icons/icon16.png', icon16.toBuffer('image/png'));
console.log('✅ Created icon16.png');

// Create 48x48
const icon48 = createIcon(48);
fs.writeFileSync('icons/icon48.png', icon48.toBuffer('image/png'));
console.log('✅ Created icon48.png');

// Create 128x128
const icon128 = createIcon(128);
fs.writeFileSync('icons/icon128.png', icon128.toBuffer('image/png'));
console.log('✅ Created icon128.png');

console.log('\n�� All icons created successfully!');
