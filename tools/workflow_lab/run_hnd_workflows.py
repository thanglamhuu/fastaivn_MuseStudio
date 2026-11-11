# -*- coding: utf-8 -*-
"""Chạy lần lượt các mẫu Workflow của HND Muse AI qua API nội bộ (127.0.0.1:5680),
lưu video + báo cáo vào I:\\Claude\\Srcs\\HNDWorkflow.
Usage: python run_hnd_workflows.py [template_id ...]
"""
import json, os, re, shutil, sys, time, urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
API = "http://127.0.0.1:5680/api/hnd-workflow/"
OUT = Path(r"I:\Claude\Srcs\HNDWorkflow")
TN = Path(r"I:\Claude\Srcs\TaiNguyen")
WEB = TN / "web"
STATUS = OUT / "_run_status.json"
ACCOUNT = "8c4d9d2bad9e"  # <email tài khoản Muse 1>
# <email tài khoản Muse 2> được thêm khi tk 1 sắp hết hạn mức tuần
ACCOUNTS = ["fa14168dcb35", ACCOUNT]
MAX_WAIT = 60 * 60  # 1h / workflow

ME, BO, CON = str(TN / "Me.png"), str(TN / "Bo.png"), str(TN / "ChiDai.png")

# cấu hình test cho từng mẫu: ảnh nhân vật / trang phục / sản phẩm + mô tả + ý tưởng
CFG = {
    "ai-family-video-creator": dict(family=True, userIdea="Con gái nghe điện thoại hộ mẹ, chống nạnh mắng bố về muộn y hệt giọng mẹ"),
    "nghia_mmo_super_flow_id": dict(char=ME, charName="Mẹ", outfit=str(WEB / "dam_vay_he.jpg"), outfitDesc="Đầm xoè mùa hè màu hồng phấn, nơ lớn sau lưng, chân váy xếp ly"),
    "bc4f02e6-0ea4-4f6e-858b-0cccc279c666": dict(prod=str(WEB / "ga_ran.jpg"), prodName="Gà rán giòn cay", prodDesc="Gà rán giòn rụm vàng óng, lớp bột chiên xù, đựng khay giấy"),
    "women-outfit": dict(char=ME, charName="Mẹ", outfit=str(WEB / "dam_den.jpg"), outfitDesc="Đầm hai dây đen ánh kim sequin dáng suông dự tiệc"),
    "studio-outfits": dict(char=ME, charName="Mẹ", outfit=str(WEB / "dam_vay_he.jpg"), outfitDesc="Đầm xoè mùa hè màu hồng phấn, nơ lớn sau lưng"),
    "tiktok-street-catwalk-pose": dict(char=ME, charName="Mẹ", outfit=str(WEB / "dam_den.jpg"), outfitDesc="Đầm hai dây đen ánh kim sequin dáng suông"),
    "tiktok-koc-unboxing-asmr": dict(char=ME, charName="Mẹ", prod=str(WEB / "son_moi.jpg"), prodName="Bộ son môi 5 thỏi", prodDesc="Set 5 thỏi son kem lì các tông đỏ, hồng, nude"),
    "tiktok-menswear-gentleman": dict(char=BO, charName="Bố", outfit=str(WEB / "ao_vest_trang.jpg"), outfitDesc="Áo vest trắng ve đen, sơ mi trắng, nơ đen, đồng hồ kim loại"),
    "tiktok-home-appliance-hack": dict(char=ME, charName="Mẹ", prod=str(TN / "quat-cam-tay-mini-jisulife-life-7-5000mah_4__3.webp"), prodName="Quạt cầm tay JisuLife Life 7", prodDesc="Quạt cầm tay mini màu hồng, pin 5000mAh, 5 cấp gió, màn hình LED"),
    "tiktok-kitchen-cooking-chill": dict(char=ME, charName="Mẹ", prod=str(WEB / "chao_chong_dinh.jpg"), prodName="Chảo chống dính ceramic", prodDesc="Chảo chống dính lòng ceramic xám, tay cầm inox"),
    "tiktok-luxury-perfume-jewelry": dict(char=ME, charName="Mẹ", prod=str(WEB / "nuoc_hoa.jpg"), prodName="Nước hoa pha lê xanh", prodDesc="Chai nước hoa thuỷ tinh pha lê xanh lá cắt cạnh, nắp hình quạt"),
    "tiktok-fitness-wellness-routine": dict(char=BO, charName="Bố", prod=str(TN / "Coc1.jpg"), prodName="Bình giữ nhiệt thể thao", prodDesc="Bình giữ nhiệt inox màu xám, nắp có tay cầm"),
    "tiktok-desk-setup-toy-unbox": dict(char=BO, charName="Bố", prod=str(WEB / "mo_hinh_do_choi.jpg"), prodName="Mô hình vinyl art toy", prodDesc="Mô hình vinyl art toy màu trắng hình chú mèo tai nhọn"),
}


