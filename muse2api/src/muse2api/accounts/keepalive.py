"""Background session keepalive.

muse.ai sessions expire unless refreshed; this loop periodically asks the active
driver to renew each account and merges refreshed cookies back into the pool.
Drivers that do not support renewal simply raise ``FeatureNotImplemented`` and
the loop skips them.
"""

from __future__ import annotations

import asyncio
import logging
import time

from ..drivers.base import MuseDriver
from ..errors import FeatureNotImplemented, UpstreamAccountBlocked, UpstreamAuthError
from .model import AccountStatus, mark_account_blocked
from .pool import AccountPool, note_wake

log = logging.getLogger(__name__)


async def renew_account(pool: AccountPool, driver: MuseDriver, account_id: str, check_page: bool = False) -> dict:
    """Làm mới phiên. ``check_page`` ([MuseStudio patch], chỉ khi người dùng bấm "Kiểm tra phiên"): mở thêm trang chat để
    phát hiện tài khoản bị muse.ai khóa ("Muse is disconnected" — /api/session vẫn báo hợp lệ); vòng giữ phiên tự động không mở."""
    acc = pool.get(account_id)
    if acc is None:
        return {"ok": False, "error": "not found"}
    try:
        info = await driver.renew_session(acc)
    except FeatureNotImplemented as exc:
        return {"ok": False, "error": exc.message}
    except UpstreamAuthError as exc:
        acc.status = AccountStatus.INVALID
        acc.last_error = exc.message
        await pool.upsert(acc)
        return {"ok": False, "error": exc.message}

    acc.cookies.update(info.cookies)
    acc.cookie_expires.update(info.cookie_expires)
    acc.meta.update(info.meta)
    acc.meta["renewed_at"] = time.time()
    note_wake(acc, info.meta)
    page = ""
    if check_page and info.ok and hasattr(driver, "check_chat_page"):
        try:
            await driver.check_chat_page(acc)
            page = "ok"
            if acc.meta.pop("blocked_at", None):
                # Trước bị đánh dấu khóa, giờ trang chat bình thường (đã được mở khóa qua ticket) → bật lại
                acc.enabled = True
                acc.status = AccountStatus.ACTIVE
                acc.last_error = None
        except UpstreamAccountBlocked as exc:
            mark_account_blocked(acc, exc.message)
            await pool.upsert(acc)
            return {"ok": False, "blocked": True, "error": exc.message}
        except UpstreamAuthError as exc:
            acc.status = AccountStatus.INVALID
            acc.last_error = exc.message
            await pool.upsert(acc)
            return {"ok": False, "error": exc.message}
        except Exception as exc:  # noqa: BLE001  (trang chậm / tài khoản đang bận: không kết luận được)
            page = f"không mở được trang chat để kiểm tra ({str(exc)[:120] or type(exc).__name__})"
    await pool.upsert(acc)
    out = {"ok": info.ok, "meta": info.meta}
    if page:
        out["page"] = page
    return out


async def keepalive_loop(pool: AccountPool, driver: MuseDriver, interval: float) -> None:
    log.info("keepalive loop started (interval=%ss)", interval)
    while True:
        await asyncio.sleep(interval)
        for acc in pool.all():
            if not acc.enabled or acc.status == AccountStatus.INVALID:
                continue
            try:
                result = await renew_account(pool, driver, acc.id)
                log.info("keepalive %s -> %s", acc.id, result.get("ok"))
            except Exception:  # noqa: BLE001
                log.exception("keepalive failed for %s", acc.id)
