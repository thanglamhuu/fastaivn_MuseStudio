"""API /studio cho file và trạng thái của MuseStudio (gắn vào app muse2api như studio_api.py).

- GET  /studio/settings              thư mục xuất file + đường dẫn FFmpeg tìm được
- GET  /studio/voices                danh sách giọng đọc muse.ai
- GET  /studio/state/{key}           đọc trạng thái giao diện đã lưu (cảnh, ảnh tham chiếu, sản phẩm...)
- PUT  /studio/state/{key}           lưu trạng thái giao diện (không bị giới hạn ~5MB như localStorage)
- POST /studio/export                chép 1 video từ data/media vào <thư mục xuất>/<dự án>/<tên>.mp4
- POST /studio/merge                 ghép nhiều cảnh thành 1 video bằng FFmpeg
- POST /studio/open-folder           mở thư mục dự án trong Explorer (chỉ từ chính máy này)

data/media bị muse2api tự dọn sau ``media_retention_days`` (14 ngày); file trong thư mục
xuất thì không bao giờ bị xoá.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, Depends, Request
from muse2api.api.deps import public_base, require_admin_key
from muse2api.core.voices import list_voices
from muse2api.errors import InvalidRequest, Muse2APIError, NotFound
from pydantic import BaseModel, Field

router = APIRouter(prefix="/studio", tags=["studio"], dependencies=[Depends(require_admin_key)])

_SAFE_KEY = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
_UNSAFE_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]+')
_RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)),
             *(f"LPT{i}" for i in range(1, 10))}
MAX_STATE_BYTES = 64 * 1024 * 1024
_LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost"}


class FFmpegError(Muse2APIError):
    status_code = 500
    code = "ffmpeg_failed"


# ---------------------------------------------------------------- helpers
def safe_name(raw: str, fallback: str = "untitled", max_len: int = 80) -> str:
    """Tên file/thư mục hợp lệ trên Windows và không thoát ra ngoài thư mục cha."""
    name = _UNSAFE_CHARS.sub("_", str(raw or "")).strip(" .")
    name = re.sub(r"\s+", " ", name)[:max_len].strip(" .")
    if not name or name in {".", ".."} or name.upper() in _RESERVED:
        return fallback
    return name


def output_dir() -> Path:
    raw = os.environ.get("MUSE2API_STUDIO_OUTPUT_DIR", "").strip()
    return Path(raw) if raw else Path.home() / "Downloads" / "MuseStudio"


def find_ffmpeg() -> str | None:
    configured = os.environ.get("MUSE2API_FFMPEG_PATH", "").strip()
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    # Bản .exe bàn giao: ffmpeg.exe đặt CẠNH MuseVideoStudio.exe (không nhét vào exe cho nhẹ, khởi động nhanh)
    exe_dir = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else base
    for cand in (configured, str(base / "ffmpeg.exe"), str(base / "bin" / "ffmpeg.exe"),
                 str(exe_dir / "ffmpeg.exe"), str(exe_dir / "bin" / "ffmpeg.exe")):
        if cand and Path(cand).is_file():
            return cand
    return shutil.which("ffmpeg")


def _hidden() -> dict[str, Any]:
    return {"creationflags": 0x08000000} if os.name == "nt" else {}  # CREATE_NO_WINDOW


def _state_dir(request: Request) -> Path:
    return Path(request.app.state.services.settings.data_dir) / "studio" / "state"


def _state_file(request: Request, key: str) -> Path:
    if not _SAFE_KEY.match(key or ""):
        raise InvalidRequest("state key must be 1-64 letters, digits, '.', '_' or '-'")
    return _state_dir(request) / f"{key}.json"


def project_folder(project: str) -> Path:
    folder = output_dir() / safe_name(project, "MuseStudio")
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def probe(ffmpeg: str, clip: Path) -> dict[str, Any]:
    """Kích thước, có tiếng hay không và thời lượng của ``clip`` (đọc từ banner của ffmpeg)."""
    proc = subprocess.run([ffmpeg, "-hide_banner", "-i", str(clip)], capture_output=True, check=False,
                          text=True, encoding="utf-8", errors="ignore", timeout=60, **_hidden())
    info = proc.stderr
    size = re.search(r"Video:.*?(\d{2,5})x(\d{2,5})", info)
    dur = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", info)
    w, h = (int(size.group(1)), int(size.group(2))) if size else (720, 1280)
    seconds = (int(dur.group(1)) * 3600 + int(dur.group(2)) * 60 + float(dur.group(3))
               if dur else 10.0)
    return {"w": w - w % 2, "h": h - h % 2, "audio": "Audio:" in info, "seconds": seconds}


def merge_clips(ffmpeg: str, clips: list[Path], target: Path) -> Path:
    """Ghép ``clips`` theo thứ tự vào ``target``. Mọi clip được đưa về cùng kích thước clip
    đầu, 30 fps, âm thanh AAC (clip không có tiếng được chèn âm câm) nên luôn ghép được."""
    if len(clips) < 2:
        raise InvalidRequest("cần ít nhất 2 video để ghép")
    probes = [probe(ffmpeg, c) for c in clips]
    w, h = probes[0]["w"], probes[0]["h"]
    cmd = [ffmpeg, "-hide_banner", "-y"]
    filters = []
    for i, (clip, info) in enumerate(zip(clips, probes, strict=True)):
        cmd += ["-i", str(clip)]
        filters.append(
            f"[{i}:v:0]scale={w}:{h}:force_original_aspect_ratio=decrease,"
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v{i}]")
        if info["audio"]:
            filters.append(f"[{i}:a:0]aresample=44100,aformat=channel_layouts=stereo[a{i}]")
        else:
            filters.append(f"anullsrc=r=44100:cl=stereo,atrim=0:{info['seconds']:.3f}[a{i}]")
    joined = "".join(f"[v{i}][a{i}]" for i in range(len(clips)))
    filters.append(f"{joined}concat=n={len(clips)}:v=1:a=1[v][a]")
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as fh:
        fh.write(";\n".join(filters))
        script = fh.name
    try:
        cmd += ["-filter_complex_script", script, "-map", "[v]", "-map", "[a]",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
                "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(target)]
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", check=False,
                              errors="ignore", timeout=1800, **_hidden())
    finally:
        Path(script).unlink(missing_ok=True)
    if proc.returncode != 0 or not target.is_file():
        tail = "\n".join(proc.stderr.strip().splitlines()[-6:])
        raise FFmpegError(f"FFmpeg ghép video thất bại ({proc.returncode}): {tail}")
    return target


def _media_name(ref: str) -> str:
    """Tên file trong data/media từ tên trần hoặc URL .../v1/media/<tên>."""
    return ref.rstrip("/").rsplit("/v1/media/", 1)[-1].split("?", 1)[0]


# ---------------------------------------------------------------- routes
@router.get("/settings")
async def settings() -> dict:
    return {"output_dir": str(output_dir()), "ffmpeg": find_ffmpeg()}


@router.get("/voices")
async def voices() -> dict:
    return {"data": list_voices()}


@router.get("/state/{key}")
async def get_state(key: str, request: Request) -> dict:
    f = _state_file(request, key)
    if not f.is_file():
        raise NotFound(f"state '{key}' not saved yet")
    return json.loads(f.read_text(encoding="utf-8"))


@router.put("/state/{key}")
async def put_state(key: str, request: Request, data: Any = Body(...)) -> dict:  # noqa: B008
    """Lưu ``{"savedAt": ms, "value": ...}``; ghi vào file tạm rồi đổi tên để không hỏng file."""
    f = _state_file(request, key)
    raw = json.dumps(data, ensure_ascii=False)
    if len(raw.encode("utf-8")) > MAX_STATE_BYTES:
        raise InvalidRequest("dữ liệu quá lớn (trên 64 MB)")
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix(".tmp")
    tmp.write_text(raw, encoding="utf-8")
    tmp.replace(f)
    return {"key": key, "saved_at": time.time()}


class ExportRequest(BaseModel):
    media: str = Field(min_length=1, max_length=500, description="Tên file hoặc URL /v1/media/...")
    project: str = Field(default="", max_length=200)
    filename: str = Field(min_length=1, max_length=200)


@router.post("/export")
async def export(body: ExportRequest, request: Request) -> dict:
    svc = request.app.state.services
    source = svc.media.path_of(_media_name(body.media))
    target = project_folder(body.project) / f"{safe_name(Path(body.filename).stem, 'video')}{source.suffix}"
    await asyncio.to_thread(shutil.copy2, source, target)
    return {"path": str(target), "folder": str(target.parent)}


class MergeRequest(BaseModel):
    media: list[str] = Field(min_length=2, max_length=60)
    project: str = Field(default="", max_length=200)
    filename: str = Field(default="video_full", max_length=200)


@router.post("/merge")
async def merge(body: MergeRequest, request: Request) -> dict:
    svc = request.app.state.services
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        raise FFmpegError("Không tìm thấy FFmpeg: cài FFmpeg (có trong PATH) hoặc đặt MUSE2API_FFMPEG_PATH")
    clips = [svc.media.path_of(_media_name(m)) for m in body.media]
    target = project_folder(body.project) / f"{safe_name(body.filename, 'video_full')}.mp4"
    await asyncio.to_thread(merge_clips, ffmpeg, clips, target)
    name = svc.media.save(target.read_bytes(), "video/mp4", prefix="vid")
    return {"path": str(target), "folder": str(target.parent), "media": name,
            "url": f"{public_base(request)}/v1/media/{name}"}


class OpenFolderRequest(BaseModel):
    project: str | None = Field(default=None, max_length=200)


@router.post("/open-folder")
async def open_folder(request: Request, body: OpenFolderRequest | None = None) -> dict:
    client = request.client.host if request.client else ""
    if client not in _LOCAL_HOSTS:
        raise InvalidRequest("chỉ mở được thư mục từ chính máy chạy Gateway")
    folder = project_folder(body.project) if body and body.project else output_dir()
    folder.mkdir(parents=True, exist_ok=True)
    await asyncio.to_thread(_reveal, folder)
    return {"folder": str(folder)}


def _reveal(folder: Path) -> None:
    if os.name == "nt":
        os.startfile(folder)  # ứng dụng desktop chạy cục bộ, thư mục do tool tạo
    else:
        subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", str(folder)])
