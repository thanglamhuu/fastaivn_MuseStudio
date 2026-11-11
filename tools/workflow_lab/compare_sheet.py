# -*- coding: utf-8 -*-
"""Bảng so sánh: mỗi dòng 1 video, 6 khung (0,2,4,6,8,9.5s) + nhãn. Ghi so_sanh.jpg"""
import subprocess, sys
from pathlib import Path
import cv2
import numpy as np

sys.stdout.reconfigure(encoding="utf-8")
out = Path(sys.argv[1])
items = [(Path(p.split("=", 1)[1]), p.split("=", 1)[0]) for p in sys.argv[2:]]
rows = []
for v, label in items:
    cap = cv2.VideoCapture(str(v))
    fps = cap.get(cv2.CAP_PROP_FPS) or 24
    tiles = []
    for t in (0.2, 2, 4, 6, 8, 9.5):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(t * fps))
        ok, f = cap.read()
        f = cv2.resize(f, (180, 320)) if ok else np.zeros((320, 180, 3), np.uint8)
        tiles.append(f)
    lab = np.full((320, 220, 3), 30, np.uint8)
    y = 30
    for line in label.split("|"):
        cv2.putText(lab, line, (8, y), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)
        y += 26
    rows.append(np.hstack([lab] + tiles))
cv2.imwrite(str(out), np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 85])
print(out)
