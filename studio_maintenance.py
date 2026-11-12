"""Bảo trì dữ liệu: SAO LƯU tự động + DỌN data/media.

Sao lưu (mỗi giờ, chỉ khi dữ liệu có thay đổi so với lần trước):
    backup/yyyyMMdd/HH/data/accounts.json
    backup/yyyyMMdd/HH/data/studio/ai_config.json
    backup/yyyyMMdd/HH/data/studio/state/...          (giữ nguyên cấu trúc đường dẫn trong data/)
  Thư mục backup: biến MUSESTUDIO_BACKUP_DIR → <thư mục cha của data>/backup (bản dev: MuseStudio/backup)
  → bản exe (data = %APPDATA%/MuseVideoStudio): %APPDATA%/MuseVideoStudio/backup. Giữ ``backup_keep_days`` ngày.

Dọn media: xoá file trong data/media cũ hơn ``media_keep_days`` ngày, TRỪ file đang được dữ liệu app tham chiếu
(data/studio/state/*.json: sơ đồ khối, cảnh, sản phẩm…). Tự chạy mỗi ngày 1 lần khi ``media_auto`` bật; có nút xem trước / dọn ngay.

API (khóa admin):
- GET  /studio/maintenance                 cấu hình + lần sao lưu gần nhất + thống kê media
- PUT  /studio/maintenance                 đổi cấu hình
- POST /studio/maintenance/backup          sao lưu ngay (bỏ qua kiểm tra "có thay đổi")
- POST /studio/maintenance/media/clean     {days, dry_run}: xem trước / dọn ngay
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from muse2api.api.deps import require_admin_key

log = logging.getLogger("musestudio.maintenance")
router = APIRouter(prefix="/studio/maintenance", tags=["studio"], dependencies=[Depends(require_admin_key)])

# Đường dẫn TƯƠNG ĐỐI trong data/ được sao lưu (giữ cấu trúc)
BACKUP_ITEMS = ("studio/state", "accounts.json", "studio/ai_config.json")
DEFAULTS: dict[str, Any] = {
    "backup_enabled": True,
    "backup_keep_days": 30,
    "media_auto": True,
    "media_keep_days": 14,
}
CHECK_EVERY_S = 600  # luồng nền thức dậy mỗi 10 phút
MEDIA_REF_RE = re.compile(r"[a-z]{2,4}_[0-9a-f]{16}\.[a-z0-9]{2,4}")
_lock = threading.Lock()
_started = False


# ---------------------------------------------------------------- cấu hình
def _cfg_path(data_dir: Path) -> Path:
    return data_dir / "studio" / "maintenance.json"


def load_cfg(data_dir: Path) -> dict[str, Any]:
    p = _cfg_path(data_dir)
    cfg = dict(DEFAULTS)
    if p.is_file():
        try:
            cfg.update(json.loads(p.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            pass
    return cfg


def save_cfg(data_dir: Path, cfg: dict[str, Any]) -> None:
    p = _cfg_path(data_dir)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(cfg, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, p)


def backup_root(data_dir: Path) -> Path:
    env = os.environ.get("MUSESTUDIO_BACKUP_DIR", "").strip()
    if env:
        return Path(env)
    data_dir = data_dir.resolve()
    # Bản dev: data/ nằm trong repo → MuseStudio/backup. Bản exe: data = %APPDATA%/MuseVideoStudio → backup bên trong
    return data_dir.parent / "backup" if data_dir.name == "data" else data_dir / "backup"


# ---------------------------------------------------------------- sao lưu
def _files_to_backup(data_dir: Path) -> list[Path]:
    out: list[Path] = []
    for rel in BACKUP_ITEMS:
        p = data_dir / rel
        if p.is_dir():
            out += sorted(f for f in p.rglob("*") if f.is_file())
        elif p.is_file():
            out.append(p)
    return out


def _fingerprint(files: list[Path], data_dir: Path) -> str:
    parts = []
    for f in files:
        st = f.stat()
        parts.append(f"{f.relative_to(data_dir).as_posix()}:{st.st_size}:{int(st.st_mtime)}")
    # sha1 (không dùng hash(): giá trị đổi sau mỗi lần khởi động lại Python → sao lưu thừa)
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()


def run_backup(data_dir: Path, force: bool = False, now: float | None = None) -> dict[str, Any]:
    """Chép 3 mục vào backup/yyyyMMdd/HH/data/<đường dẫn gốc>. Không đổi gì từ lần trước (và không ``force``) → bỏ qua."""
    with _lock:
        data_dir = Path(data_dir)
        cfg = load_cfg(data_dir)
        files = _files_to_backup(data_dir)
        if not files:
            return {"ok": False, "skipped": "không có dữ liệu để sao lưu"}
        fp = _fingerprint(files, data_dir)
        if not force and fp == cfg.get("last_backup_fp"):
            return {"ok": True, "skipped": "dữ liệu không đổi từ lần sao lưu trước", "last": cfg.get("last_backup_dir")}
        t = time.localtime(now or time.time())
        dest_root = backup_root(data_dir) / time.strftime("%Y%m%d", t) / time.strftime("%H", t) / "data"
        size = 0
        for f in files:
            dst = dest_root / f.relative_to(data_dir)
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, dst)
            size += f.stat().st_size
        cfg.update(last_backup_fp=fp, last_backup_at=time.time(), last_backup_dir=str(dest_root))
        pruned = _prune_backups(data_dir, int(cfg.get("backup_keep_days") or 0), now)
        save_cfg(data_dir, cfg)
        log.info("sao lưu %d file (%.1f MB) → %s", len(files), size / 1e6, dest_root)
        return {"ok": True, "dir": str(dest_root), "files": len(files), "bytes": size, "pruned_days": pruned}


def _prune_backups(data_dir: Path, keep_days: int, now: float | None = None) -> list[str]:
    """Xoá thư mục ngày (yyyyMMdd) cũ hơn ``keep_days`` ngày (0 = giữ hết)."""
    root = backup_root(data_dir)
    if keep_days <= 0 or not root.is_dir():
        return []
    cutoff = time.strftime("%Y%m%d", time.localtime((now or time.time()) - keep_days * 86400))
    removed = []
    for d in root.iterdir():
        if d.is_dir() and re.fullmatch(r"\d{8}", d.name) and d.name < cutoff:
            shutil.rmtree(d, ignore_errors=True)
            removed.append(d.name)
    return removed


def list_backups(data_dir: Path, limit: int = 12) -> list[dict[str, Any]]:
    root = backup_root(data_dir)
    if not root.is_dir():
        return []
    out = []
    for day in sorted((d for d in root.iterdir() if d.is_dir() and re.fullmatch(r"\d{8}", d.name)), reverse=True):
        for hour in sorted((h for h in day.iterdir() if h.is_dir()), reverse=True):
            files = [f for f in hour.rglob("*") if f.is_file()]
            out.append({"name": f"{day.name}/{hour.name}", "dir": str(hour), "files": len(files),
                        "bytes": sum(f.stat().st_size for f in files)})
            if len(out) >= limit:
                return out
    return out


# ---------------------------------------------------------------- dọn media
def referenced_media(data_dir: Path) -> set[str]:
    """Tên file media đang được dữ liệu app dùng (sơ đồ khối, cảnh, sản phẩm…) → không xoá."""
    refs: set[str] = set()
    state = data_dir / "studio" / "state"
    if state.is_dir():
        for p in state.glob("*.json"):
            try:
                refs |= set(MEDIA_REF_RE.findall(p.read_text(encoding="utf-8", errors="ignore")))
            except OSError:
                pass
    return refs


def media_candidates(data_dir: Path, days: int, now: float | None = None) -> tuple[list[Path], int]:
    """(file cũ hơn ``days`` ngày và không được tham chiếu, số file cũ được giữ vì đang dùng)."""
    media = data_dir / "media"
    if days <= 0 or not media.is_dir():
        return [], 0
    cutoff = (now or time.time()) - days * 86400
    refs = referenced_media(data_dir)
    old = [f for f in media.iterdir() if f.is_file() and f.stat().st_mtime < cutoff]
    return [f for f in old if f.name not in refs], sum(1 for f in old if f.name in refs)


def clean_media(data_dir: Path, days: int, dry_run: bool = True, now: float | None = None) -> dict[str, Any]:
    with _lock:
        data_dir = Path(data_dir)
        files, kept = media_candidates(data_dir, days, now)
        size = sum(f.stat().st_size for f in files)
        if dry_run:
            return {"dry_run": True, "days": days, "files": len(files), "bytes": size, "kept_in_use": kept}
        removed = []
        for f in files:
            try:
                f.unlink()
                removed.append(f.name)
            except OSError as exc:
                log.warning("không xoá được %s: %s", f, exc)
        # Bỏ các mục đã xoá khỏi chỉ mục thư viện media
        idx = data_dir / "studio" / "media_index.json"
        if removed and idx.is_file():
            try:
                data = json.loads(idx.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    for name in removed:
                        data.pop(name, None)
                    idx.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            except (OSError, ValueError):
                pass
        cfg = load_cfg(data_dir)
        cfg.update(last_media_clean_at=time.time(), last_media_clean={"files": len(removed), "bytes": size, "days": days})
        save_cfg(data_dir, cfg)
        log.info("dọn media: xoá %d file (%.1f MB) cũ hơn %d ngày, giữ %d file đang dùng", len(removed), size / 1e6, days, kept)
        return {"dry_run": False, "days": days, "files": len(removed), "bytes": size, "kept_in_use": kept}


def media_stats(data_dir: Path) -> dict[str, Any]:
    media = data_dir / "media"
    files = [f for f in media.iterdir() if f.is_file()] if media.is_dir() else []
    return {"files": len(files), "bytes": sum(f.stat().st_size for f in files),
            "oldest": min((f.stat().st_mtime for f in files), default=0)}


# ---------------------------------------------------------------- luồng nền
def tick(data_dir: Path, now: float | None = None) -> None:
    """Mỗi lần thức dậy: sao lưu nếu sang giờ mới và có thay đổi; dọn media 1 lần / ngày."""
    cfg = load_cfg(data_dir)
    now = now or time.time()
    if cfg.get("backup_enabled"):
        hour = time.strftime("%Y%m%d%H", time.localtime(now))
        last = cfg.get("last_backup_at") or 0
        if time.strftime("%Y%m%d%H", time.localtime(last)) != hour:
            try:
                run_backup(data_dir, now=now)
            except Exception:  # noqa: BLE001
                log.exception("sao lưu tự động lỗi")
    days = int(cfg.get("media_keep_days") or 0)
    if cfg.get("media_auto") and days > 0 and now - float(cfg.get("last_media_auto_at") or 0) >= 86400:
        try:
            clean_media(data_dir, days, dry_run=False, now=now)
        except Exception:  # noqa: BLE001
            log.exception("dọn media tự động lỗi")
        cfg = load_cfg(data_dir)
        cfg["last_media_auto_at"] = now
        save_cfg(data_dir, cfg)


def start_scheduler(data_dir: Path) -> None:
    """Luồng nền (daemon): chạy ``tick`` ngay khi mở app rồi mỗi 10 phút."""
    global _started
    if _started:
        return
    _started = True

    def loop() -> None:
        while True:
            try:
                tick(Path(data_dir))
            except Exception:  # noqa: BLE001
                log.exception("bảo trì dữ liệu lỗi")
            time.sleep(CHECK_EVERY_S)

    threading.Thread(target=loop, name="musestudio-maintenance", daemon=True).start()
    log.info("bảo trì dữ liệu: sao lưu → %s", backup_root(Path(data_dir)))


# ---------------------------------------------------------------- API
def _data_dir(request: Request) -> Path:
    return Path(request.app.state.services.settings.data_dir)


@router.get("")
async def get_maintenance(request: Request) -> dict:
    d = _data_dir(request)
    cfg = load_cfg(d)
    files, kept = media_candidates(d, int(cfg.get("media_keep_days") or 0))
    return {
        "config": {k: cfg.get(k, v) for k, v in DEFAULTS.items()},
        "backup_dir": str(backup_root(d)),
        "last_backup_at": cfg.get("last_backup_at"),
        "backups": list_backups(d),
        "media": media_stats(d),
        "media_clean_preview": {"files": len(files), "bytes": sum(f.stat().st_size for f in files), "kept_in_use": kept},
        "last_media_clean_at": cfg.get("last_media_clean_at"),
        "last_media_clean": cfg.get("last_media_clean"),
    }


class MaintenanceConfig(BaseModel):
    backup_enabled: bool | None = None
    backup_keep_days: int | None = Field(default=None, ge=0, le=3650)
    media_auto: bool | None = None
    media_keep_days: int | None = Field(default=None, ge=0, le=3650)


@router.put("")
async def put_maintenance(body: MaintenanceConfig, request: Request) -> dict:
    d = _data_dir(request)
    cfg = load_cfg(d)
    cfg.update({k: v for k, v in body.model_dump().items() if v is not None})
    save_cfg(d, cfg)
    return await get_maintenance(request)


@router.post("/backup")
async def backup_now(request: Request) -> dict:
    return run_backup(_data_dir(request), force=True)


class CleanRequest(BaseModel):
    days: int = Field(ge=1, le=3650)
    dry_run: bool = True


@router.post("/media/clean")
async def media_clean(body: CleanRequest, request: Request) -> dict:
    return clean_media(_data_dir(request), body.days, dry_run=body.dry_run)
