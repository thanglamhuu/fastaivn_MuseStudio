"""API /studio cho Thư viện media, công cụ hậu kỳ và AI tạo chân dung nhân vật.

- GET    /studio/library                 ảnh / clip trong data/media (lọc kind, q, favorite)
- PATCH  /studio/library/{name}          đánh dấu yêu thích, ghi chú
- DELETE /studio/library/{name}          xóa file khỏi thư viện
- POST   /studio/post/frame              cắt 1 khung hình (thời điểm tùy chọn, mặc định khung cuối) thành ảnh
- POST   /studio/post/upscale            nâng độ phân giải ảnh / video bằng FFmpeg (lanczos + làm nét nhẹ)
- POST   /studio/post/blur               làm mờ / làm vỡ hạt các vùng chọn (che logo, watermark)
- POST   /studio/portrait                AI (muse-image) tạo ảnh chân dung nhân vật từ mô tả
- POST   /studio/media/upload            lưu ảnh / video dạng data URL thành media (sơ đồ Node: hậu kỳ, xuất file)

Kết quả hậu kỳ / chân dung được lưu vào data/media như media khác và ghi nguồn gốc vào
data/studio/media_index.json (nguồn, prompt, file gốc) để thư viện hiển thị.
"""
from __future__ import annotations

import asyncio
import json
import re
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, Request
from muse2api.api.deps import public_base, require_admin_key
from muse2api.core.media import load_image_ref
from muse2api.core.models import resolve_model
from muse2api.drivers.base import ImageRequest, InputImage
from muse2api.errors import InvalidRequest, NotFound
from pydantic import BaseModel, Field

from studio_media import FFmpegError, _hidden, _media_name, find_ffmpeg, probe

router = APIRouter(prefix="/studio", tags=["studio-library"], dependencies=[Depends(require_admin_key)])

_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
_VIDEO_EXT = {".mp4", ".webm", ".mov"}


# ---------------------------------------------------------------- chỉ mục nguồn gốc media
def _index_path(request: Request) -> Path:
    return Path(request.app.state.services.settings.data_dir) / "studio" / "media_index.json"


