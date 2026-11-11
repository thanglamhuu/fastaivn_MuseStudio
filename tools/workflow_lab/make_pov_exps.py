# -*- coding: utf-8 -*-
"""Thí nghiệm giữ bao bì + màu sản phẩm cho Hieu POV AIO (Hồng treo gió VijiFarm, ảnh TaiNguyen\\HongTreoGio).
Mỗi biến thể: 3 ô ảnh khóa → 2 Prompt cảnh cố định (cảnh 1 hộp, cảnh 2 cận quả) → 2 Generate Video. Không qua Gemini để so sánh công bằng.
"""
import base64, json, subprocess, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
SRC = Path(r"I:\Claude\Srcs\TaiNguyen\HongTreoGio")
OUT = Path(r"I:\Claude\Srcs\HNDWorkflow\HND worflows export\6_pov_giu_bao_bi_mau")
OUT.mkdir(parents=True, exist_ok=True)
DESK = Path(r"I:\Claude\Srcs\MuseStudio\frontend\public\workflow-thumbs\fastaivn-pov-desk.jpg")


def data_url(p: Path) -> str:
    tmp = OUT / "in" / (p.stem[:20] + ".jpg")
    tmp.parent.mkdir(exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(p), "-vf", "scale='min(1280,iw)':-2", "-q:v", "2", str(tmp)], check=True)
    return "data:image/jpeg;base64," + base64.b64encode(tmp.read_bytes()).decode()


BOX = data_url(SRC / "hop.webp")
INNER = data_url(SRC / "vn-11134201-81ztc-mv7j7w6vkzka19.webp")
DESK_URL = "data:image/jpeg;base64," + base64.b64encode(DESK.read_bytes()).decode()

# Prompt cảnh người dùng đã chạy (AI viết từ Brief mặc định: "phủ phấn trắng", "cam nâu", "xoay nghiêng hộp")
BASE1 = ("CẢNH 01/03 — HOOK – KHOE HỘP | Hành động 3 nhịp (giây): 0-3.5s hai tay đưa hộp giấy viền cam sát ống kính; 3.5-7.0s xoay nghiêng khoe mặt trước "
         "VILIFARM, chữ HỒNG TREO GIÓ ĐÀ LẠT và cô gái đội mũ rơm; 7.0-10s mở nắp hộp, lộ hộp nhựa trong bên trong. | Camera: POV ngang tầm mắt, chéo xuống 30-45°, "
         "rung nhẹ tự nhiên, lấy nét theo hộp. | Âm thanh ASMR: tiếng hộp giấy sột soạt, nắp bật nhẹ. | Lời thoại voice-over: \"Mấy bà ơi nhìn hồng treo gió Đà Lạt "
         "này hộp năm trăm gram dẻo ứa mật ngọt thanh cưng xỉu quá đi nè!\" | Khóa: chỉ đôi tay, không mặt, không chữ, đúng bối cảnh + sản phẩm trong ảnh.")
BASE2 = ("CẢNH 02/03 — CẬN CẢNH – CẢM GIÁC | Hành động 3 nhịp (giây): 0-3.5s nối từ cảnh trước, mở hộp nhựa và bóc màng seal; 3.5-7.0s macro quả hồng cam nâu dẹt, "
         "bề mặt nhăn bóng, phủ phấn trắng tự nhiên, cuống khô; 7.0-10s hai tay tách đôi quả, mật bên trong ứa ra kéo sợi. | Camera: POV macro sát sản phẩm rồi lùi ra, "
         "lấy nét nhanh theo tay. | Âm thanh ASMR: tiếng bóc màng, tiếng xé dẻo mềm. | Lời thoại voice-over: \"Mấy bà nhìn nè quả nào cũng phủ phấn trắng tự nhiên "
         "dẻo mềm tách đôi là mật ứa ra ngọt thanh ghê luôn á!\" | Khóa: chỉ đôi tay, không mặt, không chữ, đúng bối cảnh + sản phẩm trong ảnh.")

# Prompt sửa: đúng màu theo ảnh, ánh sáng ban ngày trung tính, hộp giữ thẳng ít xoay, mở đầu đúng khung hình
COLOR = ("MÀU SẢN PHẨM ĐÚNG ẢNH: quả hồng màu vàng cam tươi sáng, thịt trong mọng óng như mứt, bề mặt láng; KHÔNG nâu, KHÔNG sẫm, KHÔNG đỏ thẫm, "
         "KHÔNG phủ phấn trắng. Ánh sáng ban ngày sáng trong, trắng trung tính từ cửa sổ, không ám vàng, không tối.")
BOXLOCK = ("BAO BÌ: hộp giấy vuông màu cam, mặt trước in tranh cô gái đội nón lá tóc tết áo thổ cẩm bên giàn hồng treo, logo VILIFARM, chữ dọc "
           "\"HỒNG TREO GIÓ ĐÀ LẠT\" bên phải — giữ y hệt ảnh, không vẽ lại, không đổi bố cục chữ / hình.")
