"""API /studio/catalog — danh sách mẫu Workflow dùng chung, quản trị trên fastaivn.com (Firebase).

fastaivn.com (trang Quản trị mẫu) soạn mẫu trong Firestore, bấm "Xuất bản" để ghi 1 file tĩnh
`catalog.v1.json` (+ thumbnail, video xem trước, sơ đồ từng mẫu) lên Firebase Hosting / Storage.
App chỉ đọc file đó — không cần Firebase SDK hay API key. Xem taiLieu/FASTAIVN_CATALOG.md.

- GET  /studio/catalog?refresh=1     catalog (online → lưu đệm đĩa; lỗi mạng → bản đệm)
- GET  /studio/catalog/graph?url=…   sơ đồ flow-workflow của 1 mẫu (đường dẫn tương đối theo catalog)
- GET  /studio/catalog/bundle?url=…  bộ workflow .musestudio.json (nhiều mẫu + sơ đồ + nhân vật / sản phẩm, tới 80MB)
- GET  /studio/catalog/config        / PUT: đổi địa chỉ catalog (vd. bản staging)

Tải phía Gateway (không phải trình duyệt) để không vướng CORS của Firebase Storage và để có
bản đệm dùng khi mất mạng. Địa chỉ catalog cũng có thể là đường dẫn file trên máy (để thử).
"""
from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import APIRouter, Depends, Request
from muse2api.api.deps import require_admin_key
from muse2api.errors import InvalidRequest, NotFound
from pydantic import BaseModel, Field

router = APIRouter(prefix="/studio/catalog", tags=["studio-catalog"], dependencies=[Depends(require_admin_key)])

DEFAULT_URL = os.getenv("MUSESTUDIO_CATALOG_URL", "https://fastaivn.com/workflows/catalog.v1.json")
MAX_BYTES = 8 * 1024 * 1024
FRESH_SECONDS = 6 * 3600  # bản đệm mới hơn 6 giờ thì dùng luôn, không hỏi lại server


def _dir(request: Request) -> Path:
    d = Path(request.app.state.services.settings.data_dir) / "studio" / "catalog"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _config(request: Request) -> dict[str, Any]:
    f = _dir(request) / "config.json"
    try:
        return json.loads(f.read_text(encoding="utf-8"))
    except Exception:
        return {}


def catalog_url(request: Request) -> str:
    return str(_config(request).get("url") or DEFAULT_URL).strip()


def _is_local(url: str) -> bool:
    return url.startswith("file://") or (len(url) > 2 and url[1] == ":") or url.startswith("/")


def _local_path(url: str) -> Path:
    return Path(url[7:].lstrip("/") if url.startswith("file:///") else url[7:] if url.startswith("file://") else url)


def _resolve(base: str, ref: str) -> str:
    """Đường dẫn trong catalog có thể tương đối (thumbs/a.jpg) → tuyệt đối theo địa chỉ catalog."""
    if not ref or urlparse(ref).scheme in ("http", "https", "data"):
        return ref
    if _is_local(base):
        return str((_local_path(base).parent / ref).resolve())
    return urljoin(base, ref)


async def _fetch(url: str, etag: str | None = None, max_bytes: int = MAX_BYTES) -> tuple[int, bytes, str | None]:
    if _is_local(url):
        p = _local_path(url)
        if not p.is_file():
            raise NotFound(f"không thấy file {p}")
        if p.stat().st_size > max_bytes:
            raise InvalidRequest("file quá lớn")
        return 200, p.read_bytes(), None
    if urlparse(url).scheme not in ("http", "https"):
        raise InvalidRequest("địa chỉ phải là http(s) hoặc đường dẫn file")
    headers = {"User-Agent": "MuseStudio-catalog/1"}
    if etag:
        headers["If-None-Match"] = etag
    async with httpx.AsyncClient(timeout=15 if max_bytes <= MAX_BYTES else 120, follow_redirects=True, trust_env=True) as c:
        r = await c.get(url, headers=headers)
    if r.status_code == 304:
        return 304, b"", etag
    if r.status_code >= 400:
        raise InvalidRequest(f"máy chủ trả HTTP {r.status_code}")
    if len(r.content) > max_bytes:
        raise InvalidRequest("file quá lớn")
    return r.status_code, r.content, r.headers.get("etag")


def _normalize(raw: Any, url: str) -> dict[str, Any]:
    if not isinstance(raw, dict) or not isinstance(raw.get("templates"), list):
        raise InvalidRequest("catalog không đúng định dạng (thiếu templates[])")
    if int(raw.get("catalogVersion") or 1) != 1:
        raise InvalidRequest(f"catalogVersion {raw.get('catalogVersion')} chưa hỗ trợ — hãy cập nhật app")
    out = []
    for t in raw["templates"]:
        if not isinstance(t, dict) or not t.get("id") or not t.get("title"):
            continue
        if t.get("published") is False:
            continue
        t = dict(t)
        for k in ("thumbnailUrl", "previewUrl", "graphUrl", "bundleUrl"):
            if t.get(k):
                t[k] = _resolve(url, str(t[k]))
        out.append(t)
    out.sort(key=lambda t: (int(t.get("sortOrder") or 9999), str(t.get("title"))))
    return {**{k: v for k, v in raw.items() if k != "templates"}, "templates": out}


