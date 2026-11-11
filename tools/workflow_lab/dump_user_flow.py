# -*- coding: utf-8 -*-
"""In cấu hình + prompt thực tế của workflow Hieu POV AIO mà người dùng đã chạy (data/studio/state/nodeflow.library.v1.json)."""
import base64, json, re, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
p = Path(r"I:\Claude\Srcs\MuseStudio\data\studio\state\nodeflow.library.v1.json")
raw = json.loads(p.read_text(encoding="utf-8"))
lib = raw.get("value", raw)
out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
wfs = [w for w in lib["workflows"] if "Hieu POV" in w.get("name", "") and "chay thu" not in w.get("name", "")]
w = max(wfs, key=lambda w: w.get("updatedAt", 0))
print("WF", w["name"], w.get("updatedAt"))
(out / "user_workflow.json").write_text(json.dumps(w, ensure_ascii=False), encoding="utf-8")
for n in w["nodes"]:
    d = n["data"]
    print("\n=====", n["id"], n["type"], d.get("batchLabel"), d.get("runStatus"))
    for k, v in d.items():
        if k in ("image", "faceImage") and isinstance(v, str):
            print(f"  {k}: {v[:60]}… ({len(v)} ký tự)")
            m = re.match(r"data:image/(\w+);base64,(.*)", v)
            if m:
                (out / f"{n['id']}_{k}.{m.group(1)}").write_bytes(base64.b64decode(m.group(2)))
        elif k == "results":
            for i, r in enumerate(v or []):
                val = r.get("value", "")
                print(f"  result[{i}] {r.get('kind')}: {val if r.get('kind') == 'text' else val[:90]}")
        elif k == "prompts":
            print("  prompts:", json.dumps(v, ensure_ascii=False)[:4000])
        elif k == "aiDescs":
            for kk, vv in (v or {}).items():
                print("  aiDesc:", vv)
        elif k != "prompt" or n["type"] != "prompt":
            s = json.dumps(v, ensure_ascii=False)
            print(f"  {k}: {s[:300]}")
    if n["type"] == "prompt":
        print("  PROMPT:\n" + d.get("prompt", ""))
