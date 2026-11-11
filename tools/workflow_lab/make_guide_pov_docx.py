# -*- coding: utf-8 -*-
"""Tài liệu hướng dẫn thực hành FastAIVN.com: tạo tay video POV review Hồng treo gió trên muse.ai, giữ đúng tham chiếu."""
import sys
from pathlib import Path

HERE = Path(__file__).parent
src = (HERE / "make_report_docx.py").read_text(encoding="utf-8-sig")
exec(src.split("# =====================================================================  TRANG BÌA")[0])  # helpers + styles + doc

from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK  # noqa: E402
from docx.enum.table import WD_TABLE_ALIGNMENT  # noqa: E402
from docx.oxml import OxmlElement  # noqa: E402
from docx.oxml.ns import qn  # noqa: E402
from docx.shared import Cm, Pt  # noqa: E402

DIR = Path(__file__).resolve().parents[3].joinpath(r"HNDWorkflow\HuongDan_POV_HongTreoGio")
IMG = DIR / "anh"
OUT = DIR / "FastAIVN - Huong dan thuc hanh video POV review Hong treo gio.docx"
FONT_MONO = "Consolas"
sec = doc.sections[0]


def prompt_box(title, text, note=None):
    t = doc.add_table(rows=1, cols=1)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    no_borders(t)
    c = t.cell(0, 0)
    shade(c, "F4F7FC")
    cell_margins(c, 140, 140, 220, 200)
    tcPr = c._tc.get_or_add_tcPr()
    bdr = OxmlElement("w:tcBorders")
    for edge, sz, col in (("left", "36", BLUE), ("top", "4", "C9D8F5"), ("bottom", "4", "C9D8F5"), ("right", "4", "C9D8F5")):
        e = OxmlElement(f"w:{edge}")
        e.set(qn("w:val"), "single")
        e.set(qn("w:sz"), sz)
        e.set(qn("w:color"), col)
        bdr.append(e)
    tcPr.append(bdr)
    p = c.paragraphs[0]
    run(p, title, bold=True, color=BLUE, size=10.5)
    p.paragraph_format.space_after = Pt(4)
    lines = []
    for raw in text.strip("\n").split("\n"):
        lines += wrap(raw, 86).split("\n") if raw else [""]
    for line in lines:
        q = c.add_paragraph()
        q.paragraph_format.space_after = Pt(1)
        q.paragraph_format.line_spacing = 1.1
        r = q.add_run(line if line else " ")
        r.font.name = FONT_MONO
        r._element.rPr.rFonts.set(qn("w:eastAsia"), FONT_MONO)
        r.font.size = Pt(8.5)
        r.font.color.rgb = rgb("1D2B4F")
    no_split(t)
    if note:
        n = doc.add_paragraph()
        run(n, note, italic=True, color="51607A", size=9)
        n.paragraph_format.space_after = Pt(8)
    else:
        doc.add_paragraph().paragraph_format.space_after = Pt(4)


def wrap(s, w=86):
    out, line = [], ""
    for word in s.split(" "):
        if line and len(line) + len(word) + 1 > w:
            out.append(line)
            line = word
        else:
            line = f"{line} {word}" if line else word
    out.append(line)
    return "\n".join(out)


_callout = callout


def callout(*a, **k):  # khung lưu ý không bị tách qua 2 trang
    _callout(*a, **k)
    no_split(doc.tables[-1])


def step_header(num, title, time):
    t = doc.add_table(rows=1, cols=2)
    no_borders(t)
    a, b = t.cell(0, 0), t.cell(0, 1)
    a.width, b.width = Cm(2.2), Cm(14.8)
    shade(a, RED)
    shade(b, LIGHT)
    cell_margins(a, 100, 100, 120, 120)
    cell_margins(b, 100, 100, 200, 120)
    pa = a.paragraphs[0]
    pa.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run(pa, f"BƯỚC {num}", bold=True, color="FFFFFF", size=10)
    pb = b.paragraphs[0]
    run(pb, title, bold=True, color=NAVY, size=12)
    run(pb, f"   ⏱ {time}", color="51607A", size=9.5)
    pa.paragraph_format.space_after = pb.paragraph_format.space_after = Pt(0)
    pb.paragraph_format.keep_with_next = True
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


