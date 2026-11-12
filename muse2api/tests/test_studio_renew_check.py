"""[MuseStudio patch] "Kiểm tra phiên" mở thêm trang chat để phát hiện tài khoản bị muse.ai khóa ("Muse is disconnected")."""
from __future__ import annotations

import pytest

from muse2api.accounts import Account, AccountPool, AccountStatus, JsonAccountStore
from muse2api.accounts.keepalive import renew_account
from muse2api.drivers.base import SessionInfo
from muse2api.errors import UpstreamAccountBlocked, UpstreamTimeout


class FakeDriver:
    def __init__(self, page_error: Exception | None = None):
        self.page_error = page_error
        self.page_checks = 0

    async def renew_session(self, account: Account) -> SessionInfo:
        return SessionInfo(ok=True)  # /api/session vẫn báo hợp lệ dù tài khoản bị khóa

    async def check_chat_page(self, account: Account) -> None:
        self.page_checks += 1
        if self.page_error:
            raise self.page_error


async def _pool(tmp_path, acc: Account) -> AccountPool:
    pool = AccountPool(JsonAccountStore(tmp_path / "acc.json"))
    await pool.upsert(acc)
    return pool


async def test_manual_check_detects_blocked_account_and_disables_it(tmp_path):
    pool = await _pool(tmp_path, Account(id="a1", cookies={"hatch_sess": "x"}))
    drv = FakeDriver(UpstreamAccountBlocked("⛔ Nghi tài khoản đã bị muse.ai khóa"))
    r = await renew_account(pool, drv, "a1", check_page=True)
    acc = pool.get("a1")
    assert r["ok"] is False and r["blocked"] is True
    assert acc.enabled is False and acc.status == AccountStatus.INVALID and acc.meta.get("blocked_at")


async def test_keepalive_does_not_open_the_chat_page(tmp_path):
    pool = await _pool(tmp_path, Account(id="a1", cookies={"hatch_sess": "x"}))
    drv = FakeDriver(UpstreamAccountBlocked("khóa"))
    r = await renew_account(pool, drv, "a1")  # vòng giữ phiên tự động: check_page mặc định False
    assert r["ok"] is True and drv.page_checks == 0 and "page" not in r


async def test_unblocked_account_is_re_enabled(tmp_path):
    acc = Account(id="a1", cookies={"hatch_sess": "x"}, enabled=False, status=AccountStatus.INVALID,
                  last_error="⛔ Nghi tài khoản đã bị muse.ai khóa", meta={"blocked_at": 1.0})
    pool = await _pool(tmp_path, acc)
    r = await renew_account(pool, FakeDriver(), "a1", check_page=True)
    acc = pool.get("a1")
    assert r["ok"] is True and r["page"] == "ok"
    assert acc.enabled is True and acc.status == AccountStatus.ACTIVE and "blocked_at" not in acc.meta and not acc.last_error


async def test_slow_chat_page_is_reported_not_treated_as_blocked(tmp_path):
    pool = await _pool(tmp_path, Account(id="a1", cookies={"hatch_sess": "x"}))
    r = await renew_account(pool, FakeDriver(UpstreamTimeout("page did not become ready")), "a1", check_page=True)
    acc = pool.get("a1")
    assert r["ok"] is True and "không mở được trang chat" in r["page"]
    assert acc.enabled is True and "blocked_at" not in acc.meta


@pytest.mark.parametrize("head", ["Muse is disconnected We disconnected Muse to protect your information."])
async def test_new_thread_reports_blocked_page_without_waiting_for_timeout(tmp_path, head):
    import time

    from muse2api.config import Settings
    from muse2api.drivers.browser.driver import BrowserDriver, _Tab

    class Page:
        closed = False

        async def send(self, method, params=None, timeout=30.0):
            return {}

        async def evaluate(self, expr, **_):
            return {"ready": False, "hasInput": False, "path": "/thread/new", "head": head}

        async def close(self):
            pass

    drv = BrowserDriver(Settings(_env_file=None, data_dir=tmp_path, page_ready_timeout=60))

    async def no_soft(tab):
        return False
    drv._soft_new_thread = no_soft
    t0 = time.monotonic()
    with pytest.raises(UpstreamAccountBlocked):
        await drv._new_thread(_Tab("a1", "ctx", "t1", Page()))
    assert time.monotonic() - t0 < 5  # không đợi hết page_ready_timeout (60 s)