def load_index(request: Request) -> dict[str, dict[str, Any]]:
    try:
        return json.loads(_index_path(request).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _save_index(request: Request, index: dict[str, dict[str, Any]]) -> None:
    path = _index_path(request)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def index_set(request: Request, name: str, **meta: Any) -> None:
    index = load_index(request)
    index[name] = {**index.get(name, {}), **{k: v for k, v in meta.items() if v is not None}}
    _save_index(request, index)


def _kind_of(name: str) -> str | None:
    ext = Path(name).suffix.lower()
    return "image" if ext in _IMAGE_EXT else "video" if ext in _VIDEO_EXT else None


def _task_media(request: Request) -> dict[str, dict[str, Any]]:
    """Tên file media -> task đã tạo ra nó (prompt, loại)."""
    out: dict[str, dict[str, Any]] = {}
    for task in request.app.state.services.tasks.list(limit=2000):
        result = task.result or {}
        urls = [result.get("url")] + [d.get("url") for d in result.get("data") or [] if isinstance(d, dict)]
        for url in filter(None, urls):
            out[_media_name(url)] = {"task_id": task.id, "prompt": task.request.get("prompt") or "",
                                    "source": task.kind, "voice": task.request.get("voice")}
    return out


# ---------------------------------------------------------------- thư viện
@router.get("/library")
async def library(request: Request, kind: str = "", q: str = "", favorite: bool = False,
                  limit: int = 400) -> dict:
    svc = request.app.state.services
    root: Path = svc.media.root
    index = load_index(request)
    tasks = _task_media(request)
    base = public_base(request)
    needle = q.strip().lower()
    items = []
    for f in root.iterdir():
        k = _kind_of(f.name)
        if not k or not f.is_file() or (kind and kind != k):
            continue
        meta = {**tasks.get(f.name, {}), **index.get(f.name, {})}
        if favorite and not meta.get("favorite"):
            continue
        if needle and needle not in " ".join(
                str(meta.get(x) or "") for x in ("prompt", "note", "source", "name")).lower():
            continue
        st = f.stat()
        items.append({
            "name": f.name, "url": f"{base}/v1/media/{f.name}", "kind": k, "size": st.st_size,
            "created": meta.get("created") or st.st_mtime,
            "source": meta.get("source") or ("image" if k == "image" else "video"),
            "prompt": meta.get("prompt") or "", "note": meta.get("note") or "",
            "favorite": bool(meta.get("favorite")), "parent": meta.get("parent"),
            "voice": meta.get("voice"),
        })
    items.sort(key=lambda x: x["created"], reverse=True)
    return {"data": items[:max(1, min(limit, 2000))], "total": len(items)}


class LibraryPatch(BaseModel):
    favorite: bool | None = None
    note: str | None = Field(default=None, max_length=500)


@router.patch("/library/{name}")
async def patch_item(name: str, body: LibraryPatch, request: Request) -> dict:
    request.app.state.services.media.path_of(name)  # 404 nếu không có
    index_set(request, name, favorite=body.favorite, note=body.note)
    return {"name": name, **load_index(request).get(name, {})}


@router.delete("/library/{name}")
async def delete_item(name: str, request: Request) -> dict:
    path = request.app.state.services.media.path_of(name)
    path.unlink()
    index = load_index(request)
    if index.pop(name, None) is not None:
        _save_index(request, index)
    return {"deleted": name}


# ---------------------------------------------------------------- hậu kỳ (FFmpeg)
def _ffmpeg() -> str:
    ff = find_ffmpeg()
    if not ff:
        raise FFmpegError("Không tìm thấy FFmpeg: cài FFmpeg (có trong PATH) hoặc đặt MUSE2API_FFMPEG_PATH")
    return ff


def _run(cmd: list[str], target: Path) -> None:
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore",
                          check=False, timeout=1800, **_hidden())
    if proc.returncode != 0 or not target.is_file() or target.stat().st_size == 0:
        tail = "\n".join(proc.stderr.strip().splitlines()[-5:])
        raise FFmpegError(f"FFmpeg xử lý thất bại ({proc.returncode}): {tail}")


def _even(n: float) -> int:
    return max(2, int(round(n / 2)) * 2)


async def _process(request: Request, media: str, build, *, out_ext: str | None = None,
                   source: str, extra: dict | None = None) -> dict:
    """Chạy FFmpeg trên file media `media` và lưu kết quả thành media mới."""
    svc = request.app.state.services
    src_name = _media_name(media)
    src = svc.media.path_of(src_name)
    kind = _kind_of(src_name)
    if not kind:
        raise InvalidRequest("chỉ xử lý được ảnh hoặc video")
    ff = _ffmpeg()
    info = await asyncio.to_thread(probe, ff, src)
    ext = out_ext or src.suffix.lower()
    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp) / f"out{ext}"
        cmd = build(ff, src, target, info, kind)
        await asyncio.to_thread(_run, cmd, target)
        data = target.read_bytes()
    mime = svc.media.mime_of(f"x{ext}")
    name = svc.media.save(data, mime, prefix="img" if _kind_of(f"x{ext}") == "image" else "vid")
    prompt = load_index(request).get(src_name, {}).get("prompt") or _task_media(request).get(src_name, {}).get("prompt")
    index_set(request, name, source=source, parent=src_name, prompt=prompt, created=time.time(), **(extra or {}))
    return {"name": name, "url": f"{public_base(request)}/v1/media/{name}", "kind": _kind_of(name)}


class FrameRequest(BaseModel):
    media: str
    # Giây cần cắt; None = khung cuối
    time: float | None = Field(default=None, ge=0)


@router.post("/post/frame")
async def cut_frame(body: FrameRequest, request: Request) -> dict:
    def build(ff, src, target, info, kind):
        if kind != "video":
            raise InvalidRequest("chỉ cắt khung hình từ video")
        if body.time is None:
            seek = ["-sseof", "-0.15"]
        else:
            seek = ["-ss", f"{min(body.time, max(0.0, info['seconds'] - 0.05)):.3f}"]
        return [ff, "-hide_banner", "-y", *seek, "-i", str(src), "-frames:v", "1", "-q:v", "2", str(target)]

    return await _process(request, body.media, build, out_ext=".jpg", source="frame",
                          extra={"time": body.time})


