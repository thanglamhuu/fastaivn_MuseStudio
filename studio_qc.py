"""Tự chấm điểm ảnh / clip sau khi tạo (QC) — so MẶT với ảnh nhân vật tham chiếu, đo CAO ĐỘ giọng.

Chuyển từ công cụ chạy thử TestWorkFlow/_tools/eval_wf.py (đã dùng chấm 22 mẫu):
- Mặt: OpenCV YuNet (dò mặt) + SFace (đặc trưng mặt), cosine ≥ 0.363 = cùng người (ngưỡng OpenCV Zoo). Mỗi mặt trong khung
  gán cho nhân vật giống nhất; ảnh tham chiếu lấy mặt lớn nhất (ảnh sheet ghép toàn thân + cận mặt).
- Giọng: tách tiếng bằng ffmpeg (mono 16 kHz), cao độ trung vị bằng tự tương quan khung 40 ms
  (nam ~85-165 Hz, nữ ~190-260 Hz, trẻ em ~280-400 Hz; 165-190 Hz = không kết luận).

API (khóa admin):
- POST /studio/qc/face   {media, refs: [{name, image}], max_frames} → điểm từng nhân vật + kết luận pass / fail / unknown
- POST /studio/qc/voice  {media, expect?: male|female|child} → cao độ + giới tính đoán + kết luận
- GET  /studio/qc/status → có OpenCV / mô hình chưa (runtime bỏ qua QC nếu chưa có)

``media`` / ``image``: data URL, URL ``…/v1/media/<tên>`` (đọc thẳng file trong data/media) hoặc tên file trong data/media.
Mô hình: models/face/yunet.onnx (trong repo) + sface.onnx (38 MB, không đưa vào git — tự tải lần đầu từ OpenCV Zoo, kiểm sha256;
bản exe kèm sẵn ở models/face cạnh exe).
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from muse2api.api.deps import require_admin_key
from muse2api.errors import InvalidRequest, UpstreamError

log = logging.getLogger("musestudio.qc")
router = APIRouter(prefix="/studio/qc", tags=["studio"], dependencies=[Depends(require_admin_key)])

SAME_TH = 0.363  # cosine SFace: ≥ ngưỡng = cùng người
MIN_FACE = 36  # mặt nhỏ hơn 36×36 px bỏ qua (quá nhỏ để so)
REF_FACE_WARN = 120  # mặt trong ảnh tham chiếu nhỏ hơn → cảnh báo (đo được: ảnh 640×480 mặt ~100 px giữ mặt kém)
MODELS = {
    "yunet.onnx": ("https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
                   "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"),
    "sface.onnx": ("https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
                   "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79"),
}

_lock = threading.Lock()
# Bộ dò mặt YuNet giữ kích thước ảnh trong đối tượng (setInputSize) → chấm lần lượt, không song song
_score_lock = threading.Lock()
_engine: dict[str, Any] = {}
_ref_cache: dict[str, Any] = {}


# ---------------------------------------------------------------- mô hình
def _model_dirs(data_dir: Path | None) -> list[Path]:
    dirs = []
    if env := os.environ.get("MUSESTUDIO_FACE_MODELS", "").strip():
        dirs.append(Path(env))
    if getattr(sys, "frozen", False):
        dirs.append(Path(sys.executable).resolve().parent / "models" / "face")
    dirs.append(Path(__file__).resolve().parent / "models" / "face")
    if data_dir:
        dirs.append(Path(data_dir) / "models" / "face")
    return dirs


def _find_model(name: str, data_dir: Path | None) -> Path | None:
    return next((d / name for d in _model_dirs(data_dir) if (d / name).is_file()), None)


def _download_model(name: str, data_dir: Path) -> Path:
    url, sha = MODELS[name]
    dest = Path(data_dir) / "models" / "face" / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    log.info("tải mô hình %s từ %s", name, url)
    h = hashlib.sha256()
    tmp = dest.with_suffix(".part")
    with httpx.stream("GET", url, follow_redirects=True, timeout=120) as r, tmp.open("wb") as f:
        r.raise_for_status()
        for chunk in r.iter_bytes():
            h.update(chunk)
            f.write(chunk)
    if h.hexdigest() != sha:
        tmp.unlink(missing_ok=True)
        raise UpstreamError(f"mô hình {name} tải về sai mã kiểm tra (sha256)")
    tmp.replace(dest)
    return dest


def engine(data_dir: Path | None = None) -> dict[str, Any]:
    """OpenCV + YuNet + SFace (nạp 1 lần). Thiếu mô hình thì tải; thiếu OpenCV → UpstreamError."""
    with _lock:
        if _engine:
            return _engine
        try:
            import cv2  # noqa: F401
            import numpy  # noqa: F401
        except ImportError as exc:
            raise UpstreamError("chưa cài OpenCV (pip install opencv-python-headless numpy) — bỏ qua chấm điểm") from exc
        import cv2

        paths = {}
        for name in MODELS:
            p = _find_model(name, data_dir)
            if p is None:
                if data_dir is None:
                    raise UpstreamError(f"thiếu mô hình {name}")
                p = _download_model(name, data_dir)
            paths[name] = p
        _engine["cv2"] = cv2
        _engine["det"] = cv2.FaceDetectorYN.create(str(paths["yunet.onnx"]), "", (320, 320), 0.7, 0.3, 5000)
        _engine["rec"] = cv2.FaceRecognizerSF.create(str(paths["sface.onnx"]), "")
        return _engine


def status(data_dir: Path | None = None) -> dict[str, Any]:
    try:
        import cv2  # noqa: F401
        have_cv = True
    except ImportError:
        have_cv = False
    return {"opencv": have_cv, "models": {n: str(p) if (p := _find_model(n, data_dir)) else None for n in MODELS}}


# ---------------------------------------------------------------- đọc ảnh / video
def _media_file(ref: str, data_dir: Path) -> Path | None:
    if "/v1/media/" in ref:
        name = ref.rstrip("/").rsplit("/v1/media/", 1)[-1].split("?", 1)[0]
    elif "/" not in ref and "\\" not in ref and not ref.startswith("data:"):
        name = ref
    else:
        return None
    p = (Path(data_dir) / "media" / name).resolve()
    return p if p.is_file() and (Path(data_dir) / "media").resolve() in p.parents else None


def load_bytes(ref: str, data_dir: Path) -> tuple[bytes, str]:
    """(nội dung, đuôi file) từ data URL / URL /v1/media / tên file trong data/media / URL http(s)."""
    if ref.startswith("data:"):
        head, _, b64 = ref.partition(",")
        mime = head[5:].split(";")[0]
        ext = {"image/png": ".png", "image/webp": ".webp", "video/mp4": ".mp4", "audio/wav": ".wav",
               "audio/x-wav": ".wav", "audio/mpeg": ".mp3"}.get(mime, ".jpg")
        return base64.b64decode(b64), ext
    if (p := _media_file(ref, data_dir)) is not None:
        return p.read_bytes(), p.suffix.lower()
    if ref.startswith(("http://", "https://")):
        r = httpx.get(ref, timeout=60, follow_redirects=True)
        r.raise_for_status()
        ext = ".mp4" if "video" in r.headers.get("content-type", "") or ref.split("?")[0].endswith(".mp4") else ".jpg"
        return r.content, ext
    raise InvalidRequest(f"không đọc được media: {ref[:80]}")


def _decode_image(data: bytes):
    import numpy as np

    cv2 = engine()["cv2"]
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise InvalidRequest("ảnh không đọc được")
    return img


def _video_frames(data: bytes, ext: str, max_frames: int) -> list:
    cv2 = engine()["cv2"]
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / f"v{ext or '.mp4'}"
        p.write_bytes(data)
        cap = cv2.VideoCapture(str(p))
        n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        idx = [int(i * (n - 1) / max(1, max_frames - 1)) for i in range(max_frames)] if n > 1 else [0]
        frames = []
        for i in sorted(set(idx)):
            cap.set(cv2.CAP_PROP_POS_FRAMES, i)
            ok, fr = cap.read()
            if ok and fr is not None:
                frames.append(fr)
        cap.release()
    return frames


def _faces(img) -> list[tuple[float, Any, int]]:
    """[(diện tích, đặc trưng SFace, cạnh mặt px)] — ảnh rất lớn thu nhỏ còn 1280 (YuNet bỏ sót mặt trên ảnh 2048)."""
    e = engine()
    cv2, det, rec = e["cv2"], e["det"], e["rec"]
    if max(img.shape[:2]) > 1280:
        k = 1280 / max(img.shape[:2])
        img = cv2.resize(img, (int(img.shape[1] * k), int(img.shape[0] * k)), interpolation=cv2.INTER_AREA)
    h, w = img.shape[:2]
    det.setInputSize((w, h))
    _, fs = det.detect(img)
    out = []
    for f in fs if fs is not None else []:
        if f[2] < MIN_FACE or f[3] < MIN_FACE:
            continue
        out.append((float(f[2] * f[3]), rec.feature(rec.alignCrop(img, f)), int(min(f[2], f[3]))))
    return out


def _ref_feature(name: str, image: str, data_dir: Path) -> tuple[Any, int]:
    """(đặc trưng mặt lớn nhất, cạnh mặt px) của ảnh tham chiếu — lưu đệm theo nội dung ảnh."""
    data, _ = load_bytes(image, data_dir)
    key = hashlib.sha1(data).hexdigest()
    if key not in _ref_cache:
        fs = _faces(_decode_image(data))
        if not fs:
            _ref_cache[key] = (None, 0)
        else:
            fs.sort(key=lambda x: -x[0])
            _ref_cache[key] = (fs[0][1], fs[0][2])
        if len(_ref_cache) > 256:
            _ref_cache.pop(next(iter(_ref_cache)))
    return _ref_cache[key]


# ---------------------------------------------------------------- chấm mặt
def score_faces(media: str, refs: list[dict[str, str]], data_dir: Path, max_frames: int = 12,
                threshold: float = 0.7) -> dict[str, Any]:
    """Mặt trong ảnh / clip có giống ảnh nhân vật tham chiếu không.

    Mỗi nhân vật: ``rate`` = tỉ lệ khung có mặt người đó mà cosine ≥ 0.363 (giống ``same_rate`` của eval_wf.py), ``best`` =
    cosine cao nhất. ``verdict``: pass (mọi nhân vật xuất hiện đều đạt ``threshold``), fail (có nhân vật xuất hiện mà dưới
    ngưỡng), unknown (không thấy mặt nào / ảnh tham chiếu không có mặt) — unknown KHÔNG phải trượt.
    """
    e = engine(data_dir)
    cv2, rec = e["cv2"], e["rec"]
    chars: dict[str, Any] = {}
    ref_issues = []
    for r in refs:
        name = (r.get("name") or "nhân vật").lstrip("@")
        feat, side = _ref_feature(name, r["image"], data_dir)
        if feat is None:
            ref_issues.append({"name": name, "issue": "ảnh tham chiếu không thấy mặt"})
            continue
        if side < REF_FACE_WARN:
            ref_issues.append({"name": name, "face_px": side,
                               "issue": f"mặt trong ảnh tham chiếu nhỏ ({side} px) — nên dùng ảnh cận mặt rõ ≥ 1024 px"})
        chars[name] = feat
    data, ext = load_bytes(media, data_dir)
    is_video = ext in (".mp4", ".webm", ".mov", ".m4v")
    frames = _video_frames(data, ext, max_frames) if is_video else [_decode_image(data)]
    per: dict[str, list[float]] = {c: [] for c in chars}
    with_face = 0
    for img in frames:
        fs = _faces(img)
        with_face += bool(fs)
        best: dict[str, float] = {}
        for _, f, _ in fs:
            sc = {c: float(rec.match(f, rf, cv2.FaceRecognizerSF_FR_COSINE)) for c, rf in chars.items()}
            if sc:
                c = max(sc, key=sc.get)
                best[c] = max(best.get(c, -1.0), sc[c])
        for c, s in best.items():
            per[c].append(s)
    people = []
    for c, arr in per.items():
        rate = sum(s >= SAME_TH for s in arr) / len(arr) if arr else None
        people.append({"name": c, "frames_present": len(arr), "rate": round(rate, 3) if rate is not None else None,
                       "best": round(max(arr), 3) if arr else None})
    present = [p for p in people if p["rate"] is not None]
    if not chars or not present:
        verdict = "unknown"
    else:
        verdict = "pass" if all(p["rate"] >= threshold for p in present) else "fail"
    return {"kind": "video" if is_video else "image", "frames": len(frames), "frames_with_face": with_face,
            "threshold": threshold, "people": people, "verdict": verdict, "ref_issues": ref_issues}


# ---------------------------------------------------------------- đo giọng
def _pitch(x, sr: int) -> float | None:
    import numpy as np

    n = int(0.04 * sr)
    f0s = []
    for i in range(0, len(x) - n, n // 2):
        fr = x[i:i + n] - x[i:i + n].mean()
        if np.sqrt((fr ** 2).mean()) < 0.02:
            continue
        ac = np.correlate(fr, fr, "full")[n - 1:]
        lo, hi = int(sr / 500), int(sr / 70)
        k = lo + int(np.argmax(ac[lo:hi]))
        if ac[k] > 0.35 * ac[0]:
            f0s.append(sr / k)
    return float(np.median(f0s)) if len(f0s) >= 5 else None


def gender_of(hz: float | None) -> str:
    if hz is None:
        return "unknown"
    if hz < 165:
        return "male"
    if hz < 190:
        return "unknown"  # vùng chồng lấn nam / nữ (đo được 177 Hz ở mẫu Nước hoa)
    return "female" if hz < 280 else "child"


def score_voice(media: str, data_dir: Path, expect: str = "", ffmpeg: str | None = None) -> dict[str, Any]:
    import numpy as np

    ff = ffmpeg or shutil.which("ffmpeg")
    if not ff:
        from studio_media import find_ffmpeg

        ff = find_ffmpeg()
    if not ff:
        raise UpstreamError("chưa có ffmpeg — bỏ qua đo giọng")
    data, ext = load_bytes(media, data_dir)
    with tempfile.TemporaryDirectory() as td:
        src = Path(td) / f"v{ext or '.mp4'}"
        src.write_bytes(data)
        r = subprocess.run([ff, "-v", "error", "-i", str(src), "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
                           capture_output=True, timeout=120,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if r.returncode != 0 or not r.stdout:
        return {"pitch_hz": None, "gender": "unknown", "verdict": "unknown", "note": "clip không có tiếng"}
    x = np.frombuffer(r.stdout, np.int16).astype(np.float32) / 32768.0
    hz = _pitch(x, 16000)
    g = gender_of(hz)
    if not expect or g == "unknown":
        verdict = "unknown"
    else:
        verdict = "pass" if g == expect or (expect == "female" and g == "child") else "fail"
    return {"pitch_hz": round(hz, 1) if hz else None, "gender": g, "expect": expect or None, "verdict": verdict}


# ---------------------------------------------------------------- API
def _data_dir(request: Request) -> Path:
    return Path(request.app.state.services.settings.data_dir)


class FaceRef(BaseModel):
    name: str = Field(default="", max_length=80)
    image: str = Field(min_length=1, max_length=40_000_000)


class FaceRequest(BaseModel):
    media: str = Field(min_length=1, max_length=60_000_000)
    refs: list[FaceRef] = Field(min_length=1, max_length=8)
    max_frames: int = Field(default=12, ge=1, le=48)
    threshold: float = Field(default=0.7, ge=0.0, le=1.0)


class VoiceRequest(BaseModel):
    media: str = Field(min_length=1, max_length=60_000_000)
    expect: str = Field(default="", pattern="^(|male|female|child)$")


@router.get("/status")
async def qc_status(request: Request) -> dict:
    return status(_data_dir(request))


@router.post("/face")
async def qc_face(body: FaceRequest, request: Request) -> dict:
    d = _data_dir(request)

    def run() -> dict:
        with _score_lock:
            return score_faces(body.media, [r.model_dump() for r in body.refs], d, body.max_frames, body.threshold)
    return await asyncio.to_thread(run)


@router.post("/voice")
async def qc_voice(body: VoiceRequest, request: Request) -> dict:
    return await asyncio.to_thread(score_voice, body.media, _data_dir(request), body.expect)
