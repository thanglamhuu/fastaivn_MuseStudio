# -*- coding: utf-8 -*-
"""Sinh sơ đồ mẫu "Hieu POV AIO" (flow-workflow) cho MuseStudio.
Ghi: frontend/src/data/hieuPovAio.flow.json
"""
import json, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
FE = Path(r"I:\Claude\Srcs\MuseStudio\frontend")

BRIEF = """=== THÔNG TIN SẢN PHẨM (sửa các dòng này — để trống thì AI tự nhận diện từ ảnh) ===
Sản phẩm:
Điểm nổi bật:
  (chỉ ghi điều ĐÚNG với ảnh của bạn — chữ khác ảnh, ví dụ "phủ phấn trắng" khi quả trong ảnh láng bóng, sẽ làm video ra SAI MÀU / SAI SẢN PHẨM)
Phong cách lời thoại: HYPE
  (HYPE = Gen Z phấn khích "cưng xỉu", "mấy bà" · TÒ MÒ = mở bằng câu hỏi gây tò mò + "để mình khui cho xem" · ASMR = tả cảm giác chậm, giàu hình ảnh, mùi vị)
Giọng đọc: nữ trẻ miền Nam, thân thiện như đang kể với bạn thân

=== HIEU POV AIO — QUY TẮC ĐẠO DIỄN (giữ nguyên) ===
Thể loại: video review sản phẩm GÓC NHÌN THỨ NHẤT (POV) dọc 9:16 cho affiliate TikTok / Shopee, trông như người thật tự quay bằng điện thoại.
Nhân vật: CHỈ có đôi bàn tay nữ người Việt (da sáng, móng gọn sơn nude), KHÔNG lộ mặt, không người thứ hai, không thấy cơ thể ngoài cổ tay – cẳng tay.
Camera: điện thoại ở ngang tầm mắt người ngồi trước bàn, nhìn chéo xuống mặt bàn 30–45°, tay cầm hơi rung tự nhiên; sản phẩm luôn ở giữa – nửa dưới khung; có lúc đưa sát ống kính macro rồi lùi ra; lấy nét nhanh theo sản phẩm.
Bối cảnh: ĐÚNG ảnh "Bối cảnh POV" (góc bàn trắng, đèn ngủ, kệ pegboard trắng, poster hồng trên tường) — giữ nguyên ở mọi cảnh. ÁNH SÁNG ban ngày sáng trong, trắng trung tính, không ám vàng, không tối (để màu sản phẩm lên đúng như ảnh).
Sản phẩm: giống 100% ảnh sản phẩm: bao bì, chữ in, màu, hình dáng, số lượng; không thêm logo, không đổi chữ trên hộp, không biến dạng.
TẢ SẢN PHẨM CHỈ THEO ẢNH: màu sắc, bề mặt, độ trong / đục của sản phẩm phải nhìn từ ảnh đính kèm mà tả (ví dụ "vàng cam tươi, trong mọng, láng"); không tự thêm đặc điểm không thấy trong ảnh (phấn trắng, nâu sẫm, cháy xém...).
GIỮ BAO BÌ: hộp / gói giữ thẳng, MẶT IN LUÔN HƯỚNG ỐNG KÍNH, di chuyển chậm; KHÔNG xoay lật, không nghiêng gắt, không che chữ (xoay hộp làm AI vẽ lại sai hình in).
Âm thanh: giọng đọc VOICE-OVER (thuyết minh, không ai nói trong khung) + tiếng ASMR thật của thao tác (mở nắp, bóc màng, xé, tách, nhai giòn...). Không nhạc nền. KHÔNG phụ đề, KHÔNG chữ chạy trên hình.

KHUNG 3 CẢNH (mỗi cảnh 3 nhịp, liền mạch như 1 lần quay):
- Cảnh 1 HOOK – KHOE HỘP: nhịp 1 hai tay cầm hộp / gói giơ NGAY NGẮN trước ống kính, mặt trước nhìn thẳng, giữ yên + câu hook (câu cảm thán hoặc câu hỏi gây tò mò); nhịp 2 đặt hộp xuống bàn, mở nắp / bóc seal; nhịp 3 lộ sản phẩm bên trong, nghiêng nhẹ khoe màu sản phẩm.
- Cảnh 2 CẬN CẢNH – CẢM GIÁC: macro bề mặt, kết cấu; tay làm THAO TÁC ĐẶC TRƯNG của ngành hàng (bảng dưới); lời thoại tả màu, độ dẻo / mịn, mùi, âm thanh.
- Cảnh 3 TRẢI NGHIỆM – CHỐT ĐƠN: tay đưa phần sản phẩm lại gần ống kính như mời người xem, cho thấy kết quả dùng thật; câu chốt kêu gọi "bấm giỏ hàng / ghim link"; 1 giây cuối giữ khung tĩnh có sản phẩm + hộp trên bàn.

THAO TÁC THEO NGÀNH HÀNG (AI tự chọn theo ảnh sản phẩm):
- Đồ ăn vặt / đặc sản / đồ khô: bóc gói, tách đôi, kéo sợi, mật – sốt ứa chảy, bẻ giòn, đưa miếng cắn dở lại gần ống kính.
- Đồ uống: lắc ly, cắm ống hút, rót ra, đá va leng keng, đưa ly sát ống kính.
- Mỹ phẩm / chăm sóc da: bóp – nhấn ra mu bàn tay hoặc mặt kính, miết thử chất kem, thoa tan, khoe độ mịn.
- Gia dụng / đồ điện nhỏ: bấm nút bật, cận cảnh hoạt động thật (gió, đèn, lưỡi dao, hơi nước...), so sánh trước – sau.
- Đồ chơi / sách / văn phòng phẩm: mở hộp, lật trang, lắp ráp, bày lên bàn.

CÁCH VIẾT MỖI ĐOẠN PROMPT CẢNH (tiếng Việt, GỌN — mỗi đoạn tối đa ~900 ký tự, đủ 3 cảnh, cảnh 3 BẮT BUỘC có câu chốt đơn):
CẢNH 0X/03 — <tên nhịp> | Hành động 3 nhịp (giây): ... | Camera: ... | Âm thanh ASMR: ... | Lời thoại voice-over: "..." | Bao bì: <tả y hệt ảnh: màu hộp, hình in, vị trí chữ chính> | Màu sản phẩm: <đúng ảnh> + "KHÔNG sẫm, KHÔNG ám màu" | Khóa: chỉ đôi tay, không mặt, không môi, không chữ phụ đề, đúng bối cảnh + sản phẩm trong ảnh.
(Mục Bao bì + Màu sản phẩm GIỐNG NHAU ở cả 3 đoạn. Không cần tả lại bối cảnh / đôi tay trong từng đoạn — app tự gửi kèm ảnh khóa.)
(Không cần tả lại bối cảnh / đôi tay / quy tắc chung trong từng đoạn — app tự gửi kèm ảnh khóa.)"""