class UpscaleRequest(BaseModel):
    media: str
    # Chiều cạnh ngắn mong muốn (720 / 1080 / 1440 / 2160)
    short_side: int = Field(default=1080, ge=480, le=2160)
    sharpen: bool = True


@router.post("/post/upscale")
async def upscale(body: UpscaleRequest, request: Request) -> dict:
    def build(ff, src, target, info, kind):
        w, h = info["w"], info["h"]
        short = min(w, h)
        if short >= body.short_side:
            raise InvalidRequest(f"file đã có cạnh ngắn {short}px, không cần nâng lên {body.short_side}px")
        k = body.short_side / short
        vf = f"scale={_even(w * k)}:{_even(h * k)}:flags=lanczos"
        if body.sharpen:
            vf += ",unsharp=5:5:0.6:5:5:0.0"
        if kind == "image":
            return [ff, "-hide_banner", "-y", "-i", str(src), "-vf", vf, "-frames:v", "1", str(target)]
        return [ff, "-hide_banner", "-y", "-i", str(src), "-vf", vf, "-c:v", "libx264", "-preset", "medium",
                "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", str(target)]

    return await _process(request, body.media, build, source="upscale", extra={"short_side": body.short_side})


class Region(BaseModel):
    """Vùng theo tỉ lệ khung (0..1) tính từ góc trên trái."""
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(gt=0, le=1)
    h: float = Field(gt=0, le=1)


class BlurRequest(BaseModel):
    media: str
    regions: list[Region] = Field(min_length=1, max_length=8)
    mode: Literal["blur", "pixelate"] = "blur"
    strength: int = Field(default=20, ge=2, le=60)


