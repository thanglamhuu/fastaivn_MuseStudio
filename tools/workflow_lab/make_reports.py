# -*- coding: utf-8 -*-
"""Tạo báo cáo cho từng workflow HND đã chạy + file 'Prompt <Tên workflow>.md' + bảng mô tả tổng."""
import json, re, sqlite3, subprocess, sys, time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HND = Path(r"D:\1FastAIVN\srcs\HND Muse AI")
OUT = Path(__file__).resolve().parents[3].joinpath(r"HNDWorkflow")
STATUS = json.loads((OUT / "_run_status.json").read_text(encoding="utf-8"))
CATALOG = json.loads((HND / "assets/workflows/catalog.json").read_text(encoding="utf-8"))["templates"]
CAT = {"gia-dinh": "Gia đình (Linh Mít)", "thoi-trang": "Thời trang", "thoi-trang-nam": "Thời trang nam",
       "my-pham": "Mỹ phẩm", "an-uong": "Ăn uống", "gia-dung": "Gia dụng", "gia-dung-bep": "Gia dụng bếp",
       "suc-khoe": "Sức khỏe", "do-choi": "Đồ chơi", "thiet-ke": "Thiết kế", "khac": "Khác"}
ORDER = list(CAT)
db = sqlite3.connect(f"file:{HND / 'data/studio.db'}?mode=ro", uri=True)
db.row_factory = sqlite3.Row


def safe(s):
    return re.sub(r'[\\/:*?"<>|]+', "-", s).strip()[:90]


def probe(path):
    try:
        out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height",
                              "-of", "json", str(path)], capture_output=True, text=True, encoding="utf-8").stdout
        d = json.loads(out)
        v = next((s for s in d["streams"] if s["codec_type"] == "video"), {})
        has_audio = any(s["codec_type"] == "audio" for s in d["streams"])
        return float(d["format"]["duration"]), f"{v.get('width')}x{v.get('height')}", has_audio
    except Exception:
        return 0.0, "?", False


def frames(video, dst):
    if not dst.exists():
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(video), "-vf",
                        "fps=1/5,scale=-2:320,tile=10x1:padding=4", "-frames:v", "1", str(dst)])


def tasks_for(wf_id):
    rows = db.execute("select * from tasks where meta like ? order by seq", (f'%"workflow_id": "{wf_id}"%',)).fetchall()
    return [dict(r) for r in rows]


def node_label(n):
    d = n.get("data") or {}
    return d.get("batchLabel") or d.get("label") or n["type"]


