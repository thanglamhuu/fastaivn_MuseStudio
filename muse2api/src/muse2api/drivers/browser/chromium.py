"""Chromium process management."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import shutil
from pathlib import Path

import httpx

log = logging.getLogger(__name__)

_CANDIDATES = (
    "chromium",
    "chromium-browser",
    "google-chrome",
    "google-chrome-stable",
    "/usr/bin/chromium",
    "/snap/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
)


def find_chromium(configured: str = "") -> str:
    for c in ((configured,) if configured else ()) + _CANDIDATES:
        if c and (os.path.isfile(c) or shutil.which(c)):
            return c
    raise FileNotFoundError(
        "Chromium/Chrome not found; install it or set MUSE2API_CHROMIUM_PATH"
    )


class ChromiumProcess:
    def __init__(self, executable: str, port: int, profile_dir: Path, headless: bool = True,
                 proxy: str = ""):
        self.executable = executable
        self.port = port
        self.profile_dir = profile_dir
        self.headless = headless
        self.proxy = proxy
        self.proc: asyncio.subprocess.Process | None = None

    @property
    def http_base(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    async def browser_ws_url(self) -> str | None:
        try:
            # Local DevTools port must not follow http_proxy/https_proxy.
            async with httpx.AsyncClient(timeout=2, trust_env=False) as client:
                r = await client.get(f"{self.http_base}/json/version")
                return r.json().get("webSocketDebuggerUrl")
        except (httpx.HTTPError, ValueError):
            return None

    async def start(self) -> str:
        """Start (or attach to an already running) Chromium; return the browser ws URL."""
        if url := await self.browser_ws_url():
            log.info("attached to existing Chromium on port %s", self.port)
            return url

        self.profile_dir.mkdir(parents=True, exist_ok=True)
        for lock in ("SingletonLock", "SingletonSocket", "SingletonCookie"):
            with contextlib.suppress(FileNotFoundError):
                (self.profile_dir / lock).unlink()

        args = [
            self.executable,
            f"--remote-debugging-port={self.port}",
            "--remote-allow-origins=*",
            f"--user-data-dir={self.profile_dir}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-dev-shm-usage",
            "--disable-background-networking",
            "--autoplay-policy=no-user-gesture-required",
            "--window-size=1440,2200",
            "about:blank",
        ]
        if self.proxy:
            args.insert(1, f"--proxy-server={self.proxy}")
        if self.headless:
            args[1:1] = ["--headless=new", "--disable-gpu"]
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            args.insert(1, "--no-sandbox")

        log.info("launching Chromium: %s", self.executable)
        self.proc = await asyncio.create_subprocess_exec(
            *args, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
        )
        for _ in range(60):
            if url := await self.browser_ws_url():
                return url
            if self.proc.returncode is not None:
                break
            await asyncio.sleep(0.5)
        raise RuntimeError("Chromium did not expose a DevTools endpoint")

    async def stop(self) -> None:
        if self.proc and self.proc.returncode is None:
            self.proc.terminate()
            try:
                await asyncio.wait_for(self.proc.wait(), 10)
            except asyncio.TimeoutError:
                self.proc.kill()
        self.proc = None



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
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            _os.path.join(local_app, r"Google\Chrome\Application\chrome.exe"),
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
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
