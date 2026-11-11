# -*- coding: utf-8 -*-
"""Dựng 4 biến thể thí nghiệm đồng nhất cho mẫu HND Gia đình (nhúng sẵn ảnh Bố / Mẹ / Con gái + sản phẩm).
R1 baseline (như HND: không AI mô tả, không khóa ưu tiên ảnh)
R2 + AI mô tả ảnh + khóa ƯU TIÊN ẢNH
R3 = R2 + sản phẩm (ảnh tham chiếu thứ 4) + nhắc sản phẩm trong prompt cảnh
R4 = R3 + keyframe-first (Generate Image khung hình từng cảnh → Image→Video)
"""
import base64, copy, json, subprocess, sys, tempfile, uuid
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
TN = Path(__file__).resolve().parents[3].joinpath(r"TaiNguyen")
OUT = Path(__file__).resolve().parents[3].joinpath(r"HNDWorkflow\HND worflows export\4_thi_nghiem_dong_nhat")
OUT.mkdir(parents=True, exist_ok=True)
tpl = next(t for t in json.loads(Path(__file__).resolve().parents[2].joinpath(r"frontend\src\data\hndFlowTemplates.json").read_text(encoding="utf-8"))
           if t["id"] == "hnd-ai-family-video-creator")


def data_url(path, vf="scale='min(1280,iw)':-2"):
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "x.jpg"
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(path), "-vf", vf, "-q:v", "3", str(out)], check=True)
        return "data:image/jpeg;base64," + base64.b64encode(out.read_bytes()).decode()


IMG = {"father": data_url(TN / "Bo.png"), "mother": data_url(TN / "Me.png"), "child": data_url(TN / "ChiDai.png")}
# Ảnh sản phẩm: cắt phần quạt (bỏ chữ thông số bên phải)
PROD = data_url(TN / "quat-cam-tay-mini-jisulife-life-7-5000mah_4__3.webp", "crop=iw*0.5:ih:0:0,scale=600:-2")
PROD_DESC = "Quạt cầm tay mini JisuLife Life 7 màu hồng pastel, cánh quạt tròn, màn hình LED nhỏ hiển thị %, tay cầm thẳng dài in chữ JisuLife"
PROD_LINE = ("Trong cảnh này Mẹ @MeGiaDinh cầm trên tay chiếc quạt cầm tay mini JisuLife màu hồng (sản phẩm — Ảnh #4), "
             "bật quạt hướng về mặt, sản phẩm luôn rõ ràng trong khung hình, giữ đúng 100% hình dáng, màu hồng và logo như Ảnh #4.")


def nid():
    return "n-" + uuid.uuid4().hex[:10]


def base(name):
    g = copy.deepcopy(tpl["graph"])
    g["name"] = name
    for n in g["nodes"]:
        if n["type"] == "upload-image":
            role = n["data"].get("memberRole")
            n["data"]["image"] = IMG[role]
            n["data"]["fileName"] = {"father": "Bo.png", "mother": "Me.png", "child": "ChiDai.png"}[role]
            n["data"]["characterName"] = {"father": "BoGiaDinh", "mother": "MeGiaDinh", "child": "ConGai"}[role]
    return g


def variant(name, describe, priority):
    g = base(name)
    for n in g["nodes"]:
        if n["type"] == "upload-image":
            n["data"]["autoDescribe"] = describe
        if n["type"] == "generate-video":
            n["data"]["imagePriority"] = priority
    return g


def add_product(g):
    p = {"id": nid(), "type": "upload-image", "position": {"x": -1200, "y": 600},
         "data": {"refRoles": ["product"], "batchLabel": "📦 SẢN PHẨM: QUẠT JISULIFE", "batchOrder": 9, "image": PROD,
                  "fileName": "quat.jpg", "prompt": PROD_DESC, "autoDescribe": True}}
    g["nodes"].append(p)
    for n in g["nodes"]:
        if n["type"] == "generate-video":
            g["edges"].append({"id": nid(), "source": p["id"], "sourceHandle": "image-out", "target": n["id"], "targetHandle": "image-in"})
        if n["type"] == "prompt":
            n["data"]["prompt"] = n["data"]["prompt"].rstrip() + "\n" + PROD_LINE
    return g


