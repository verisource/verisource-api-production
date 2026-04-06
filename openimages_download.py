import csv
import os
import urllib.request
import concurrent.futures
import threading

out_dir = '/mnt/verisource/training-data/real/openimages'
os.makedirs(out_dir, exist_ok=True)
done, fail, lock = 0, 0, threading.Lock()

def download(row):
    global done, fail
    image_id = row['ImageID']
    url = row['Thumbnail300KURL'] or row['OriginalURL']
    if not url:
        with lock:
            fail += 1
        return
    dest = os.path.join(out_dir, 'oi_' + image_id + '.jpg')
    if os.path.exists(dest) and os.path.getsize(dest) > 1000:
        with lock:
            done += 1
        return
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'VeriSourceBot/1.0 (https://verisource.io; Brian@verisource.io)'
        })
        with urllib.request.urlopen(req, timeout=15) as r:
            data = r.read()
        if len(data) > 1000:
            with open(dest, 'wb') as f:
                f.write(data)
            with lock:
                done += 1
        else:
            with lock:
                fail += 1
    except Exception:
        with lock:
            fail += 1
    with lock:
        if (done + fail) % 100 == 0:
            print('\r✅ ' + str(done) + ' ❌ ' + str(fail), end='', flush=True)

with open('/workspace/verisource-gpu/validation_urls.csv') as f:
    rows = list(csv.DictReader(f))

print('Loaded ' + str(len(rows)) + ' URLs')

with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
    ex.map(download, rows)

print('\nDone: ' + str(done) + ' | Fail: ' + str(fail))