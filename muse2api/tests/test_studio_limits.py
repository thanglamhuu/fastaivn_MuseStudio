"""[MuseStudio] Per-account thread limit stored in meta["max_concurrency"]."""
from __future__ import annotations

import pytest

from muse2api.accounts import Account, AccountPool, JsonAccountStore
from muse2api.errors import NoAccountAvailable


async def _pool(tmp_path, limits: dict[str, int | None]) -> AccountPool:
    pool = AccountPool(JsonAccountStore(tmp_path / "acc.json"), acquire_timeout=0.2,
                       max_concurrency=4, strategy="lru")
    for acc_id, limit in limits.items():
        meta = {} if limit is None else {"max_concurrency": limit}
        await pool.upsert(Account(id=acc_id, cookies={"hatch_sess": "x"}, meta=meta))
    return pool


async def test_limit_defaults_to_global_and_is_capped(tmp_path):
    pool = await _pool(tmp_path, {"a": None, "b": 9, "c": 0})
    assert pool.limit_of(pool.get("a")) == 4
    assert pool.limit_of(pool.get("b")) == 4  # never above browser tabs per account
    assert pool.limit_of(pool.get("c")) == 4  # 0 / falsy -> global


async def test_rotation_respects_per_account_limit(tmp_path):
    pool = await _pool(tmp_path, {"a": 1, "b": 2})
    held = [await pool.acquire() for _ in range(3)]
    assert sorted(a.id for a in held) == ["a", "b", "b"]
    assert pool.inflight_of("a") == 1 and pool.inflight_of("b") == 2
    with pytest.raises(NoAccountAvailable, match="busy"):
        await pool.acquire()
    await pool.release(held[0])
    assert (await pool.acquire()).id == held[0].id
