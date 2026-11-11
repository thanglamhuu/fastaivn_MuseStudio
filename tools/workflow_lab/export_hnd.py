import json, sys, urllib.request
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
API = "http://127.0.0.1:5680/api/hnd-workflow/"
def api(m, p=None):
    req = urllib.request.Request(API + m, data=json.dumps({"payload": p or {}}, ensure_ascii=False).encode(), headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=120).read().decode("utf-8", "replace"))
root = Path(__file__).resolve().parents[3].joinpath(r"HNDWorkflow\HND worflows export")
a, b = root / "1_mau_goc (Dung mau)", root / "2_da_dong_bo_chay_thu"
a.mkdir(parents=True, exist_ok=True); b.mkdir(parents=True, exist_ok=True)
for t in api("get_workflow_templates")["templates"]:
    wf = api("clone_workflow_template", {"template_id": t["id"]})["workflow"]
    wf["name"] = f"{t.get('category')} - {t['title']}"
    r = api("export_workflow_graph_file", {"workflow": wf, "output_dir": str(a)})
    print("goc", r.get("ok"), r.get("path") or r.get("error"))
state = api("get_workflow_graph_state")["state"]
for wf in state.get("workflows") or []:
    if str(wf.get("name", "")).startswith("[TEST]"):
        wf = dict(wf); wf["name"] = wf["name"].replace("[TEST] ", "")
        r = api("export_workflow_graph_file", {"workflow": wf, "output_dir": str(b)})
        print("test", r.get("ok"), r.get("path") or r.get("error"))
