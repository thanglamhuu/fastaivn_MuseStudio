# -*- coding: utf-8 -*-
"""Thumbnail 9:16 + clip xem trước cho 13 mẫu HND, lấy từ video thành phẩm đã chạy thử (HNDWorkflow/<mẫu>/VIDEO_THANH_PHAM.mp4).
Ghi vào frontend/public/workflow-thumbs/hnd-<templateId>.jpg / .mp4
"""
import json, subprocess, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
SRC = Path(r"I:\Claude\Srcs\HNDWorkflow")
OUT = Path(r"I:\Claude\Srcs\MuseStudio\frontend\public\workflow-thumbs")
OUT.mkdir(parents=True, exist_ok=True)
status = json.loads((SRC / "_run_status.json").read_text(encoding="utf-8"))
for tid, st in status.items():
    folder = Path(st.get("folder") or "")
    video = folder / "VIDEO_THANH_PHAM.mp4"
    if not video.is_file():
        print("bỏ qua", tid, "(chưa có video)")
        continue
    jpg, mp4 = OUT / f"hnd-{tid}.jpg", OUT / f"hnd-{tid}.mp4"
    vf = "scale=360:640:force_original_aspect_ratio=increase,crop=360:640"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", "3", "-i", str(video), "-frames:v", "1", "-vf", vf, "-q:v", "4", str(jpg)], check=True)
    # Clip xem trước 6s (từ giây 1), không tiếng, nhẹ để rê chuột là phát
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", "1", "-t", "6", "-i", str(video), "-an",
                    "-vf", "scale=270:480:force_original_aspect_ratio=increase,crop=270:480,fps=24", "-c:v", "libx264",
                    "-crf", "31", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(mp4)], check=True)
    print(tid, jpg.stat().st_size, mp4.stat().st_size)
