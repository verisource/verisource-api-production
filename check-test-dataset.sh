#!/bin/bash
echo "========================================="
echo "Test Dataset Progress - Real Photos Only"
echo "========================================="
echo ""

total=0

for dir in real-dslr real-stock real-smartphone real-edited; do
  count=$(find test-dataset/$dir -type f \( -name "*.jpg" -o -name "*.jpeg" -o -name "*.png" -o -name "*.webp" \) 2>/dev/null | wc -l)
  total=$((total + count))
  
  if [ $count -eq 0 ]; then
    status="⚪"
  else
    status="✅"
  fi
  
  printf "%s %-20s %2d images\n" "$status" "$dir:" "$count"
done

echo ""
echo "Total: $total images"
echo ""

if [ $total -gt 0 ]; then
  echo "✅ Ready to test! Run: node test-accuracy-comprehensive.js"
else
  echo "❌ No images found"
fi
