"""Thumbnail + video xem trước của các mẫu Workflow lấy từ thư mục ``wfthumb`` (cạnh dữ liệu app).

- ``wfthumb/wfthumb.config.json`` khai báo từng mẫu theo ``templateId``: ảnh, video (tên file trong thư mục hoặc link
  http(s)), link YouTube khi đã tải clip lên. Người dùng chỉ cần sửa file này (không phải build lại app).
- GET /studio/wfthumb/config            -> nội dung config (+ ``base`` để ghép đường dẫn file)
- GET /studio/wfthumb/file/{tên file}   -> ảnh / video / sơ đồ trong thư mục (chỉ đọc, không ra ngoài thư mục)
- GET /studio/wfthumb/full/{tên file}   -> clip đầy đủ trong thư mục ``fullVideoDir`` của config (ngoài repo cho nhẹ git)

Hai route không cần API key: thẻ <img> / <video> không gửi được header, và dữ liệu chỉ là thumbnail công khai.
Thư mục: biến môi trường ``MUSESTUDIO_WFTHUMB`` → ``<thư mục cha của data>/wfthumb`` → ``<thư mục exe>/wfthumb``.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse
from muse2api.errors import NotFound

router = APIRouter(prefix="/studio/wfthumb", tags=["studio-wfthumb"])

CONFIG = "wfthumb.config.json"


def wfthumb_dir(request: Request) -> Path:
    env = os.getenv("MUSESTUDIO_WFTHUMB")
    cands = [Path(env)] if env else []
    try:
        cands.append(Path(request.app.state.services.settings.data_dir).resolve().parent / "wfthumb")
    except AttributeError:
        pass
    cands.append(Path(sys.executable).resolve().parent / "wfthumb")
    cands.append(Path(__file__).resolve().parent / "wfthumb")
    for c in cands:
        if c.is_dir():
            return c
    return cands[0]


@router.get("/config")
async def get_config(request: Request) -> dict:
    d = wfthumb_dir(request)
    f = d / CONFIG
    if not f.is_file():
        return {"version": 1, "templates": [], "base": "/studio/wfthumb/file/", "dir": str(d), "missing": True}
    data = json.loads(f.read_text(encoding="utf-8"))
    data["base"] = "/studio/wfthumb/file/"
    data["fullBase"] = "/studio/wfthumb/full/" if data.get("fullVideoDir") and Path(data["fullVideoDir"]).is_dir() else ""
    data["dir"] = str(d)
    return data


@router.get("/full/{name:path}")
async def get_full(name: str, request: Request) -> FileResponse:
    """Clip đầy đủ (nút ▶ phóng to) nằm NGOÀI repo — thư mục khai báo ở ``fullVideoDir`` trong config
    (để không đẩy hàng trăm MB video lên git). Chỉ đọc file trong đúng thư mục đó."""
    f_cfg = wfthumb_dir(request) / CONFIG
    full_dir = json.loads(f_cfg.read_text(encoding="utf-8")).get("fullVideoDir") if f_cfg.is_file() else None
    if not full_dir:
        raise NotFound("fullVideoDir chưa khai báo trong wfthumb.config.json")
    d = Path(full_dir).resolve()
    f = (d / name).resolve()
    if d not in f.parents or not f.is_file():
        raise NotFound(f"full clip '{name}' not found")
    return FileResponse(str(f))


@router.get("/file/{name:path}")
async def get_file(name: str, request: Request) -> FileResponse:
    d = wfthumb_dir(request).resolve()
    f = (d / name).resolve()
    if d not in f.parents or not f.is_file():
        raise NotFound(f"wfthumb file '{name}' not found")
    return FileResponse(str(f))
