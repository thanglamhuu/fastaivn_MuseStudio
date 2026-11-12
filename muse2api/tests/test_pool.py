from __future__ import annotations

import asyncio
import time

import pytest

from muse2api.accounts import Account, AccountPool, AccountStatus, JsonAccountStore
from muse2api.drivers.base import ChatRequest
from muse2api.drivers.mock import MockDriver
from muse2api.errors import NoAccountAvailable, UpstreamAuthError, UpstreamError
from muse2api.services.gateway import Gateway


async def _pool(tmp_path, n=2, **kw) -> AccountPool:
    pool = AccountPool(JsonAccountStore(tmp_path / "acc.json"), acquire_timeout=0.2, **kw)
    for i in range(n):
        await pool.upsert(Account(id=f"a{i}", cookies={"hatch_sess": "x"}))
    return pool


async def test_empty_pool_raises(tmp_path):
    pool = await _pool(tmp_path, n=0)
    with pytest.raises(NoAccountAvailable):
        await pool.acquire()


async def test_lru_spreads_load(tmp_path):
    pool = await _pool(tmp_path, strategy="lru")
    first = await pool.acquire()
    await pool.release(first)
    second = await pool.acquire()
    assert first.id != second.id


async def test_concurrency_limit_waits_then_times_out(tmp_path):
    pool = await _pool(tmp_path, n=1)
    held = await pool.acquire()
    with pytest.raises(NoAccountAvailable, match="busy"):
        await pool.acquire()
    waiter = asyncio.create_task(pool.acquire())
    await asyncio.sleep(0.05)
    await pool.release(held)
    assert (await waiter).id == held.id


async def test_auth_error_invalidates(tmp_path):
    pool = await _pool(tmp_path, n=1)
    with pytest.raises(UpstreamAuthError):
        async with pool.lease():
            raise UpstreamAuthError("bad cookie")
    assert pool.get("a0").status == AccountStatus.INVALID
    with pytest.raises(NoAccountAvailable):
        await pool.acquire()


async def test_persistence_roundtrip(tmp_path):
    await _pool(tmp_path, n=2)
    reloaded = AccountPool(JsonAccountStore(tmp_path / "acc.json"))
    await reloaded.load()
    assert {a.id for a in reloaded.all()} == {"a0", "a1"}


class _FlakyDriver(MockDriver):
    requires_account = True

    def __init__(self, bad: set[str]):
        super().__init__(delay=0)
        self.bad = bad

    async def chat_stream(self, account, req):
        if account.id in self.bad:
            raise UpstreamError("boom")
        async for d in super().chat_stream(account, req):
            yield d


async def test_gateway_fails_over(tmp_path):
    pool = await _pool(tmp_path, n=2, strategy="round_robin")
    gw = Gateway(pool, _FlakyDriver({"a0"}), max_failover=2)
    text = "".join([d async for d in gw.chat_stream(ChatRequest(prompt="hi", model="m"))])
    assert "hi" in text
    assert pool.get("a0").status == AccountStatus.COOLING
    assert pool.get("a1").success_count == 1


async def test_single_account_failure_keeps_original_error(tmp_path):
    pool = await _pool(tmp_path, n=1)
    driver = _FlakyDriver({"a0"})
    gw = Gateway(pool, driver, max_failover=2)
    # No other account: no pointless retry that would hide "boom" behind NoAccountAvailable.
    with pytest.raises(UpstreamError, match="boom"):
        _ = [d async for d in gw.chat_stream(ChatRequest(prompt="hi", model="m"))]
    assert pool.get("a0").fail_count == 1


async def test_acquire_waits_for_cooldown_to_end(tmp_path):
    pool = await _pool(tmp_path, n=1)
    acc = pool.get("a0")
    acc.status, acc.cooldown_until = AccountStatus.COOLING, time.time() + 0.1
    got = await pool.acquire()  # acquire_timeout is 0.2s, cooldown ends after 0.1s
    assert got.id == "a0"


async def test_acquire_fails_fast_when_cooldown_outlasts_timeout(tmp_path):
    pool = await _pool(tmp_path, n=1)
    acc = pool.get("a0")
    acc.status, acc.cooldown_until = AccountStatus.COOLING, time.time() + 60
    started = time.monotonic()
    with pytest.raises(NoAccountAvailable, match="cooling"):
        await pool.acquire()
    assert time.monotonic() - started < 0.1


async def test_timeout_does_not_cool_the_account(tmp_path):
    from muse2api.errors import UpstreamTimeout

    pool = await _pool(tmp_path, n=1)
    with pytest.raises(UpstreamTimeout):
        async with pool.lease():
            raise UpstreamTimeout("video generation timed out")
    acc = pool.get("a0")
    assert acc.status == AccountStatus.ACTIVE and acc.fail_count == 1
    assert (await pool.acquire()).id == "a0"


async def test_other_upstream_errors_still_cool_down(tmp_path):
    pool = await _pool(tmp_path, n=1, cooldown=30)
    with pytest.raises(UpstreamError):
        async with pool.lease():
            raise UpstreamError("browser error")
    assert pool.get("a0").status == AccountStatus.COOLING


def test_default_concurrency_for_accounts_without_own_limit(tmp_path):
    # [MuseStudio patch] tài khoản chưa đặt số luồng riêng: theo mặc định (2), không phải trần (4); đặt riêng vẫn tới trần
    pool = AccountPool(JsonAccountStore(tmp_path / "acc.json"), max_concurrency=4, default_concurrency=2)
    assert pool.limit_of(Account(label="mới")) == 2
    assert pool.limit_of(Account(label="3 luồng", meta={"max_concurrency": 3})) == 3
    assert pool.limit_of(Account(label="quá trần", meta={"max_concurrency": 9})) == 4
    # Không truyền mặc định: như bản gốc (bằng trần)
    assert AccountPool(JsonAccountStore(tmp_path / "b.json"), max_concurrency=4).limit_of(Account(label="x")) == 4


def test_settings_default_concurrency_is_two():
    from muse2api.config import Settings
    s = Settings(_env_file=None)
    assert s.account_default_concurrency == 2 and s.account_max_concurrency == 4


async def test_blocked_account_is_invalid_and_marked(tmp_path):
    # [MuseStudio patch] muse.ai khóa tài khoản ("Muse is disconnected") → INVALID + meta["blocked_at"] để UI hiện "Nghi bị khóa"
    from muse2api.errors import UpstreamAccountBlocked

    pool = await _pool(tmp_path, n=1)
    with pytest.raises(UpstreamAccountBlocked):
        async with pool.lease():
            raise UpstreamAccountBlocked("⛔ Nghi tài khoản đã bị muse.ai khóa")
    acc = pool.get("a0")
    assert acc.status == AccountStatus.INVALID and acc.meta.get("blocked_at") and "bị muse.ai khóa" in acc.last_error
    assert acc.enabled is False and pool.get("a0") is not None  # tự tắt, KHÔNG xoá khỏi danh sách
    with pytest.raises(NoAccountAvailable):
        await pool.acquire()
