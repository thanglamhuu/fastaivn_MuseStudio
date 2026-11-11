# -*- coding: utf-8 -*-
"""Tải video từng cảnh của các *.result.json trong thư mục thí nghiệm → <tên>_canhN.mp4 (+ keyframe nếu có)."""
import base64, json, sys, urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
d = Path(sys.argv[1])
for f in sorted(d.glob("*.result.json")):
    w = json.loads(f.read_text(encoding="utf-8"))
    name = f.name.replace(".result.json", "")
    for n in w["nodes"]:
        if n["type"] != "generate-video":
            continue
        k = n["id"][-1]
        res = (n["data"].get("results") or [{}])[0].get("value")
        if res:
            req = urllib.request.Request(res, headers={"Authorization": "Bearer m2a_secret_key"})
            (d / f"{name}_canh{k}.mp4").write_bytes(urllib.request.urlopen(req).read())
        kf = n["data"].get("keyframe")
        if kf:
            raw = base64.b64decode(kf.split(",", 1)[1])
            (d / f"{name}_canh{k}_khunghinh.{'webp' if raw[:4] == b'RIFF' else 'png'}").write_bytes(raw)
        print(name, k, n["data"].get("runStatus"), bool(res), bool(kf))
