"""Lấy thông tin + ảnh sản phẩm từ link Shopee / TikTok Shop / trang bán hàng bất kỳ.

POST /studio/product/scrape {"url": "..."}
  -> {"url", "title", "price", "brand", "description", "text", "images": [{"url", "source"}],
      "warning"}

Mở một cửa sổ Chrome riêng (đặt ngoài màn hình, profile tạm) qua CDP, chờ trang tải xong,
cuộn để tải ảnh lười, đọc JSON-LD / thẻ og: / ảnh lớn trên trang. Ảnh được Gateway tải về
và lưu vào kho media, nên frontend dùng được mà không vướng CORS của CDN.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import logging
import os
import re
import urllib.parse
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from websockets.asyncio.client import connect as ws_connect

from muse2api.api.deps import public_base, require_admin_key
from muse2api.drivers.browser.cdp import CDPSession
from muse2api.drivers.browser.chromium import find_chromium
from muse2api.errors import InvalidRequest, UpstreamError

log = logging.getLogger("musestudio.product")

router = APIRouter(prefix="/studio", tags=["studio"], dependencies=[Depends(require_admin_key)])

PAGE_TIMEOUT_S = 45
MAX_IMAGES = 12
MIN_IMAGE_BYTES = 8 * 1024
MAX_IMAGE_BYTES = 12 * 1024 * 1024
USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/140.0.0.0 Safari/537.36")

# Chạy trong trang sản phẩm: trả về tiêu đề, giá, mô tả, danh sách ảnh (lớn trước) và chữ trên trang.
EXTRACT_JS = r"""
(() => {
  const meta = (n) => (document.querySelector(`meta[property="${n}"],meta[name="${n}"]`) || {}).content || '';
  const ld = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    try { const j = JSON.parse(s.textContent); (Array.isArray(j) ? j : [j]).forEach((x) => ld.push(x)); } catch (e) {}
  });
  const nodes = ld.flatMap((x) => (x && x['@graph']) || [x]).filter(Boolean);
  const product = nodes.find((x) => /Product/i.test(String(x['@type']))) || {};
  const imgs = new Map();
  // Ảnh trong vùng đầu trang (thư viện ảnh sản phẩm) được ưu tiên hơn ảnh "sản phẩm gợi ý" bên dưới,
  // kể cả ảnh nhỏ (thumbnail của thư viện ảnh, sẽ được đổi sang ảnh gốc ở phía Python).
  const TOP_ZONE = 1100;
  const add = (u, w) => {
    if (!u || typeof u !== 'string' || u.startsWith('data:')) return;
    try { u = new URL(u, location.href).href; } catch (e) { return; }
    imgs.set(u, Math.max(imgs.get(u) || 0, w || 0));
  };
  [].concat(product.image || []).forEach((i) => add(typeof i === 'string' ? i : i && i.url, 99999));
  add(meta('og:image'), 90000);
  document.querySelectorAll('img').forEach((im) => {
    const r = im.getBoundingClientRect();
    const w = Math.max(im.naturalWidth || 0, r.width || 0);
    const top = r.top + window.scrollY;
    const inTop = top < TOP_ZONE && r.width > 0;
    if (w >= 250 || (inTop && w >= 60)) add(im.currentSrc || im.src, (inTop ? 50000 : 0) + w);
  });
  document.querySelectorAll('[style*="background-image"]').forEach((el) => {
    const m = (el.style.backgroundImage || '').match(/url\(["']?(.*?)["']?\)/);
    const r = el.getBoundingClientRect();
    const inTop = r.top + window.scrollY < TOP_ZONE;
    if (m && (r.width >= 200 || (inTop && r.width >= 60))) add(m[1], (inTop ? 50000 : 0) + r.width);
  });
  const offer = product.offers ? [].concat(product.offers)[0] || {} : {};
  const brand = product.brand ? (product.brand.name || product.brand) : '';
  const main = document.querySelector('main') || document.body;
  return {
    url: location.href,
    // Bỏ tiêu đề chung của sàn ("Shopee Việt Nam | Mua và Bán..."): khi đó để trống, AI tự lấy tên từ chữ trên trang
    title: (() => {
      const generic = /mua và bán|mua sắm online|shopee việt nam|^tiktok/i;
      const h1 = ((document.querySelector('h1') || {}).innerText || '').trim();
      const cands = [product.name, h1, meta('og:title'), document.title].map((x) => (x || '').trim());
      return cands.find((x) => x.length > 3 && !generic.test(x)) || '';
    })(),
    description: product.description || meta('og:description') || meta('description') || '',
    price: offer.price ? `${offer.price} ${offer.priceCurrency || ''}`.trim() : '',
    brand: typeof brand === 'string' ? brand : '',
    images: [...imgs.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]).slice(0, 40),
    text: (main.innerText || '').replace(/\n{3,}/g, '\n\n').slice(0, 6000),
  };
})()
"""

SCROLL_JS = """
(async () => {
  for (let i = 0; i < 6; i++) { window.scrollBy(0, Math.round(innerHeight * 0.9)); await new Promise(r => setTimeout(r, 400)); }
  window.scrollTo(0, 0);
  return document.readyState;
})()
"""

# Profile Chrome CỐ ĐỊNH cho việc đọc trang bán hàng: người dùng đăng nhập Shopee/TikTok một lần
# (nút "Đăng nhập Shopee"), các lần đọc link sau dùng lại phiên đó. Mỗi lúc chỉ một Chrome dùng profile.
_profile_lock = asyncio.Lock()
_login_proc: asyncio.subprocess.Process | None = None

LOGIN_URLS = {
    "shopee": "https://shopee.vn/buyer/login",
    "tiktok": "https://www.tiktok.com/login",
}


def _shop_profile(data_dir: Path) -> Path:
    p = (data_dir / "shop-profile").resolve()
    p.mkdir(parents=True, exist_ok=True)
    return p


def _reset_window_placement(profile: Path) -> None:
    """Chrome nhớ vị trí cửa sổ cuối cùng trong profile. Lần đọc trang đặt cửa sổ ngoài màn hình
    (-32000) nên cửa sổ đăng nhập mở sau đó cũng bị ra ngoài màn hình -> trông như tự ẩn."""
    prefs = profile / "Default" / "Preferences"
    if not prefs.is_file():
        return
    try:
        data = json.loads(prefs.read_text(encoding="utf-8"))
        browser = data.get("browser") or {}
        changed = browser.pop("window_placement", None) is not None
        changed |= browser.pop("app_window_placement", None) is not None
        if changed:
            prefs.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    except (OSError, ValueError):
        log.warning("could not reset window placement in %s", prefs)


async def _kill_profile_chrome(profile: Path) -> None:
    """Đóng mọi Chrome/Edge còn chạy với profile này. Nếu còn sót, lệnh mở mới sẽ bị gộp vào
    tiến trình cũ (có thể đang ẩn ngoài màn hình) thay vì mở cửa sổ riêng."""
    if os.name != "nt":
        return
    needle = str(profile).replace("'", "''")
    script = (
        "Get-CimInstance Win32_Process | Where-Object { "
        "($_.Name -eq 'chrome.exe' -or $_.Name -eq 'msedge.exe') -and "
        f"$_.CommandLine -like '*--user-data-dir={needle}*' }} | "
        "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
    )
    with contextlib.suppress(Exception):
        proc = await asyncio.create_subprocess_exec(
            "powershell", "-NoProfile", "-Command", script,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
        await asyncio.wait_for(proc.wait(), 20)
    await asyncio.sleep(0.8)  # chờ Chrome nhả khóa profile


def _site_of(url: str) -> str:
    u = url.lower()
    if "shopee" in u or "shp.ee" in u:
        return "shopee"
    if "tiktok" in u:
        return "tiktok"
    return ""


_LOGIN_HINTS = ("đăng nhập", "dang nhap", "log in", "login", "sign in", "verify", "captcha", "xác minh")


def _full_size(url: str) -> str:
    """Ảnh thu nhỏ của Shopee kết thúc bằng _tn / @resize: bỏ đi để lấy ảnh gốc."""
    if "susercontent.com" in url or "shopee" in url:
        url = re.sub(r"_tn(?=$|[?#])", "", url)
        url = re.sub(r"@resize_w\d+_nl", "", url)
    return url


def _free_port() -> int:
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def _page_ws(port: int, proc: asyncio.subprocess.Process) -> str:
    async with httpx.AsyncClient(timeout=2, trust_env=False) as client:
        for _ in range(60):
            if proc.returncode is not None:
                raise UpstreamError("Chrome thoát ngay khi khởi động")
            with contextlib.suppress(httpx.HTTPError, ValueError):
                pages = (await client.get(f"http://127.0.0.1:{port}/json/list")).json()
                for p in pages:
                    if p.get("type") == "page" and p.get("webSocketDebuggerUrl"):
                        return p["webSocketDebuggerUrl"].replace("localhost", "127.0.0.1")
            await asyncio.sleep(0.5)
    raise UpstreamError("Chrome không mở cổng DevTools sau 30 giây")


USER_VERIFY_TIMEOUT_S = 240
_GATE_MARKERS = ("/verify/", "/buyer/login", "/login", "captcha")
_scrape_status: dict = {"busy": False, "message": "", "waiting_user": False}


def _set_status(message: str, waiting_user: bool = False) -> None:
    _scrape_status.update(message=message, waiting_user=waiting_user)


def _is_gate(url: str) -> bool:
    return any(m in (url or "").lower() for m in _GATE_MARKERS)


async def _current_url(cdp: CDPSession) -> str:
    return str(await cdp.evaluate("location.href", timeout=10) or "")


async def _settled_url(cdp: CDPSession, settle_s: float = 6.0) -> str:
    """URL sau khi trang thôi chuyển hướng: theo dõi vài giây, gặp trang chặn thì trả về ngay."""
    end = asyncio.get_running_loop().time() + settle_s
    url = ""
    while True:
        with contextlib.suppress(Exception):
            url = await _current_url(cdp)
        if _is_gate(url) or asyncio.get_running_loop().time() >= end:
            return url
        await asyncio.sleep(0.75)


async def _wait_loaded(cdp: CDPSession) -> None:
    deadline = asyncio.get_running_loop().time() + PAGE_TIMEOUT_S
    while asyncio.get_running_loop().time() < deadline:
        await asyncio.sleep(1.0)
        with contextlib.suppress(Exception):
            if await cdp.evaluate("document.readyState") == "complete":
                return


async def _show_window(cdp: CDPSession) -> None:
    """Đưa cửa sổ đang ẩn ngoài màn hình ra giữa màn hình và lên trước."""
    with contextlib.suppress(Exception):
        win = await cdp.send("Browser.getWindowForTarget", timeout=10)
        await cdp.send("Browser.setWindowBounds", {"windowId": win["windowId"],
                                                   "bounds": {"windowState": "normal"}}, timeout=10)
        await cdp.send("Browser.setWindowBounds", {
            "windowId": win["windowId"],
            "bounds": {"left": 80, "top": 40, "width": 1100, "height": 860}}, timeout=10)
    with contextlib.suppress(Exception):
        await cdp.send("Page.bringToFront", timeout=10)


async def _open_and_extract(url: str, data_dir: Path, chromium_path: str) -> dict:
    if _login_proc is not None and _login_proc.returncode is None:
        raise InvalidRequest("Cửa sổ đăng nhập Shopee/TikTok đang mở. Đăng nhập xong hãy đóng nó rồi thử lại.")
    async with _profile_lock:
        _scrape_status.update(busy=True, message="", waiting_user=False)
        try:
            return await _open_and_extract_locked(url, data_dir, chromium_path)
        finally:
            _scrape_status.update(busy=False, message="", waiting_user=False)


async def _open_and_extract_locked(url: str, data_dir: Path, chromium_path: str) -> dict:
    exe = find_chromium(chromium_path or os.environ.get("MUSE2API_CHROMIUM_PATH", ""))
    port = _free_port()
    profile = _shop_profile(data_dir)
    await _kill_profile_chrome(profile)  # Chrome còn sót sẽ nuốt lệnh mở mới
    # Cửa sổ thật nhưng đặt ngoài màn hình: trang bán hàng chặn Chrome headless mạnh hơn.
    proc = await asyncio.create_subprocess_exec(
        exe, f"--remote-debugging-port={port}", "--remote-allow-origins=*",
        f"--user-data-dir={profile}", "--no-first-run", "--no-default-browser-check",
        "--disable-sync", "--window-position=-32000,-32000", "--window-size=1280,900",
        "--lang=vi-VN", "about:blank",
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
    )
    cdp: CDPSession | None = None
    try:
        ws = await ws_connect(await _page_ws(port, proc), max_size=None, ping_interval=None,
                              open_timeout=15)
        cdp = CDPSession(ws)
        await cdp.send("Page.enable")
        _set_status("Đang mở trang sản phẩm...")
        await cdp.send("Page.navigate", {"url": url}, timeout=30)
        await _wait_loaded(cdp)

        # Shopee/TikTok hay chặn bằng trang đăng nhập hoặc captcha, thường chuyển hướng bằng JS vài
        # giây SAU khi trang đã tải xong. App KHÔNG tự giải: đưa cửa sổ ra giữa màn hình để người
        # dùng tự đăng nhập / kéo captcha, chờ tới khi qua được rồi đọc tiếp. Kiểm tra lại vài lần
        # vì sau đăng nhập có thể bị chuyển tiếp sang captcha.
        for _round in range(3):
            current = await _settled_url(cdp)
            if not _is_gate(current):
                break
            await _show_window(cdp)
            _set_status("Trang bán hàng yêu cầu xác minh: hãy đăng nhập / kéo captcha trong cửa sổ Chrome "
                        "vừa hiện. Xong app sẽ tự đọc tiếp (chờ tối đa 4 phút).", waiting_user=True)
            deadline = asyncio.get_running_loop().time() + USER_VERIFY_TIMEOUT_S
            while asyncio.get_running_loop().time() < deadline:
                await asyncio.sleep(1.5)
                if proc.returncode is not None:
                    raise UpstreamError("Cửa sổ xác minh đã bị đóng trước khi xong.")
                with contextlib.suppress(Exception):
                    current = await _current_url(cdp)
                if not _is_gate(current):
                    break
            else:
                break  # hết thời gian chờ: đọc trang hiện tại (sẽ báo needs_login)
            _set_status("Đã qua bước xác minh, đang mở lại sản phẩm...")
            path = urllib.parse.urlparse(current).path
            if path in ("", "/") or "/buyer/" in current:
                # Đăng nhập xong Shopee hay quay về trang chủ: mở lại link sản phẩm
                await cdp.send("Page.navigate", {"url": url}, timeout=30)
            await _wait_loaded(cdp)

        _set_status("Đang đọc ảnh và thông tin sản phẩm...")
        await asyncio.sleep(1.5)  # trang SPA (Shopee/TikTok) còn tải dữ liệu sau "complete"
        with contextlib.suppress(Exception):
            await cdp.evaluate(SCROLL_JS, await_promise=True, timeout=20)
        await asyncio.sleep(1.5)
        return await cdp.evaluate(EXTRACT_JS, timeout=20) or {}
    finally:
        if cdp is not None:
            with contextlib.suppress(Exception):
                await cdp.send("Browser.close", timeout=5)
            await cdp.close()
        if proc.returncode is None:
            with contextlib.suppress(Exception):
                await asyncio.wait_for(proc.wait(), 10)
        if proc.returncode is None:
            with contextlib.suppress(Exception):
                proc.kill()
        # Không để vị trí "ngoài màn hình" lưu lại cho lần mở cửa sổ đăng nhập sau
        _reset_window_placement(profile)


async def _download_images(urls: list[str], referer: str, svc, base: str) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    headers = {"User-Agent": USER_AGENT, "Referer": referer,
               "Accept": "image/avif,image/webp,image/png,image/jpeg,*/*"}
    async with httpx.AsyncClient(timeout=20, headers=headers, follow_redirects=True) as client:
        sem = asyncio.Semaphore(6)

        async def fetch(u: str):
            async with sem:
                try:
                    r = await client.get(u)
                except httpx.HTTPError:
                    return None
                mime = r.headers.get("content-type", "").split(";")[0].strip().lower()
                if r.status_code != 200 or not mime.startswith("image/") or mime == "image/svg+xml":
                    return None
                if not (MIN_IMAGE_BYTES <= len(r.content) <= MAX_IMAGE_BYTES):
                    return None
                return u, r.content, mime

        results = await asyncio.gather(*(fetch(_full_size(u)) for u in urls))
    for item in results:
        if not item:
            continue
        u, data, mime = item
        digest = hashlib.sha1(data).hexdigest()
        if digest in seen:
            continue
        seen.add(digest)
        # Lưu dạng jpg/png/webp; avif để nguyên, trình duyệt hiện đại đều xem được
        name = svc.media.save(data, mime, prefix="prd")
        out.append({"url": f"{base}/v1/media/{name}", "source": u})
        if len(out) >= MAX_IMAGES:
            break
    return out


class ScrapeRequest(BaseModel):
    url: str = Field(min_length=8)


@router.post("/product/scrape")
async def scrape_product(body: ScrapeRequest, request: Request) -> dict:
    url = body.url.strip()
    m = re.search(r"https?://\S+", url)  # cho phép dán cả đoạn chia sẻ có chữ kèm link
    if not m:
        raise InvalidRequest("Link không hợp lệ (cần bắt đầu bằng http:// hoặc https://)")
    url = m.group(0).rstrip(").,;")
    svc = request.app.state.services
    data = await _open_and_extract(url, Path(svc.settings.data_dir), svc.settings.chromium_path)
    images = await _download_images(data.get("images") or [], data.get("url") or url, svc,
                                    public_base(request))
    title = (data.get("title") or "").strip()
    final_url = (data.get("url") or url).lower()
    page_text = f"{title} {(data.get('text') or '')[:400]}".lower()
    site = _site_of(final_url) or _site_of(url)
    needs_login = not images and (
        "/verify/" in final_url or "/login" in final_url or any(h in page_text for h in _LOGIN_HINTS))
    warning = ""
    if needs_login:
        warning = (f"{site.capitalize() or 'Trang'} yêu cầu đăng nhập / xác minh. Bấm 'Đăng nhập "
                   f"{site.capitalize() or 'trang bán'}' một lần rồi đọc lại link, hoặc dùng 'Tự nhập SP'.")
    elif not images:
        warning = "Không tìm thấy ảnh sản phẩm trên trang. Có thể tải ảnh lên thủ công."
    return {
        "url": data.get("url") or url,
        "title": title,
        "price": data.get("price") or "",
        "brand": data.get("brand") or "",
        "description": (data.get("description") or "").strip()[:3000],
        "text": data.get("text") or "",
        "images": images,
        "warning": warning,
        "needs_login": needs_login,
        "site": site,
    }


class ShopLoginRequest(BaseModel):
    site: str = Field(pattern="^(shopee|tiktok)$")


@router.post("/product/login")
async def open_shop_login(body: ShopLoginRequest, request: Request) -> dict:
    """Mở cửa sổ Chrome (profile cố định) để người dùng đăng nhập Shopee/TikTok, người dùng tự đóng khi xong."""
    global _login_proc
    if _profile_lock.locked():
        raise InvalidRequest("Đang đọc một link sản phẩm, thử lại sau vài giây.")
    svc = request.app.state.services
    exe = find_chromium(svc.settings.chromium_path or os.environ.get("MUSE2API_CHROMIUM_PATH", ""))
    profile = _shop_profile(Path(svc.settings.data_dir))
    # Bấm lại khi cửa sổ cũ còn mở (có thể đang nằm ngoài màn hình): đóng hết rồi mở lại
    if _login_proc is not None and _login_proc.returncode is None:
        with contextlib.suppress(Exception):
            _login_proc.terminate()
            await asyncio.wait_for(_login_proc.wait(), 5)
    await _kill_profile_chrome(profile)
    _reset_window_placement(profile)
    _login_proc = await asyncio.create_subprocess_exec(
        exe, f"--user-data-dir={profile}", "--no-first-run", "--no-default-browser-check",
        "--disable-sync", "--window-position=80,40", "--window-size=1100,860", "--lang=vi-VN",
        "--new-window", LOGIN_URLS[body.site],
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
    )
    return {"open": True}


@router.get("/product/login")
async def shop_login_state() -> dict:
    return {"open": _login_proc is not None and _login_proc.returncode is None}


@router.get("/product/status")
async def scrape_status() -> dict:
    """Tiến trình đọc link (để giao diện báo khi cần người dùng kéo captcha / đăng nhập)."""
    return dict(_scrape_status)
