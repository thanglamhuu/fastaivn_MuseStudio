"""Tests for studio_ai.py: Gemini key rotation, OpenAI-compatible fallback, config masking.
No network: Gemini / OpenAI are faked with httpx.MockTransport."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "muse2api" / "src"))

from fastapi.testclient import TestClient
from muse2api.app import create_app
from muse2api.config import Settings
from muse2api.drivers.mock import MockDriver

import studio_ai

KEY = "test-key"
AUTH = {"Authorization": f"Bearer {KEY}"}
GOOD = "AIzaGOODkey1234567890"
BAD = "AIzaBADkey12345678901"


class Fake:
    def __init__(self):
        self.calls: list[tuple[str, str]] = []  # (provider, key/model)
        self.gemini_status = {GOOD: 200, BAD: 429}
        self.openai_status = 200

    def __call__(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "generativelanguage" in url:
            key = request.url.params.get("key")
            self.calls.append(("gemini", key))
            status = self.gemini_status.get(key, 403)
            if url.split("?")[0].endswith("/models"):
                return httpx.Response(status, json={"models": []})
            if status != 200:
                return httpx.Response(status, json={"error": {"message": "quota"}})
            body = json.loads(request.content)
            assert body["generationConfig"]["responseMimeType"] == "application/json"
            n_images = sum(1 for p in body["contents"][0]["parts"] if "inline_data" in p)
            return httpx.Response(200, json={"candidates": [{"content": {"parts": [
                {"text": json.dumps({"scenes": [{"prompt": "p"}], "images": n_images})}]}}]})
        self.calls.append(("openai", json.loads(request.content)["model"]))
        if self.openai_status != 200:
            return httpx.Response(self.openai_status, text="boom")
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"scenes":[]}'}}]})


@pytest.fixture
def ctx(tmp_path):
    settings = Settings(_env_file=None, data_dir=tmp_path / "data", api_key=KEY, driver="mock")
    app = create_app(settings, MockDriver(delay=0))
    app.include_router(studio_ai.router)
    fake = Fake()
    app.state.ai_transport = httpx.MockTransport(fake)
    studio_ai._next_key["i"] = 0
    with TestClient(app) as c:
        yield c, fake


def test_parse_keys():
    assert studio_ai.parse_keys("a1\n\n# note\na1\nb2 extra, c3") == ["a1", "b2", "c3"]


def test_config_is_masked_and_masked_lines_keep_old_keys(ctx):
    c, _ = ctx
    r = c.put("/studio/ai/config", headers=AUTH, json={"gemini_keys_text": f"{GOOD}\n{BAD}",
                                                     "openai_api_key": "sk-secret-value-123"})
    cfg = r.json()
    assert cfg["gemini_key_count"] == 2 and GOOD not in json.dumps(cfg)
    assert "secret" not in cfg["openai_api_key"]
    # Gửi lại đúng các dòng đang bị che + 1 key mới: 2 key cũ được giữ nguyên
    text = "\n".join(cfg["gemini_keys"] + ["AIzaNEWkey99999999999"])
    c.put("/studio/ai/config", headers=AUTH, json={"gemini_keys_text": text,
                                                 "openai_api_key": cfg["openai_api_key"]})
    stored = json.loads((Path(c.app.state.services.settings.data_dir) / "studio" / "ai_config.json").read_text())
    assert stored["gemini_keys"] == [GOOD, BAD, "AIzaNEWkey99999999999"]
    assert stored["openai_api_key"] == "sk-secret-value-123"


def test_gemini_rotates_past_a_rate_limited_key(ctx):
    c, fake = ctx
    c.put("/studio/ai/config", headers=AUTH, json={"gemini_keys_text": f"{BAD}\n{GOOD}"})
    png = "data:image/png;base64,iVBORw0KGgo="
    r = c.post("/studio/ai/chat", headers=AUTH, json={"prompt": "viết kịch bản", "images": [png]})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["source"] == "gemini" and out["key_index"] == 2
    assert json.loads(out["text"])["images"] == 1
    assert [k for p, k in fake.calls if p == "gemini"] == [BAD, GOOD]


def test_falls_back_to_openai_when_all_gemini_keys_fail(ctx):
    c, _ = ctx
    c.put("/studio/ai/config", headers=AUTH, json={
        "gemini_keys_text": BAD, "openai_base_url": "https://llm.example/v1", "openai_model": "gpt-x"})
    out = c.post("/studio/ai/chat", headers=AUTH, json={"prompt": "x"}).json()
    assert out["source"] == "openai" and out["model"] == "gpt-x"


def test_no_provider_is_503_so_the_ui_uses_muse_chat(ctx):
    c, _ = ctx
    r = c.post("/studio/ai/chat", headers=AUTH, json={"prompt": "x"})
    assert r.status_code == 503 and r.json()["error"]["code"] == "no_ai_provider"
    c.put("/studio/ai/config", headers=AUTH, json={"gemini_keys_text": GOOD, "prefer": "muse"})
    assert c.post("/studio/ai/chat", headers=AUTH, json={"prompt": "x"}).status_code == 503


def test_all_providers_failing_is_502(ctx):
    c, fake = ctx
    fake.openai_status = 500
    c.put("/studio/ai/config", headers=AUTH, json={
        "gemini_keys_text": BAD, "openai_base_url": "https://llm.example/v1", "openai_model": "m"})
    r = c.post("/studio/ai/chat", headers=AUTH, json={"prompt": "x"})
    assert r.status_code == 502 and "gemini" in r.json()["error"]["message"]


def test_key_check(ctx):
    c, _ = ctx
    c.put("/studio/ai/config", headers=AUTH, json={"gemini_keys_text": f"{GOOD}\n{BAD}"})
    res = c.post("/studio/ai/test", headers=AUTH, json={"provider": "gemini"}).json()["results"]
    assert [r["ok"] for r in res] == [True, False]


def test_gemini_switches_model_when_one_hangs_or_is_retired(tmp_path):
    """Model đang đặt treo (quá thời gian chờ) hoặc bị Google ngừng (404) → tự thử model mặc định rồi bản lite."""
    settings = Settings(_env_file=None, data_dir=tmp_path / "data", api_key=KEY, driver="mock")
    app = create_app(settings, MockDriver(delay=0))
    app.include_router(studio_ai.router)
    seen: list[str] = []
    behaviour = {"gemini-slow": "timeout", studio_ai.DEFAULT_GEMINI_MODEL: 404}

    def fake(request: httpx.Request) -> httpx.Response:
        model = request.url.path.split("/models/")[1].split(":")[0]
        seen.append(model)
        b = behaviour.get(model, 200)
        if b == "timeout":
            raise httpx.ReadTimeout("hang", request=request)
        if b != 200:
            return httpx.Response(b, json={"error": {"message": "no longer available"}})
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "OK"}]}}]})

    app.state.ai_transport = httpx.MockTransport(fake)
    studio_ai._next_key["i"] = 0
    with TestClient(app) as c:
        c.put("/studio/ai/config", headers=AUTH, json={"gemini_keys_text": f"{GOOD}\n{BAD}", "gemini_model": "gemini-slow"})
        out = c.post("/studio/ai/chat", headers=AUTH, json={"prompt": "x", "json_output": False}).json()
    assert out["source"] == "gemini" and out["model"] == studio_ai.FALLBACK_GEMINI_MODEL, out
    # Model treo: không thử key thứ 2 của cùng model (mất thêm 60 s vô ích); 404: đổi model ngay
    assert seen == ["gemini-slow", studio_ai.DEFAULT_GEMINI_MODEL, studio_ai.FALLBACK_GEMINI_MODEL]


def test_quiet_connection_reset_filter_only_drops_windows_reset_noise():
    import asyncio
    from studio_settings import QuietConnectionResetMiddleware

    seen: list[str] = []

    async def app(scope, receive, send):
        return None

    async def run():
        loop = asyncio.get_running_loop()
        loop.set_exception_handler(lambda lp, ctx: seen.append(ctx.get("message", "")))
        await QuietConnectionResetMiddleware(app)({"type": "http"}, None, None)
        h = loop.get_exception_handler()
        h(loop, {"message": "Exception in callback", "exception": ConnectionResetError(10054, "reset"),
                 "handle": "<Handle _ProactorBasePipeTransport._call_connection_lost(None)>"})
        h(loop, {"message": "lỗi thật", "exception": ValueError("x")})
        h(loop, {"message": "reset ở chỗ khác", "exception": ConnectionResetError(10054, "reset")})

    asyncio.run(run())
    assert seen == ["lỗi thật", "reset ở chỗ khác"]