BG_DESC = (
    "Góc bàn làm việc phòng ngủ con gái nhìn từ trên xuống chéo (góc POV người ngồi): mặt bàn trắng trơn chiếm nửa dưới khung, "
    "đèn ngủ trụ chụp vải lanh sáng vàng ấm chân gỗ bên trái, thú bông ngựa vằn mép trái, kệ pegboard trắng có bình thủy tinh, "
    "son, tượng thỏ nhỏ; tường kem dán poster hồng 'FOCUS ON THE GOOD'; ánh sáng sáng trong, không người."
)


def node(id_, type_, x, y, data):
    return {"id": id_, "type": type_, "position": {"x": x, "y": y}, "data": data}


nodes = [
    node("pov-product-1", "upload-image", 0, 0, {
        "refRoles": ["product"], "productId": "", "autoDescribe": True,
        "batchLabel": "📦 Ảnh sản phẩm 1 — hộp / bao bì (BẮT BUỘC, ảnh thật)",
        "prompt": "Ảnh thật của sản phẩm: ưu tiên ảnh thấy rõ hộp / bao bì và chữ in. Hoặc tích chọn sản phẩm trong Cài đặt.",
    }),
    node("pov-product-2", "upload-image", 0, 300, {
        "refRoles": ["product"], "productId": "", "autoDescribe": True,
        "batchLabel": "🔍 Ảnh sản phẩm 2 — bên trong / cận cảnh (tùy chọn, để trống = bỏ qua)",
        "prompt": "",
    }),
    node("pov-desk", "upload-image", 0, 600, {
        "refRoles": ["scene"], "autoDescribe": True,
        "batchLabel": "🏠 Bối cảnh POV — góc bàn (đổi ảnh bàn của bạn được)",
        "image": "workflow-thumbs/fastaivn-pov-desk.jpg", "fileName": "pov-desk.jpg",
        "prompt": BG_DESC,
    }),
    node("pov-brief", "prompt", 380, 0, {"batchLabel": "🎯 Brief POV AIO — sửa 4 dòng thông tin sản phẩm", "prompt": BRIEF}),
    node("pov-script", "gemini-script", 380, 520, {
        "batchLabel": "🧠 AI viết kịch bản 3 cảnh POV", "prompt": "", "outputCount": 3, "sceneSeconds": 10, "firstOutputIsCharacter": False,
    }),
]
names = ["Cảnh 1 · Hook – khoe hộp", "Cảnh 2 · Cận cảnh – cảm giác", "Cảnh 3 · Trải nghiệm – chốt đơn"]
for i in range(3):
    nodes.append(node(f"pov-vid-{i+1}", "generate-video", 820, i * 320, {
        "batchLabel": f"🎬 {names[i]} (10s)", "videoMode": "reference-to-video", "ratio": "9:16", "duration": 10,
        "prompt": "", "imagePriority": True, "keyframeFirst": True,
    }))
