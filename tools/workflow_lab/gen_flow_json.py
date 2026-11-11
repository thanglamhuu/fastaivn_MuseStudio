# -*- coding: utf-8 -*-
# Sinh frontend/src/data/hndFlowTemplates.json từ catalog HND (13 mẫu, sơ đồ node đầy đủ)
import collections, json, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
HND = Path(r"D:\1FastAIVN\srcs\HND Muse AI")
OUT = Path(r"D:\1FastAIVN\srcs\fastaivn_MuseStudio\frontend\src\data\hndFlowTemplates.json")
CAT = {"gia-dinh": "Gia đình", "thoi-trang": "Thời trang", "thoi-trang-nam": "Thời trang nam", "my-pham": "Mỹ phẩm",
       "an-uong": "Ăn uống", "gia-dung": "Gia dụng", "gia-dung-bep": "Gia dụng bếp", "suc-khoe": "Sức khỏe",
       "do-choi": "Đồ chơi", "thiet-ke": "Thiết kế", "khac": "Khác"}
KEEP = {"prompt", "label", "batchLabel", "batchKey", "batchOrder", "batchRole", "refRole", "memberRole", "characterName",
        "characterTag", "sheetPrompt", "imageMode", "videoMode", "ratio", "duration", "count", "portCount", "outputCount",
        "resolution", "engine", "model", "firstOutputIsCharacter", "isAutoCharacterSheet"}
cat = json.loads((HND / "assets/workflows/catalog.json").read_text(encoding="utf-8"))["templates"]
out = []
for t in cat:
    g = t["graph"]
    nodes = [{"id": n["id"], "type": n["type"], "position": n.get("position") or {"x": 0, "y": 0},
              "data": {k: v for k, v in (n.get("data") or {}).items() if k in KEEP}} for n in g["nodes"]]
    edges = [{"id": e.get("id") or f"e{i}", "source": e["source"], "sourceHandle": e.get("sourceHandle"),
              "target": e["target"], "targetHandle": e.get("targetHandle")} for i, e in enumerate(g["edges"])]
    out.append({"id": "hnd-" + t["id"], "title": t["title"], "category": t.get("category", "khac"),
                "categoryLabel": CAT.get(t.get("category", "khac"), "Khác"), "description": t.get("description", ""),
                "templateStyle": t.get("templateStyle", ""), "videoUrl": t.get("videoUrl") or t.get("youtubeUrl") or "",
                "graph": {"name": t["title"], "description": g.get("description", ""), "nodes": nodes, "edges": edges}})
OUT.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
print(OUT.stat().st_size, len(out))
print(collections.Counter((n["type"], n["data"].get("videoMode") or n["data"].get("imageMode") or "")
                          for t in out for n in t["graph"]["nodes"]))
print(collections.Counter((e["sourceHandle"], e["targetHandle"]) for t in out for e in t["graph"]["edges"]))
print(collections.Counter(k for t in out for n in t["graph"]["nodes"] for k in n["data"]))
