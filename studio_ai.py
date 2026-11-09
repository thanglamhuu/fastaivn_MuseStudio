"""API /studio/ai: gọi AI bên ngoài (Gemini xoay vòng nhiều key, hoặc endpoint tương thích OpenAI)
để viết kịch bản. Gắn vào app muse2api như studio_api.py.

- GET  /studio/ai/config     cấu hình hiện tại (key đã che)
- PUT  /studio/ai/config     lưu cấu hình (data/studio/ai_config.json)
- POST /studio/ai/test       kiểm tra từng Gemini key / endpoint OpenAI
- POST /studio/ai/chat       gửi prompt (+ ảnh) -> {text, source, model, key_index}

Thứ tự thử: theo ``prefer`` ("auto" = Gemini rồi OpenAI). Gemini key bị giới hạn (429), hết
quota hoặc lỗi thì tự chuyển sang key kế tiếp. Không có nhà cung cấp nào dùng được thì trả
lỗi ``no_ai_provider`` và giao diện tự quay về muse-chat (cơ chế viết kịch bản cũ).
"""

from __future__ import annotations

import json
import logging
import re
import threading
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, Depends, Request
from muse2api.api.deps import require_admin_key
from muse2api.errors import InvalidRequest, Muse2APIError
from pydantic import BaseModel, Field

log = logging.getLogger("musestudio.ai")

router = APIRouter(prefix="/studio/ai", tags=["studio-ai"], dependencies=[Depends(require_admin_key)])

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
TIMEOUT_S = 120.0
MASK = "••••"

_lock = threading.Lock()
_next_key = {"i": 0}  # vị trí key Gemini dùng cho lần gọi kế tiếp (xoay vòng)


class NoAIProvider(Muse2APIError):
    status_code = 503
    code = "no_ai_provider"


class AIProviderError(Muse2APIError):
    status_code = 502
    code = "ai_provider_failed"


# ---------------------------------------------------------------- config
def _config_file(request: Request) -> Path:
    return Path(request.app.state.services.settings.data_dir) / "studio" / "ai_config.json"


DEFAULTS: dict[str, Any] = {
    "prefer": "auto",  # auto | gemini | openai | muse
    "gemini_keys": [],
    "gemini_model": DEFAULT_GEMINI_MODEL,
    "openai_base_url": "",
    "openai_api_key": "",
    "openai_model": "",
}


def load_config(request: Request) -> dict[str, Any]:
    f = _config_file(request)
    data: dict[str, Any] = {}
    if f.is_file():
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except ValueError:
            log.warning("ai_config.json hỏng, dùng mặc định")
    return {**DEFAULTS, **data}


def _mask(key: str) -> str:
    return f"{key[:6]}{MASK}{key[-4:]}" if len(key) > 12 else MASK


def public_config(cfg: dict[str, Any]) -> dict[str, Any]:
    return {
        "prefer": cfg["prefer"],
        "gemini_keys": [_mask(k) for k in cfg["gemini_keys"]],
        "gemini_key_count": len(cfg["gemini_keys"]),
        "gemini_model": cfg["gemini_model"],
        "openai_base_url": cfg["openai_base_url"],
        "openai_api_key": _mask(cfg["openai_api_key"]) if cfg["openai_api_key"] else "",
        "openai_model": cfg["openai_model"],
    }


def parse_keys(text: str) -> list[str]:
    """Mỗi dòng 1 key; bỏ dòng trống, chú thích và key trùng."""
    out: list[str] = []
    for line in re.split(r"[\r\n,;]+", text or ""):
        key = line.strip().split()[0] if line.strip() else ""
        if key and not key.startswith("#") and key not in out:
            out.append(key)
    return out


class AIConfigUpdate(BaseModel):
    prefer: str | None = Field(default=None, pattern="^(auto|gemini|openai|muse)$")
    # Danh sách key mới (mỗi dòng 1 key). None = giữ nguyên. Dòng đang bị che (••••) = giữ key cũ đó.
    gemini_keys_text: str | None = None
    gemini_model: str | None = Field(default=None, max_length=100)
    openai_base_url: str | None = Field(default=None, max_length=300)
    openai_api_key: str | None = Field(default=None, max_length=500)
    openai_model: str | None = Field(default=None, max_length=100)


