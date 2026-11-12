"""Tự chấm điểm mặt / giọng (studio_qc.py). Ảnh thật lấy từ lượt chạy thử (TestWorkFlow) — máy không có thì bỏ qua."""
from __future__ import annotations

import base64
import io
import shutil
import sys
import wave
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "muse2api" / "src"))

cv2 = pytest.importorskip("cv2")
np = pytest.importorskip("numpy")
import studio_qc as q  # noqa: E402

TW = ROOT.parent / "TestWorkFlow"
REVIEW = TW / "09 Review sau 7 ngày dùng" / "v5"
FAMILY = TW / "10 Workflow Gia Đình Nhỏ Hài Hước Đáng Yêu (30 Chủ Đề)" / "v4"
need_models = pytest.mark.skipif(q._find_model("sface.onnx", None) is None, reason="chưa có mô hình SFace")
need_samples = pytest.mark.skipif(not (REVIEW.is_dir() and FAMILY.is_dir()), reason="không có ảnh lượt chạy thử")


def du(p: Path, mime: str = "image/jpeg") -> str:
    return f"data:{mime};base64," + base64.b64encode(p.read_bytes()).decode()


@need_models
@need_samples
def test_keyframe_of_same_person_passes_and_other_person_fails(tmp_path):
    kf = du(REVIEW / "keyframe_01.jpg")
    same = q.score_faces(kf, [{"name": "AnhTuan", "image": du(next(REVIEW.glob("ref_*character*.jpg")))}], tmp_path)
    assert same["verdict"] == "pass" and same["people"][0]["best"] > 0.6
    # Ảnh tham chiếu là NGƯỜI KHÁC (Mẹ trong mẫu Gia đình; "Bố" của mẫu đó lại chính là người mẫu AnhTuan) → không giống
    other = q.score_faces(kf, [{"name": "Me", "image": du(FAMILY / "ref_02_1_character.jpg")}], tmp_path)
    assert other["people"][0]["best"] < q.SAME_TH and other["verdict"] == "fail"


@need_models
@need_samples
def test_video_rates_and_small_reference_face_warning(tmp_path):
    ref = {"name": "AnhTuan", "image": du(next(REVIEW.glob("ref_*character*.jpg")))}
    r = q.score_faces(du(REVIEW / "canh_01.mp4", "video/mp4"), [ref], tmp_path, max_frames=8)
    assert r["kind"] == "video" and r["frames"] == 8 and r["people"][0]["rate"] == 1.0
    assert any("nhỏ" in x["issue"] for x in r["ref_issues"])  # mặt ảnh tham chiếu ~83 px


@need_models
def test_image_without_face_is_unknown_not_fail(tmp_path):
    blank = np.full((400, 300, 3), 200, np.uint8)
    ok, buf = cv2.imencode(".jpg", blank)
    img = "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode()
    r = q.score_faces(img, [{"name": "X", "image": img}], tmp_path)
    assert r["verdict"] == "unknown" and r["ref_issues"][0]["issue"] == "ảnh tham chiếu không thấy mặt"


def test_media_url_reads_file_inside_data_media_only(tmp_path):
    (tmp_path / "media").mkdir()
    (tmp_path / "media" / "img_0123456789abcdef.jpg").write_bytes(b"abc")
    assert q.load_bytes("http://127.0.0.1:18610/v1/media/img_0123456789abcdef.jpg", tmp_path) == (b"abc", ".jpg")
    assert q._media_file("http://x/v1/media/../accounts.json", tmp_path) is None


def tone_wav(hz: float, seconds: float = 2.0, sr: int = 16000) -> str:
    t = np.arange(int(seconds * sr)) / sr
    x = (0.4 * np.sin(2 * np.pi * hz * t) + 0.15 * np.sin(2 * np.pi * 2 * hz * t)) * 32767
    bio = io.BytesIO()
    with wave.open(bio, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(x.astype(np.int16).tobytes())
    return "data:audio/wav;base64," + base64.b64encode(bio.getvalue()).decode()


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="không có ffmpeg")
@pytest.mark.parametrize("hz,gender,expect,verdict", [
    (120, "male", "female", "fail"), (220, "female", "female", "pass"), (175, "unknown", "female", "unknown")])
def test_voice_pitch_gender(tmp_path, hz, gender, expect, verdict):
    r = q.score_voice(tone_wav(hz), tmp_path, expect)
    assert r["gender"] == gender and r["verdict"] == verdict
    assert abs(r["pitch_hz"] - hz) < 8


def test_api_reports_status(tmp_path):
    from fastapi.testclient import TestClient
    from muse2api.app import create_app
    from muse2api.config import Settings
    from muse2api.drivers.mock import MockDriver

    app = create_app(Settings(_env_file=None, data_dir=tmp_path / "data", api_key="k", driver="mock"), MockDriver(delay=0))
    app.include_router(q.router)
    with TestClient(app) as c:
        r = c.get("/studio/qc/status", headers={"Authorization": "Bearer k"})
        assert r.status_code == 200 and r.json()["opencv"] is True
        bad = c.post("/studio/qc/face", headers={"Authorization": "Bearer k"}, json={"media": "x", "refs": []})
        assert bad.status_code in (400, 422)
