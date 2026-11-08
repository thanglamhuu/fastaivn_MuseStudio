# I:\AiFast\MUSE\srcs\MuseVideoStudio\repair_muse.py
import subprocess
from pathlib import Path

muse_dir = Path("muse2api")
browser_dir = muse_dir / "src" / "muse2api" / "drivers" / "browser"
chromium_file = browser_dir / "chromium.py"
cdp_file = browser_dir / "cdp.py"

if not browser_dir.exists():
    print(f"[LOI] Không tìm thấy thư mục: {browser_dir.resolve()}")
    raise SystemExit(1)

# 1. Khôi phục 100% file chromium.py và cdp.py nguyên bản từ Git của muse2api
print("[1/3] Đang khôi phục chromium.py và cdp.py nguyên bản từ Git...")
subprocess.run(["git", "checkout", "--", "."], cwd=str(muse_dir), check=True)

# Xóa các file .bak cũ nếu có
for bak in browser_dir.glob("*.bak"):
    bak.unlink(missing_ok=True)

# 2. Vá nhẹ cdp.py: Giữ nguyên 100% class CDPSession gốc, chỉ đồng bộ host:port của WebSocket
cdp_code = cdp_file.read_text(encoding="utf-8")
cdp_patch = '''

# === WINDOWS WS ORIGIN SYNC PATCH ===
import re as _re

_ACTIVE_WS_ORIGIN: str | None = None
_orig_cdp_connect = CDPSession.connect

async def _patched_cdp_connect(cls, ws_url: str, *args, **kwargs):
    global _ACTIVE_WS_ORIGIN
    if ws_url:
        ws_url = ws_url.replace("localhost", "127.0.0.1").replace("[::1]", "127.0.0.1")
        m = _re.match(r"^(ws://127\\.0\\.0\\.1:\\d+)", ws_url)
        if "/devtools/browser/" in ws_url and m:
            _ACTIVE_WS_ORIGIN = m.group(1)
        elif _ACTIVE_WS_ORIGIN and "/devtools/" in ws_url:
            ws_url = _re.sub(r"^ws://[^/]+", _ACTIVE_WS_ORIGIN, ws_url)
    return await _orig_cdp_connect.__func__(cls, ws_url, *args, **kwargs)

CDPSession.connect = classmethod(_patched_cdp_connect)
'''

cdp_file.write_text(cdp_code + "\n" + cdp_patch, encoding="utf-8")
print("[2/3] Đã gắn bộ đồng bộ cổng WebSocket vào cdp.py (giữ nguyên toàn bộ hàm gốc).")

# 3. Vá nhẹ chromium.py: Giữ nguyên 100% ChromiumProcess.__init__ gốc, chỉ bọc hàm start() cho Windows
chromium_code = chromium_file.read_text(encoding="utf-8")
chromium_patch = '''

# === WINDOWS CHROMIUM START PATCH ===
import asyncio as _asyncio
import json as _json
import os as _os
import socket as _socket
import tempfile as _tempfile
import urllib.request as _urllib_request
from pathlib import Path as _Path

_orig_find_chromium = find_chromium

def find_chromium(path: str | None = None) -> str:
    try:
        return _orig_find_chromium(path)
    except Exception:
        local_app = _os.getenv("LOCALAPPDATA", "")
        for p in (
            r"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            r"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
            _os.path.join(local_app, r"Google\\Chrome\\Application\\chrome.exe"),
            r"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
            r"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        ):
            if p and _Path(p).exists():
                return p
        raise

def _win_free_port() -> int:
    with _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]

def _win_fetch_ws(port: int) -> str | None:
    try:
        with _urllib_request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1.0) as resp:
            data = _json.loads(resp.read().decode("utf-8", errors="ignore"))
            ws = data.get("webSocketDebuggerUrl")
            if ws:
                return ws.replace("localhost", "127.0.0.1").replace("[::1]", "127.0.0.1")
    except Exception:
        return None
    return None

async def _win_chromium_start(self) -> str:
    exe = None
    for k, v in self.__dict__.items():
        if isinstance(v, (str, _Path)) and any(x in str(v).lower() for x in ("chrome", "msedge", "chromium", "brave")):
            exe = str(v)
            break
    if not exe:
        exe = find_chromium(_os.environ.get("MUSE2API_CHROMIUM_PATH"))

    # Tạo thư mục profile riêng cho mỗi phiên để không bao giờ bị lỗi code=21 (Profile in use)
    base_profile_dir = _Path(_os.getenv("LOCALAPPDATA", _tempfile.gettempdir())) / "MuseVideoStudio" / "profiles"
    base_profile_dir.mkdir(parents=True, exist_ok=True)
    profile_dir = _Path(_tempfile.mkdtemp(prefix="cdp_", dir=str(base_profile_dir)))

    port = _win_free_port()

    args = [
        exe,
        f"--remote-debugging-port={port}",
        "--remote-debugging-address=127.0.0.1",
        "--remote-allow-origins=*",
        f"--user-data-dir={profile_dir}",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-sync",
        "--disable-gpu",
        "--headless=new",
        "--window-size=1280,800",
        "about:blank",
    ]

    # Hỗ trợ proxy nếu có trong thuộc tính của self
    proxy_val = getattr(self, "proxy", None) or getattr(self, "_proxy", None)
    if proxy_val:
        args.append(f"--proxy-server={proxy_val}")

    proc = await _asyncio.create_subprocess_exec(
        *args,
        stdout=_asyncio.subprocess.DEVNULL,
        stderr=_asyncio.subprocess.PIPE,
    )

    for k in list(self.__dict__.keys()):
        if "proc" in k:
            setattr(self, k, proc)
    self._proc = proc

    for _ in range(60):
        if proc.returncode is not None:
            err = (await proc.stderr.read()).decode("utf-8", errors="ignore") if proc.stderr else ""
            raise RuntimeError(f"Chrome thoát sớm (code={proc.returncode}): {err}")

        ws_url = await _asyncio.to_thread(_win_fetch_ws, port)
        if ws_url:
            # Cập nhật đầy đủ mọi thuộc tính lưu ws_url và port trên instance gốc
            for k in list(self.__dict__.keys()):
                kl = k.lower()
                if "ws" in kl or "url" in kl or "endpoint" in kl:
                    setattr(self, k, ws_url)
                elif "port" in kl:
                    setattr(self, k, port)
            self._ws_url = ws_url
            self._port = port
            return ws_url

        await _asyncio.sleep(0.5)

    raise RuntimeError(f"Chromium không mở cổng DevTools trên 127.0.0.1:{port} sau 30 giây.")

ChromiumProcess.start = _win_chromium_start
'''

chromium_file.write_text(chromium_code + "\n" + chromium_patch, encoding="utf-8")
print("[3/3] Đã cập nhật hàm start() trong chromium.py (giữ nguyên __init__ gốc).")
print("\n✅ HOÀN TẤT! Hãy chạy lại ./run_dev.bat")