summary = []
for t in sorted(CATALOG, key=lambda x: ORDER.index(x.get("category", "khac"))):
    st = STATUS.get(t["id"])
    folder = OUT / safe(t["title"])
    graph_nodes = t["graph"]["nodes"]
    types = {}
    for n in graph_nodes:
        types[n["type"]] = types.get(n["type"], 0) + 1
    inputs = [(n["data"].get("batchLabel"), n["data"].get("refRole")) for n in graph_nodes if n["type"] == "upload-image"]
    scenes = types.get("generate-video", 0)
    row = dict(cat=CAT.get(t.get("category"), "?"), title=t["title"], id=t["id"], style=t.get("templateStyle"),
               scenes=scenes, nodes=len(graph_nodes), inputs=inputs, desc=t.get("description", ""),
               state=(st or {}).get("state", "chưa chạy"), seconds=(st or {}).get("seconds"), video="", dur=0, res="", audio=False)
    wf_file = folder / "workflow_da_dong_bo.json"
    if st and wf_file.exists():
        wf = json.loads(wf_file.read_text(encoding="utf-8"))
        final = folder / "VIDEO_THANH_PHAM.mp4"
        if final.exists():
            row["dur"], row["res"], row["audio"] = probe(final)
            row["video"] = str(final)
            frames(final, folder / "khung_hinh_5s.jpg")
        tasks = tasks_for(wf["id"])
        sync = wf.get("syncConfig") or {}
        # ----- file Prompt <Tên workflow>.md
        p = [f"# Prompt {t['title']}\n",
             f"- Mẫu HND: `{t['id']}` · nhóm **{row['cat']}** · kiểu `{t.get('templateStyle')}`",
             f"- Tài khoản Muse chạy: <email tài khoản Muse 1> (HND account `8c4d9d2bad9e`, chế độ API)",
             f"- Workflow ID trong HND: `{wf['id']}` · {len(tasks)} tác vụ gửi lên Muse",
             f"- Nguồn prompt: AI viết kịch bản của HND không có Gemini key → HND dùng bộ prompt dựng sẵn theo mẫu (deterministic).",
             ""]
        if sync.get("masterStoryArc"):
            p += ["## Tóm tắt cốt truyện", sync["masterStoryArc"], ""]
        if sync.get("userIdea"):
            p += [f"**Ý tưởng / chủ đề:** {sync['userIdea']}", ""]
        p += ["## A. Prompt thực tế HND gửi lên Muse (theo thứ tự tác vụ)", ""]
        for i, tk in enumerate(tasks, 1):
            refs = []
            try:
                refs = [f"{Path(r.get('path','')).name} ({r.get('role')})" for r in json.loads(tk.get("refs") or "[]")]
            except Exception:
                pass
            p += [f"### {i}. {tk['kind'].upper()} · {tk.get('mode_key') or ''} · trạng thái `{tk['status']}`",
                  f"- Muse thread: `{tk.get('last_session') or tk.get('session_id') or ''}` → https://muse.ai/thread/{tk.get('last_session') or tk.get('session_id') or ''}",
                  f"- Ảnh tham chiếu: {', '.join(refs) or '—'} · tỉ lệ {tk['ratio']}",
                  "", "```text", tk["prompt"], "```", ""]
        p += ["## B. Prompt trong các node của workflow (sau khi Đồng bộ & AI viết)", ""]
        for n in wf.get("nodes") or []:
            d = n.get("data") or {}
            txt = d.get("prompt") or d.get("sheetPrompt") or ""
            if txt and n["type"] in ("upload-image", "prompt"):
                p += [f"### {node_label(n)} (`{n['type']}`)", "", "```text", txt, "```", ""]
        (OUT / f"Prompt {safe(t['title'])}.md").write_text("\n".join(p), encoding="utf-8")
        # ----- báo cáo trong thư mục con
        snap = json.loads((folder / "runtime_snapshot.json").read_text(encoding="utf-8")) if (folder / "runtime_snapshot.json").exists() else {}
        node_map = {n["id"]: n for n in wf.get("nodes") or []}
        b = [f"# Báo cáo chạy thử: {t['title']}\n",
             f"| Mục | Giá trị |", "|---|---|",
             f"| Nhóm | {row['cat']} |", f"| ID mẫu / kiểu | `{t['id']}` / `{t.get('templateStyle')}` |",
             f"| Mô tả mẫu | {row['desc']} |",
             f"| Cấu trúc node | {len(wf.get('nodes') or [])} node: " + ", ".join(f"{k}×{v}" for k, v in types.items()) + " |",
             f"| Số cảnh | {scenes} cảnh × 10s |",
             f"| Kết quả | **{row['state']}** sau {row['seconds']}s |",
             f"| Video thành phẩm | `VIDEO_THANH_PHAM.mp4` — {row['dur']:.1f}s, {row['res']}, {'có' if row['audio'] else 'không có'} âm thanh |" if row["video"] else "| Video thành phẩm | (không có) |",
             f"| Prompt | xem `../Prompt {safe(t['title'])}.md` |", "",
             "## Ảnh đầu vào", ""]
        for n in wf.get("nodes") or []:
            if n["type"] == "upload-image":
                d = n.get("data") or {}
                b.append(f"- {d.get('batchLabel')}: `{d.get('localPath') or '(để trống → HND tự tạo)'}`")
        b += ["", "## Trạng thái từng node", "", "| Node | Loại | Trạng thái | Lỗi |", "|---|---|---|---|"]
        for nid, s in (snap.get("nodeStates") or {}).items():
            n = node_map.get(nid, {"type": "?", "data": {}})
            b.append(f"| {node_label(n)} | {n['type']} | {s.get('status')} | {str(s.get('error') or '')[:150]} |")
        b += ["", "## File trong thư mục", ""] + [f"- `{f.name}`" for f in sorted(folder.iterdir())]
        if (folder / "khung_hinh_5s.jpg").exists():
            b += ["", "## Khung hình (mỗi 5 giây)", "", "![khung hình](khung_hinh_5s.jpg)"]
        b += ["", "## Nhật ký runtime (cuối)", "", "```text", *[str(x) for x in (snap.get("logs") or [])[-25:]], "```"]
        (folder / "BAO_CAO.md").write_text("\n".join(b), encoding="utf-8")
    summary.append(row)

# ----- bảng mô tả tổng
L = ["# Bảng mô tả 13 mẫu Workflow của HND Muse AI V1.5\n",
     f"Cập nhật: {time.strftime('%Y-%m-%d %H:%M')} · Tài khoản Muse: <email tài khoản Muse 1> · Chế độ: API (không mở Chrome)\n",
     "Mọi mẫu dùng chung khung: **Upload Image (khóa Nhân vật / Trang phục / Sản phẩm) → Prompt cảnh → Generate Video (Muse, 10s/cảnh, Reference-to-Video, 9:16) → Merge Video (FFmpeg) → Result**. "
     "Nút **Đồng Bộ Tham Chiếu & AI Viết** gọi Gemini để viết lại prompt từng cảnh; nếu không có Gemini thì dùng bộ prompt dựng sẵn theo mẫu.\n",
     "## Danh sách theo nhóm (tab Mẫu Workflow)\n",
     "| Nhóm | Số mẫu | Các mẫu |", "|---|---|---|"]
for c in ORDER:
    rs = [r for r in summary if r["cat"] == CAT[c]]
    L.append(f"| {CAT[c]} | {len(rs)} | " + "<br>".join(r["title"] for r in rs) + " |")
L += ["", "## Chi tiết & kết quả chạy thử", "",
      "| # | Nhóm | Workflow | Đầu vào khóa | Cảnh | Kết quả | Video | Thời gian chạy |", "|---|---|---|---|---|---|---|---|"]
for i, r in enumerate(summary, 1):
    inp = ", ".join(re.sub(r"[^\w\s/()À-ỹ]", "", (lab or "")).strip() for lab, _ in r["inputs"])
    vid = f"{r['dur']:.0f}s {r['res']}{' 🔊' if r['audio'] else ''}" if r["video"] else "—"
    L.append(f"| {i} | {r['cat']} | **{r['title']}**<br><sub>{r['desc']}</sub> | {inp} | {r['scenes']} | {r['state']} | {vid} | {r['seconds'] or '—'}s |")
(OUT / "BANG_MO_TA_WORKFLOW.md").write_text("\n".join(L), encoding="utf-8")
print("ok", len(summary), [(r["title"][:30], r["state"]) for r in summary])
