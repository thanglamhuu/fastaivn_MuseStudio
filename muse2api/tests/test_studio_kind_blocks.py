"""[MuseStudio patch] kind blocks (daily video limit / region) and quota-aware scheduling."""
from __future__ import annotations

import time

from muse2api.accounts import Account, AccountPool, JsonAccountStore
from muse2api.accounts.pool import block_kind, kind_blocks, quota_exhausted
from muse2api.errors import UpstreamKindBlocked


async def _pool(tmp_path, n=2, **kw) -> AccountPool:
    pool = AccountPool(JsonAccountStore(tmp_path / "acc.json"), acquire_timeout=0.2, **kw)
    for i in range(n):
        await pool.upsert(Account(id=f"a{i}", cookies={"hatch_sess": "x"}))
    return pool


async def test_kind_blocked_error_blocks_only_that_kind(tmp_path):
    pool = await _pool(tmp_path)
    acc = await pool.acquire(kind="video")
    await pool.release(acc, UpstreamKindBlocked("daily limit", kind="video"))
    assert acc.status.value == "active"
    assert "video" in kind_blocks(acc)
    for _ in range(3):
        other = await pool.acquire(kind="video")
        assert other.id != acc.id
        await pool.release(other)
    seen = set()
    for _ in range(4):
        a = await pool.acquire(kind="image")
        seen.add(a.id)
        await pool.release(a)
    assert acc.id in seen  # images still allowed


async def test_kind_block_never_shortens_and_keeps_reason():
    acc = Account(cookies={"hatch_sess": "x"})
    far = time.time() + 7 * 86400
    block_kind(acc, "video", far, "region")
    block_kind(acc, "video", time.time() + 60, "limit")
    assert kind_blocks(acc)["video"] == {"until": far, "reason": "region"}


async def test_exhausted_quota_is_skipped_unless_all_exhausted(tmp_path):
    pool = await _pool(tmp_path)
    now = time.time()
    pool.get("a0").meta["quota"] = {"checked_at": now, "weekly_used_pct": 100}
    assert quota_exhausted(pool.get("a0"))
    for _ in range(3):
        a = await pool.acquire(kind="video")
        assert a.id == "a1"
        await pool.release(a)
    pool.get("a1").meta["quota"] = {"checked_at": now, "weekly_used_pct": 100}
    a = await pool.acquire(kind="video")  # everyone exhausted: still usable, never a dead pool
    await pool.release(a)


async def test_topup_and_stale_snapshot_do_not_count_as_exhausted():
    acc = Account(cookies={"hatch_sess": "x"})
    acc.meta["quota"] = {"checked_at": time.time(), "weekly_used_pct": 100, "topup_balance": 5}
    assert not quota_exhausted(acc)
    acc.meta["quota"] = {"checked_at": time.time() - 2 * 86400, "weekly_used_pct": 100}
    assert not quota_exhausted(acc)


async def test_equal_load_prefers_more_quota_left(tmp_path):
    pool = await _pool(tmp_path)
    now = time.time()
    pool.get("a0").meta["quota"] = {"checked_at": now, "weekly_used_pct": 80}
    pool.get("a1").meta["quota"] = {"checked_at": now, "weekly_used_pct": 10}
    a = await pool.acquire(kind="video")
    assert a.id == "a1"
    await pool.release(a)