def blur_filter(regions: list[Region], w: int, h: int, mode: str, strength: int) -> str:
    """Filtergraph làm mờ từng vùng rồi phủ lại đúng chỗ (đầu ra nhãn [out])."""
    boxes = []
    for r in regions:
        x, y = int(r.x * w), int(r.y * h)
        # không vượt mép khung, kích thước chẵn (yêu cầu của yuv420p)
        bw = min(_even(r.w * w), (w - x) // 2 * 2)
        bh = min(_even(r.h * h), (h - y) // 2 * 2)
        if bw >= 4 and bh >= 4:
            boxes.append((x, y, bw, bh))
    if not boxes:
        raise InvalidRequest("vùng chọn quá nhỏ")
    n = len(boxes)
    parts = [f"[0:v]split={n + 1}[base]" + "".join(f"[c{i}]" for i in range(n))]
    for i, (x, y, bw, bh) in enumerate(boxes):
        if mode == "pixelate":
            cell = max(2, strength // 2)
            eff = f"scale={max(1, bw // cell)}:{max(1, bh // cell)},scale={bw}:{bh}:flags=neighbor"
        else:
            # kênh màu (yuv420) chỉ bằng nửa kích thước nên bán kính phải nhỏ hơn
            luma = max(1, min(strength, bw // 2 - 1, bh // 2 - 1))
            chroma = max(1, min(strength, bw // 4 - 1, bh // 4 - 1))
            eff = f"boxblur=luma_radius={luma}:luma_power=2:chroma_radius={chroma}:chroma_power=2"
        parts.append(f"[c{i}]crop={bw}:{bh}:{x}:{y},{eff}[b{i}]")
    prev = "base"
    for i, (x, y, _, _) in enumerate(boxes):
        out = "out" if i == n - 1 else f"o{i}"
        parts.append(f"[{prev}][b{i}]overlay={x}:{y}[{out}]")
        prev = out
    return ";".join(parts)


@router.post("/post/blur")
async def blur(body: BlurRequest, request: Request) -> dict:
    def build(ff, src, target, info, kind):
        graph = blur_filter(body.regions, info["w"], info["h"], body.mode, body.strength)
        if kind == "image":
            return [ff, "-hide_banner", "-y", "-i", str(src), "-filter_complex", graph, "-map", "[out]",
                    "-frames:v", "1", str(target)]
        return [ff, "-hide_banner", "-y", "-i", str(src), "-filter_complex", graph, "-map", "[out]",
                "-map", "0:a?", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
                "-c:a", "copy", "-movflags", "+faststart", str(target)]

    return await _process(request, body.media, build, source="blur",
                          extra={"regions": [r.model_dump() for r in body.regions], "mode": body.mode})


# ---------------------------------------------------------------- AI tạo chân dung
class PortraitRequest(BaseModel):
    name: str = Field(default="", max_length=80)
    description: str = Field(min_length=3, max_length=1500)
    style: str = Field(default="", max_length=600)
    size: str = Field(default="9:16", max_length=10)
    n: int = Field(default=2, ge=1, le=4)
    # Ảnh tham chiếu (data URL / URL) để giữ mặt khi tạo thêm góc khác
    reference: str | None = None


def portrait_prompt(body: PortraitRequest) -> str:
    who = f"{body.name}: {body.description}" if body.name else body.description
    # Hoạt hình 3D (Cài đặt ➔ Nhân vật chọn "Hoạt hình 3D"): khung prompt riêng — khung "photorealistic, studio" bên dưới
    # kéo ảnh về người thật, ngược với phong cách cần giữ cho mẫu Phim 3D Chuyện Đời.
    if re.search(r"3D CGI animated|hoạt hình 3D|pixar", body.style or "", re.I):
        return (
            "Single-frame 3D CGI animated film character render, ONE character only, one single undivided frame "
            "(no collage, no split screen, no text). Stylized appealing proportions (slightly large head, big expressive "
            "glossy eyes, soft rounded facial features), smooth skin with subsurface scattering, detailed 3D hair and cloth, "
            "warm cinematic lighting, vivid colors, softly blurred simple background. Front-facing, looking at the camera, "
            "gentle expression. "
            f"Character — {who}. {body.style}".strip()
        )
    return (
        "Single-frame solo portrait photo, ONE person only, one single undivided frame (no collage, "
        "no split screen). Front-facing, looking at the camera, head and upper body clearly visible, "
        "neutral expression with a light natural smile, plain light-grey studio background, soft even "
        "lighting, photorealistic, sharp facial details, natural skin texture. "
        f"Character — {who}. {body.style}".strip()
    )


@router.post("/portrait")
async def portrait(body: PortraitRequest, request: Request) -> dict:
    svc = request.app.state.services
    refs = [InputImage(*(await load_image_ref(body.reference)))] if body.reference else []
    prompt = portrait_prompt(body)
    req = ImageRequest(prompt=prompt, model=resolve_model(None, "image").id, size=body.size, n=body.n,
                       reference_images=refs, timeout=svc.settings.image_timeout)
    results = await svc.gateway.generate_image(req)
    base = public_base(request)
    out = []
    for r in results:
        name = svc.media.save(r.data, r.mime, prefix="img")
        index_set(request, name, source="portrait", prompt=prompt, note=body.name or None, created=time.time())
        out.append({"name": name, "url": f"{base}/v1/media/{name}"})
    if not out:
        raise NotFound("muse.ai không trả về ảnh nào")
    return {"data": out, "prompt": prompt}


class UploadRequest(BaseModel):
    # data URL ảnh / video (ảnh tải lên, ảnh AI trả base64) — lưu thành media để hậu kỳ / xuất file
    data: str = Field(min_length=16, max_length=60_000_000)
    source: str = Field(default="upload", max_length=40)
    note: str | None = Field(default=None, max_length=200)


@router.post("/media/upload")
async def upload_media(body: UploadRequest, request: Request) -> dict:
    svc = request.app.state.services
    if not body.data.startswith("data:"):
        raise InvalidRequest("data phải là data URL (data:image/...;base64,...)")
    raw, mime = await load_image_ref(body.data)
    kind = "video" if mime.startswith("video/") else "image"
    name = svc.media.save(raw, mime, prefix="vid" if kind == "video" else "img")
    index_set(request, name, source=body.source, note=body.note, created=time.time())
    return {"name": name, "url": f"{public_base(request)}/v1/media/{name}", "kind": kind}
