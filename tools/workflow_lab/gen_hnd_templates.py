# -*- coding: utf-8 -*-
"""Sinh frontend/src/data/hndWorkflowTemplates.ts từ catalog + TEMPLATE_ARCHETYPES của HND Muse AI."""
import json, re, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
HND = Path(r"D:\1FastAIVN\srcs\HND Muse AI")
OUT = Path(r"I:\Claude\Srcs\MuseStudio\frontend\src\data\hndWorkflowTemplates.ts")
sys.path.insert(0, str(HND))
import workflow_studio as ws  # noqa: E402

CAT = {"gia-dinh": "Gia đình", "thoi-trang": "Thời trang", "thoi-trang-nam": "Thời trang nam", "my-pham": "Mỹ phẩm",
       "an-uong": "Ăn uống", "gia-dung": "Gia dụng", "gia-dung-bep": "Gia dụng bếp", "suc-khoe": "Sức khỏe",
       "do-choi": "Đồ chơi", "thiet-ke": "Thiết kế", "khac": "Khác"}
ICON = {"gia-dinh": "👨‍👩‍👧", "thoi-trang": "👗", "thoi-trang-nam": "🤵", "my-pham": "💄", "an-uong": "🍗",
        "gia-dung": "🏠", "gia-dung-bep": "🍳", "suc-khoe": "💪", "do-choi": "🧸", "thiet-ke": "💎", "khac": "🧩"}
FASHION = {"walk_pose", "women_outfit", "studio_lookbook", "street_catwalk_pose", "menswear_gentleman"}


def clean(text: str, tag: str) -> str:
    t = str(text or "")
    if tag:
        t = re.sub(r"(?i)(nhân vật\s+)?@" + re.escape(tag) + r"\b", "nhân vật chính", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def short(text: str, n: int) -> str:
    return text if len(text) <= n else text[: n - 1].rsplit(" ", 1)[0] + "…"


catalog = json.loads((HND / "assets/workflows/catalog.json").read_text(encoding="utf-8"))["templates"]
items = []
for t in catalog:
    style = t.get("templateStyle")
    a = ws.TEMPLATE_ARCHETYPES[style]
    nodes = t["graph"]["nodes"]
    scenes = sum(1 for n in nodes if n["type"] == "generate-video")
    tag = a.get("default_char_name") or ""
    beats = a["beats"][:scenes]
    beat_lines = "\n".join(
        f"Cảnh {i + 1}/{scenes} — {clean(b[0], tag)}: {short(clean(b[1], tag), 420)}" for i, b in enumerate(beats)
    )
    note = (
        f"Phong cách (mẫu HND «{a['title']}»): {short(clean(a.get('directive', ''), tag), 700)}\n"
        f"Ý tưởng mặc định: {clean(a.get('default_idea', ''), tag)}\n"
        f"Viết ĐÚNG {scenes} cảnh 10 giây theo khung sau (giữ nguyên nhân vật, trang phục, sản phẩm và bối cảnh xuyên suốt; "
        f"mỗi cảnh chia 3 nhịp 0-3.5s / 3.5-7s / 7-10s):\n{beat_lines}"
    )
    cat = t.get("category") or "khac"
    item = {
        "id": f"hnd-{t['id']}",
        "name": t["title"],
        "icon": ICON.get(cat, "🧩"),
        "category": f"HND · {CAT.get(cat, 'Khác')}",
        "description": t.get("description", ""),
        "builtin": True,
        "scriptMode": "short_film" if (style in FASHION or style == "family_sitcom_linh_mit") else
                      ("pov_aff" if style == "food_pov" else "tvc5"),
        "extraNote": note,
        "sceneCount": scenes,
        "duration": 10,
        "aspectRatio": "9:16",
        "withDialogue": style not in {"street_catwalk_pose", "walk_pose"},
        "faceless": style == "food_pov",
        "rotateProductImages": style == "studio_lookbook",
        "chainEndFrame": False,
        "cameraMotion": "",
        "autoMerge": True,
        "refMode": "reference",
        "realismLock": True,
        "hnd": {"templateId": t["id"], "templateStyle": style,
                "videoUrl": t.get("videoUrl") or t.get("youtubeUrl") or a.get("video_url") or ""},
    }
    if style in FASHION and a.get("default_outfit_desc"):
        item["outfit"] = {"description": clean(a["default_outfit_desc"], tag)}
    items.append(item)

ts = (
    "// TỰ SINH từ HND Muse AI (assets/workflows/catalog.json + TEMPLATE_ARCHETYPES trong workflow_studio.py)\n"
    "// bằng script gen_hnd_templates.py — 13 mẫu Workflow của app cũ HND, giữ nguyên nhóm ngành hàng,\n"
    "// số cảnh (10s/cảnh) và khung kịch bản từng cảnh (đưa vào extraNote cho AI viết kịch bản).\n"
    "import type { WorkflowTemplate } from '../types/workflow';\n\n"
    f"export const HND_WORKFLOWS: WorkflowTemplate[] = {json.dumps(items, ensure_ascii=False, indent=2)};\n"
)
OUT.write_text(ts, encoding="utf-8")
print("wrote", OUT, len(items), "templates")
for i in items:
    print(i["category"], "|", i["name"], "|", i["sceneCount"], i["scriptMode"])
