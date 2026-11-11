# -*- coding: utf-8 -*-
"""Kiểm thử GET /studio/catalog/bundle (router studio_catalog) bằng TestClient — không đụng Gateway đang chạy."""
import json, sys, tempfile, threading, http.server, functools
from pathlib import Path
from types import SimpleNamespace

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT), str(ROOT / "muse2api" / "src")]
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
import studio_catalog  # noqa: E402
from muse2api.api.deps import require_admin_key  # noqa: E402
from muse2api.errors import Muse2APIError  # noqa: E402

tmp = Path(tempfile.mkdtemp())
web = tmp / "web"
(web / "workflows" / "bundles").mkdir(parents=True)
bundle = {"kind": "musestudio-workflow-bundle", "bundleVersion": 1, "name": "Bộ thử", "templates": [], "flows": [{"name": "A", "nodes": [], "edges": []}],
          "characters": [], "products": [], "pad": "x" * (12 * 1024 * 1024)}  # 12MB > giới hạn sơ đồ 8MB
(web / "workflows" / "bundles" / "thu.musestudio.json").write_text(json.dumps(bundle, ensure_ascii=False), encoding="utf-8")
(web / "workflows" / "catalog.v1.json").write_text(json.dumps({"catalogVersion": 1, "templates": [
    {"id": "bo-thu", "version": 1, "title": "Bộ thử", "bundleUrl": "bundles/thu.musestudio.json", "published": True}]}), encoding="utf-8")

# Máy chủ web giả (như fastaivn.com) để thử đường dẫn tương đối theo catalog
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(web)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{srv.server_port}/workflows/catalog.v1.json"

app = FastAPI()
app.state.services = SimpleNamespace(settings=SimpleNamespace(data_dir=str(tmp / "data")))
app.dependency_overrides[require_admin_key] = lambda: None


@app.exception_handler(Muse2APIError)
async def _h(request, exc):
    from fastapi.responses import JSONResponse
    return JSONResponse({"error": {"message": str(getattr(exc, "message", exc))}}, status_code=getattr(exc, "status_code", 400))


app.include_router(studio_catalog.router)
c = TestClient(app)
print("đặt catalog:", c.put("/studio/catalog/config", json={"url": base}).status_code)
cat = c.get("/studio/catalog?refresh=1").json()
print("catalog bundleUrl đã chuyển tuyệt đối:", cat["catalog"]["templates"][0]["bundleUrl"])
r = c.get("/studio/catalog/bundle", params={"url": "bundles/thu.musestudio.json"})
j = r.json()
print("tải bộ 12MB qua link tương đối:", r.status_code, j.get("source"), j.get("bundle", {}).get("name"), len(r.content) // 1048576, "MB")
srv.shutdown()
r2 = c.get("/studio/catalog/bundle", params={"url": "bundles/thu.musestudio.json"})
print("mất mạng → bản đệm:", r2.status_code, r2.json().get("source"))
r3 = c.get("/studio/catalog/bundle", params={"url": "http://127.0.0.1:1/khong-co.json"})
print("link hỏng:", r3.status_code, r3.text[:120])
print("sơ đồ 12MB qua /graph (giới hạn 8MB) vẫn bị chặn như cũ:", c.get("/studio/catalog/graph", params={"url": str(web / "workflows" / "bundles" / "thu.musestudio.json")}).status_code)