# =====================================================================  BÌA
band = doc.add_table(rows=1, cols=1)
no_borders(band)
band.cell(0, 0).paragraphs[0].add_run().add_picture(str(IMG / "logo.png"), width=Cm(6.5))
doc.add_paragraph().paragraph_format.space_after = Pt(24)
p = doc.add_paragraph()
run(p, "HƯỚNG DẪN THỰC HÀNH", bold=True, color=RED, size=13)
p.paragraph_format.space_after = Pt(4)
p = doc.add_paragraph()
run(p, "VIDEO POV REVIEW", bold=True, color=NAVY, size=30)
p.paragraph_format.space_after = Pt(0)
p = doc.add_paragraph()
run(p, "HỒNG TREO GIÓ ĐÀ LẠT", bold=True, color=BLUE, size=30)
p.paragraph_format.space_after = Pt(10)
tag = doc.add_table(rows=1, cols=1)
no_borders(tag)
tc = tag.cell(0, 0)
shade(tc, BLUE)
cell_margins(tc, 120, 120, 240, 240)
run(tc.paragraphs[0], "Làm tay trên muse.ai  •  Giữ đúng bao bì  •  Giữ đúng màu sản phẩm  •  Chỉ thấy đôi tay", bold=True, color="FFFFFF", size=12)
doc.add_paragraph().paragraph_format.space_after = Pt(12)
para("Từng bước tạo một video review sản phẩm góc nhìn thứ nhất (POV) dài ~30 giây cho kênh affiliate TikTok / Shopee — "
     "chỉ với 3 ảnh và tài khoản muse.ai. Kèm toàn bộ prompt dùng ngay cho Hồng treo gió VijiFarm và các bài học đã kiểm chứng "
     "bằng thí nghiệm để hộp không bị vẽ lại, quả không bị sẫm màu.", color="33415C", size=11)
doc.add_paragraph().paragraph_format.space_after = Pt(6)
figure(IMG / "thanh_pham.png", 7.2, "Thành phẩm: 3 cảnh × 10 giây — khoe hộp → bóc màng, tách quả → ăn thử & chốt đơn (khung hình mỗi 2 giây).")
meta = doc.add_table(rows=4, cols=2)
no_borders(meta)
for i, (k, v) in enumerate((
    ("Biên soạn", "FastAIVN.com"),
    ("Công cụ", "muse.ai (Muse Image + Muse Video), Gemini / ChatGPT (viết kịch bản), CapCut (ghép)"),
    ("Thời gian làm", "~40–50 phút / video (lần đầu); ~20 phút khi đã quen"),
    ("Áp dụng cho", "Đồ ăn vặt, đặc sản, mỹ phẩm, gia dụng nhỏ — mọi sản phẩm có bao bì"),
)):
    a, b = meta.cell(i, 0), meta.cell(i, 1)
    a.width, b.width = Cm(4), Cm(13)
    shade(a, LIGHT)
    cell_margins(a)
    cell_margins(b)
    run(a.paragraphs[0], k, bold=True, color=NAVY, size=10)
    run(b.paragraphs[0], v, size=10)
    a.paragraphs[0].paragraph_format.space_after = b.paragraphs[0].paragraph_format.space_after = Pt(0)

sec.different_first_page_header_footer = True
hp = sec.header.paragraphs[0]
hp.add_run().add_picture(str(IMG / "logo.png"), width=Cm(3.2))
hp.add_run("\t")
run(hp, "Hướng dẫn thực hành: Video POV review Hồng treo gió", color="51607A", size=8.5)
hp.paragraph_format.tab_stops.add_tab_stop(Cm(17), alignment=2)
para_border_bottom(hp, BLUE, 8)
fp = sec.footer.paragraphs[0]
run(fp, "© FastAIVN.com — Tài liệu học viên   ·   Trang ", color="51607A", size=8.5)
add_field(fp, "PAGE")
fp.alignment = WD_ALIGN_PARAGRAPH.CENTER

# =====================================================================  MỤC LỤC
h1("Nội dung").paragraph_format.page_break_before = True
for n, t in (
    ("01", "Video POV review là gì — cấu trúc 3 cảnh"),
    ("02", "Chuẩn bị 3 ảnh tham chiếu"),
    ("03", "Quy trình 6 bước làm tay trên muse.ai"),
    ("04", "Bộ prompt đầy đủ cho Hồng treo gió VijiFarm (copy dùng ngay)"),
    ("05", "10 lưu ý vàng để giữ đúng tham chiếu"),
    ("06", "Bằng chứng: thí nghiệm trước / sau"),
    ("07", "Checklist & xử lý sự cố"),
):
    p = doc.add_paragraph()
    run(p, f"{n}   ", bold=True, color=RED, size=11)
    run(p, t, color=NAVY, size=11)
    p.paragraph_format.space_after = Pt(3)
