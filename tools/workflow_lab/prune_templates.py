# -*- coding: utf-8 -*-
"""Lọc mẫu theo danh sách đã duyệt (11/11): xóa 4 mẫu tự lưu + 6 sơ đồ node; ghi qua Gateway PUT /studio/state/<key> với savedAt mới
để mọi cửa sổ app mở lại đều lấy bản đã lọc. Đã sao lưu ở data/studio/state/_backup_truoc_khi_loc_mau_20261111."""
import json, sys, time, urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
GW = "http://127.0.0.1:18610/studio/state/"
H = {"Authorization": "Bearer m2a_secret_key", "Content-Type": "application/json"}

DEL_CUSTOM = {"wf_mw9khdcntxic8", "wf_mw9m615ml4fmi", "wf_mw9m6iwga2mli", "wf_mwa1ospt56d9r"}
DEL_FLOWS = {"wf-mwa4656f0rwvy", "wf-mwa8pn150nrgj", "wf-mwagpkdp0jx6z", "wf-mwat6x33ud5xy", "wf-mwatn7t9u9bi7", "wf-mwaue7r2ukcvf"}
KEEP_FLOW = "wf-mwaycvl1upka2"


def get(key):
    return json.loads(urllib.request.urlopen(urllib.request.Request(GW + key, headers=H)).read())


def put(key, value):
    body = json.dumps({"savedAt": int(time.time() * 1000), "value": value}, ensure_ascii=False).encode()
    urllib.request.urlopen(urllib.request.Request(GW + key, data=body, headers=H, method="PUT")).read()


c = get("workflow.custom.v1")["value"]
before = [t["name"] for t in c]
c2 = [t for t in c if t["id"] not in DEL_CUSTOM]
assert len(c) - len(c2) == len(DEL_CUSTOM), "danh sách mẫu tự lưu đã thay đổi — dừng"
put("workflow.custom.v1", c2)
print(f"Mẫu tự lưu: {len(c)} → {len(c2)}")

lib = get("nodeflow.library.v1")["value"]
w2 = [w for w in lib["workflows"] if w["id"] not in DEL_FLOWS]
assert len(lib["workflows"]) - len(w2) == len(DEL_FLOWS) and any(w["id"] == KEEP_FLOW for w in w2), "danh sách sơ đồ đã thay đổi — dừng"
put("nodeflow.library.v1", {**lib, "workflows": w2, "activeId": KEEP_FLOW})
print(f"Sơ đồ node: {len(lib['workflows'])} → {len(w2)}: {[w['name'] + ' (' + w['id'] + ')' for w in w2]}")


