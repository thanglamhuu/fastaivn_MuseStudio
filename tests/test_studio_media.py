"""Tests for studio_media.py (state, export, merge, voices). Run from the repo root:

    python -m pytest tests -q
"""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "muse2api" / "src"))

from fastapi.testclient import TestClient
from muse2api.app import create_app
from muse2api.config import Settings
from muse2api.drivers.mock import MockDriver

import studio_media

KEY = "test-key"
AUTH = {"Authorization": f"Bearer {KEY}"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("MUSE2API_STUDIO_OUTPUT_DIR", str(tmp_path / "out"))
    settings = Settings(_env_file=None, data_dir=tmp_path / "data", api_key=KEY, driver="mock")
    app = create_app(settings, MockDriver(delay=0))
    app.include_router(studio_media.router)
    with TestClient(app) as c:
        yield c


def test_safe_name():
    assert "/" not in studio_media.safe_name("../../x") and "\\" not in studio_media.safe_name("a\\b")
    assert studio_media.safe_name("..") == "untitled"
    assert studio_media.safe_name("CON") == "untitled"
    assert studio_media.safe_name("  Cảnh 1: Hook?  ") == "Cảnh 1_ Hook_"


def test_state_roundtrip_and_key_validation(client):
    assert client.get("/studio/state/scenes.v1", headers=AUTH).status_code == 404
    payload = {"savedAt": 123, "value": [{"id": "s1", "rawPrompt": "cảnh 1"}]}
    assert client.put("/studio/state/scenes.v1", json=payload, headers=AUTH).status_code == 200
    assert client.get("/studio/state/scenes.v1", headers=AUTH).json() == payload
    assert client.put("/studio/state/..%2Fevil", json={}, headers=AUTH).status_code in (400, 404)
    assert client.get("/studio/state/a b", headers=AUTH).status_code == 400


def test_voices_and_settings(client):
    voices = client.get("/studio/voices", headers=AUTH).json()["data"]
    assert voices and all(v["id"] and v["name"] for v in voices)
    s = client.get("/studio/settings", headers=AUTH).json()
    assert s["output_dir"].endswith("out")


def test_requires_key(client):
    assert client.get("/studio/voices").status_code == 401


def test_video_export_with_voice(client):
    client.post("/admin/accounts", json={"cookies": {"hatch_sess": "x"}}, headers=AUTH)
    r = client.post("/v1/videos", headers=AUTH, json={"prompt": "a cat", "voice": "avocado_v2:x"})
    assert r.status_code == 200
    task_id = r.json()["id"]
    for _ in range(100):
        body = client.get(f"/v1/videos/{task_id}", headers=AUTH).json()
        if body["status"] == "succeeded":
            break
        time.sleep(0.02)
    url = body["result"]["url"]
    exp = client.post("/studio/export", headers=AUTH,
                      json={"media": url, "project": "Shop/Áo", "filename": "Canh_01"})
    assert exp.status_code == 200
    path = Path(exp.json()["path"])
    assert path.name == "Canh_01.mp4" and path.parent.name == "Shop_Áo" and path.is_file()


def test_export_unknown_media_is_404(client):
    r = client.post("/studio/export", headers=AUTH,
                    json={"media": "vid_0000000000000000.mp4", "filename": "x"})
    assert r.status_code == 404


@pytest.mark.skipif(not studio_media.find_ffmpeg(), reason="ffmpeg not installed")
def test_merge_clips_with_and_without_audio(tmp_path):
    ffmpeg = studio_media.find_ffmpeg()
    clips = []
    for i, audio in enumerate((True, False)):
        out = tmp_path / f"c{i}.mp4"
        cmd = [ffmpeg, "-hide_banner", "-y", "-f", "lavfi", "-i", "color=c=red:s=320x240:d=1:r=24"]
        if audio:
            cmd += ["-f", "lavfi", "-i", "sine=f=440:d=1", "-shortest"]
        subprocess.run(cmd + [str(out)], check=True, capture_output=True)
        clips.append(out)
    target = studio_media.merge_clips(ffmpeg, clips, tmp_path / "out" / "full.mp4")
    info = studio_media.probe(ffmpeg, target)
    assert info["audio"] and 1.8 < info["seconds"] < 2.4 and (info["w"], info["h"]) == (320, 240)


def test_guess_price_from_page_text():
    import studio_product

    assert studio_product.guess_price("Áo thun nam\n₫199.000\nĐã bán 2k") == "199.000 ₫"
    assert studio_product.guess_price("Giá 1.250.000đ freeship") == "1.250.000 ₫"
    assert studio_product.guess_price("₫99.000 - ₫149.000 còn hàng") == "99.000 - 149.000 ₫"
    assert studio_product.guess_price("Sale 50% chỉ hôm nay") == ""
