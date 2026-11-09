"""Chọn tài khoản theo giọng: muse.ai đặt giọng theo tài khoản (patch trong muse2api/accounts/pool.py)."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "muse2api" / "src"))

from muse2api.accounts import Account, AccountPool, JsonAccountStore
from muse2api.errors import NoAccountAvailable

A, B = "avocado_v2:voice_a", "avocado_v2:voice_b"


async def _pool(tmp_path, n=2, threads=2, dedicated=None) -> AccountPool:
    pool = AccountPool(JsonAccountStore(tmp_path / "acc.json"), acquire_timeout=0.2,
                       max_concurrency=threads)
    for i in range(n):
        meta = {"dedicated_voice": dedicated[i]} if dedicated and dedicated[i] else {}
        await pool.upsert(Account(id=f"a{i}", cookies={"hatch_sess": "x"}, meta=meta))
    return pool


def test_one_voice_per_account_at_a_time(tmp_path):
    async def run():
        pool = await _pool(tmp_path, n=1, threads=2)
        first = await pool.acquire(voice=A)
        # cùng giọng: dùng luồng thứ 2 của tài khoản
        same = await pool.acquire(voice=A)
        assert same.id == first.id
        await pool.release(same)
        # giọng khác: phải chờ tài khoản rảnh hẳn
        with pytest.raises(NoAccountAvailable):
            await pool.acquire(voice=B)
        waiter = asyncio.create_task(pool.acquire(voice=B, wait=2))
        await asyncio.sleep(0.05)
        assert not waiter.done()
        await pool.release(first)
        assert (await waiter).id == "a0"

    asyncio.run(run())


def test_different_voices_spread_over_accounts(tmp_path):
    async def run():
        pool = await _pool(tmp_path, n=2, threads=4)
        a = await pool.acquire(voice=A)
        b = await pool.acquire(voice=B)
        assert a.id != b.id
        # giọng A tiếp theo về đúng tài khoản đang chạy giọng A
        a2 = await pool.acquire(voice=A)
        assert a2.id == a.id

    asyncio.run(run())


def test_dedicated_accounts(tmp_path):
    async def run():
        pool = await _pool(tmp_path, n=3, threads=1, dedicated=[A, B, None])
        assert (await pool.acquire(voice=B)).id == "a1"  # ưu tiên tài khoản dành riêng
        got = await pool.acquire(voice=B)  # a1 bận: dùng tài khoản chung, không dùng a0 (giọng A)
        assert got.id == "a2"
        with pytest.raises(NoAccountAvailable):
            await pool.acquire(voice=B)
        assert (await pool.acquire(voice=A)).id == "a0"

    asyncio.run(run())


def test_all_accounts_reserved_for_other_voices_still_usable(tmp_path):
    async def run():
        pool = await _pool(tmp_path, n=1, threads=1, dedicated=[A])
        assert (await pool.acquire(voice=B)).id == "a0"

    asyncio.run(run())


def test_no_voice_ignores_routing(tmp_path):
    async def run():
        pool = await _pool(tmp_path, n=1, threads=2, dedicated=[A])
        x = await pool.acquire(voice=A)
        y = await pool.acquire()
        assert x.id == y.id == "a0"

    asyncio.run(run())
