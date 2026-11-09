"""Thư viện media, hậu kỳ FFmpeg và AI tạo chân dung (studio_library.py)."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "muse2api" / "src"))

from fastapi.testclient import TestClient
from muse2api.app import create_app
from muse2api.config import Settings
from muse2api.drivers.mock import MockDriver

import studio_library
import studio_media

KEY = "test-key"
AUTH = {"Authorization": f"Bearer {KEY}"}
FF = studio_media.find_ffmpeg()
needs_ff = pytest.mark.skipif(not FF, reason="ffmpeg not installed")


@pytest.fixture
def app_client(tmp_path):
    settings = Settings(_env_file=None, data_dir=tmp_path / "data", api_key=KEY, driver="mock")
    app = create_app(settings, MockDriver(delay=0))
    app.include_router(studio_library.router)
    with TestClient(app) as c:
        c.post("/admin/accounts", json={"cookies": {"hatch_sess": "x"}}, headers=AUTH)
        yield app, c


def _put_video(app, tmp_path, w=360, h=640) -> str:
    out = tmp_path / "src.mp4"
    subprocess.run([FF, "-hide_banner", "-y", "-f", "lavfi", "-i", f"testsrc=s={w}x{h}:d=2:r=24",
                    "-f", "lavfi", "-i", "sine=f=440:d=2", "-shortest", "-pix_fmt", "yuv420p", str(out)],
                   check=True, capture_output=True)
    return app.state.services.media.save(out.read_bytes(), "video/mp4", prefix="vid")


def test_blur_filter_clamps_regions():
    g = studio_library.blur_filter([studio_library.Region(x=0.9, y=0.9, w=0.5, h=0.5)], 360, 640, "blur", 20)
    assert "crop=36:64:324:576" in g and g.endswith("[out]")
    g2 = studio_library.blur_filter([studio_library.Region(x=0, y=0, w=0.2, h=0.1),
                                     studio_library.Region(x=0.5, y=0.5, w=0.2, h=0.1)], 360, 640, "pixelate", 20)
    assert "split=3" in g2 and "flags=neighbor" in g2


def test_portrait_goes_to_library(app_client):
    _, c = app_client
    r = c.post("/studio/portrait", headers=AUTH, json={"name": "Lan", "description": "cô gái 25 tuổi tóc dài", "n": 2})
    assert r.status_code == 200, r.text
    names = [d["name"] for d in r.json()["data"]]
    assert len(names) == 2 and "ONE person only" in r.json()["prompt"]
    lib = c.get("/studio/library?kind=image", headers=AUTH).json()["data"]
    portraits = [x for x in lib if x["source"] == "portrait"]
    assert {x["name"] for x in portraits} == set(names)
    # yêu thích + lọc + xóa
    assert c.patch(f"/studio/library/{names[0]}", headers=AUTH, json={"favorite": True}).status_code == 200
    fav = c.get("/studio/library?favorite=true", headers=AUTH).json()["data"]
    assert [x["name"] for x in fav] == [names[0]]
    assert c.get("/studio/library?q=lan", headers=AUTH).json()["total"] == 2
    assert c.delete(f"/studio/library/{names[1]}", headers=AUTH).status_code == 200
    assert c.get("/studio/library", headers=AUTH).json()["total"] == 1


@needs_ff
def test_frame_upscale_blur(app_client, tmp_path):
    app, c = app_client
    vid = _put_video(app, tmp_path)
    frame = c.post("/studio/post/frame", headers=AUTH, json={"media": vid})
    assert frame.status_code == 200, frame.text
    assert frame.json()["kind"] == "image"
    mid = c.post("/studio/post/frame", headers=AUTH, json={"media": f"http://x/v1/media/{vid}", "time": 1.0})
    assert mid.status_code == 200
    up = c.post("/studio/post/upscale", headers=AUTH, json={"media": vid, "short_side": 720})
    assert up.status_code == 200, up.text
    info = studio_media.probe(FF, app.state.services.media.path_of(up.json()["name"]))
    assert (info["w"], info["h"]) == (720, 1280) and info["audio"]
    again = c.post("/studio/post/upscale", headers=AUTH, json={"media": up.json()["name"], "short_side": 720})
    assert again.status_code == 400
    bl = c.post("/studio/post/blur", headers=AUTH,
                json={"media": vid, "regions": [{"x": 0.7, "y": 0.02, "w": 0.28, "h": 0.08}]})
    assert bl.status_code == 200, bl.text
    img_blur = c.post("/studio/post/blur", headers=AUTH,
                      json={"media": frame.json()["name"], "mode": "pixelate",
                            "regions": [{"x": 0.1, "y": 0.1, "w": 0.3, "h": 0.3}]})
    assert img_blur.status_code == 200, img_blur.text
    lib = {x["name"]: x for x in c.get("/studio/library", headers=AUTH).json()["data"]}
    assert lib[bl.json()["name"]]["source"] == "blur" and lib[bl.json()["name"]]["parent"] == vid
    assert lib[frame.json()["name"]]["source"] == "frame"
