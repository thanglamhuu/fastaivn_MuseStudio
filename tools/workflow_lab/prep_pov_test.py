# -*- coding: utf-8 -*-
"""Tạo file chạy thử Hieu POV AIO: nhúng ảnh Hồng treo gió + ảnh bàn (data URL) vào sơ đồ."""
import base64, json, subprocess, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
SRC = Path(r"D:\work\fastaivn\srcs\fastaivnflowList\lamclip\POVAIO")
OUT = Path(__file__).resolve().parents[3].joinpath(r"HNDWorkflow\HND worflows export\5_hieu_pov_aio")
OUT.mkdir(parents=True, exist_ok=True)
FE = Path(__file__).resolve().parents[2].joinpath(r"frontend")


def data_url(p: Path) -> str:
    tmp = OUT / (p.stem + "_in.jpg")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(p), "-vf", "scale='min(1024,iw)':-2", "-q:v", "3", str(tmp)], check=True)
    return "data:image/jpeg;base64," + base64.b64encode(tmp.read_bytes()).decode()


g = json.loads((FE / "src/data/hieuPovAio.flow.json").read_text(encoding="utf-8"))
imgs = {
    "pov-product-1": SRC / "HongTreoGio" / "0.webp",
    "pov-product-2": SRC / "HongTreoGio" / "5.webp",
    "pov-desk": FE / "public/workflow-thumbs/fastaivn-pov-desk.jpg",
}
for n in g["nodes"]:
    if n["id"] in imgs:
        n["data"]["image"] = data_url(imgs[n["id"]])
        n["data"]["fileName"] = imgs[n["id"]].name
g["name"] = "Hieu POV AIO - Hong treo gio (chay thu)"
f = OUT / "Hieu POV AIO - chay thu Hong treo gio.json"
f.write_text(json.dumps(g, ensure_ascii=False), encoding="utf-8")
print(f)
