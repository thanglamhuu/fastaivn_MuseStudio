# -*- mode: python ; coding: utf-8 -*-
# Đóng gói MuseVideoStudio.exe (1 file). Chạy qua build_exe.bat (build giao diện trước, gom thư mục bàn giao sau).
#
# GÓI VÀO EXE: mã Python (app_launcher + studio_*.py + muse2api trong repo, kèm voices.json), giao diện đã build
# (frontend/dist → frontend_dist: gồm luôn mẫu workflow có sẵn + ảnh mẫu public/workflow-thumbs), thư viện chạy server.
# KHÔNG GÓI: data/ (log, media, requests.db, accounts.json chứa cookie, profile Chrome, state, ai_config chứa Gemini key),
# TestWorkFlow, tools, tests, changeLog, taiLieu, node_modules, tmpacc.k (danh sách email tài khoản)…
# wfthumb/ + ffmpeg.exe đặt CẠNH exe trong thư mục bàn giao (tools/package_release.py), không nhét vào exe.
from pathlib import Path

from PyInstaller.utils.hooks import collect_all

ROOT = Path(SPECPATH)
DIST = ROOT / "frontend" / "dist"
if not (DIST / "index.html").is_file():
    raise SystemExit(f"Chưa build giao diện: không thấy {DIST / 'index.html'} (chạy build_exe.bat)")

datas = [(str(DIST), "frontend_dist")]
binaries = []
hiddenimports = []
for pkg in ("muse2api", "uvicorn", "fastapi", "starlette", "webview"):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

a = Analysis(
    [str(ROOT / "app_launcher.py")],
    pathex=[str(ROOT / "muse2api" / "src"), str(ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Thư viện có trên máy build nhưng app không dùng → không gói (exe nhẹ, khởi động nhanh)
    excludes=["tkinter", "matplotlib", "pytest", "IPython", "notebook", "cv2", "torch", "faster_whisper",
              "ctranslate2", "scipy", "pandas", "PyQt5", "PyQt6", "PySide2", "PySide6"],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="MuseVideoStudio",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