FIX1 = ("CẢNH 01/03 — HOOK – KHOE HỘP | Hành động 3 nhịp (giây): 0-3.5s hai tay cầm hộp giấy cam giơ ngay ngắn trước ống kính, MẶT TRƯỚC HỘP NHÌN THẲNG, giữ yên "
        "cho thấy rõ toàn bộ hình in; 3.5-7.0s đặt hộp xuống bàn, mở nắp lộ hộp nhựa trong đựng hồng vàng cam; 7.0-10s nghiêng nhẹ hộp nhựa khoe các quả hồng vàng "
        "cam tươi trong mọng. Hộp di chuyển chậm, KHÔNG xoay lật, mặt in luôn hướng ống kính. | Camera: POV ngang tầm mắt chéo xuống, rung tay rất nhẹ. | Âm thanh "
        "ASMR: tiếng hộp giấy, nắp bật nhẹ. | Lời thoại voice-over: \"Mấy bà ơi nhìn hồng treo gió Đà Lạt này hộp năm trăm gram dẻo ứa mật ngọt thanh cưng xỉu "
        "quá đi nè!\" | " + BOXLOCK + " " + COLOR + " | Khóa: chỉ đôi tay, không mặt, không môi, không chữ phụ đề.")
FIX2 = ("CẢNH 02/03 — CẬN CẢNH – CẢM GIÁC | Hành động 3 nhịp (giây): 0-3.5s một tay nhấc một quả hồng vàng cam ra khỏi hộp nhựa đưa macro sát ống kính; 3.5-7.0s "
        "ngón tay ấn nhẹ cho thấy thịt quả dẻo mềm trong mọng, óng ánh; 7.0-10s hai tay tách đôi quả, ruột vàng cam trong như mứt, mật óng ứa ra kéo sợi. | Camera: "
        "POV macro sát rồi lùi nhẹ. | Âm thanh ASMR: tiếng tách dẻo mềm. | Lời thoại voice-over: \"Mấy bà nhìn nè quả nào cũng vàng cam trong veo dẻo mềm tách đôi "
        "là mật ứa ra ngọt thanh ghê luôn á!\" | " + COLOR + " | Khóa: chỉ đôi tay, không mặt, không môi, không chữ phụ đề.")

VARIANTS = {
    "V0_goc": dict(s=(BASE1, BASE2), kf=True, note="Prompt người dùng đã chạy + khung hình trước (như hiện tại)"),
    "V1_sua_prompt": dict(s=(FIX1, FIX2), kf=True, note="Sửa prompt: đúng màu, ánh sáng ban ngày, hộp giữ thẳng, khóa bao bì + khung hình trước"),
    "V2_sua_prompt_khong_kf": dict(s=(FIX1, FIX2), kf=False, note="Như V1 nhưng KHÔNG tạo khung hình trước (tham chiếu thẳng)"),
    "V3_anh_that_mo_dau": dict(s=(FIX1, FIX2), kf=False, first=True, note="Như V1, cảnh 1 dùng ẢNH THẬT hộp làm khung mở đầu (image-to-video), cảnh 2 tham chiếu thẳng"),
}


def node(i, t, x, y, d):
    return {"id": i, "type": t, "position": {"x": x, "y": y}, "data": d}


for name, v in VARIANTS.items():
    nodes = [
        node("box", "upload-image", 0, 0, {"refRoles": ["product"], "image": BOX, "fileName": "hop.webp", "autoDescribe": True, "batchLabel": "Hộp"}),
        node("inner", "upload-image", 0, 300, {"refRoles": ["product"], "image": INNER, "fileName": "ben_trong.webp", "autoDescribe": True, "batchLabel": "Bên trong"}),
        node("desk", "upload-image", 0, 600, {"refRoles": ["scene"], "image": DESK_URL, "fileName": "desk.jpg", "autoDescribe": True, "batchLabel": "Bàn"}),
    ]
    edges = []
    for k in range(2):
        nodes.append(node(f"p{k+1}", "prompt", 300, k * 300, {"prompt": v["s"][k], "batchLabel": f"Prompt cảnh {k+1}"}))
        first = v.get("first") and k == 0
        nodes.append(node(f"v{k+1}", "generate-video", 600, k * 300, {
            "batchLabel": f"Cảnh {k+1}", "videoMode": "frame-to-frame" if first else "reference-to-video", "ratio": "9:16", "duration": 10,
            "imagePriority": True, "keyframeFirst": v["kf"]}))
        edges.append({"id": f"e{k}t", "source": f"p{k+1}", "sourceHandle": "text-out", "target": f"v{k+1}", "targetHandle": "text-in"})
        if first:  # ảnh thật của hộp (tay cầm hộp) làm khung mở đầu
            edges.append({"id": "eff", "source": "box", "sourceHandle": "image-out", "target": "v1", "targetHandle": "image-in-start"})
        for r in ("box", "inner", "desk"):
            edges.append({"id": f"e{k}{r}", "source": r, "sourceHandle": "image-out", "target": f"v{k+1}", "targetHandle": "image-in"})
    g = {"kind": "flow-workflow", "schemaVersion": 1, "name": f"POV EXP {name}", "description": v["note"], "nodes": nodes, "edges": edges}
    (OUT / f"{name}.json").write_text(json.dumps(g, ensure_ascii=False), encoding="utf-8")
    print(name, "→", v["note"])
