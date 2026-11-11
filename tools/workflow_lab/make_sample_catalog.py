# -*- coding: utf-8 -*-
"""Dựng catalog mẫu fastaivn.com (catalog.v1.json + thumbs/ + previews/ + graphs/) từ 3 mẫu HND.
Ghi vào: <out>/workflows/...   (out = thư mục gốc Firebase Hosting public)
"""
import json, shutil, sys
from datetime import datetime, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
out = Path(sys.argv[1])
FE = Path(r"D:\1FastAIVN\srcs\fastaivn_MuseStudio\frontend")
tpls = {t["id"]: t for t in json.loads((FE / "src/data/hndFlowTemplates.json").read_text(encoding="utf-8"))}
pick = [
    ("hnd-ai-family-video-creator", "gia-dinh-linh-mit", "👨‍👩‍👧", 10, {"scriptMode": "short_film", "sceneCount": 3, "duration": 10}),
    ("hnd-women-outfit", "ootd-bien-hinh-nu", "👗", 20, {"scriptMode": "short_film", "sceneCount": 4, "duration": 10}),
    ("hnd-tiktok-koc-unboxing-asmr", "koc-unboxing-my-pham", "💄", 30, {"scriptMode": "tvc5", "sceneCount": 5, "duration": 10}),
]
root = out / "workflows"
for d in ("thumbs", "previews", "graphs"):
    (root / d).mkdir(parents=True, exist_ok=True)
entries = []
for src_id, new_id, icon, order, lt in pick:
    t = tpls[src_id]
    hnd_id = src_id[4:]
    shutil.copy2(FE / f"public/workflow-thumbs/hnd-{hnd_id}.jpg", root / "thumbs" / f"{new_id}.jpg")
    shutil.copy2(FE / f"public/workflow-thumbs/hnd-{hnd_id}.mp4", root / "previews" / f"{new_id}.mp4")
    graph = {"kind": "flow-workflow", "schemaVersion": 1, **t["graph"]}
    (root / "graphs" / f"{new_id}.v1.json").write_text(json.dumps(graph, ensure_ascii=False), encoding="utf-8")
    entries.append({
        "id": new_id, "version": 1, "title": t["title"], "description": t["description"],
        "category": t["categoryLabel"], "icon": icon, "tags": [t["templateStyle"]], "sortOrder": order,
        "isPremium": False, "minAppVersion": "1.0.0", "published": True,
        "thumbnailUrl": f"thumbs/{new_id}.jpg", "previewUrl": f"previews/{new_id}.mp4",
        "graphUrl": f"graphs/{new_id}.v1.json", "trendUrl": t["videoUrl"], "listTemplate": lt,
    })
# 1 mẫu cần bản app mới hơn (để kiểm tra lọc minAppVersion)
entries.append({**entries[0], "id": "mau-can-app-moi", "title": "Mẫu thử: cần app 9.0", "minAppVersion": "9.0.0", "sortOrder": 99})
catalog = {"catalogVersion": 1, "publishedAt": datetime.now(timezone.utc).isoformat(), "publishedBy": "admin@fastaivn.com", "templates": entries}
(root / "catalog.v1.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=1), encoding="utf-8")
print("ok", root, len(entries))
