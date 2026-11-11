# -*- coding: utf-8 -*-
"""Kiểm kê mẫu Workflow MuseStudio: mẫu có sẵn (code), mẫu tự lưu (workflow.custom.v1), sơ đồ node đã lưu (nodeflow.library.v1), dòng đã chạy theo mẫu."""
import json, re, sys
from collections import Counter
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
R = Path(r"I:\Claude\Srcs\MuseStudio")
ST = R / "data/studio/state"


def load(name):
    p = ST / name
    if not p.exists():
        return None
    v = json.loads(p.read_text(encoding="utf-8"))
    return v.get("value", v) if isinstance(v, dict) and "value" in v and len(v) <= 3 else v


src = (R / "frontend/src/data/workflowTemplates.ts").read_text(encoding="utf-8")
print("=== MẪU CÓ SẴN (workflowTemplates.ts) ===")
for m in re.finditer(r"id: '([^']+)',\s*name: '([^']+)'.*?category: '([^']+)'", src, re.S):
    print(f"  {m.group(1):22s} | {m.group(3):14s} | {m.group(2)}")
hnd = json.loads((R / "frontend/src/data/hndFlowTemplates.json").read_text(encoding="utf-8"))
print(f"=== MẪU HND (13) ===")
for t in hnd:
    print(f"  {t['id'][:40]:40s} | {t['categoryLabel']:12s} | {t['title']}")

rows = load("workflow.rows.v1.json") or []
used = Counter((r.get("template") or {}).get("id") for r in rows)
print("\n=== MẪU TỰ LƯU (workflow.custom.v1) ===")
for t in load("workflow.custom.v1.json") or []:
    print(f"  {t['id']:30s} | {t.get('category','')[:16]:16s} | {t['name']} | cảnh {t.get('sceneCount')} | graph={'có' if t.get('graph') else '-'} | dòng đã chạy={used.get(t['id'],0)}")
    print(f"      mô tả: {t.get('description','')[:140]}")
print("\n=== SỐ DÒNG ĐÃ CHẠY THEO MẪU ===")
for k, v in used.most_common():
    print(f"  {k}: {v}")

lib = load("nodeflow.library.v1.json") or {}
print(f"\n=== SƠ ĐỒ NODE ĐÃ LƯU (nodeflow.library.v1) — {len(lib.get('workflows', []))} sơ đồ, đang mở: {lib.get('activeId')} ===")
for w in lib.get("workflows", []):
    types = Counter(n["type"] for n in w["nodes"])
    done = sum(1 for n in w["nodes"] if n["data"].get("runStatus") == "done")
    ts = datetime.fromtimestamp((w.get("updatedAt") or w.get("createdAt") or 0) / 1000).strftime("%d/%m %H:%M")
    print(f"  {w['id'][:22]:22s} | {ts} | tpl={str(w.get('templateId',''))[:34]:34s} | {len(w['nodes'])} node, {types.get('generate-video',0)} video, chạy xong {done} | {w['name']}")