callout("3 điều quan trọng nhất (đọc trước khi làm)", [
    ("1. Muse làm theo CHỮ nhiều hơn theo ẢNH. ", "Chữ tả sai (\"quả cam nâu, phủ phấn trắng\" trong khi ảnh quả vàng cam láng) → video ra quả nâu sẫm. "
     "Mọi mô tả sản phẩm phải nhìn từ ảnh mà viết."),
    ("2. Không xoay, không lật hộp. ", "Hộp càng xoay nhiều AI càng phải \"vẽ lại\" mặt in → sai hình, sai chữ. Giơ hộp ngay ngắn, mặt in hướng ống kính."),
    ("3. Tạo ảnh khung hình trước, duyệt rồi mới tạo video. ", "Ảnh khung hình đúng thì video đúng; ảnh sai thì làm lại ảnh (rẻ, nhanh) thay vì làm lại video."),
], icon="🎯")

# =====================================================================  01
h1("Video POV review là gì — cấu trúc 3 cảnh", "01")
para("Video POV (Point of View) quay từ góc mắt người xem: chỉ thấy đôi tay đang cầm, mở, dùng thử sản phẩm trên một góc bàn quen thuộc, "
     "có giọng đọc thuyết minh (voice-over) và tiếng ASMR thật của thao tác. Không lộ mặt nên không cần người mẫu, dễ làm hàng loạt, "
     "rất hợp kênh affiliate đồ ăn vặt, đặc sản, mỹ phẩm, gia dụng.")
data_table(
    ["Cảnh", "Nhịp", "Hình ảnh", "Lời thoại (ví dụ Hồng treo gió)"],
    [
        ["1 · 0–10s", "HOOK – KHOE HỘP", "Hai tay giơ hộp ngay ngắn trước ống kính → đặt xuống bàn, mở nắp → lộ khay hồng vàng cam",
         "\"Mấy bà ơi, hồng treo gió Đà Lạt VILIFARM cưng xỉu luôn nè, khui hộp ra là thơm nức mũi luôn á!\""],
        ["2 · 10–20s", "CẬN CẢNH – CẢM GIÁC", "Bóc màng seal → nhấc 1 quả đưa macro sát ống kính, ấn nhẹ → xé đôi, mật ứa kéo sợi",
         "\"Trời ơi hồng vàng cam tươi láng mọng dẻo quẹo luôn mấy bà, ấn nhẹ là mật ứa ra ngọt thanh quá nè!\""],
        ["3 · 20–30s", "TRẢI NGHIỆM – CHỐT ĐƠN", "Đưa miếng cắn dở sát ống kính → đặt cạnh hộp → giữ khung tĩnh 1 giây cuối",
         "\"Ăn một miếng là ghiền luôn mấy bà ơi, hồng dẻo ngọt thanh không gắt đâu, bấm giỏ hàng chốt ngay nha!\""],
    ],
    [2.0, 3.2, 5.8, 6.0],
    font_size=9,
)
callout("Ba phong cách lời thoại (chọn 1)", [
    ("HYPE: ", "Gen Z phấn khích — \"cưng xỉu\", \"mấy bà ơi\", \"chốt ngay nha\". Hợp đồ ăn vặt, giá rẻ."),
    ("TÒ MÒ: ", "Mở bằng câu hỏi — \"Nửa cân hồng này có gì mà dân tình đồn thổi?\" + \"để mình khui cho xem\"."),
    ("ASMR: ", "Tả cảm giác chậm, giàu hình ảnh — \"mùi thơm ngọt lịm phảng phất… dẻo mềm tan nơi đầu lưỡi\". Hợp đặc sản, quà biếu."),
], icon="🎙")

# =====================================================================  02
h1("Chuẩn bị 3 ảnh tham chiếu", "02")
para("muse.ai nhận tối đa 4 ảnh cho mỗi video. Khi dùng ảnh khung hình mở đầu (Bước 3) thì còn 3 chỗ — đúng bằng 3 ảnh dưới đây:")
data_table(
    ["Ảnh", "Nội dung", "Yêu cầu để giữ tham chiếu tốt"],
    [
        ["#A  Hộp / bao bì", "hop.webp — tay cầm hộp VijiFarm nhìn thẳng", "Mặt in chiếm ≥ 60% khung, nhìn THẲNG (không nghiêng), đủ sáng, rõ chữ. Không dùng banner có chữ quảng cáo đè lên."],
        ["#B  Sản phẩm bên trong", "Hộp mở, khay nhựa + quả hồng", "Thấy rõ MÀU THẬT của quả (vàng cam trong mọng), nhãn trên khay. Chụp ánh sáng tự nhiên, không filter."],
        ["#C  Bối cảnh POV", "Góc bàn trắng, đèn ngủ, pegboard, poster", "Góc nhìn chéo xuống bàn như người ngồi, mặt bàn trống chiếm nửa dưới. Dùng CỐ ĐỊNH cho mọi video của kênh."],
    ],
    [3.4, 5.0, 8.6],
    font_size=9,
)
figure(IMG / "anh_san_pham.png", 16.5, "Ảnh sản phẩm dùng trong bài (thư mục TaiNguyen\\HongTreoGio): ảnh 1 = #A hộp, ảnh 2 = #B bên trong; các ảnh còn lại để tham khảo màu quả.")
figure(IMG / "goc_ban.png", 4.5, "Ảnh #C — góc bàn POV.")
callout("Lưu ý về ánh sáng", [
    "Ảnh sản phẩm chụp ngoài nắng (rất sáng) còn góc bàn chụp dưới đèn ngủ buổi tối → video sẽ tối hơn ảnh sản phẩm khoảng 25%. "
    "Muốn quả lên tươi sáng như ảnh: dùng ảnh góc bàn chụp ban ngày cạnh cửa sổ, và luôn ghi \"ánh sáng ban ngày trung tính\" trong prompt.",
], fill="FFF4D6", bar=AMBER, icon="☀️")