nodes += [
    node("pov-merge", "merge-video", 1200, 300, {"batchLabel": "🎞️ Ghép 3 cảnh", "portCount": 3}),
    node("pov-result", "result", 1500, 300, {"batchLabel": "✅ Video POV hoàn chỉnh (~30s)"}),
]

edges = []
def e(s, sh, t, th):
    edges.append({"id": f"e-{s}-{sh}-{t}-{th}", "source": s, "sourceHandle": sh, "target": t, "targetHandle": th})

refs = ["pov-product-1", "pov-product-2", "pov-desk"]
for r in refs:
    e(r, "image-out", "pov-script", "image-in")
e("pov-brief", "text-out", "pov-script", "text-in")
for i in range(3):
    v = f"pov-vid-{i+1}"
    e("pov-script", f"text-out-{i}", v, "text-in")
    for r in refs:
        e(r, "image-out", v, "image-in")
    e(v, "video-out", "pov-merge", f"video-in-{i}")
e("pov-merge", "video-out", "pov-result", "video-in")

graph = {
    "kind": "flow-workflow", "schemaVersion": 1,
    "name": "Hieu POV AIO — Review sản phẩm góc nhìn thứ nhất",
    "description": "1 ảnh sản phẩm → AI nhận diện ngành hàng, viết 3 cảnh POV (khoe hộp → cận cảnh → trải nghiệm & chốt đơn) có giọng đọc → "
                   "tạo ảnh khung hình + video từng cảnh trên cùng 1 góc bàn → ghép ~30s.",
    "nodes": nodes, "edges": edges,
}
out = FE / "src/data/hieuPovAio.flow.json"
out.write_text(json.dumps(graph, ensure_ascii=False, indent=1), encoding="utf-8")
print("ok", out, len(nodes), "nodes", len(edges), "edges")
