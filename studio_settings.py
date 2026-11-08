"""Cấu hình dùng chung cho Local Gateway (gateway_server.py và app_launcher.py).

Đổi cổng hoặc API key tại đây (hoặc qua biến môi trường MUSE2API_PORT / MUSE2API_API_KEY).
Nếu đổi, cập nhật cả frontend: frontend/.env (VITE_GATEWAY_URL, VITE_MUSE_API_KEY).
"""
import os
import sys
from pathlib import Path

# Luôn dùng bản muse2api nhúng trong repo (có bản vá Windows + MuseStudio), kể cả khi máy
# còn cài một bản muse2api khác bằng `pip install -e`. Khi chạy từ file .exe (PyInstaller)
# thì muse2api đã được đóng gói sẵn nên bỏ qua bước này.
_VENDORED_SRC = Path(__file__).resolve().parent / "muse2api" / "src"
if not hasattr(sys, "_MEIPASS") and _VENDORED_SRC.is_dir():
    sys.path.insert(0, str(_VENDORED_SRC))
    for _name in [m for m in sys.modules if m == "muse2api" or m.startswith("muse2api.")]:
        del sys.modules[_name]

HOST = os.environ.get("MUSE2API_HOST", "127.0.0.1")
PORT = int(os.environ.get("MUSE2API_PORT", "18610"))
API_KEY = os.environ.get("MUSE2API_API_KEY", "m2a_secret_key")


def apply_gateway_env() -> None:
    """Đặt biến môi trường mặc định cho muse2api trước khi import muse2api.app."""
    os.environ.setdefault("MUSE2API_HOST", HOST)
    os.environ.setdefault("MUSE2API_PORT", str(PORT))
    os.environ.setdefault("MUSE2API_DRIVER", "browser")
    os.environ.setdefault("MUSE2API_API_KEY", API_KEY)


def cleanup_stale_driver_chrome() -> None:
    """Đóng các Chrome ngầm còn sót từ lần chạy Gateway trước và xóa profile tạm của chúng.

    Bản vá Windows trong muse2api tạo một profile tạm mới (cdp_*) cho mỗi lần khởi động; khi
    cửa sổ Gateway bị tắt ngang, Chrome cũ không được đóng nên vừa chiếm RAM vừa để lại hàng
    trăm MB profile. Gọi hàm này TRƯỚC khi Gateway mới khởi động.
    """
    import shutil
    import subprocess
    import tempfile

    base = Path(os.getenv("LOCALAPPDATA", tempfile.gettempdir())) / "MuseVideoStudio" / "profiles"
    if os.name == "nt":
        needle = str(base).replace("'", "''")
        script = (
            "Get-CimInstance Win32_Process | Where-Object { "
            "($_.Name -eq 'chrome.exe' -or $_.Name -eq 'msedge.exe') -and "
            f"$_.CommandLine -like '*--user-data-dir={needle}\cdp_*' }} | "
            "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
        )
        try:
            subprocess.run(["powershell", "-NoProfile", "-Command", script], timeout=30,
                           capture_output=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except (OSError, subprocess.SubprocessError):
            pass
    if base.is_dir():
        for child in base.glob("cdp_*"):
            shutil.rmtree(child, ignore_errors=True)