# =====================================================================  03
h1("Quy trình 6 bước làm tay trên muse.ai", "03")
step_header(1, "Nhờ AI nhìn ảnh, tả lại sản phẩm + bao bì", "3 phút")
para("Mở Gemini / ChatGPT (hoặc khung chat muse.ai), đính kèm ảnh #A và #B, dán prompt P1 (mục 04). Nhận về 2 đoạn: BAO BÌ và MÀU SẢN PHẨM.")
callout("Phải đọc lại và SỬA mô tả của AI", [
    "Trong thí nghiệm, AI tả ảnh #B là quả \"màu cam nâu nhạt\" — trong khi quả thật vàng cam trong mọng. "
    "Chữ \"nâu\" này lọt vào prompt video sẽ làm quả bị sẫm. Sửa thành \"vàng cam tươi, trong mọng, láng\" trước khi dùng.",
], fill="FDECEC", bar=RED, icon="⚠️")
step_header(2, "Viết kịch bản 3 cảnh", "5 phút")
para("Dán prompt P2 (mục 04) vào Gemini / ChatGPT kèm 3 ảnh. Kiểm tra: đủ 3 cảnh, cảnh 3 có câu chốt đơn, KHÔNG có chữ \"xoay / lật hộp\", "
     "mục Bao bì + Màu sản phẩm giống hệt nhau ở cả 3 cảnh. (Muốn nhanh: dùng luôn 3 prompt cảnh viết sẵn P4a–P4c.)")
step_header(3, "Tạo ảnh khung hình mở đầu cho từng cảnh (Muse Image)", "3 × 1 phút")
para("Trên muse.ai, tạo ẢNH (không phải video), tỉ lệ 9:16, đính kèm 3 ảnh #A #B #C, dán prompt P3 + đoạn \"Hành động\" nhịp đầu của cảnh. "
     "Làm 3 lần cho 3 cảnh. Duyệt từng ảnh: hộp đúng hình in? quả đúng màu? chỉ có tay? — sai thì tạo lại ảnh (chưa tốn lượt video).")
figure(IMG / "keyframes.png", 14, "Ảnh khung hình mở đầu đạt chuẩn của 3 cảnh: hộp đúng bố cục (cô gái bên trái, chữ dọc bên phải), quả vàng cam, chỉ thấy đôi tay.")
step_header(4, "Tạo video từng cảnh (Muse Video)", "3 × 3–5 phút")
para("Tạo VIDEO 9:16, 10 giây. Đính kèm theo đúng thứ tự: (1) ảnh khung hình của cảnh vừa duyệt, (2) ảnh #A hộp, (3) ảnh #B bên trong, (4) ảnh #C góc bàn. "
     "Dán prompt cảnh P4a / P4b / P4c. Ba cảnh có thể tạo song song.")
step_header(5, "Kiểm tra từng cảnh", "5 phút")
para("Xem từng video theo checklist mục 07. Cảnh nào sai (hộp vẽ lại, quả sẫm, lộ mặt, mất tiếng) → tạo lại RIÊNG cảnh đó, giữ nguyên ảnh khung hình.")
step_header(6, "Ghép, hậu kỳ, đăng", "10 phút")
bullet("CapCut: ghép 3 cảnh theo thứ tự, cắt bỏ 0.2–0.5s đầu / cuối nếu có khựng; chỉnh âm lượng giọng đọc đều nhau.")
bullet("Có thể tăng sáng nhẹ (+5–10) và độ bão hòa (+5) nếu video vẫn tối hơn ảnh thật — KHÔNG đổi màu sắc (hue).")
bullet("Thêm chữ tiêu đề / giá / mũi tên giỏ hàng ở hậu kỳ (không bắt AI viết chữ vào video). Gắn link sản phẩm khi đăng.")

