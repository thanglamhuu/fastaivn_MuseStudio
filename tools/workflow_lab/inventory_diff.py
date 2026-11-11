# -*- coding: utf-8 -*-
"""So mẫu tự lưu với mẫu gốc; xem khác biệt giữa các sơ đồ node trùng tên."""
import json, re, subprocess, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
R = Path(r"D:\1FastAIVN\srcs\fastaivn_MuseStudio")
ST = R / "data/studio/state"


def load(name):
    v = json.loads((ST / name).read_text(encoding="utf-8"))
    return v.get("value", v) if isinstance(v, dict) and "value" in v and len(v) <= 3 else v


# Mẫu có sẵn: lấy qua esbuild → JSON
out = subprocess.run(
    ["node", "-e", "require('esbuild').build({entryPoints:['src/data/workflowTemplates.ts'],bundle:true,write:false,format:'cjs',platform:'node',logLevel:'silent'})"
     ".then(r=>{const m={};new Function('module','exports',r.outputFiles[0].text)(m,m.exports={});console.log(JSON.stringify(m.exports.BUILTIN_WORKFLOWS))})"],
    cwd=R / "frontend", capture_output=True, text=True, encoding="utf-8")
builtin = {t["name"]: t for t in json.loads(out.stdout)}
SKIP = {"id", "name", "builtin", "graph", "category"}
print("=== MẪU TỰ LƯU so với mẫu gốc cùng tên ===")
for t in load("workflow.custom.v1.json"):
    base = builtin.get(t["name"].replace(" (của tôi)", ""))
    if not base:
        print(f"- {t['name']}: không có mẫu gốc cùng tên (nguồn: {t.get('category')})")
        continue
    diff = {k: (base.get(k), t.get(k)) for k in set(base) | set(t) if k not in SKIP and base.get(k) != t.get(k)}
    print(f"- {t['name']} ({t['id']}): {'GIỐNG HỆT mẫu gốc' if not diff else 'khác ' + str(len(diff)) + ' trường'}")
    for k, (a, b) in diff.items():
        print(f"     {k}: {str(a)[:90]!r} → {str(b)[:90]!r}")

print("\n=== SƠ ĐỒ NODE ===")
lib = load("nodeflow.library.v1.json")
for w in lib["workflows"]:
    print(f"- {w['id']} {w['name']}")
    for n in w["nodes"]:
        d = n["data"]
        if n["type"] == "prompt" and "Brief" in str(d.get("batchLabel", "")):
            p = d.get("prompt", "")
            m = re.search(r"Sản phẩm:(.*)\nĐiểm nổi bật:(.*)\n", p)
            ver = "MỚI (đã sửa 23h)" if "TẢ SẢN PHẨM CHỈ THEO ẢNH" in p else "CŨ (trước khi sửa)"
            print(f"     Brief {ver}; Sản phẩm:{m.group(1)[:50] if m else '?'} | Điểm nổi bật:{m.group(2)[:60] if m else '?'}")
        if n["type"] == "upload-image":
            print(f"     ảnh: {d.get('batchLabel','')[:40]} → {d.get('fileName') or ('có ảnh' if d.get('image') else 'trống')}")
    ids = {n["id"] for n in w["nodes"]}
    extra = [n for n in w["nodes"] if n["type"] not in ("upload-image", "prompt", "gemini-script", "generate-video", "merge-video", "result")]
    if extra:
        print(f"     node khác: {[(n['type'], n['data'].get('batchLabel')) for n in extra]}")
