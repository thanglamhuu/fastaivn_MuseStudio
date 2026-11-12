"""API riêng của MuseStudio, gắn thêm vào app muse2api (xem gateway_server.py / app_launcher.py).

- POST /studio/login                 mở cửa sổ Chrome thật để người dùng đăng nhập muse.ai;
                                     khi đăng nhập xong tự lấy cookie, lưu tài khoản và đóng Chrome.
- GET  /studio/login/{job_id}        trạng thái phiên đăng nhập
- POST /studio/login/{job_id}/cancel hủy và đóng Chrome
- GET  /studio/accounts              danh sách tài khoản kèm số luồng đang chạy / giới hạn luồng
- PATCH /studio/accounts/{id}        đổi tên, bật/tắt, số luồng riêng, dán cookie mới
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import shutil
import socket
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, Depends, FastAPI, Request
from pydantic import BaseModel, Field

from muse2api.accounts.model import Account, AccountStatus
from muse2api.accounts.pool import kind_blocks, quota_exhausted
from muse2api.api.deps import require_admin_key
from muse2api.api.routes.admin import parse_cookies
from muse2api.drivers.browser.cdp import CDPSession
from websockets.asyncio.client import connect as ws_connect
from muse2api.drivers.browser.chromium import find_chromium
from muse2api.errors import InvalidRequest, NotFound, UpstreamAuthError, UpstreamError
from muse2api.upstream.muse import SITE, missing_session_cookies, renew_session
from studio_emaillogin import (BrowserInbox, EmailLogin, FallbackInbox, HttpInbox, LoginPage, auto_login,
                              default_inbox_url, parse_lines)

log = logging.getLogger("musestudio.login")

router = APIRouter(prefix="/studio", tags=["studio"], dependencies=[Depends(require_admin_key)])

LOGIN_TIMEOUT_S = 10 * 60
COOKIE_POLL_S = 2.0
VERIFY_EVERY_S = 6.0


# ---------------------------------------------------------------- login jobs
@dataclass
class LoginJob:
    id: str
    account_id: str | None
    label: str
    status: str = "starting"  # starting | waiting | verifying | succeeded | failed | cancelled
    message: str = "Đang mở trình duyệt..."
    result_account_id: str | None = None
    created_at: float = field(default_factory=time.time)
    task: asyncio.Task | None = None
    proc: asyncio.subprocess.Process | None = None
    # Đăng nhập tự động bằng email + mã OTP đọc từ hộp thư (studio_emaillogin); rỗng = người dùng tự đăng nhập
    email: str = ""
    inbox_url: str = ""

    @property
    def finished(self) -> bool:
        return self.status in ("succeeded", "failed", "cancelled")

    def view(self) -> dict[str, Any]:
        return {"id": self.id, "account_id": self.account_id, "label": self.label,
                "status": self.status, "message": self.message, "email": self.email,
                "result_account_id": self.result_account_id, "created_at": self.created_at}


@dataclass
class LoginBatch:
    """Nhiều tài khoản email | hộp thư: đăng nhập LẦN LƯỢT (mỗi lúc một cửa sổ Chrome)."""
    id: str
    job_ids: list[str]
    task: asyncio.Task | None = None

    def view(self) -> dict[str, Any]:
        jobs = [_jobs[j].view() for j in self.job_ids if j in _jobs]
        done = all(j["status"] in ("succeeded", "failed", "cancelled") for j in jobs)
        return {"id": self.id, "finished": done, "jobs": jobs,
                "succeeded": sum(j["status"] == "succeeded" for j in jobs),
                "failed": sum(j["status"] in ("failed", "cancelled") for j in jobs)}


_batches: dict[str, LoginBatch] = {}


_jobs: dict[str, LoginJob] = {}


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def _browser_ws(port: int, proc: asyncio.subprocess.Process) -> str:
    async with httpx.AsyncClient(timeout=2, trust_env=False) as client:
        for _ in range(60):
            if proc.returncode is not None:
                raise RuntimeError("Chrome thoát ngay khi khởi động")
            with contextlib.suppress(httpx.HTTPError, ValueError):
                r = await client.get(f"http://127.0.0.1:{port}/json/version")
                if ws := r.json().get("webSocketDebuggerUrl"):
                    return ws.replace("localhost", "127.0.0.1")
            await asyncio.sleep(0.5)
    raise RuntimeError("Chrome không mở cổng DevTools sau 30 giây")


async def _read_muse_cookies(cdp: CDPSession) -> tuple[dict[str, str], dict[str, int]]:
    res = await cdp.send("Storage.getCookies", timeout=10)
    cookies: dict[str, str] = {}
    expires: dict[str, int] = {}
    for c in res.get("cookies", []):
        domain = str(c.get("domain", "")).lstrip(".")
        if domain == "muse.ai" or domain.endswith(".muse.ai"):
            if c.get("value"):
                cookies[c["name"]] = c["value"]
                if (exp := c.get("expires")) and exp > 0:
                    expires[c["name"]] = int(exp)
    return cookies, expires


async def _save_account(app: FastAPI, job: LoginJob, cookies: dict[str, str],
                        expires: dict[str, int]) -> Account:
    svc = app.state.services
    acc = svc.pool.get(job.account_id) if job.account_id else None
    if acc is None:
        acc = Account(label=job.label or f"muse_{time.strftime('%d%m_%H%M')}")
    acc.cookies = {k: v for k, v in cookies.items() if v}
    acc.cookie_expires = {k: v for k, v in expires.items() if k in acc.cookies}
    acc.status = AccountStatus.ACTIVE
    acc.cooldown_until = 0.0
    acc.last_error = None
    acc.enabled = True
    acc.meta["logged_in_at"] = time.time()
    if job.email:
        # Nhớ email + hộp thư để nút "Đăng nhập lại" tự lấy mã lần sau
        acc.meta["email"] = job.email
        acc.meta["inbox_url"] = job.inbox_url
    await svc.pool.upsert(acc)
    return acc


async def _page_ws(port: int) -> str:
    """websocket DevTools của tab trang (muse.ai) trong cửa sổ đăng nhập."""
    async with httpx.AsyncClient(timeout=3, trust_env=False) as client:
        for _ in range(40):
            with contextlib.suppress(httpx.HTTPError, ValueError):
                pages = [t for t in (await client.get(f"http://127.0.0.1:{port}/json/list")).json()
                         if t.get("type") == "page" and t.get("webSocketDebuggerUrl")]
                if pages:
                    return pages[0]["webSocketDebuggerUrl"].replace("localhost", "127.0.0.1")
            await asyncio.sleep(0.5)
    raise RuntimeError("không thấy tab trang đăng nhập")


async def _run_auto(job: LoginJob, port: int) -> None:
    """Gõ email / mã OTP lấy từ hộp thư. Lỗi thì để người dùng hoàn tất bằng tay trong cửa sổ đang mở."""
    page_cdp: CDPSession | None = None

    def report(msg: str) -> None:
        if job.status in ("starting", "waiting"):
            job.message = msg

    async def open_tab(url: str) -> CDPSession:
        # Tab phụ trong CHÍNH cửa sổ đăng nhập để đọc hộp thư: trình duyệt thật không bị generator.email chặn
        # như httpx (đo 12/11: httpx nhận HTTP 503 liên tục, Chrome mở bình thường)
        async with httpx.AsyncClient(timeout=10, trust_env=False) as c:
            r = await c.put(f"http://127.0.0.1:{port}/json/new?{url}")
            r.raise_for_status()
            ws = r.json()["webSocketDebuggerUrl"].replace("localhost", "127.0.0.1")
        return CDPSession(await ws_connect(ws, max_size=None, ping_interval=None, open_timeout=15))

    browser_inbox: BrowserInbox | None = None
    try:
        page_cdp = CDPSession(await ws_connect(await _page_ws(port), max_size=None,
                                               ping_interval=None, open_timeout=15))
        async with httpx.AsyncClient(timeout=20, trust_env=False) as client:
            browser_inbox = BrowserInbox(open_tab, job.inbox_url)
            inbox = FallbackInbox(browser_inbox, HttpInbox(client, job.inbox_url))
            await auto_login(LoginPage(page_cdp), EmailLogin(job.email, job.inbox_url), report,
                             client=client, inbox=inbox)
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001
        log.warning("auto login %s (%s) dừng: %s", job.id, job.email, exc)
        report(f"{job.email}: tự động chưa xong ({exc}) — hãy hoàn tất bằng tay trong cửa sổ Chrome.")
    finally:
        if browser_inbox is not None:
            await browser_inbox.close()
        if page_cdp is not None:
            await page_cdp.close()


async def _run_login(app: FastAPI, job: LoginJob) -> None:
    svc = app.state.services
    settings = svc.settings
    # Phải là đường dẫn TUYỆT ĐỐI: data_dir mặc định là "data" (tương đối). Chrome trên Windows
    # không nhận --user-data-dir tương đối, rơi về profile mặc định, chuyển trang sang Chrome
    # đang mở của người dùng rồi thoát ngay -> không còn cửa sổ nào để đọc cookie.
    profile = (Path(settings.data_dir) / "login-profiles" / job.id).resolve()
    cdp: CDPSession | None = None
    auto_task: asyncio.Task | None = None
    try:
        exe = find_chromium(settings.chromium_path or os.environ.get("MUSE2API_CHROMIUM_PATH", ""))
        port = _free_port()
        profile.mkdir(parents=True, exist_ok=True)
        # Cửa sổ thật (không headless), profile trắng riêng cho mỗi lần đăng nhập để
        # đăng nhập được tài khoản khác nhau và không đụng tới Chrome cá nhân.
        job.proc = await asyncio.create_subprocess_exec(
            exe,
            f"--remote-debugging-port={port}",
            "--remote-allow-origins=*",
            f"--user-data-dir={profile}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-sync",
            "--window-size=1100,860",
            # Chế độ cửa sổ ứng dụng: không thanh địa chỉ / tab, trông như một phần của app
            f"--app={SITE}",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        # Kết nối websocket trực tiếp, KHÔNG qua CDPSession.connect: bản vá Windows trong
        # cdp.py ghi nhớ cổng DevTools của lần connect "browser" gần nhất và sẽ chuyển
        # hướng các tab của driver chính sang Chrome đăng nhập này.
        ws = await ws_connect(await _browser_ws(port, job.proc), max_size=None,
                              ping_interval=None, open_timeout=15)
        cdp = CDPSession(ws)
        job.status, job.message = "waiting", "Hãy đăng nhập muse.ai trong cửa sổ Chrome vừa mở..."
        if job.email:
            auto_task = asyncio.create_task(_run_auto(job, port))

        deadline = time.monotonic() + LOGIN_TIMEOUT_S
        last_verified_sess, last_verify_at = None, 0.0
        while time.monotonic() < deadline:
            await asyncio.sleep(COOKIE_POLL_S)
            if job.proc.returncode is not None:
                job.status, job.message = "failed", "Cửa sổ Chrome đã bị đóng trước khi đăng nhập xong."
                return
            try:
                cookies, expires = await _read_muse_cookies(cdp)
            except Exception:  # noqa: BLE001  (trang đang chuyển hướng, thử lại)
                continue
            if missing_session_cookies(cookies):
                continue
            sess = cookies["hatch_sess"]
            if sess == last_verified_sess and time.monotonic() - last_verify_at < VERIFY_EVERY_S:
                continue
            last_verified_sess, last_verify_at = sess, time.monotonic()

            job.status, job.message = "verifying", "Đã thấy cookie, đang xác minh phiên với muse.ai..."
            try:
                info = await renew_session(cookies, wake_vm=False, confirm_s=0)
            except (UpstreamAuthError, UpstreamError, httpx.HTTPError):
                job.status, job.message = "waiting", "Chưa đăng nhập xong, đang chờ..."
                continue
            if not info.ok:
                job.status, job.message = "waiting", "Chưa đăng nhập xong, đang chờ..."
                continue

            # Cookie sau khi gọi /api/session (có thể đã được xoay vòng) là bản mới nhất
            acc = await _save_account(app, job, info.cookies,
                                      {**expires, **info.cookie_expires})
            job.result_account_id = acc.id
            job.status, job.message = "succeeded", f"Đã lưu tài khoản {acc.label or acc.id}."
            return

        job.status, job.message = "failed", "Hết 10 phút chờ đăng nhập."
    except asyncio.CancelledError:
        job.status, job.message = "cancelled", "Đã hủy đăng nhập."
    except Exception as exc:  # noqa: BLE001
        log.exception("login job %s failed", job.id)
        job.status, job.message = "failed", f"Lỗi: {exc}"
    finally:
        if auto_task is not None and not auto_task.done():
            auto_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await auto_task
        if cdp is not None:
            with contextlib.suppress(Exception):
                await cdp.send("Browser.close", timeout=5)
            await cdp.close()
        if job.proc and job.proc.returncode is None:
            with contextlib.suppress(Exception):
                job.proc.terminate()
                await asyncio.wait_for(job.proc.wait(), 10)
        if job.proc and job.proc.returncode is None:
            with contextlib.suppress(Exception):
                job.proc.kill()
        # Profile chứa phiên đăng nhập: xóa ngay sau khi đã lấy cookie
        await asyncio.sleep(1.0)
        shutil.rmtree(profile, ignore_errors=True)


class LoginStart(BaseModel):
    account_id: str | None = Field(default=None, description="Đăng nhập lại cho tài khoản có sẵn")
    label: str = ""
    # Tài khoản đã lưu email + hộp thư (đăng nhập bằng email trước đó) thì tự lấy mã; false = tự đăng nhập bằng tay
    auto: bool = True


def _ensure_no_open_login() -> None:
    # Mỗi lúc chỉ một cửa sổ đăng nhập để người dùng không bị rối
    if any(not j.finished for j in _jobs.values()) or any(b.task and not b.task.done() for b in _batches.values()):
        raise InvalidRequest("Đang có một cửa sổ đăng nhập mở. Hãy hoàn tất hoặc hủy nó trước.")


@router.post("/login")
async def start_login(body: LoginStart, request: Request) -> dict:
    svc = request.app.state.services
    acc = svc.pool.get(body.account_id) if body.account_id else None
    if body.account_id and acc is None:
        raise NotFound(f"account '{body.account_id}' not found")
    _ensure_no_open_login()
    job = LoginJob(id="login_" + uuid.uuid4().hex[:10], account_id=body.account_id, label=body.label)
    if acc is not None and body.auto and acc.meta.get("email"):
        job.email = str(acc.meta["email"])
        job.inbox_url = str(acc.meta.get("inbox_url") or default_inbox_url(job.email))
    _jobs[job.id] = job
    job.task = asyncio.create_task(_run_login(request.app, job))
    return job.view()


class EmailLoginStart(BaseModel):
    text: str = Field(max_length=200_000, description="Mỗi dòng: email | link hộp thư (thiếu link = generator.email)")


def _account_by_email(svc, email: str) -> Account | None:
    email = email.lower()
    return next((a for a in svc.pool.all() if str(a.meta.get("email") or "").lower() == email
                 or (a.label or "").strip().lower() == email), None)


async def _run_batch(app: FastAPI, batch: LoginBatch) -> None:
    for jid in batch.job_ids:
        job = _jobs[jid]
        if job.finished:
            continue
        job.task = asyncio.current_task()
        cancelled = False
        try:
            await _run_login(app, job)  # tự bắt CancelledError và ghi trạng thái "cancelled"
        except asyncio.CancelledError:
            cancelled = True
        if cancelled or job.status == "cancelled":
            # Hủy cả loạt: tài khoản đang chạy + các tài khoản chưa tới lượt
            for rest in batch.job_ids:
                if not _jobs[rest].finished:
                    _jobs[rest].status, _jobs[rest].message = "cancelled", "Đã hủy đăng nhập."
            return


@router.post("/login/email")
async def start_email_login(body: EmailLoginStart, request: Request) -> dict:
    """Đăng nhập (hoặc đăng nhập lại) nhiều tài khoản bằng email + mã OTP đọc từ hộp thư, lần lượt từng tài khoản."""
    items = parse_lines(body.text)
    if not items:
        raise InvalidRequest("Không thấy email nào. Mỗi dòng dạng: email@domain | https://generator.email/email@domain")
    svc = request.app.state.services
    _ensure_no_open_login()
    ids: list[str] = []
    for it in items:
        acc = _account_by_email(svc, it.email)
        job = LoginJob(id="login_" + uuid.uuid4().hex[:10], account_id=acc.id if acc else None,
                       label=acc.label if acc else it.email, email=it.email, inbox_url=it.inbox_url,
                       status="starting", message="Đang chờ tới lượt…")
        _jobs[job.id] = job
        ids.append(job.id)
    batch = LoginBatch(id="batch_" + uuid.uuid4().hex[:10], job_ids=ids)
    _batches[batch.id] = batch
    batch.task = asyncio.create_task(_run_batch(request.app, batch))
    return batch.view()


@router.get("/login/batch/{batch_id}")
async def get_email_login(batch_id: str) -> dict:
    batch = _batches.get(batch_id)
    if batch is None:
        raise NotFound(f"login batch '{batch_id}' not found")
    return batch.view()


@router.post("/login/batch/{batch_id}/cancel")
async def cancel_email_login(batch_id: str) -> dict:
    batch = _batches.get(batch_id)
    if batch is None:
        raise NotFound(f"login batch '{batch_id}' not found")
    if batch.task and not batch.task.done():
        batch.task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await batch.task
    return batch.view()


@router.get("/login/{job_id}")
async def get_login(job_id: str) -> dict:
    job = _jobs.get(job_id)
    if job is None:
        raise NotFound(f"login job '{job_id}' not found")
    return job.view()


@router.post("/login/{job_id}/cancel")
async def cancel_login(job_id: str) -> dict:
    job = _jobs.get(job_id)
    if job is None:
        raise NotFound(f"login job '{job_id}' not found")
    if job.task and not job.task.done():
        job.task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await job.task
    return job.view()


# ---------------------------------------------------------------- accounts
def _account_view(svc, acc: Account) -> dict:
    data = acc.public()
    data["max_concurrency"] = svc.pool.limit_of(acc)
    data["inflight"] = svc.pool.inflight_of(acc.id)
    # Tài khoản bị chặn video (giới hạn ngày / theo vùng) và hết hạn mức tuần
    data["blocked"] = kind_blocks(acc)
    data["quota_exhausted"] = quota_exhausted(acc)
    return data


@router.get("/accounts")
async def list_accounts(request: Request) -> dict:
    svc = request.app.state.services
    return {
        "data": [_account_view(svc, a) for a in svc.pool.all()],
        "max_concurrency_per_account": svc.pool.max_concurrency,
        "default_concurrency_per_account": svc.pool.default_concurrency,
    }


class StudioAccountUpdate(BaseModel):
    label: str | None = None
    enabled: bool | None = None
    max_concurrency: int | None = Field(default=None, ge=1, le=16)
    # Giọng Muse dành riêng cho tài khoản (mã avocado_v2:...); "" = không dành riêng
    dedicated_voice: str | None = Field(default=None, max_length=200)
    # Chuỗi header "Cookie" copy từ F12, hoặc dict
    cookies: str | dict[str, str] | None = None


@router.patch("/accounts/{account_id}")
async def update_account(account_id: str, body: StudioAccountUpdate, request: Request) -> dict:
    svc = request.app.state.services
    acc = svc.pool.get(account_id)
    if acc is None:
        raise NotFound(f"account '{account_id}' not found")
    if body.label is not None:
        acc.label = body.label.strip()
    if body.enabled is not None:
        acc.enabled = body.enabled
    if body.max_concurrency is not None:
        acc.meta["max_concurrency"] = body.max_concurrency
    if body.dedicated_voice is not None:
        if body.dedicated_voice.strip():
            acc.meta["dedicated_voice"] = body.dedicated_voice.strip()
        else:
            acc.meta.pop("dedicated_voice", None)
    if body.cookies is not None:
        raw = body.cookies.strip() if isinstance(body.cookies, str) else body.cookies
        if isinstance(raw, str) and raw.lower().startswith("cookie:"):
            raw = raw[7:]
        cookies, _ = parse_cookies(raw)
        cookies = {k: v for k, v in cookies.items() if v}
        if missing := missing_session_cookies(cookies):
            raise InvalidRequest(f"cookie thiếu: {', '.join(missing)}")
        acc.cookies = cookies
        acc.cookie_expires = {}
        acc.status, acc.cooldown_until, acc.last_error = AccountStatus.ACTIVE, 0.0, None
    await svc.pool.upsert(acc)
    return {"account": _account_view(svc, acc)}
