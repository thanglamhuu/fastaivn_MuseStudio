# -*- coding: utf-8 -*-
"""Chấm độ giống khuôn mặt nhân vật trong video so với ảnh tham chiếu (OpenCV YuNet + SFace).
SFace cosine >= 0.363 được coi là cùng người (ngưỡng của OpenCV Zoo).

python face_score.py --ref Bo=path --ref Me=path --ref Con=path --out report.json video1.mp4 video2.mp4 ...
"""
import argparse, json, subprocess, sys, tempfile
from pathlib import Path

import cv2
import numpy as np

sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).parent / "facemodels"
det = cv2.FaceDetectorYN.create(str(HERE / "yunet.onnx"), "", (320, 320), 0.7, 0.3, 5000)
rec = cv2.FaceRecognizerSF.create(str(HERE / "sface.onnx"), "")


def read(p):
    data = np.fromfile(str(p), dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


def faces(img):
    h, w = img.shape[:2]
    scale = 1.0
    if max(h, w) > 1600:
        scale = 1600 / max(h, w)
        img = cv2.resize(img, (int(w * scale), int(h * scale)))
        h, w = img.shape[:2]
    det.setInputSize((w, h))
    _, fs = det.detect(img)
    out = []
    for f in fs if fs is not None else []:
        if f[2] * f[3] < 40 * 40:  # mặt quá nhỏ bỏ qua
            continue
        crop = rec.alignCrop(img, f)
        out.append((float(f[2] * f[3]), rec.feature(crop)))
    return out


def ref_feature(p):
    fs = faces(read(p))
    if not fs:
        raise SystemExit(f"Không thấy mặt trong ảnh tham chiếu {p}")
    # Ảnh character sheet có nhiều góc: lấy trung bình các mặt, ưu tiên mặt to (cận mặt)
    fs.sort(key=lambda x: -x[0])
    feats = [f for _, f in fs[:3]]
    m = np.mean(np.vstack(feats), axis=0, keepdims=True).astype(np.float32)
    return m


def sim(a, b):
    return float(rec.match(a, b, cv2.FaceRecognizerSF_FR_COSINE))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", action="append", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--fps", default="2")
    ap.add_argument("videos", nargs="+")
    a = ap.parse_args()
    refs = {}
    for r in a.ref:
        name, path = r.split("=", 1)
        refs[name] = ref_feature(path)
    report = {"refs": list(refs), "videos": []}
    for v in a.videos:
        with tempfile.TemporaryDirectory() as td:
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", v, "-vf", f"fps={a.fps}", f"{td}/f_%04d.jpg"], check=True)
            frames = sorted(Path(td).glob("*.jpg"))
            per = {n: [] for n in refs}
            nfaces = 0
            for fr in frames:
                fs = faces(read(fr))
                nfaces += len(fs)
                # Mỗi mặt gán cho nhân vật giống nhất; mỗi nhân vật lấy điểm cao nhất trong khung
                best_in_frame = {n: None for n in refs}
                for _, f in fs:
                    scores = {n: sim(f, rf) for n, rf in refs.items()}
                    n = max(scores, key=scores.get)
                    if best_in_frame[n] is None or scores[n] > best_in_frame[n]:
                        best_in_frame[n] = scores[n]
                for n, s in best_in_frame.items():
                    if s is not None:
                        per[n].append(s)
            row = {"video": v, "frames": len(frames), "faces": nfaces, "chars": {}}
            for n, arr in per.items():
                if arr:
                    arr = np.array(arr)
                    row["chars"][n] = {
                        "present": round(len(arr) / max(1, len(frames)), 2),
                        "median": round(float(np.median(arr)), 3),
                        "p90": round(float(np.percentile(arr, 90)), 3),
                        "same_person_rate": round(float((arr >= 0.363).mean()), 2),
                    }
                else:
                    row["chars"][n] = {"present": 0, "median": None, "p90": None, "same_person_rate": 0}
            report["videos"].append(row)
            print(Path(v).name, json.dumps(row["chars"], ensure_ascii=False))
    # Tổng hợp: trung bình median & tỉ lệ khung "cùng người" của từng nhân vật qua các cảnh có mặt
    summ = {}
    for n in refs:
        meds = [r["chars"][n]["median"] for r in report["videos"] if r["chars"][n]["median"] is not None]
        rates = [r["chars"][n]["same_person_rate"] for r in report["videos"] if r["chars"][n]["median"] is not None]
        summ[n] = {"scenes_present": len(meds), "avg_median": round(float(np.mean(meds)), 3) if meds else None,
                   "avg_same_person_rate": round(float(np.mean(rates)), 2) if rates else None}
    report["summary"] = summ
    print("SUMMARY", json.dumps(summ, ensure_ascii=False))
    Path(a.out).write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
