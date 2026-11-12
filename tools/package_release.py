# -*- coding: utf-8 -*-
"""Gom thư mục BÀN GIAO sau khi build exe: python tools/package_release.py [--full-clips] [--no-ffmpeg] [--no-zip]

release/MuseVideoStudio_<ngày>/
  MuseVideoStudio.exe      app (giao diện + Gateway + muse2api + mẫu workflow có sẵn) — từ dist/
  wfthumb/                 thumbnail + video xem trước 8 s + sơ đồ .flow.json + wfthumb.config.json của các mẫu workflow
                           (config sửa được: dán link YouTube…). Đã bỏ đường dẫn máy dev (testClip) khỏi config.
  wfthumb/full/            (chỉ khi --full-clips) clip đầy đủ có tiếng cho nút ▶ — lấy từ TestWorkFlow/thumFull (~160 MB)
  ffmpeg.exe               (nếu máy build có ffmpeg; bỏ bằng --no-ffmpeg) — cần cho ghép cảnh / hậu kỳ
  HUONG_DAN_CHAY.txt       cách chạy, yêu cầu máy, dữ liệu lưu ở đâu
→ nén thành release/MuseVideoStudio_<ngày>.zip

KHÔNG BAO GIỜ gói: data/ (log, media, requests.db, accounts.json chứa cookie đăng nhập, login-profiles, browser-profile,
studio/state, studio/ai_config.json chứa Gemini key, seen_media.txt), tmpacc.k (email tài khoản), TestWorkFlow (trừ clip
full khi chọn), tools, tests, changeLog, taiLieu, thamK, node_modules, .git, muse2api/tests, build/.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[1]
EXE = ROOT / "dist" / "MuseVideoStudio.exe"
THUMB_EXT = {".jpg", ".jpeg", ".png", ".webp", ".mp4", ".json"}

GUIDE = """MUSE AI VIDEO BATCH STUDIO — HƯỚNG DẪN CHẠY (bản {date})

1. Yêu cầu máy: Windows 10/11 64-bit; đã cài Google Chrome hoặc Microsoft Edge (app dùng trình duyệt có sẵn để chạy muse.ai);
   mạng ổn định.
2. Giải nén cả thư mục (giữ MuseVideoStudio.exe, thư mục wfthumb{ff} ĐỂ CẠNH NHAU), chạy MuseVideoStudio.exe.
   Windows SmartScreen hỏi thì bấm "More info" → "Run anyway".
3. Lần đầu: Cài đặt → Tài khoản Muse → "+ Thêm tài khoản (đăng nhập)" hoặc "✉ Đăng nhập bằng email (OTP)".
   (Tuỳ chọn) Cài đặt → Trợ lý AI → dán Gemini API key để AI viết kịch bản tốt hơn.
4. Dữ liệu của bạn (tài khoản, nhân vật, sản phẩm, sơ đồ đã lưu…) nằm ở %APPDATA%\\MuseVideoStudio — KHÔNG nằm cạnh exe,
   cập nhật exe mới không mất dữ liệu. Video xuất ra: Downloads\\MuseStudio\\<tên dự án>.
5. Mẫu workflow: thumbnail / video mẫu lấy từ thư mục wfthumb cạnh exe; sửa wfthumb\\wfthumb.config.json (vd. dán link
   YouTube) rồi mở lại màn Workflow là thấy.{full}
6. Cổng mặc định 18610 (đang có app khác dùng cổng này thì đóng app đó trước).
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--full-clips", action="store_true", help="gói clip đầy đủ (TestWorkFlow/thumFull) cho nút ▶")
    ap.add_argument("--no-ffmpeg", action="store_true", help="không kèm ffmpeg.exe")
    ap.add_argument("--ffmpeg", default="", help="đường dẫn ffmpeg.exe để kèm (mặc định: biến MUSE2API_FFMPEG_PATH hoặc PATH)")
    ap.add_argument("--no-zip", action="store_true", help="không nén zip")
    args = ap.parse_args()

    if not EXE.is_file():
        print(f"[LỖI] Chưa có {EXE} — chạy PyInstaller trước (build_exe.bat).")
        return 1
    date = time.strftime("%Y%m%d")
    out = ROOT / "release" / f"MuseVideoStudio_{date}"
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    shutil.copy2(EXE, out / EXE.name)

    # wfthumb: chỉ file thumbnail / video / sơ đồ / config
    src_thumb = ROOT / "wfthumb"
    dst_thumb = out / "wfthumb"
    dst_thumb.mkdir()
    n = 0
    for f in sorted(src_thumb.iterdir()):
        if f.is_file() and f.suffix.lower() in THUMB_EXT and f.name != "wfthumb.config.json":
            shutil.copy2(f, dst_thumb / f.name)
            n += 1
    cfg_path = src_thumb / "wfthumb.config.json"
    full_note = ""
    if cfg_path.is_file():
        cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
        for t in cfg.get("templates", []):
            t.pop("testClip", None)  # đường dẫn thư mục chạy thử trên máy dev
            t.pop("testVersion", None)
        cfg["fullVideoDir"] = ""
        if args.full_clips:
            full_src = (src_thumb / "../../TestWorkFlow/thumFull").resolve()
            if full_src.is_dir():
                shutil.copytree(full_src, dst_thumb / "full")
                cfg["fullVideoDir"] = "full"  # tương đối so với thư mục wfthumb
                full_note = "\n   Clip đầy đủ có tiếng (nút ▶) nằm ở wfthumb\\full."
            else:
                print(f"[CẢNH BÁO] Không thấy {full_src} — bỏ clip đầy đủ (nút ▶ phát video xem trước 8 s).")
        (dst_thumb / "wfthumb.config.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=1), encoding="utf-8")
        n += 1

    ff_note = ""
    if not args.no_ffmpeg:
        import os

        given = [c for c in (args.ffmpeg, os.environ.get("MUSE2API_FFMPEG_PATH", "")) if c and Path(c).is_file()]
        ff = given[0] if given else shutil.which("ffmpeg")
        if ff:
            shutil.copy2(ff, out / "ffmpeg.exe")
            ff_note = ", ffmpeg.exe"
        else:
            print("[CẢNH BÁO] Không tìm thấy ffmpeg (PATH / MUSE2API_FFMPEG_PATH / --ffmpeg) — bản bàn giao KHÔNG có ffmpeg.exe, "
                  "người dùng cần tự cài ffmpeg để ghép cảnh / hậu kỳ. Chạy lại: python tools/package_release.py --ffmpeg <đường dẫn>")
    (out / "HUONG_DAN_CHAY.txt").write_text(GUIDE.format(date=date, ff=ff_note, full=full_note), encoding="utf-8-sig")

    # Chặn nhầm: thư mục bàn giao không được chứa dữ liệu cá nhân
    bad = [p for p in out.rglob("*") if p.name in {"accounts.json", "ai_config.json", "tmpacc.k", "requests.db", "seen_media.txt"}]
    if bad:
        print("[LỖI] Thư mục bàn giao có file dữ liệu cá nhân:", bad)
        return 1

    size = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    print(f"Thư mục bàn giao: {out}  ({size / 1e6:.0f} MB; wfthumb {n} file{ff_note}{' + clip full' if full_note else ''})")
    if not args.no_zip:
        z = shutil.make_archive(str(out), "zip", root_dir=out.parent, base_dir=out.name)
        print(f"File zip: {z}  ({Path(z).stat().st_size / 1e6:.0f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
