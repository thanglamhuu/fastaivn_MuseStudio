# -*- coding: utf-8 -*-
"""Đặt lại các node video / ghép / kết quả trong <file>.result.json để chạy tiếp (giữ ảnh khung hình đã tạo)."""
import json, sys
from pathlib import Path

p = Path(sys.argv[1])
wf = json.loads(p.read_text(encoding="utf-8"))
n = 0
for node in wf["nodes"]:
    if node["type"] in ("generate-video", "merge-video", "result"):
        node["data"]["runStatus"] = "idle"
        node["data"]["results"] = []
        n += 1
p.write_text(json.dumps(wf, ensure_ascii=False), encoding="utf-8")
print("reset", n)
