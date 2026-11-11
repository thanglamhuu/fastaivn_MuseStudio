# -*- coding: utf-8 -*-
"""Chạy kiểm chứng mẫu Hieu POV AIO (bản đã sửa, có AI viết kịch bản) với ảnh VijiFarm của người dùng, Brief để trống tên / điểm nổi bật."""
import base64, json, subprocess, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
SRC = Path(r"D:\1FastAIVN\srcs\TaiNguyen\HongTreoGio")
OUT = Path(r"D:\1FastAIVN\srcs\HNDWorkflow\HND worflows export\6_pov_giu_bao_bi_mau")
FE = Path(r"D:\1FastAIVN\srcs\fastaivn_MuseStudio\frontend")
box = "data:image/jpeg;base64," + base64.b64encode((OUT / "in" / "hop.jpg").read_bytes()).decode()
inner = "data:image/jpeg;base64," + base64.b64encode((OUT / "in" / "vn-11134201-81ztc-mv.jpg").read_bytes()).decode()
desk = "data:image/jpeg;base64," + base64.b64encode((FE / "public/workflow-thumbs/fastaivn-pov-desk.jpg").read_bytes()).decode()
g = json.loads((FE / "src/data/hieuPovAio.flow.json").read_text(encoding="utf-8"))
for n in g["nodes"]:
    if n["id"] == "pov-product-1":
        n["data"]["image"] = box
    if n["id"] == "pov-product-2":
        n["data"]["image"] = inner
    if n["id"] == "pov-desk":
        n["data"]["image"] = desk
g["name"] = "POV EXP V4 mau da sua (Viji, AI viet kich ban)"
(OUT / "V4_mau_da_sua_day_du.json").write_text(json.dumps(g, ensure_ascii=False), encoding="utf-8")
print("ok")