def api(method, payload=None, timeout=900):
    body = json.dumps({"payload": payload or {}}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(API + method, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def safe(s):
    return re.sub(r'[\\/:*?"<>|]+', "-", s).strip()[:90]


def status_update(tid, **kw):
    st = json.loads(STATUS.read_text(encoding="utf-8")) if STATUS.exists() else {}
    st.setdefault(tid, {}).update(kw, updated=time.strftime("%Y-%m-%d %H:%M:%S"))
    STATUS.write_text(json.dumps(st, ensure_ascii=False, indent=1), encoding="utf-8")


def set_node_image(node, path):
    d = node.setdefault("data", {})
    d.update(localPath=path, generatedPath=path, fileName=Path(path).name, runStatus="done", error="",
             results=[{"kind": "image", "value": path, "thumb": path}])


def build(template, cfg):
    wf = api("clone_workflow_template", {"template_id": template["id"]})["workflow"]
    style = wf.get("templateStyle") or template.get("templateStyle")
    nodes = wf.get("nodes") or []
    vid_n = sum(1 for n in nodes if n["type"] == "generate-video")
    sync = dict(templateStyle=style, videoUrl=wf.get("videoUrl", ""), affiliateMode="no",
                sceneDurationSec=10, sceneCount=vid_n, totalDurationSec=vid_n * 10, autoAiOnRun=True,
                userIdea=cfg.get("userIdea", ""))
    if cfg.get("family"):
        chars = [dict(role="father", name="Bố", path=BO), dict(role="mother", name="Mẹ", path=ME),
                 dict(role="child", name="Con gái", path=CON)]
        sync.update(pillarsMode="multi_person_family", familyTopicId=1, familyCastMode="custom",
                    familyCount=3, customCharacters=chars, customCharactersLocked=True,
                    fatherPath=BO, motherPath=ME, childPath=CON)
        for n, c in zip([n for n in nodes if n["type"] == "upload-image"], chars):
            set_node_image(n, c["path"])
    else:
        if cfg.get("char"):
            sync.update(characterPath=cfg["char"], characterName=cfg.get("charName", ""))
        if cfg.get("outfit"):
            sync.update(outfitPath=cfg["outfit"], outfitDesc=cfg.get("outfitDesc", ""))
        if cfg.get("prod"):
            sync.update(productPath=cfg["prod"], productName=cfg.get("prodName", ""),
                        productDesc=cfg.get("prodDesc", ""), affiliateMode="yes")
        for n in nodes:
            if n["type"] != "upload-image":
                continue
            role = (n.get("data") or {}).get("refRole") or "character"
            p = {"character": cfg.get("char"), "outfit": cfg.get("outfit"), "product": cfg.get("prod")}.get(role)
            if p:
                set_node_image(n, p)
    res = api("ai_write_workflow_prompts", {"workflow": wf, "syncConfig": sync, "useAi": True}, timeout=1200)
    if not res.get("ok"):
        raise RuntimeError("ai_write_workflow_prompts: " + str(res.get("error")))
    wf = res["workflow"]
    # gán lại ảnh (phòng khi sync tạo lại node)
    for n in wf.get("nodes") or []:
        if n["type"] == "upload-image" and not (n.get("data") or {}).get("localPath"):
            role = (n.get("data") or {}).get("refRole") or "character"
            mr = (n.get("data") or {}).get("memberRole")
            p = {"father": BO, "mother": ME, "child": CON}.get(mr) if cfg.get("family") else \
                {"character": cfg.get("char"), "outfit": cfg.get("outfit"), "product": cfg.get("prod")}.get(role)
            if p:
                set_node_image(n, p)
    wf["name"] = "[TEST] " + template["title"]
    wf["execution"] = {"profileIds": ACCOUNTS}
    # lưu vào thư viện Workflow của HND để hiện trên giao diện
    state = api("get_workflow_graph_state")["state"]
    state["workflows"] = [w for w in state.get("workflows") or [] if w.get("id") != wf["id"]] + [wf]
    state["activeWorkflowId"] = wf["id"]
    api("save_workflow_graph_state", state)
    return wf, sync


def collect_prompts(wf):
    rows = []
    for n in wf.get("nodes") or []:
        d = n.get("data") or {}
        if n["type"] in ("prompt", "generate-video", "generate-image", "upload-image"):
            txt = d.get("prompt") or d.get("text") or d.get("sheetPrompt") or ""
            if txt:
                rows.append((n["type"], d.get("batchLabel") or d.get("label") or n["id"], txt))
    return rows


def run_one(template):
    tid = template["id"]
    cfg = CFG.get(tid, {})
    folder = OUT / safe(template["title"])
    folder.mkdir(parents=True, exist_ok=True)
    print(f"\n=== {template['title']} ({tid})", flush=True)
    status_update(tid, title=template["title"], category=template.get("category"), state="building")
    t0 = time.time()
    wf, sync = build(template, cfg)
    (folder / "workflow_da_dong_bo.json").write_text(json.dumps(wf, ensure_ascii=False, indent=1), encoding="utf-8")
    # chờ runtime rảnh
    while api("get_workflow_graph_runtime").get("active"):
        time.sleep(15)
    r = api("start_workflow_graph", {"workflow": wf, "profile_ids": ACCOUNTS})
    if not r.get("ok"):
        status_update(tid, state="start_error", error=r.get("error"))
        raise RuntimeError("start: " + str(r.get("error")))
    run_id = r["run_id"]
    status_update(tid, state="running", run_id=run_id, folder=str(folder))
    snap = {}
    while True:
        time.sleep(20)
        try:
            snap = api("get_workflow_graph_runtime")
        except Exception as e:
            print("poll err", e, flush=True)
            continue
        if snap.get("id") != run_id:
            break
        states = snap.get("nodeStates") or {}
        cnt = {}
        for s in states.values():
            cnt[s.get("status")] = cnt.get(s.get("status"), 0) + 1
        print(time.strftime("%H:%M:%S"), cnt, flush=True)
        status_update(tid, progress=cnt)
        if not snap.get("active"):
            break
        if time.time() - t0 > MAX_WAIT:
            api("stop_workflow_graph")
            status_update(tid, state="timeout")
            break
    # thu kết quả
    node_map = {n["id"]: n for n in wf.get("nodes") or []}
    copied, final_video = [], ""
    for nid, st in (snap.get("nodeStates") or {}).items():
        n = node_map.get(nid, {})
        for i, res in enumerate(st.get("results") or []):
            v = str(res.get("value") or "")
            if res.get("kind") in ("video", "image") and os.path.isfile(v) and n.get("type") != "upload-image":
                label = safe((n.get("data") or {}).get("batchLabel") or n.get("type", "node"))
                dst = folder / f"{n.get('type')}_{label}_{i}{Path(v).suffix}"
                shutil.copy2(v, dst)
                copied.append((n.get("type"), str(dst), st.get("status")))
                if n.get("type") in ("merge-video", "result") and res.get("kind") == "video":
                    final_video = str(dst)
    if final_video:
        shutil.copy2(final_video, folder / "VIDEO_THANH_PHAM.mp4")
    errors = {nid: st.get("error") for nid, st in (snap.get("nodeStates") or {}).items() if st.get("status") == "error"}
    (folder / "runtime_snapshot.json").write_text(json.dumps(snap, ensure_ascii=False, indent=1), encoding="utf-8")
    ok = bool(final_video) and not errors
    status_update(tid, state="done" if ok else "error", seconds=int(time.time() - t0), final=final_video,
                  files=[c[1] for c in copied], errors=errors, logs=(snap.get("logs") or [])[-40:])
    print("=> ", "OK" if ok else "LOI", final_video, errors, flush=True)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    templates = api("get_workflow_templates")["templates"]
    only = sys.argv[1:]
    for t in templates:
        if only and t["id"] not in only:
            continue
        st = json.loads(STATUS.read_text(encoding="utf-8")) if STATUS.exists() else {}
        if not only and st.get(t["id"], {}).get("state") == "done":
            continue
        try:
            run_one(t)
        except Exception as e:
            print("EXC", t["id"], e, flush=True)
            status_update(t["id"], title=t["title"], state="exception", error=str(e))


if __name__ == "__main__":
    main()
