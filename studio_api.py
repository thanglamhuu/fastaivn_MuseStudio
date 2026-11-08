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

    @property
    def finished(self) -> bool:
        return self.status in ("succeeded", "failed", "cancelled")

    def view(self) -> dict[str, Any]:
        return {"id": self.id, "account_id": self.account_id, "label": self.label,
                "status": self.status, "message": self.message,
                "result_account_id": self.result_account_id, "created_at": self.created_at}


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
    await svc.pool.upsert(acc)
    return acc


async def _run_login(app: FastAPI, job: LoginJob) -> None:
    svc = app.state.services
    settings = svc.settings
    # Phải là đường dẫn TUYỆT ĐỐI: data_dir mặc định là "data" (tương đối). Chrome trên Windows
    # không nhận --user-data-dir tương đối, rơi về profile mặc định, chuyển trang sang Chrome
    # đang mở của người dùng rồi thoát ngay -> không còn cửa sổ nào để đọc cookie.
    profile = (Path(settings.data_dir) / "login-profiles" / job.id).resolve()
    cdp: CDPSession | None = None
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


@router.post("/login")
async def start_login(body: LoginStart, request: Request) -> dict:
    svc = request.app.state.services
    if body.account_id and svc.pool.get(body.account_id) is None:
        raise NotFound(f"account '{body.account_id}' not found")
    # Mỗi lúc chỉ một cửa sổ đăng nhập để người dùng không bị rối
    for job in _jobs.values():
        if not job.finished:
            raise InvalidRequest("Đang có một cửa sổ đăng nhập mở. Hãy hoàn tất hoặc hủy nó trước.")
    job = LoginJob(id="login_" + uuid.uuid4().hex[:10], account_id=body.account_id, label=body.label)
    _jobs[job.id] = job
    job.task = asyncio.create_task(_run_login(request.app, job))
    return job.view()


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
    }


class StudioAccountUpdate(BaseModel):
    label: str | None = None
    enabled: bool | None = None
    max_concurrency: int | None = Field(default=None, ge=1, le=16)
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