# =====================================================================  04
h1("Bộ prompt đầy đủ cho Hồng treo gió VijiFarm", "04")
para("Copy nguyên khối. Với sản phẩm khác chỉ cần thay đoạn BAO BÌ, MÀU SẢN PHẨM, lời thoại và thao tác cảnh 2.")
prompt_box("P1 · AI tả lại bao bì + màu sản phẩm (đính kèm ảnh #A, #B)", """
Nhìn 2 ảnh đính kèm (ảnh 1 = hộp / bao bì, ảnh 2 = sản phẩm bên trong) và viết đúng 2 đoạn ngắn:
BAO BÌ: tả y hệt mặt in của hộp — màu hộp, hình vẽ (vị trí trái / phải), logo, các dòng chữ
chính và vị trí của chúng. Tối đa 60 từ.
MÀU SẢN PHẨM: tả màu sắc, độ trong / đục, bề mặt (láng, nhăn, phủ phấn…) ĐÚNG NHƯ ẢNH 2. Tối đa 30 từ.
Chỉ tả những gì nhìn thấy, không suy đoán, không thêm đặc điểm không có trong ảnh.
""", note="Kết quả đã sửa dùng trong bài: xem dòng BAO BÌ và MÀU SẢN PHẨM trong P4a.")
prompt_box("P2 · Viết kịch bản 3 cảnh POV (Gemini / ChatGPT, đính kèm 3 ảnh)", """
Bạn là đạo diễn video review sản phẩm POV dọc 9:16 cho TikTok, tiếng Việt.
Sản phẩm: [Hồng treo gió Đà Lạt VijiFarm, hộp 500g] — điểm nổi bật: [dẻo, ứa mật, ngọt thanh,
không chất bảo quản] (chỉ ghi điều ĐÚNG với ảnh). Phong cách lời thoại: [HYPE]. Giọng: nữ trẻ miền Nam.
QUY TẮC: chỉ thấy đôi bàn tay nữ (móng nude), KHÔNG mặt, KHÔNG môi; camera điện thoại ngang tầm mắt
nhìn chéo xuống bàn 30–45°, rung tay nhẹ; bối cảnh đúng ảnh 3 (góc bàn); ánh sáng ban ngày trung tính,
không tối, không ám vàng. Tả sản phẩm CHỈ theo ảnh. Hộp giữ thẳng, mặt in luôn hướng ống kính, KHÔNG
xoay lật. Giọng voice-over + tiếng ASMR thật, không nhạc, không phụ đề.
KHUNG: Cảnh 1 HOOK–khoe hộp (giơ hộp ngay ngắn + câu hook → đặt xuống mở nắp → khoe sản phẩm);
Cảnh 2 CẬN CẢNH (thao tác đặc trưng: tách đôi, mật chảy…); Cảnh 3 TRẢI NGHIỆM–CHỐT ĐƠN (đưa sản phẩm sát
ống kính mời người xem, câu "bấm giỏ hàng", giữ khung tĩnh 1 giây cuối).
Viết đúng 3 đoạn, ngăn cách bằng dòng ---, mỗi đoạn ≤ 900 ký tự theo mẫu:
CẢNH 0X/03 — <nhịp> | Hành động 3 nhịp (giây): ... | Camera: ... | Âm thanh ASMR: ... |
Lời thoại voice-over: "..." | Bao bì: <dán đoạn BAO BÌ của P1> | Màu sản phẩm: <dán đoạn MÀU của P1>,
KHÔNG sẫm, KHÔNG ám màu | Khóa: chỉ đôi tay, không mặt, không môi, không chữ phụ đề.
""")
prompt_box("P3 · Ảnh khung hình mở đầu (Muse Image, 9:16, đính kèm #A #B #C)", """
ONE SINGLE STILL PHOTO (ảnh tĩnh, KHÔNG tạo video), tỉ lệ 9:16, photorealistic — khung hình MỞ ĐẦU của cảnh.
Giữ y hệt sản phẩm / bao bì (hình in, chữ, màu sắc thật) như ảnh 1–2 và bối cảnh góc bàn như ảnh 3;
màu sản phẩm tươi đúng ảnh, không tối, không ám màu. KHÔNG có mặt người, chỉ thấy đôi tay.
Ánh sáng ban ngày trung tính.
Khung hình: [dán nhịp đầu của cảnh, vd. cảnh 1: hai tay cầm hộp giấy cam giơ ngay ngắn trước ống kính,
mặt in nhìn thẳng, phía sau là góc bàn trắng với đèn ngủ và pegboard].
""")
LOCK = ("[ƯU TIÊN ẢNH THAM CHIẾU: nếu chữ khác ảnh thì LUÔN theo ảnh. Ảnh #1 = khung hình mở đầu; Ảnh #2 = hộp VijiFarm; "
        "Ảnh #3 = khay hồng bên trong; Ảnh #4 = góc bàn. Màu sản phẩm tươi, sáng đúng như ảnh (không sẫm, không ám vàng / nâu); "
        "bao bì giữ y hệt hình in, chữ, bố cục như ảnh — không vẽ lại.]")