@router.get("/config")
async def get_config(request: Request) -> dict:
    return public_config(load_config(request))


@router.put("/config")
async def put_config(body: AIConfigUpdate, request: Request) -> dict:
    cfg = load_config(request)
    if body.prefer is not None:
        cfg["prefer"] = body.prefer
    if body.gemini_keys_text is not None:
        old = {(_mask(k)): k for k in cfg["gemini_keys"]}
        keys = []
        for k in parse_keys(body.gemini_keys_text):
            k = old.get(k, k)  # dòng bị che -> key cũ
            if MASK in k:
                continue
            if k not in keys:
                keys.append(k)
        cfg["gemini_keys"] = keys
    if body.gemini_model is not None:
        cfg["gemini_model"] = body.gemini_model.strip() or DEFAULT_GEMINI_MODEL
    if body.openai_base_url is not None:
        url = body.openai_base_url.strip().rstrip("/")
        if url and not re.match(r"^https?://", url):
            raise InvalidRequest("Base URL phải bắt đầu bằng http:// hoặc https://")
        cfg["openai_base_url"] = url
    if body.openai_api_key is not None and MASK not in body.openai_api_key:
        cfg["openai_api_key"] = body.openai_api_key.strip()
    if body.openai_model is not None:
        cfg["openai_model"] = body.openai_model.strip()
    f = _config_file(request)
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(cfg, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(f)
    return public_config(cfg)


# ---------------------------------------------------------------- providers
def _split_data_url(url: str) -> tuple[str, str] | None:
    m = re.match(r"^data:([\w/+.-]+);base64,(.+)$", url or "", re.DOTALL)
    return (m.group(1), m.group(2)) if m else None


def _image_parts(images: list[str]) -> list[tuple[str, str]]:
    """(mime, base64) cho từng ảnh data URL (tối đa 4)."""
    return [p for p in (_split_data_url(u) for u in images[:4]) if p]


def _gemini_error_is_retryable(status: int, body: str) -> bool:
    # 429 = hết hạn mức / quá nhanh; 403 = key bị khóa / sai; 400 API_KEY_INVALID; 5xx = lỗi máy chủ
    return status in (401, 403, 429) or status >= 500 or "API_KEY_INVALID" in body


async def call_gemini(cfg: dict[str, Any], prompt: str, images: list[tuple[str, str]],
                      want_json: bool, client: httpx.AsyncClient) -> dict[str, Any]:
    keys: list[str] = cfg["gemini_keys"]
    if not keys:
        raise NoAIProvider("chưa có Gemini API key")
    model = cfg["gemini_model"] or DEFAULT_GEMINI_MODEL
    parts: list[dict[str, Any]] = [{"text": prompt}]
    parts += [{"inline_data": {"mime_type": mime, "data": data}} for mime, data in images]
    body: dict[str, Any] = {"contents": [{"role": "user", "parts": parts}]}
    if want_json:
        body["generationConfig"] = {"responseMimeType": "application/json"}
    with _lock:
        start = _next_key["i"] % len(keys)
        _next_key["i"] = start + 1
    errors = []
    for step in range(len(keys)):
        idx = (start + step) % len(keys)
        try:
            resp = await client.post(f"{GEMINI_BASE}/models/{model}:generateContent",
                                     params={"key": keys[idx]}, json=body, timeout=TIMEOUT_S)
        except httpx.HTTPError as exc:
            errors.append(f"key #{idx + 1}: {type(exc).__name__}")
            continue
        if resp.status_code == 200:
            data = resp.json()
            cands = data.get("candidates") or []
            text = "".join(p.get("text", "") for c in cands[:1]
                           for p in (c.get("content") or {}).get("parts", []))
            if text.strip():
                with _lock:
                    _next_key["i"] = idx + 1
                return {"text": text, "source": "gemini", "model": model, "key_index": idx + 1}
            reason = (cands[0].get("finishReason") if cands else None) or \
                (data.get("promptFeedback") or {}).get("blockReason") or "trả lời rỗng"
            errors.append(f"key #{idx + 1}: {reason}")
            continue
        msg = resp.text[:300]
        errors.append(f"key #{idx + 1}: HTTP {resp.status_code}")
        if not _gemini_error_is_retryable(resp.status_code, msg):
            raise AIProviderError(f"Gemini từ chối yêu cầu (HTTP {resp.status_code}): {msg}")
    raise AIProviderError("Mọi Gemini key đều lỗi: " + "; ".join(errors))


async def call_openai(cfg: dict[str, Any], prompt: str, images: list[tuple[str, str]],
                      want_json: bool, client: httpx.AsyncClient) -> dict[str, Any]:
    base, key, model = cfg["openai_base_url"], cfg["openai_api_key"], cfg["openai_model"]
    if not (base and model):
        raise NoAIProvider("chưa cấu hình endpoint OpenAI")
    content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    content += [{"type": "image_url", "image_url": {"url": f"data:{m};base64,{d}"}} for m, d in images]
    body: dict[str, Any] = {"model": model, "messages": [{"role": "user", "content": content}]}
    if want_json:
        body["response_format"] = {"type": "json_object"}
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    url = base if base.endswith("/chat/completions") else f"{base}/chat/completions"
    try:
        resp = await client.post(url, json=body, headers=headers, timeout=TIMEOUT_S)
        if resp.status_code == 400 and want_json:
            # Một số endpoint không hỗ trợ response_format: thử lại không có nó
            body.pop("response_format", None)
            resp = await client.post(url, json=body, headers=headers, timeout=TIMEOUT_S)
    except httpx.HTTPError as exc:
        raise AIProviderError(f"Không gọi được endpoint OpenAI: {type(exc).__name__}") from exc
    if resp.status_code != 200:
        raise AIProviderError(f"Endpoint OpenAI trả HTTP {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    text = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    if not text.strip():
        raise AIProviderError("Endpoint OpenAI trả lời rỗng")
    return {"text": text, "source": "openai", "model": model, "key_index": None}


def provider_order(cfg: dict[str, Any]) -> list[str]:
    prefer = cfg.get("prefer", "auto")
    if prefer == "muse":
        return []
    if prefer == "openai":
        return ["openai", "gemini"]
    return ["gemini", "openai"]


class ChatRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=60_000)
    images: list[str] = Field(default_factory=list, max_length=4, description="data URL")
    json_output: bool = True


@router.post("/chat")
async def chat(body: ChatRequest, request: Request) -> dict:
    cfg = load_config(request)
    errors = []
    async with httpx.AsyncClient(transport=getattr(request.app.state, "ai_transport", None),
                                 trust_env=True) as client:
        images = _image_parts(body.images)
        for name in provider_order(cfg):
            fn = call_gemini if name == "gemini" else call_openai
            try:
                return await fn(cfg, body.prompt, images, body.json_output, client)
            except NoAIProvider:
                continue
            except AIProviderError as exc:
                log.warning("AI %s lỗi: %s", name, exc.message)
                errors.append(f"{name}: {exc.message}")
    if errors:
        raise AIProviderError(" | ".join(errors))
    raise NoAIProvider("Chưa cấu hình Gemini / OpenAI (hoặc đang chọn dùng muse-chat)")


class TestRequest(BaseModel):
    provider: str = Field(pattern="^(gemini|openai)$")


@router.post("/test")
async def test(body: TestRequest, request: Request) -> dict:
    """Kiểm tra key: Gemini gọi danh sách model (không tốn quota); OpenAI gọi 1 câu rất ngắn."""
    cfg = load_config(request)
    results = []
    async with httpx.AsyncClient(transport=getattr(request.app.state, "ai_transport", None),
                                 trust_env=True, timeout=20) as client:
        if body.provider == "gemini":
            for i, key in enumerate(cfg["gemini_keys"]):
                try:
                    r = await client.get(f"{GEMINI_BASE}/models", params={"key": key, "pageSize": 1})
                    ok = r.status_code == 200
                    results.append({"index": i + 1, "key": _mask(key), "ok": ok,
                                    "detail": "" if ok else f"HTTP {r.status_code}"})
                except httpx.HTTPError as exc:
                    results.append({"index": i + 1, "key": _mask(key), "ok": False,
                                    "detail": type(exc).__name__})
        else:
            try:
                res = await call_openai(cfg, "Reply with OK", [], False, client)
                results.append({"index": 1, "ok": True, "detail": res["text"][:40]})
            except Muse2APIError as exc:
                results.append({"index": 1, "ok": False, "detail": exc.message[:200]})
    return {"provider": body.provider, "results": results}
