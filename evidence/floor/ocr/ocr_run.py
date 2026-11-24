# OCR every hires frame; one TSV row per detected text line.
# Usage: py -3.11 ocr_run.py [prefix] [first_index] [end_index]   (frame index N is at N/2 seconds)
import sys, os, csv, glob
from rapidocr_onnxruntime import RapidOCR
prefix = sys.argv[1] if len(sys.argv) > 1 else ''
lo = int(sys.argv[2]) if len(sys.argv) > 2 else 0
hi = int(sys.argv[3]) if len(sys.argv) > 3 else 10**9
engine = RapidOCR()
files = [f for f in sorted(glob.glob(os.path.join('hires', prefix + '*.jpg')))
         if lo <= int(os.path.basename(f).split('_h')[1][:4]) < hi]
out = open('ocr_%s_%d.tsv' % (prefix or 'all', lo), 'w', newline='', encoding='utf-8')
w = csv.writer(out, delimiter='\t')
w.writerow(['frame', 'seconds', 'conf', 'x', 'y', 'w', 'h', 'text'])
for i, f in enumerate(files):
    name = os.path.basename(f)
    secs = int(name.split('_h')[1][:4]) / 2
    result, _ = engine(f)
    for box, text, conf in (result or []):
        xs = [p[0] for p in box]; ys = [p[1] for p in box]
        w.writerow([name, secs, '%.2f' % float(conf), int(min(xs)), int(min(ys)),
                    int(max(xs) - min(xs)), int(max(ys) - min(ys)), text])
    if i % 20 == 0:
        out.flush(); print(i, len(files), flush=True)
out.close(); print('done', len(files))