BAOBI = ("Bao bì: hộp giấy vuông viền cam dày, mặt trước in cô gái đội nón lá tóc tết áo thổ cẩm bên trái cạnh giàn hồng treo, logo VILIFARM, "
         "chữ dọc DRIED PERSIMMON, chữ lớn HỒNG TREO GIÓ ĐÀ LẠT bên phải, dòng \"Ngọt thơm vị nắng, dẻo mềm vị gió\"; khay nhựa trong dán nhãn vàng "
         "\"HỒNG TREO SẤY GIÓ\" | Màu sản phẩm: quả dẹt vàng cam tươi, thịt trong mọng óng như mứt, bề mặt láng; KHÔNG sẫm, KHÔNG nâu, KHÔNG phủ phấn trắng, "
         "KHÔNG ám màu")




HEAD = "Generate a video (aspect ratio 9:16, 10 seconds long):"
TAIL = "Use the first attached image as the opening frame. The other attached images are references (products, scene) to keep consistent."
scenes = [
    ("P4a · Video cảnh 1 — HOOK – KHOE HỘP",
     "CẢNH 01/03 — HOOK – KHOE HỘP | Hành động 3 nhịp (giây): 0-3.5s hai tay cầm hộp giấy cam giơ ngay ngắn trước ống kính, MẶT IN NHÌN THẲNG, giữ yên; "
     "3.5-7.0s đặt hộp xuống bàn trắng, mở nắp; 7.0-10s lộ khay nhựa trong đựng hồng vàng cam, nghiêng nhẹ khoe màu quả. Hộp di chuyển chậm, KHÔNG xoay lật. "
     "| Camera: POV ngang tầm mắt chéo xuống bàn 30–45°, rung tay rất nhẹ | Âm thanh ASMR: tiếng hộp giấy, nắp bật nhẹ | Lời thoại voice-over (nữ trẻ miền Nam): "
     "\"Mấy bà ơi, hồng treo gió Đà Lạt VILIFARM cưng xỉu luôn nè, khui hộp ra là thơm nức mũi luôn á!\" | " + BAOBI +
     " | Ánh sáng ban ngày trung tính | Khóa: chỉ đôi tay, không mặt, không môi, không chữ phụ đề."),
    ("P4b · Video cảnh 2 — CẬN CẢNH – CẢM GIÁC",
     "CẢNH 02/03 — CẬN CẢNH – CẢM GIÁC | Hành động 3 nhịp (giây): 0-3.5s hai tay bóc màng seal khay nhựa trong hộp giấy đang mở; 3.5-7.0s nhấc một quả hồng "
     "vàng cam đưa macro sát ống kính, ngón tay ấn nhẹ cho thấy thịt dẻo mềm trong mọng; 7.0-10s xé đôi quả, ruột vàng cam trong như mứt, mật óng ứa ra kéo sợi "
     "| Camera: POV macro sát rồi lùi nhẹ, lấy nét theo quả | Âm thanh ASMR: tiếng bóc màng, tiếng xé dẻo mềm | Lời thoại voice-over: \"Trời ơi hồng vàng cam "
     "tươi láng mọng dẻo quẹo luôn mấy bà, ấn nhẹ là mật ứa ra ngọt thanh quá nè!\" | " + BAOBI +
     " | Ánh sáng ban ngày trung tính | Khóa: chỉ đôi tay, không mặt, không môi, không chữ phụ đề."),
    ("P4c · Video cảnh 3 — TRẢI NGHIỆM – CHỐT ĐƠN",
     "CẢNH 03/03 — TRẢI NGHIỆM – CHỐT ĐƠN | Hành động 3 nhịp (giây): 0-3.5s tay cầm miếng hồng đã xé / cắn dở đưa sát ống kính như mời người xem, khoe ruột "
     "ứa mật; 3.5-7.0s đặt miếng hồng cạnh khay nhựa, tay vuốt nhẹ hộp giấy về giữa khung, mặt in hướng ống kính; 7.0-10s giữ khung tĩnh 1 giây cuối với quả "
     "hồng, khay và hộp giấy trên bàn | Camera: POV chéo xuống bàn, kết thúc đứng yên | Âm thanh ASMR: tiếng xé nhẹ, tiếng đặt hộp | Lời thoại voice-over: "
     "\"Ăn một miếng là ghiền luôn mấy bà ơi, hồng dẻo ngọt thanh không gắt đâu, bấm giỏ hàng chốt ngay nha!\" | " + BAOBI +
     " | Ánh sáng ban ngày trung tính | Khóa: chỉ đôi tay, không mặt, không môi, không chữ phụ đề, không ăn bằng miệng trong khung."),
]
para("Gửi cho muse.ai theo đúng cấu trúc: dòng mở đầu → prompt cảnh → khóa ưu tiên ảnh → câu dặn ảnh đính kèm. Đính kèm 4 ảnh theo thứ tự: "
     "khung hình của cảnh, #A, #B, #C.")
