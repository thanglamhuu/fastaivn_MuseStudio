# -*- coding: utf-8 -*-
"""Chấm điểm giữ tham chiếu cho video POV:
- MÀU: vùng điểm ảnh màu cam (H 3–22 / 180, S>90, V>60): trung vị V (sáng), S (tươi), H (vàng↔đỏ nâu) so với ảnh sản phẩm gốc.
- BAO BÌ: số điểm SIFT khớp (ratio 0.75 + RANSAC homography inliers) giữa ảnh hộp thật và khung hình tốt nhất của video.
python pov_metrics.py <ref_dir> <box_image> <video>... → in bảng + ghi metrics.json cạnh video đầu
"""
import json, sys
from pathlib import Path
import cv2
import numpy as np

sys.stdout.reconfigure(encoding="utf-8")


def orange_stats(img):
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    m = (h >= 3) & (h <= 22) & (s > 90) & (v > 60)
    if m.sum() < 500:
        return None
    return float(np.median(v[m])), float(np.median(s[m])), float(np.median(h[m])), float(m.mean())


def read_any(p):
    img = cv2.imdecode(np.fromfile(str(p), np.uint8), cv2.IMREAD_COLOR)
    if img is None:  # webp lạ → qua ffmpeg
        import subprocess, tempfile
        t = Path(tempfile.gettempdir()) / "pm_tmp.png"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(p), str(t)], check=True)
        img = cv2.imread(str(t))
    return img


def frames(video, step=0.5):
    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS) or 24
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    out = []
    for i in range(0, n, max(1, int(fps * step))):
        cap.set(cv2.CAP_PROP_POS_FRAMES, i)
        ok, f = cap.read()
        if ok:
            out.append((i / fps, f))
    return out


sift = cv2.SIFT_create(nfeatures=3000)
bf = cv2.BFMatcher()


def box_inliers(kd_ref, img):
    kr, dr = kd_ref
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    k, d = sift.detectAndCompute(g, None)
    if d is None or len(k) < 10:
        return 0
    good = [m for m, n2 in (p for p in bf.knnMatch(dr, d, k=2) if len(p) == 2) if m.distance < 0.75 * n2.distance]
    if len(good) < 8:
        return len(good) // 2
    src = np.float32([kr[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([k[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    _, mask = cv2.findHomography(src, dst, cv2.RANSAC, 6.0)
    return int(mask.sum()) if mask is not None else 0


ref_dir, box_path, videos = Path(sys.argv[1]), Path(sys.argv[2]), [Path(v) for v in sys.argv[3:]]
refs = [orange_stats(read_any(p)) for p in sorted(ref_dir.iterdir()) if p.suffix.lower() in (".webp", ".jpg", ".png")]
refs = [r for r in refs if r]
R = np.median(np.array(refs), axis=0)
print(f"ẢNH GỐC  sáng V={R[0]:.0f}  tươi S={R[1]:.0f}  sắc H={R[2]:.1f}")
box = read_any(box_path)
box = cv2.resize(box, (800, int(800 * box.shape[0] / box.shape[1])))
kd_ref = sift.detectAndCompute(cv2.cvtColor(box, cv2.COLOR_BGR2GRAY), None)
rows = []
for v in videos:
    fr = frames(v)
    st = [orange_stats(f) for _, f in fr]
    st = [x for x in st if x]
    A = np.median(np.array(st), axis=0) if st else [0, 0, 0, 0]
    inl = [box_inliers(kd_ref, f) for _, f in fr]
    best = int(np.argmax(inl))
    row = {
        "video": v.name, "V": round(A[0]), "S": round(A[1]), "H": round(A[2], 1),
        "dV": round(A[0] - R[0]), "dS": round(A[1] - R[1]), "dH": round(A[2] - R[2], 1),
        "box_max": int(inl[best]), "box_at": round(fr[best][0], 1), "box_frames_ok": int(sum(1 for x in inl if x >= 25)), "frames": len(fr),
    }
    rows.append(row)
    print(f"{v.name[:48]:48s} V={row['V']:3d}({row['dV']:+4d}) S={row['S']:3d}({row['dS']:+4d}) H={row['H']:5.1f}({row['dH']:+5.1f})  "
          f"hộp: max {row['box_max']:4d} điểm khớp @{row['box_at']}s, {row['box_frames_ok']}/{row['frames']} khung ≥25")
(videos[0].parent / "metrics.json").write_text(json.dumps({"ref": {"V": R[0], "S": R[1], "H": R[2]}, "rows": rows}, ensure_ascii=False, indent=1), encoding="utf-8")