@router.get("")
async def get_catalog(request: Request, refresh: bool = False) -> dict:
    url = catalog_url(request)
    cache = _dir(request) / "catalog.json"
    meta_f = _dir(request) / "meta.json"
    meta: dict[str, Any] = {}
    try:
        meta = json.loads(meta_f.read_text(encoding="utf-8"))
    except Exception:
        pass
    cached = None
    if cache.is_file() and meta.get("url") == url:
        try:
            cached = json.loads(cache.read_text(encoding="utf-8"))
        except Exception:
            cached = None
    if cached and not refresh and time.time() - float(meta.get("fetchedAt") or 0) < FRESH_SECONDS:
        return {"catalog": cached, "source": "cache", "url": url, "fetchedAt": meta.get("fetchedAt")}
    try:
        status, body, etag = await _fetch(url, meta.get("etag") if cached else None)
        if status == 304 and cached:
            meta["fetchedAt"] = time.time()
            meta_f.write_text(json.dumps(meta), encoding="utf-8")
            return {"catalog": cached, "source": "online", "url": url, "fetchedAt": meta["fetchedAt"], "notModified": True}
        catalog = _normalize(json.loads(body.decode("utf-8-sig")), url)
        cache.write_text(json.dumps(catalog, ensure_ascii=False), encoding="utf-8")
        meta = {"url": url, "etag": etag, "fetchedAt": time.time()}
        meta_f.write_text(json.dumps(meta), encoding="utf-8")
        return {"catalog": catalog, "source": "online", "url": url, "fetchedAt": meta["fetchedAt"]}
    except Exception as exc:  # mất mạng / server lỗi → dùng bản đệm nếu có
        msg = getattr(exc, "message", None) or str(exc) or exc.__class__.__name__
        if cached:
            return {"catalog": cached, "source": "cache", "url": url, "fetchedAt": meta.get("fetchedAt"), "error": msg}
        return {"catalog": None, "source": "none", "url": url, "error": msg}


@router.get("/graph")
async def get_graph(request: Request, url: str) -> dict:
    """Sơ đồ flow-workflow của 1 mẫu. Lưu đệm theo địa chỉ để mở được khi mất mạng."""
    full = _resolve(catalog_url(request), url)
    f = _dir(request) / f"graph_{hashlib.sha1(full.encode()).hexdigest()[:16]}.json"
    try:
        _, body, _ = await _fetch(full)
        graph = json.loads(body.decode("utf-8-sig"))
        f.write_text(json.dumps(graph, ensure_ascii=False), encoding="utf-8")
        return {"graph": graph, "source": "online"}
    except Exception as exc:
        if f.is_file():
            return {"graph": json.loads(f.read_text(encoding="utf-8")), "source": "cache"}
        raise NotFound(f"không tải được sơ đồ mẫu: {getattr(exc, 'message', None) or exc}") from None


BUNDLE_MAX_BYTES = 80 * 1024 * 1024


@router.get("/bundle")
async def get_bundle(request: Request, url: str) -> dict:
    """Bộ workflow (.musestudio.json, có nhúng ảnh nên cho tới 80MB) từ link fastaivn.com / Firebase / file trên máy.
    Đường dẫn tương đối tính theo địa chỉ catalog. Có bản đệm để mở lại khi mất mạng."""
    full = _resolve(catalog_url(request), url.strip())
    f = _dir(request) / f"bundle_{hashlib.sha1(full.encode()).hexdigest()[:16]}.json"
    try:
        _, body, _ = await _fetch(full, max_bytes=BUNDLE_MAX_BYTES)
        bundle = json.loads(body.decode("utf-8-sig"))
        f.write_text(json.dumps(bundle, ensure_ascii=False), encoding="utf-8")
        return {"bundle": bundle, "source": "online", "url": full}
    except Exception as exc:
        if f.is_file():
            return {"bundle": json.loads(f.read_text(encoding="utf-8")), "source": "cache", "url": full}
        raise NotFound(f"không tải được bộ workflow: {getattr(exc, 'message', None) or exc}") from None


class CatalogConfig(BaseModel):
    url: str = Field(default="", max_length=1000, description="trống = mặc định fastaivn.com")


@router.get("/config")
async def get_config(request: Request) -> dict:
    return {"url": catalog_url(request), "default": DEFAULT_URL}


@router.put("/config")
async def put_config(body: CatalogConfig, request: Request) -> dict:
    (_dir(request) / "config.json").write_text(json.dumps({"url": body.url.strip()}), encoding="utf-8")
    return {"url": catalog_url(request), "default": DEFAULT_URL}