for title, body in scenes:
    prompt_box(title, HEAD + "\n" + body + "\n\n" + LOCK + "\n\n" + TAIL)

# =====================================================================  05
h1("10 lưu ý vàng để giữ đúng tham chiếu", "05")
data_table(
    ["#", "Lưu ý", "Vì sao (đã kiểm chứng)"],
    [
        ["1", "Tả sản phẩm CHỈ theo ảnh, không điền thông tin chép từ nơi khác", "Chữ \"cam nâu, phủ phấn trắng\" → quả ra nâu sẫm phủ phấn dù ảnh vàng cam láng (độ sáng −75, độ tươi −42)."],
        ["2", "Đọc lại và sửa mô tả do AI viết", "AI tả nhầm \"cam nâu nhạt\"; một chữ \"nâu\" đủ kéo màu cả video."],
        ["3", "Không xoay, lật, nghiêng gắt hộp", "Prompt \"xoay nghiêng khoe mặt trước\" → hộp bị vẽ lại (11 điểm khớp). Giữ thẳng → 439–454 điểm khớp."],
        ["4", "Viết mục BAO BÌ chi tiết, giống hệt nhau ở mọi cảnh", "Tả vị trí hình (cô gái bên trái, chữ dọc bên phải) giúp cảnh 3 giữ hộp đúng 20/21 khung hình."],
        ["5", "Ghi \"ánh sáng ban ngày trung tính\"", "\"Ánh sáng ấm buổi tối\" làm quả tối, ám nâu đỏ."],
        ["6", "Tạo ảnh khung hình trước, duyệt rồi mới tạo video", "Sai ở ảnh thì sửa rẻ; ảnh khung hình giúp góc bàn và hộp ổn định hơn tham chiếu thẳng."],
        ["7", "Nhịp đầu của cảnh phải KHỚP ảnh khung hình", "muse.ai chỉ coi khung đầu là gợi ý — chữ tả tư thế khác ảnh thì video theo chữ."],
        ["8", "Ghi rõ \"không mặt, không môi\" + \"không ăn bằng miệng trong khung\"", "Cảnh ăn thử dễ bị AI cho người đưa miệng vào cắn → lộ môi."],
        ["9", "Đúng 4 ảnh, đúng thứ tự, có bảng \"Ảnh #1 = … #4 = …\"", "muse.ai chỉ nhận 4 ảnh; ánh xạ rõ giúp AI không nhầm hộp với bối cảnh."],
        ["10", "Không dùng ảnh thật của hộp làm khung mở đầu", "Hộp đẹp nhất (480 điểm) nhưng mất góc bàn — ra phòng khác, các cảnh không khớp."],
    ],
    [0.8, 6.2, 10.0],
    align_center_cols=(0,),
    font_size=9,
)

# =====================================================================  06
h1("Bằng chứng: thí nghiệm trước / sau", "06")
para("Cùng 3 ảnh VijiFarm, chạy trên muse.ai, đo tự động: Hộp = số điểm đặc trưng khớp giữa ảnh hộp thật và khung hình tốt nhất "
     "(càng cao càng giống, < 25 = không nhận ra hộp); Màu = chênh lệch độ sáng / độ tươi vùng màu cam so với ảnh gốc.")
