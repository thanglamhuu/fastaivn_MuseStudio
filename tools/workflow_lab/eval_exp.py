# -*- coding: utf-8 -*-
"""Đánh giá 1 lượt thí nghiệm: tìm thư mục "Node - EXP Rx ..." trong Downloads\\MuseStudio,
chấm điểm mặt (face_score.py) cho từng video cảnh + dựng ảnh so sánh (ảnh gốc | khung 2s/5s/8s mỗi cảnh).
python eval_exp.py R1
"""
import json, os, subprocess, sys, tempfile
from pathlib import Path

import cv2
import numpy as np

sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).parent
TN = Path(r"D:\1FastAIVN\srcs\TaiNguyen")
OUT = Path(r"D:\1FastAIVN\srcs\HNDWorkflow\HND worflows export\4_thi_nghiem_dong_nhat")
tag = sys.argv[1]
root = Path(os.environ["USERPROFILE"]) / "Downloads" / "MuseStudio"
folder = next(p for p in root.iterdir() if p.is_dir() and p.name.startswith(f"Node - EXP {tag} "))
videos = sorted([p for p in folder.glob("*.mp4") if "GHEP" not in p.name and "KET_QUA" not in p.name], key=lambda p: p.name)
# Chỉ lấy 3 cảnh mới nhất (lượt chạy cuối)
videos = sorted(videos, key=lambda p: p.stat().st_mtime)[-3:]
videos = sorted(videos, key=lambda p: p.name.split("_Scene_")[-1] if "_Scene_" in p.name else p.name)
print("videos:", [v.name for v in videos])
rep = OUT / f"{tag}_face.json"
subprocess.run([sys.executable, str(HERE / "face_score.py"), "--ref", f"Bo={TN/'Bo.png'}", "--ref", f"Me={TN/'Me.png'}",
                "--ref", f"Con={TN/'ChiDai.png'}", "--out", str(rep), *map(str, videos)], check=True)


def read(p):
    return cv2.imdecode(np.fromfile(str(p), dtype=np.uint8), cv2.IMREAD_COLOR)


def fit(img, h=360):
    s = h / img.shape[0]
    return cv2.resize(img, (int(img.shape[1] * s), h))


refs = [fit(read(TN / f)) for f in ("Bo.png", "Me.png", "ChiDai.png")]
prod = read(TN / "quat-cam-tay-mini-jisulife-life-7-5000mah_4__3.webp")
if prod is not None:
    refs.append(fit(prod[:, : prod.shape[1] // 2]))
rows = [np.hstack(refs)]
for v in videos:
    frames = []
    with tempfile.TemporaryDirectory() as td:
        for t in (1.5, 4.5, 8.0):
            o = Path(td) / f"{t}.jpg"
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", str(t), "-i", str(v), "-frames:v", "1", str(o)])
            if o.exists():
                frames.append(fit(read(o)))
    if frames:
        rows.append(np.hstack(frames))
W = max(r.shape[1] for r in rows)
rows = [np.pad(r, ((0, 6), (0, W - r.shape[1]), (0, 0))) for r in rows]
sheet = np.vstack(rows)
sp = OUT / f"{tag}_so_sanh.jpg"
cv2.imencode(".jpg", sheet, [cv2.IMWRITE_JPEG_QUALITY, 82])[1].tofile(str(sp))
print("sheet:", sp)
print(json.dumps(json.loads(rep.read_text(encoding="utf-8"))["summary"], ensure_ascii=False))
