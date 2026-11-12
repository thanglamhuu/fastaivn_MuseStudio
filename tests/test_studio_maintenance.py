"""Sao lưu tự động + dọn data/media (studio_maintenance.py)."""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "muse2api" / "src"))

import studio_maintenance as m  # noqa: E402

NOW = time.mktime((2026, 11, 12, 16, 30, 0, 0, 0, -1))


def make_data(tmp_path: Path) -> Path:
    d = tmp_path / "data"
    (d / "studio" / "state").mkdir(parents=True)
    (d / "studio" / "state" / "characters.v1.json").write_text('{"value": []}', encoding="utf-8")
    (d / "studio" / "state" / "nodeflow.library.v1.json").write_text(
        '{"value": {"url": "/v1/media/vid_0123456789abcdef.mp4"}}', encoding="utf-8")
    (d / "accounts.json").write_text("[]", encoding="utf-8")
    (d / "studio" / "ai_config.json").write_text("{}", encoding="utf-8")
    (d / "requests.db").write_text("x", encoding="utf-8")  # không được sao lưu
    return d


def test_backup_keeps_structure_under_date_hour_and_skips_unchanged(tmp_path, monkeypatch):
    monkeypatch.delenv("MUSESTUDIO_BACKUP_DIR", raising=False)
    d = make_data(tmp_path)
    r = m.run_backup(d, now=NOW)
    dest = tmp_path / "backup" / "20261112" / "16" / "data"
    assert r["ok"] and Path(r["dir"]) == dest
    got = sorted(p.relative_to(dest).as_posix() for p in dest.rglob("*") if p.is_file())
    assert got == ["accounts.json", "studio/ai_config.json", "studio/state/characters.v1.json",
                   "studio/state/nodeflow.library.v1.json"]
    # Không đổi gì → bỏ qua; "Sao lưu ngay" (force) vẫn chép
    assert "skipped" in m.run_backup(d, now=NOW + 3600)
    assert m.run_backup(d, force=True, now=NOW + 3600)["ok"]
    assert (tmp_path / "backup" / "20261112" / "17" / "data" / "accounts.json").is_file()


def test_backup_root_for_exe_data_dir_is_inside_it(tmp_path, monkeypatch):
    monkeypatch.delenv("MUSESTUDIO_BACKUP_DIR", raising=False)
    exe_data = tmp_path / "MuseVideoStudio"  # %APPDATA%/MuseVideoStudio của bản exe
    assert m.backup_root(exe_data) == exe_data.resolve() / "backup"
    monkeypatch.setenv("MUSESTUDIO_BACKUP_DIR", str(tmp_path / "x"))
    assert m.backup_root(exe_data) == tmp_path / "x"


def test_old_backup_days_are_pruned(tmp_path, monkeypatch):
    monkeypatch.delenv("MUSESTUDIO_BACKUP_DIR", raising=False)
    d = make_data(tmp_path)
    old = tmp_path / "backup" / "20261001" / "09" / "data"
    old.mkdir(parents=True)
    m.save_cfg(d, {**m.DEFAULTS, "backup_keep_days": 30})
    r = m.run_backup(d, now=NOW)
    assert r["pruned_days"] == ["20261001"] and not old.exists()


def test_media_clean_keeps_files_in_use_and_updates_index(tmp_path):
    d = make_data(tmp_path)
    media = d / "media"
    media.mkdir()
    old_t = NOW - 20 * 86400
    for name in ("vid_0123456789abcdef.mp4", "vid_ffffffffffffffff.mp4", "img_aaaaaaaaaaaaaaaa.jpg"):
        (media / name).write_bytes(b"x" * 100)
        os.utime(media / name, (old_t, old_t))
    (media / "vid_1111111111111111.mp4").write_bytes(b"new")  # mới → giữ
    (d / "studio" / "media_index.json").write_text(json.dumps({"vid_ffffffffffffffff.mp4": {}, "keep.jpg": {}}), encoding="utf-8")

    preview = m.clean_media(d, 14, dry_run=True, now=NOW)
    assert preview == {"dry_run": True, "days": 14, "files": 2, "bytes": 200, "kept_in_use": 1}
    assert len(list(media.iterdir())) == 4  # xem trước không xoá
    r = m.clean_media(d, 14, dry_run=False, now=NOW)
    assert r["files"] == 2
    assert sorted(f.name for f in media.iterdir()) == ["vid_0123456789abcdef.mp4", "vid_1111111111111111.mp4"]
    assert json.loads((d / "studio" / "media_index.json").read_text(encoding="utf-8")) == {"keep.jpg": {}}


def test_tick_backs_up_once_per_hour_and_cleans_media_once_per_day(tmp_path, monkeypatch):
    monkeypatch.delenv("MUSESTUDIO_BACKUP_DIR", raising=False)
    d = make_data(tmp_path)
    calls = {"clean": 0}
    real_clean = m.clean_media

    def count_clean(*a, **k):
        calls["clean"] += 1
        return real_clean(*a, **k)
    monkeypatch.setattr(m, "clean_media", count_clean)
    m.tick(d, now=NOW)
    (d / "accounts.json").write_text("[1]", encoding="utf-8")  # có thay đổi trong cùng giờ
    m.tick(d, now=NOW + 600)  # cùng giờ → chưa sao lưu lại
    hours = sorted(p.name for p in (tmp_path / "backup" / "20261112").iterdir())
    assert hours == ["16"] and calls["clean"] == 1
    m.tick(d, now=NOW + 3600)  # sang giờ mới + có thay đổi → sao lưu; chưa đủ 1 ngày → không dọn lại
    hours = sorted(p.name for p in (tmp_path / "backup" / "20261112").iterdir())
    assert hours == ["16", "17"] and calls["clean"] == 1