def keyframe_first(g):
    byid = {n["id"]: n for n in g["nodes"]}
    ups = [n for n in g["nodes"] if n["type"] == "upload-image"]
    for v in [n for n in g["nodes"] if n["type"] == "generate-video"]:
        text_edge = next(e for e in g["edges"] if e["target"] == v["id"] and e["targetHandle"] == "text-in")
        gi = {"id": nid(), "type": "generate-image", "position": {"x": v["position"]["x"] - 380, "y": v["position"]["y"] + 260},
              "data": {"batchLabel": "Khung hình " + v["data"].get("batchLabel", ""), "imageMode": "image-to-image", "ratio": "9:16", "count": 1}}
        g["nodes"].append(gi)
        g["edges"].append({"id": nid(), "source": text_edge["source"], "sourceHandle": text_edge["sourceHandle"], "target": gi["id"], "targetHandle": "text-in"})
        for u in ups:
            g["edges"].append({"id": nid(), "source": u["id"], "sourceHandle": "image-out", "target": gi["id"], "targetHandle": "image-in"})
        # Video: Image→Video, khung mở đầu = ảnh khung hình vừa tạo (ảnh nhân vật vẫn đi kèm làm tham chiếu)
        v["data"]["videoMode"] = "image-to-video"
        g["edges"].append({"id": nid(), "source": gi["id"], "sourceHandle": "image-out", "target": v["id"], "targetHandle": "image-in"})
    return g


def data_url_fc(path, fc):
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "x.jpg"
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(path), "-filter_complex", fc, "-q:v", "3", str(out)], check=True)
        return "data:image/jpeg;base64," + base64.b64encode(out.read_bytes()).decode()


# Ảnh ghép 2 ô: toàn thân mặt trước (ô trên trái) + cận mặt (ô dưới phải) → mặt to hơn, vẫn thấy trang phục
FC = "[0]crop=iw/2:ih/2:0:0[a];[0]crop=iw/2:ih/2:iw/2:ih/2[b];[a][b]hstack,scale='min(1280,iw)':-2"
IMG_FACE = {"father": data_url_fc(TN / "Bo.png", FC), "mother": data_url_fc(TN / "Me.png", FC), "child": data_url_fc(TN / "ChiDai.png", FC)}


def face_variant(name):
    g = variant(name, True, True)
    for n in g["nodes"]:
        if n["type"] == "upload-image" and n["data"].get("memberRole") in IMG_FACE:
            n["data"]["image"] = IMG_FACE[n["data"]["memberRole"]]
    return g


exps = {
    "R7": keyframe_first(add_product(face_variant("EXP R7 Gia dinh - keyframe + anh ghep + san pham"))),
    "R4c": keyframe_first(add_product(variant("EXP R4c Gia dinh - lap lai R4", True, True))),
    "R6": add_product(face_variant("EXP R6 Gia dinh - tot nhat anh ghep + san pham")),
    "R5": face_variant("EXP R5 Gia dinh - R2 + anh ghep toan than + can mat"),
    "R1": variant("EXP R1 Gia dinh - baseline HND", False, False),
    "R2": variant("EXP R2 Gia dinh - AI mo ta + uu tien anh", True, True),
    "R3": add_product(variant("EXP R3 Gia dinh - R2 + san pham anh #4", True, True)),
    "R4": keyframe_first(add_product(variant("EXP R4 Gia dinh - R3 + keyframe truoc", True, True))),
}
for k, g in exps.items():
    g["kind"] = "flow-workflow"
    g["schemaVersion"] = 1
    p = OUT / f"{k}.json"
    p.write_text(json.dumps(g, ensure_ascii=False), encoding="utf-8")
    print(k, p, p.stat().st_size, len(g["nodes"]), len(g["edges"]))