data_table(
    ["Cách làm", "Hộp (cảnh 1)", "Màu quả (cảnh 2)", "Nhận xét"],
    [
        ["Prompt cũ (chữ tả sai màu, xoay hộp, ánh sáng tối)", ("11", RED, True), "sáng −75 · tươi −42", "hộp vẽ lại, quả nâu sẫm, lộ môi"],
        ["Sửa prompt + ảnh khung hình trước", ("439", GREEN, True), "sáng −58 · tươi +38", "hộp đúng bố cục, quả vàng cam trong"],
        ["Sửa prompt, không ảnh khung hình", ("360", GREEN, True), "sáng −54 · tươi −1", "tốt, góc bàn kém ổn định hơn"],
        ["Ảnh thật làm khung mở đầu", ("480", GREEN, True), "sáng −50 · tươi −4", "mất góc bàn (ra phòng khác)"],
        ["Quy trình trong tài liệu này (đủ 3 cảnh)", ("454", GREEN, True), "sáng −60 · tươi +6", "đúng hộp, quả vàng cam, không lộ mặt"],
    ],
    [6.2, 2.2, 3.6, 5.0],
    align_center_cols=(1,),
    bold_rows=(4,),
    font_size=9,
)
figure(IMG / "so_sanh_truoc_sau.png", 14.5, "Hàng TRUOC: cách làm cũ. Hàng SAU: theo tài liệu này — cùng ảnh tham chiếu, cùng muse.ai.")

# =====================================================================  07
h1("Checklist & xử lý sự cố", "07")
h2("7.1. Trước khi bấm tạo video")
for t in (
    "Ảnh #A nhìn thẳng mặt in, rõ chữ; ảnh #B thấy rõ màu thật của sản phẩm.",
    "Prompt không có chữ màu / bề mặt nào khác ảnh (nâu, sẫm, phấn trắng, cháy…).",
    "Không có chữ \"xoay\", \"lật\", \"nghiêng khoe\" khi nói về hộp.",
    "Có mục Bao bì + Màu sản phẩm, giống nhau ở cả 3 cảnh; có \"ánh sáng ban ngày trung tính\".",
    "Ảnh khung hình đã duyệt: đúng hộp, đúng màu, chỉ có tay; nhịp đầu của prompt khớp ảnh.",
    "Đính kèm đúng 4 ảnh theo thứ tự khung hình → #A → #B → #C.",
    "Cảnh 3 có câu chốt đơn; có \"không mặt, không môi\".",
):
    bullet(t, "☐  ")
h2("7.2. Duyệt video")
for t in (
    "Hộp: hình in, logo, chữ đúng vị trí như ảnh thật ở mọi khung hình?",
    "Màu quả: vàng cam tươi như ảnh, không nâu sẫm / phủ phấn?",
    "Chỉ thấy đôi tay, không mặt / môi / người thứ hai? Góc bàn đúng?",
    "Giọng đọc đúng lời, rõ, không lặp câu của cảnh khác?",
):
    bullet(t, "☐  ")
h2("7.3. Xử lý sự cố")
data_table(
    ["Hiện tượng", "Cách xử lý"],
    [
        ["Hộp bị vẽ lại / sai chữ", "Bỏ thao tác xoay hộp; mô tả bao bì chi tiết hơn (vị trí hình, chữ); tạo lại ảnh khung hình cho hộp nhìn thẳng rồi tạo lại video."],
        ["Quả / sản phẩm bị sẫm màu", "Tìm và xóa mọi chữ màu sai trong prompt; thêm \"KHÔNG sẫm, KHÔNG nâu\"; ánh sáng ban ngày; đổi ảnh góc bàn sáng hơn; hậu kỳ tăng sáng nhẹ."],
        ["Lộ mặt / môi", "Thêm \"không mặt, không môi, không ăn bằng miệng trong khung\"; đổi hành động \"cắn\" thành \"đưa miếng cắn dở lại gần ống kính\"."],
        ["Bối cảnh đổi giữa các cảnh", "Luôn đính kèm cùng ảnh #C; dùng ảnh khung hình; không dùng ảnh hộp thật (nền khác) làm khung mở đầu."],
        ["Video không có tiếng / sai lời", "Đặt lời thoại trong ngoặc kép, ghi rõ \"voice-over giọng nữ trẻ miền Nam\"; tạo lại riêng cảnh đó."],
        ["Một cảnh lặp lời cảnh khác", "Kiểm tra kịch bản: mỗi đoạn chỉ có 1 câu thoại của chính cảnh đó (AI đôi khi dán lặp đoạn trước)."],
    ],
    [4.6, 12.4],
    font_size=9,
)
callout("Làm nhanh hơn với FastAIVN MuseStudio", [
    "Toàn bộ quy trình này đã được đóng gói thành mẫu \"Hieu POV AIO\" (Workflow làm clip → nhóm Review POV (FastAIVN) → 🧩 Sơ đồ): "
    "tải ảnh, sửa vài dòng Brief, bấm chạy — app tự tả ảnh, viết kịch bản, tạo ảnh khung hình, render 3 cảnh và ghép video.",
], icon="⚡")

DIR.mkdir(parents=True, exist_ok=True)
doc.save(str(OUT))
print("saved", OUT)

