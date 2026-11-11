# -*- coding: utf-8 -*-
"""Báo cáo nghiên cứu FastAIVN.com — giữ đồng nhất tham chiếu khi tạo video AI với Muse (.docx)."""
import sys
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

sys.stdout.reconfigure(encoding="utf-8")
DIR = Path(r"D:\1FastAIVN\srcs\HNDWorkflow\BaoCao_DongNhat_Muse")
OUT = DIR / "FastAIVN - Bao cao giu dong nhat tham chieu Muse v2.docx"

# Nhận diện FastAIVN.com
BLUE = "1E5BD6"
NAVY = "0B2265"
LIGHT = "EAF2FF"
LIGHT2 = "F5F9FF"
RED = "E3262B"
GREEN = "1E9E55"
AMBER = "C77700"
FONT = "Arial"

doc = Document()
sec = doc.sections[0]
sec.page_width, sec.page_height = Cm(21), Cm(29.7)
sec.left_margin = sec.right_margin = Cm(2)
sec.top_margin, sec.bottom_margin = Cm(2), Cm(1.8)


def rgb(h):
    return RGBColor.from_string(h)


# ---------- Styles
st = doc.styles["Normal"]
st.font.name = FONT
st.font.size = Pt(10.5)
st.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
st.paragraph_format.space_after = Pt(5)
st.paragraph_format.line_spacing = 1.2
for name, size, color, before, after in (("Heading 1", 17, NAVY, 18, 8), ("Heading 2", 13, BLUE, 12, 5), ("Heading 3", 11.5, NAVY, 8, 3)):
    s = doc.styles[name]
    s.font.name = FONT
    s.font.size = Pt(size)
    s.font.bold = True
    s.font.color.rgb = rgb(color)
    s.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    rf = s.element.rPr.rFonts
    rf.set(qn("w:ascii"), FONT)
    rf.set(qn("w:hAnsi"), FONT)
    s.paragraph_format.space_before = Pt(before)
    s.paragraph_format.space_after = Pt(after)
    s.paragraph_format.keep_with_next = True
for name in ("List Bullet", "List Number"):
    s = doc.styles[name]
    s.font.name = FONT
    s.font.size = Pt(10.5)
    s.paragraph_format.space_after = Pt(3)


def shade(cell, color):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), color)
    tcPr.append(shd)


def cell_margins(cell, top=80, bottom=80, left=120, right=120):
    tcPr = cell._tc.get_or_add_tcPr()
    mar = OxmlElement("w:tcMar")
    for k, v in (("top", top), ("bottom", bottom), ("start", left), ("end", right)):
        e = OxmlElement(f"w:{k}")
        e.set(qn("w:w"), str(v))
        e.set(qn("w:type"), "dxa")
        mar.append(e)
    tcPr.append(mar)


def table_borders(table, color="C9D8F5", size=4):
    tblPr = table._tbl.tblPr
    b = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        e = OxmlElement(f"w:{edge}")
        e.set(qn("w:val"), "single")
        e.set(qn("w:sz"), str(size))
        e.set(qn("w:color"), color)
        b.append(e)
    tblPr.append(b)


def no_borders(table):
    tblPr = table._tbl.tblPr
    b = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        e = OxmlElement(f"w:{edge}")
        e.set(qn("w:val"), "nil")
        b.append(e)
    tblPr.append(b)


def para_border_bottom(p, color=BLUE, size=12):
    pPr = p._p.get_or_add_pPr()
    bdr = OxmlElement("w:pBdr")
    bt = OxmlElement("w:bottom")
    bt.set(qn("w:val"), "single")
    bt.set(qn("w:sz"), str(size))
    bt.set(qn("w:space"), "4")
    bt.set(qn("w:color"), color)
    bdr.append(bt)
    pPr.append(bdr)


def run(p, text, bold=False, color=None, size=None, italic=False):
    r = p.add_run(text)
    r.bold = bold
    r.italic = italic
    r.font.name = FONT
    if color:
        r.font.color.rgb = rgb(color)
    if size:
        r.font.size = Pt(size)
    return r


def para(text="", bold_prefix=None, color=None, size=None, align=None, after=None, style=None):
    p = doc.add_paragraph(style=style)
    if bold_prefix:
        run(p, bold_prefix, bold=True, color=NAVY)
    if text:
        run(p, text, color=color, size=size)
    if align:
        p.alignment = align
    if after is not None:
        p.paragraph_format.space_after = Pt(after)
    return p


def bullet(text, bold_prefix=None, level=0):
    p = doc.add_paragraph(style="List Bullet")
    if level:
        p.paragraph_format.left_indent = Cm(0.63 + 0.63 * level)
    if bold_prefix:
        run(p, bold_prefix, bold=True, color=NAVY)
    run(p, text)
    return p


def h1(text, num=None):
    p = doc.add_heading(level=1)
    if num:
        run(p, f"{num}  ", bold=True, color=RED, size=17)
    run(p, text, bold=True, color=NAVY, size=17)
    para_border_bottom(p, BLUE, 10)
    return p


def h2(text):
    return doc.add_heading(text, level=2)


def h3(text):
    return doc.add_heading(text, level=3)


def callout(title, lines, fill=LIGHT, bar=BLUE, icon="💡"):
    t = doc.add_table(rows=1, cols=1)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    no_borders(t)
    c = t.cell(0, 0)
    shade(c, fill)
    cell_margins(c, 140, 140, 220, 200)
    tcPr = c._tc.get_or_add_tcPr()
    bdr = OxmlElement("w:tcBorders")
    left = OxmlElement("w:left")
    left.set(qn("w:val"), "single")
    left.set(qn("w:sz"), "36")
    left.set(qn("w:color"), bar)
    bdr.append(left)
    tcPr.append(bdr)
    p = c.paragraphs[0]
    run(p, f"{icon}  {title}", bold=True, color=bar, size=11)
    p.paragraph_format.space_after = Pt(4)
    for ln in lines:
        q = c.add_paragraph()
        q.paragraph_format.space_after = Pt(2)
        if isinstance(ln, tuple):
            run(q, ln[0], bold=True, color=NAVY)
            run(q, ln[1])
        else:
            run(q, ln)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


def no_split(table):
    """Không cho 1 hàng bảng bị tách đôi qua 2 trang."""
    for row in table.rows:
        trPr = row._tr.get_or_add_trPr()
        cs = OxmlElement("w:cantSplit")
        cs.set(qn("w:val"), "true")
        trPr.append(cs)


def data_table(headers, rows, widths, header_fill=BLUE, zebra=True, align_center_cols=(), bold_rows=(), font_size=9.5):
    t = doc.add_table(rows=1 + len(rows), cols=len(headers))
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    table_borders(t)
    for i, h in enumerate(headers):
        c = t.cell(0, i)
        c.width = Cm(widths[i])
        shade(c, header_fill)
        cell_margins(c)
        c.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        p = c.paragraphs[0]
        run(p, h, bold=True, color="FFFFFF", size=font_size)
        if i in align_center_cols:
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    for r_i, r in enumerate(rows):
        for i, val in enumerate(r):
            c = t.cell(r_i + 1, i)
            c.width = Cm(widths[i])
            cell_margins(c)
            c.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            if r_i in bold_rows:
                shade(c, "FFF4D6")
            elif zebra and r_i % 2 == 1:
                shade(c, LIGHT2)
            p = c.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            if isinstance(val, tuple):  # (text, color, bold)
                run(p, val[0], color=val[1], bold=val[2] if len(val) > 2 else False, size=font_size)
            else:
                run(p, str(val), bold=r_i in bold_rows, size=font_size)
            if i in align_center_cols:
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    no_split(t)
    # Lặp hàng tiêu đề khi sang trang
    trPr = t.rows[0]._tr.get_or_add_trPr()
    th = OxmlElement("w:tblHeader")
    th.set(qn("w:val"), "true")
    trPr.append(th)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t


def figure(path, width_cm, caption):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run().add_picture(str(path), width=Cm(width_cm))
    p.paragraph_format.keep_with_next = True
    c = doc.add_paragraph()
    c.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run(c, caption, italic=True, color="51607A", size=9)
    c.paragraph_format.space_after = Pt(10)


def add_field(p, instr):
    r = p.add_run()
    for t, v in (("begin", None), (None, instr), ("end", None)):
        if t:
            e = OxmlElement("w:fldChar")
            e.set(qn("w:fldCharType"), t)
        else:
            e = OxmlElement("w:instrText")
            e.set(qn("xml:space"), "preserve")
            e.text = v
        r._r.append(e)
    r.font.size = Pt(8.5)
    r.font.color.rgb = rgb("51607A")


def pct(v, good=60, ok=30):
    color = GREEN if v >= good else (AMBER if v >= ok else RED)
    return (f"{v}%", color, True)


# =====================================================================  TRANG BÌA
band = doc.add_table(rows=1, cols=1)
no_borders(band)
c = band.cell(0, 0)
shade(c, "FFFFFF")
c.paragraphs[0].add_run().add_picture(str(DIR / "logo.png"), width=Cm(6.5))
doc.add_paragraph().paragraph_format.space_after = Pt(30)

p = doc.add_paragraph()
run(p, "BÁO CÁO NGHIÊN CỨU", bold=True, color=RED, size=13)
p.paragraph_format.space_after = Pt(4)
p = doc.add_paragraph()
run(p, "GIỮ ĐỒNG NHẤT THAM CHIẾU", bold=True, color=NAVY, size=30)
p.paragraph_format.space_after = Pt(0)
p = doc.add_paragraph()
run(p, "KHI TẠO VIDEO AI VỚI MUSE", bold=True, color=BLUE, size=30)
p.paragraph_format.space_after = Pt(10)

tag = doc.add_table(rows=1, cols=1)
no_borders(tag)
tc = tag.cell(0, 0)
shade(tc, BLUE)
cell_margins(tc, 120, 120, 240, 240)
q = tc.paragraphs[0]
run(q, "Nhân vật  •  Khuôn mặt  •  Trang phục  •  Sản phẩm  •  Bối cảnh", bold=True, color="FFFFFF", size=13)
doc.add_paragraph().paragraph_format.space_after = Pt(16)

para("Tổng kết kinh nghiệm thực chiến từ quá trình nghiên cứu công cụ HND Muse AI, chạy thử 13 mẫu workflow và 9 vòng thí nghiệm "
     "đo đạc độ đồng nhất trên muse.ai — kèm nguyên tắc, checklist, quy trình thực chiến 8 bước và bộ prompt mẫu để làm video Affiliate, "
     "phim ngắn gia đình, TVC sản phẩm giữ đúng người, đúng đồ, đúng sản phẩm.", color="33415C", size=11)
doc.add_paragraph().paragraph_format.space_after = Pt(30)

meta = doc.add_table(rows=4, cols=2)
no_borders(meta)
for i, (k, v) in enumerate((
    ("Đơn vị nghiên cứu & báo cáo", "FastAIVN.com"),
    ("Công cụ thử nghiệm", "muse.ai (Muse Image / Muse Video) · HND Muse AI V1.5 · FastAIVN MuseStudio"),
    ("Thời gian", "Tháng 11/2026"),
    ("Phạm vi", "Video dọc 9:16, 10 giây / cảnh, Reference-to-Video, nhiều nhân vật + sản phẩm"),
)):
    a, b = meta.cell(i, 0), meta.cell(i, 1)
    a.width, b.width = Cm(5.2), Cm(11.8)
    shade(a, LIGHT)
    cell_margins(a)
    cell_margins(b)
    run(a.paragraphs[0], k, bold=True, color=NAVY, size=10)
    run(b.paragraphs[0], v, size=10)
    a.paragraphs[0].paragraph_format.space_after = Pt(0)
    b.paragraphs[0].paragraph_format.space_after = Pt(0)

# Header / footer: 1 section, trang bìa (trang đầu) không có header / footer, mọi trang sau đều có
doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
sec.different_first_page_header_footer = True
new = sec
hdr = new.header
hp = hdr.paragraphs[0]
hp.add_run().add_picture(str(DIR / "logo.png"), width=Cm(3.2))
hp.add_run("\t")
run(hp, "Báo cáo: Giữ đồng nhất tham chiếu khi tạo video AI với Muse", color="51607A", size=8.5)
hp.paragraph_format.tab_stops.add_tab_stop(Cm(17), alignment=2)
para_border_bottom(hp, BLUE, 8)
ftr = new.footer
fp = ftr.paragraphs[0]
run(fp, "© FastAIVN.com — Tài liệu nghiên cứu nội bộ / học viên   ·   Trang ", color="51607A", size=8.5)
add_field(fp, "PAGE")
fp.alignment = WD_ALIGN_PARAGRAPH.CENTER

# =====================================================================  MỤC LỤC NGẮN
h1("Nội dung báo cáo")
for n, t in (
    ("01", "Tóm tắt điều hành — 5 phát hiện quan trọng nhất"),
    ("02", "Bối cảnh & phương pháp nghiên cứu"),
    ("03", "Kết quả thí nghiệm (9 vòng, mẫu Gia đình)"),
    ("04", "Nguyên tắc vàng: Ảnh tham chiếu"),
    ("05", "Nguyên tắc vàng: Viết prompt"),
    ("06", "Nguyên tắc vàng: Quy trình dựng & render"),
    ("07", "Những lỗi thường gặp (bài học từ HND Muse AI)"),
    ("08", "Checklist trước khi bấm Render"),
    ("09", "Cấu hình khuyến nghị trong FastAIVN MuseStudio"),
    ("10", "Quy trình thực chiến: làm video giới thiệu sản phẩm (8 bước)"),
    ("11", "Bộ prompt mẫu dùng ngay (kèm ví dụ điền sẵn)"),
    ("12", "Hạn chế & hướng nghiên cứu tiếp theo"),
):
    p = doc.add_paragraph()
    run(p, f"{n}   ", bold=True, color=RED, size=11)
    run(p, t, color=NAVY, size=11)
    p.paragraph_format.space_after = Pt(3)

# =====================================================================  01
h1("Tóm tắt điều hành", "01")
para("Muse cho ra video rất đẹp nhưng việc giữ đúng người, đúng đồ, đúng sản phẩm qua nhiều cảnh không tự đến. "
     "Qua 9 vòng thí nghiệm có đo đạc trên cùng một kịch bản gia đình 3 người + 1 sản phẩm, FastAIVN.com rút ra 5 phát hiện:")
callout("5 phát hiện quan trọng nhất", [
    ("1. Muse bám CHỮ nhiều hơn bám ẢNH. ", "Prompt mô tả trang phục khác ảnh (vd. ảnh váy xanh, chữ ghi váy hồng) → video ra sai đồ. "
     "Khóa “ưu tiên ảnh” + mô tả do AI nhìn ảnh viết lại sửa được 100% trang phục."),
    ("2. Tạo ẢNH KHUNG HÌNH trước rồi mới tạo video ", "là cải tiến lớn nhất cho khuôn mặt: tỉ lệ khung hình đúng người của Bố tăng 6% → 93%, Mẹ 7% → 60%."),
    ("3. muse.ai nhận tối đa 4 ảnh / video. ", "Gia đình 3 người + sản phẩm cần đủ 4 suất — nếu công cụ chỉ gửi 3 ảnh, sản phẩm bị rơi khỏi video."),
    ("4. Khuôn mặt phải TO trong ảnh tham chiếu. ", "Character sheet 4 ô làm mặt quá nhỏ; ghép “toàn thân + cận mặt” tăng độ giống mặt rõ rệt (Bố 24% → 65%)."),
    ("5. Mỗi lần render dao động. ", "Phải đo nhiều lần, so sánh có số liệu — không kết luận từ 1 video đẹp."),
], icon="🎯")
para("Kết quả trước / sau trên cùng kịch bản (trái: cách làm cũ — sai váy con gái, sai áo Bố, Mẹ mặc đồ bộ, không có sản phẩm; "
     "phải: cấu hình tối ưu — đúng người, đúng đồ, quạt JisuLife xuất hiện ở mọi cảnh):", size=10)
figure(DIR / "so_sanh_R1_R8.jpg", 16.5, "Hình 1. Hàng trên: ảnh tham chiếu (Bố, Mẹ, Con gái, sản phẩm). Dưới trái: R1 — cách làm cũ. Dưới phải: R8 — cấu hình tối ưu.")

# =====================================================================  02
h1("Bối cảnh & phương pháp nghiên cứu", "02")
h2("2.1. Muse và bài toán đồng nhất")
para("Muse (muse.ai) tạo video 10 giây / cảnh từ prompt + tối đa 4 ảnh đính kèm. Một video bán hàng / phim ngắn hoàn chỉnh "
     "thường gồm 3–5 cảnh render riêng rồi ghép lại, nên mỗi cảnh là một lần “đoán” độc lập: nhân vật dễ đổi mặt, đổi áo, sản phẩm đổi màu, "
     "phòng khách mỗi cảnh một kiểu. Báo cáo này trả lời câu hỏi: làm sao để các cảnh khớp nhau tối đa?")
h2("2.2. Những gì đã làm")
bullet("Phân tích công cụ HND Muse AI V1.5: 12 loại node workflow, bộ chạy, cách ghép ảnh tham chiếu và prompt (đọc mã nguồn + thao tác thực tế).")
bullet("Chạy thử toàn bộ 13 mẫu workflow của HND (Gia đình, Thời trang, Thời trang nam, Mỹ phẩm, Ăn uống, Gia dụng, Bếp, Sức khỏe, Đồ chơi, Thiết kế) bằng ảnh thật.")
bullet("Xây lại bộ máy workflow trong FastAIVN MuseStudio và chạy 9 vòng thí nghiệm có kiểm soát trên mẫu “Gia đình hài hước” "
       "(3 cảnh × 10s, 3 nhân vật Bố / Mẹ / Con gái + sản phẩm quạt cầm tay JisuLife).")
h2("2.3. Cách đo")
data_table(
    ["Tiêu chí", "Cách đo"],
    [
        ["Khuôn mặt", "Nhận diện khuôn mặt tự động (OpenCV YuNet + SFace). Lấy 2 khung hình / giây; mỗi khuôn mặt so với ảnh tham chiếu; "
                      "tính % khung hình được nhận là CÙNG NGƯỜI (độ tương đồng ≥ 0.363 — ngưỡng chuẩn của OpenCV)."],
        ["Trang phục", "So trực quan ảnh gốc với khung hình 1.5s / 4.5s / 8s của mỗi cảnh: đúng màu, kiểu dáng, chi tiết (nơ, giày, quần dài / short)."],
        ["Sản phẩm", "Có xuất hiện trong cảnh không, đúng hình dáng / màu / logo không."],
        ["Bối cảnh", "Phòng khách giữa các cảnh có giống nhau không (bố cục, nội thất, ánh sáng)."],
    ],
    [3.2, 13.8],
)
para("Ghi chú: % “cùng người” là thước đo nghiêm khắc — người xem có thể vẫn thấy “khá giống” ở mức 30–50%. "
     "Dùng để SO SÁNH giữa các cách làm, không phải điểm tuyệt đối.", color="51607A", size=9.5)

# =====================================================================  03
h1("Kết quả thí nghiệm", "03")
para("Cùng 1 kịch bản, cùng ảnh tham chiếu, mỗi vòng thay đổi 1 yếu tố. Tỉ lệ % = khung hình có khuôn mặt được nhận là đúng người.")
data_table(
    ["Vòng", "Thay đổi so với vòng trước", "Bố", "Mẹ", "Con gái", "Trang phục", "Sản phẩm"],
    [
        ["HND", "Chạy trong app HND Muse AI gốc", pct(65), pct(11), pct(92), ("Sai", RED, True), "—"],
        ["R1", "Baseline: Reference-to-Video, prompt mẫu (cách HND)", pct(6), pct(7), pct(56), ("Sai cả 3", RED, True), "—"],
        ["R2", "+ AI nhìn ảnh mô tả lại + khóa ƯU TIÊN ẢNH", pct(24), pct(16), pct(53), ("Đúng cả 3", GREEN, True), "—"],
        ["R3", "R2 + sản phẩm làm ảnh tham chiếu #4", pct(38), pct(6), pct(55), ("Đúng", GREEN, True), ("Đúng", GREEN, True)],
        ["R5", "R2 + ảnh ghép toàn thân + cận mặt", pct(65), pct(0), pct(78), ("Đúng", GREEN, True), "—"],
        ["R6", "R5 + sản phẩm", pct(29), pct(0), pct(62), ("Lệch 1 cảnh", AMBER, True), ("Đúng", GREEN, True)],
        ["R4", "R3 + tạo ẢNH KHUNG HÌNH trước → Image-to-Video", pct(87), pct(48), pct(67), ("Đúng", GREEN, True), ("Đúng", GREEN, True)],
        ["R4c", "Lặp lại R4 (đo độ dao động)", pct(87), pct(40), pct(69), ("Đúng", GREEN, True), ("Đúng", GREEN, True)],
        ["R7", "R4 + ảnh ghép toàn thân / cận mặt", pct(79), pct(36), pct(68), ("Đúng", GREEN, True), ("Đúng", GREEN, True)],
        ["R8 ★", "Cấu hình tối ưu (tích hợp sẵn trong MuseStudio)", pct(93), pct(60), pct(60), ("Đúng cả 3", GREEN, True), ("Đúng mọi cảnh", GREEN, True)],
    ],
    [1.3, 6.6, 1.4, 1.4, 1.6, 2.4, 2.3],
    align_center_cols=(0, 2, 3, 4, 5, 6),
    bold_rows=(9,),
    font_size=9,
)
h3("Đọc kết quả")
bullet("Trang phục: chỉ cần khóa “ưu tiên ảnh” + mô tả khớp ảnh là đúng 100% (R1 sai cả 3 người → R2 đúng cả 3).", "Chữ quyết định đồ: ")
bullet("tạo ảnh khung hình trước (R4, R4c, R8) cho tỉ lệ đúng người cao nhất và ổn định qua các lần chạy.", "Khuôn mặt: ")
bullet("thêm suất ảnh thứ 4 cho sản phẩm không làm hỏng nhân vật / trang phục (R3), sản phẩm giữ đúng ở mọi cảnh.", "Sản phẩm: ")
bullet("ảnh ghép toàn thân + cận mặt giúp mạnh khi KHÔNG tạo khung hình trước (R5), nhưng không cộng thêm khi đã có khung hình (R7).", "Ảnh ghép: ")
bullet("Mẹ luôn là nhân vật khó nhất (ảnh gốc là gương mặt AI rất “lý tưởng hóa”) — cấu hình tối ưu đưa được lên 60%.", "Nhân vật khó: ")

# =====================================================================  04
h1("Nguyên tắc vàng: Ảnh tham chiếu", "04")
callout("Quy tắc số 1", ["Ảnh tham chiếu tốt quyết định 50% kết quả. Không có prompt nào cứu được một ảnh mặt nhỏ, mờ, hoặc trái với mô tả."], icon="📸")
h2("4.1. Nhân vật & khuôn mặt")
bullet("Mặt phải TO và RÕ: ảnh cận mặt chính diện, đủ sáng, không đeo kính râm / che mặt. Character sheet 4 ô (trước – nghiêng – sau – cận) làm mặt quá nhỏ.", "Mặt to, rõ: ")
bullet("ghép 2 ô “toàn thân mặt trước” + “cận mặt” thành 1 ảnh: vừa thấy trang phục, vừa thấy mặt to, chỉ tốn 1 suất ảnh.", "Ảnh ghép toàn thân + cận mặt: ")
figure(DIR / "anh_ghep_mat.png", 16, "Hình 2. Trái: character sheet 4 ô (mặt nhỏ). Phải: ảnh ghép toàn thân + cận mặt — Bố tăng 24% → 65%, Con gái 53% → 78% (R2 → R5).")
bullet("gương mặt AI quá hoàn hảo, “búp bê” dễ bị Muse thay bằng một người đẹp tương tự. Ảnh người thật, có nét riêng (nốt ruồi, kiểu tóc đặc trưng, kính) giữ tốt hơn.", "Ưu tiên mặt có đặc điểm: ")
bullet("nền trơn sáng, ánh sáng đều; tránh ảnh có chữ, logo, nhiều người.", "Nền đơn giản: ")
bullet("trang phục trong ảnh nhân vật chính là trang phục trong video. Muốn đổi đồ thì đổi ảnh (hoặc thêm ảnh trang phục riêng).", "Mặc đúng đồ trong ảnh: ")
h2("4.2. Sản phẩm")
bullet("cắt bỏ phần chữ, thông số, infographic quanh sản phẩm — chỉ giữ sản phẩm trên nền sạch.", "Ảnh sạch: ")
bullet("sản phẩm có chữ / logo nên chụp thấy rõ logo; Muse giữ hình dáng & màu tốt, chữ nhỏ thường bị biến dạng.", "Logo: ")
h2("4.3. Giới hạn số ảnh & thứ tự")
callout("muse.ai nhận tối đa 4 ảnh / video", [
    "• Reference-to-Video (không có khung mở đầu): 4 ảnh tham chiếu.",
    "• Có khung mở đầu (Image-to-Video / tạo khung hình trước): 1 khung + 3 ảnh tham chiếu.",
    "• Xếp thứ tự CỐ ĐỊNH ở mọi cảnh: Nhân vật → Trang phục → Sản phẩm → Bối cảnh, và gọi đúng “Ảnh #1, #2…” trong prompt.",
    "• Nhiều nhân vật + sản phẩm vượt 4 suất: gộp (1 ảnh vừa khóa trang phục vừa khóa bối cảnh), hoặc chỉ gửi nhân vật CÓ MẶT trong cảnh đó.",
], fill="FFF4F4", bar=RED, icon="⚠️")

# =====================================================================  05
h1("Nguyên tắc vàng: Viết prompt", "05")
callout("Muse bám chữ hơn bám ảnh", ["Mọi mô tả trong prompt phải KHỚP với ảnh. Chỉ một câu “bé mặc váy hồng” khi ảnh là váy xanh là đủ làm hỏng cả 3 cảnh."], fill="FFF4F4", bar=RED, icon="🚫")
h2("5.1. Cấu trúc prompt khuyến nghị")
data_table(
    ["Phần", "Nội dung", "Vì sao"],
    [
        ["1. Bảng ánh xạ ảnh (đầu prompt)", "“Ảnh #1 = Bố @BoGiaDinh: …; Ảnh #2 = Mẹ …; Ảnh #4 = sản phẩm …”", "Muse biết ảnh nào là ai / cái gì, không tráo mặt giữa các nhân vật"],
        ["2. Nội dung cảnh", "Hành động theo 3 nhịp 0–3.5s / 3.5–7s / 7–10s, lời thoại trong ngoặc kép, gọi tên kèm “(Ảnh #N)”", "Liền mạch, khớp miệng đúng người nói"],
        ["3. Khóa bối cảnh", "Cùng 1 câu mô tả phòng / không gian, Y HỆT ở mọi cảnh", "Các cảnh render song song vẫn cùng một phòng"],
        ["4. Khóa khớp miệng", "Chỉ người được chỉ định mở miệng, người khác ngậm miệng lắng nghe", "Tránh cả nhà cùng nhép môi"],
        ["5. Khóa ƯU TIÊN ẢNH (cuối prompt)", "“Nếu chữ khác ảnh thì LUÔN theo ảnh: giữ y hệt mặt, tóc, kính, trang phục, sản phẩm…”", "Model nhớ phần cuối tốt nhất — sửa được 100% lỗi trang phục"],
        ["6. Khóa chân thật", "Quay như iPhone / Sony FX3, da thật, không ám màu nhựa AI", "Giảm “mặt AI”, tăng độ tin cậy video bán hàng"],
    ],
    [3.6, 7.6, 5.8],
)
h2("5.2. Những điều cần tránh")
bullet("viết mô tả ngoại hình / trang phục theo mẫu có sẵn (“người mẫu nữ 23 tuổi…”) khi ảnh là người khác — đây là lỗi khiến mẫu Sức khỏe của HND ra SAI NGƯỜI.", "Không dùng mô tả mặc định: ")
figure(DIR / "loi_mo_ta_mac_dinh.png", 13.5, "Hình 3. Ảnh tham chiếu là nam (trái) nhưng prompt mẫu mô tả “KOC nữ” → video ra người khác hoàn toàn (mẫu Sức khỏe, HND).")
bullet("để AI nhìn ảnh rồi viết mô tả (“nam ~27 tuổi, tóc đen xoăn bồng, kính gọng kim loại, sơ mi trắng, quần tây xám, giày trắng”), dùng mô tả này trong bảng ánh xạ và khóa ưu tiên ảnh.", "Thay vào đó: ")
bullet("prompt cho ẢNH phải ghi rõ “1 ảnh tĩnh, không tạo video”. Prompt viết kiểu “Video 10 giây…” gửi sang Muse Image sẽ bị trả về video.", "Prompt ảnh ≠ prompt video: ")
bullet("gọi tên nhân vật nhất quán (@BoGiaDinh ở mọi cảnh), không lúc “Bố”, lúc “người đàn ông”.", "Tên gọi nhất quán: ")
bullet("chủ đề / ý tưởng bị cắt cụt (HND cắt ~60 ký tự) làm lời thoại vô nghĩa — luôn đọc lại prompt cuối trước khi render.", "Kiểm tra prompt cuối: ")

# =====================================================================  06
h1("Nguyên tắc vàng: Quy trình dựng & render", "06")
h2("6.1. Tạo ảnh khung hình trước (khuyên dùng)")
para("Thay vì đưa ảnh tham chiếu thẳng vào video, tạo trước 1 ẢNH khung hình mở đầu cho mỗi cảnh (Muse Image + đủ ảnh tham chiếu), "
     "kiểm tra ảnh đúng người đúng đồ, rồi dùng ảnh đó làm khung mở đầu video (Image-to-Video) kèm ảnh nhân vật làm tham chiếu.")
data_table(
    ["", "Reference-to-Video thẳng", "Tạo khung hình trước"],
    [
        ["Mặt Bố / Mẹ / Con", "24% / 16% / 53%", ("87–93% / 40–60% / 60–69%", GREEN, True)],
        ["Thời gian / cảnh", "~2 phút", "~3 phút (thêm ~1 phút tạo ảnh)"],
        ["Kiểm soát", "Chỉ biết kết quả khi video xong", "Xem ảnh khung hình trước, sai thì tạo lại ảnh — rẻ hơn tạo lại video"],
        ["Khi nào dùng", "Cảnh 1 người, sản phẩm đơn giản, cần nhanh", "Nhiều nhân vật, cần giữ mặt; video bán hàng quan trọng"],
    ],
    [3.6, 6.4, 7.0],
)
h2("6.2. Giữ bối cảnh & liền mạch giữa các cảnh")
bullet("dùng chung 1 câu “khóa bối cảnh” y hệt ở mọi cảnh; hoặc 1 ảnh bối cảnh (khóa bối cảnh) gửi kèm mọi cảnh.", "Cùng một phòng: ")
bullet("cần cảnh sau nối tiếp tư thế cảnh trước → trích khung cuối cảnh trước làm khung mở đầu cảnh sau (Frame-to-Frame). Đổi lại phải render tuần tự.", "Liền mạch tuyệt đối: ")
bullet("khung hình mở đầu của từng cảnh được tạo độc lập nên bối cảnh có thể lệch nhẹ — thêm khóa bối cảnh để khắc phục.", "Lưu ý: ")
h2("6.3. Vận hành")
bullet("Muse hiện luôn trả 10 giây / cảnh dù đặt 4 / 6 / 8 giây — viết kịch bản theo nhịp 10 giây.", "Thời lượng: ")
bullet("mỗi tài khoản Muse có giới hạn luồng song song; chạy quá tải sẽ bị “all accounts are busy” → hàng đợi phải tự chờ & thử lại, không bỏ cảnh.", "Tài khoản bận: ")
bullet("cảnh lỗi chỉ render lại đúng cảnh đó (chạy tiếp), không chạy lại cả workflow.", "Chạy lại từng phần: ")
bullet("mỗi lần render có dao động; với mẫu quan trọng hãy render 2 phương án và chọn bản tốt hơn.", "Dao động: ")

# =====================================================================  07
h1("Những lỗi thường gặp (bài học từ HND Muse AI)", "07")
data_table(
    ["Lỗi", "Hậu quả", "Cách khắc phục"],
    [
        ["Prompt mẫu viết sẵn mô tả nhân vật / trang phục mặc định", "Đổi ảnh người khác vẫn ra người mẫu mặc định; đổi màu áo, váy", "Mô tả lấy từ ảnh thật (AI nhìn ảnh) + khóa ưu tiên ảnh"],
        ["Chỉ gửi tối đa 3 ảnh tham chiếu", "Gia đình 3 người + sản phẩm → mất ảnh sản phẩm", "Dùng đủ 4 suất khi không có khung mở đầu"],
        ["Character sheet 4 ô làm ảnh tham chiếu", "Mặt nhỏ → Muse tự “sáng tác” mặt", "Ảnh cận mặt / ảnh ghép toàn thân + cận mặt / tạo khung hình trước"],
        ["Không có AI viết kịch bản (thiếu Gemini key)", "Rơi về prompt dựng sẵn, lời thoại chung chung", "Cấu hình AI (Gemini / OpenAI / muse-chat) và kiểm tra prompt cuối"],
        ["Chủ đề bị cắt ~60 ký tự", "Lời thoại cụt nghĩa", "Đọc lại prompt; viết chủ đề ngắn gọn"],
        ["Mẫu Lookbook “5 outfits” chỉ có 1 ô trang phục", "Cả 5 cảnh mặc cùng 1 bộ", "Mỗi cảnh 1 ảnh trang phục (xoay vòng ảnh)"],
    ],
    [5.0, 5.6, 6.4],
)

# =====================================================================  08
h1("Checklist trước khi bấm Render", "08")
checks = [
    ("Ảnh nhân vật", "Mặt to, rõ, chính diện; có ảnh cận mặt hoặc ảnh ghép toàn thân + cận mặt"),
    ("Ảnh trang phục", "Đúng bộ đồ muốn xuất hiện; trùng với đồ trên ảnh nhân vật (hoặc ảnh riêng)"),
    ("Ảnh sản phẩm", "Đã cắt bỏ chữ / thông số; thấy rõ hình dáng, màu, logo"),
    ("Số ảnh", "≤ 4 ảnh / cảnh (≤ 3 nếu có khung mở đầu); thứ tự Nhân vật → Trang phục → Sản phẩm → Bối cảnh"),
    ("Mô tả", "Không câu nào trái với ảnh (màu áo, kiểu tóc, tuổi, giới tính)"),
    ("Bảng ánh xạ", "Ảnh #1, #2… đúng thứ tự ảnh gửi đi; tên @nhân vật nhất quán"),
    ("Khóa", "Bối cảnh (y hệt mọi cảnh), khớp miệng, ưu tiên ảnh, chân thật"),
    ("Chế độ", "Nhiều nhân vật → bật tạo khung hình trước; cần nối cảnh → trích khung cuối"),
    ("Kịch bản", "Nhịp 10 giây / cảnh, 3 lượt thoại; chủ đề không bị cắt"),
    ("Sau khi render", "Xem ảnh khung hình / cảnh đầu trước khi render hàng loạt; cảnh lỗi chạy lại riêng"),
]
t = doc.add_table(rows=len(checks), cols=3)
table_borders(t)
for i, (k, v) in enumerate(checks):
    a, b, c3 = t.cell(i, 0), t.cell(i, 1), t.cell(i, 2)
    a.width, b.width, c3.width = Cm(1.0), Cm(4.0), Cm(12.0)
    for cc in (a, b, c3):
        cell_margins(cc)
        cc.paragraphs[0].paragraph_format.space_after = Pt(0)
    shade(a, LIGHT)
    shade(b, LIGHT2 if i % 2 else "FFFFFF")
    shade(c3, LIGHT2 if i % 2 else "FFFFFF")
    run(a.paragraphs[0], "☐", color=BLUE, size=13)
    a.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
    run(b.paragraphs[0], k, bold=True, color=NAVY, size=10)
    run(c3.paragraphs[0], v, size=10)
no_split(t)
doc.add_paragraph()

# =====================================================================  09
h1("Cấu hình khuyến nghị trong FastAIVN MuseStudio", "09")
para("Các kết quả nghiên cứu đã được tích hợp sẵn vào Sơ đồ khối (Workflow làm clip → 🧩 Sơ đồ khối) và bật mặc định:")
data_table(
    ["Khối", "Tùy chọn", "Mặc định", "Tác dụng"],
    [
        ["Upload Image", "Khóa tham chiếu (tích nhiều: nhân vật / trang phục / sản phẩm / bối cảnh)", "Nhân vật", "1 ảnh khóa được nhiều thứ, tiết kiệm suất ảnh"],
        ["Upload Image", "🔍 AI nhìn ảnh mô tả lại", ("Bật", GREEN, True), "Mô tả khớp đúng ảnh, dùng cho khóa ưu tiên ảnh"],
        ["Upload Image", "✂️ Ảnh là character sheet 2×2 / ô ảnh cận mặt", "Tùy chọn", "Ghép toàn thân + cận mặt → mặt to hơn"],
        ["Upload Image", "Lấy nhân vật / sản phẩm từ Cài đặt", "Tùy chọn", "Dùng ảnh + mô tả đã chuẩn hóa trong thư viện"],
        ["Generate Video", "🔒 Khóa ưu tiên ảnh tham chiếu", ("Bật", GREEN, True), "Trang phục / sản phẩm đúng ảnh"],
        ["Generate Video", "🖼 Tạo ảnh khung hình trước", ("Bật", GREEN, True), "Giữ mặt tốt nhất (Bố 93%, Mẹ 60%)"],
        ["Generate Video", "Tối đa 4 ảnh tham chiếu", ("Tự động", GREEN, True), "Đủ chỗ 3 nhân vật + sản phẩm"],
        ["Prompt", "Gõ @ chọn nhân vật, @@ chọn sản phẩm", "—", "Tự gửi kèm ảnh + mô tả của nhân vật / sản phẩm được nhắc"],
        ["Bộ chạy", "Tài khoản bận → chờ & thử lại; chạy tiếp từ cảnh lỗi", ("Tự động", GREEN, True), "Không mất cảnh, không render lại từ đầu"],
    ],
    [2.8, 6.2, 2.0, 6.0],
    align_center_cols=(2,),
)

# =====================================================================  10  QUY TRÌNH THỰC CHIẾN
h1("Quy trình thực chiến: làm video giới thiệu sản phẩm", "10")
para("Áp dụng cho video Affiliate TikTok Shop / Shopee Video / Reels dạng dọc 9:16, 5 cảnh × 10 giây (≈ 50 giây), "
     "1 KOC + 1 sản phẩm. Ví dụ xuyên suốt: quạt cầm tay mini JisuLife Life 7 màu hồng.")
steps = [
    ("1", "Chuẩn bị sản phẩm", "10 phút",
     "Lấy 3–5 ảnh: (a) ảnh chính nền trắng, đã cắt bỏ chữ / thông số; (b) ảnh cận logo / chi tiết; (c) ảnh đang sử dụng. "
     "Ghi: tên, giá, 3 điểm nổi bật (USP), khách hàng mục tiêu, nỗi đau khách hàng."),
    ("2", "Chọn nhân vật (KOC)", "5 phút",
     "1 ảnh cận mặt chính diện + 1 ảnh toàn thân mặc đúng bộ đồ sẽ xuất hiện (hoặc ảnh ghép 2 ô). Trang phục hợp ngành hàng. "
     "Sản phẩm ăn uống / gia dụng có thể làm POV chỉ thấy tay — bỏ bước này."),
    ("3", "Chốt bối cảnh", "2 phút",
     "Viết 1 câu khóa bối cảnh dùng Y HỆT cho cả 5 cảnh (không gian, nội thất, màu, ánh sáng). Có ảnh bối cảnh thì thêm khóa bối cảnh."),
    ("4", "Viết kịch bản 5 cảnh", "5 phút",
     "Khung 5 bước chuyển đổi: Hook 3 giây → Giới thiệu → Cận cảnh chi tiết → Trải nghiệm thực tế → Chốt đơn (CTA). Dùng Prompt P1 (mục 11)."),
    ("5", "AI mô tả ảnh tham chiếu", "2 phút",
     "Cho AI nhìn ảnh KOC và ảnh sản phẩm, viết mô tả đúng những gì thấy (Prompt P2). Dán mô tả này vào bảng ánh xạ & khóa ưu tiên ảnh — tuyệt đối không tự bịa màu áo."),
    ("6", "Tạo ảnh khung hình mở đầu từng cảnh", "5–8 phút",
     "Muse Image + ảnh KOC + ảnh sản phẩm (Prompt P3). Duyệt từng ảnh: đúng mặt, đúng đồ, đúng sản phẩm; sai thì tạo lại ảnh (rẻ và nhanh hơn tạo lại video)."),
    ("7", "Render video từng cảnh", "10–15 phút",
     "Image-to-Video: khung hình bước 6 làm khung mở đầu + ảnh KOC, ảnh sản phẩm làm tham chiếu (tối đa 3). Prompt P4 đủ 6 phần. "
     "Xem cảnh 1 trước khi render hàng loạt; cảnh lỗi chỉ render lại cảnh đó."),
    ("8", "Ghép, hậu kỳ & đăng", "5 phút",
     "Ghép theo thứ tự cảnh 1→5; xóa logo / watermark góc; nâng 1080p; chạy Checklist (mục 08); thêm caption + link sản phẩm; đăng khung giờ vàng."),
]
data_table(
    ["Bước", "Việc cần làm", "Thời gian", "Chi tiết & lưu ý"],
    [[(s, RED, True), (t, NAVY, True), m, d] for s, t, m, d in steps],
    [1.5, 3.4, 1.9, 10.2],
    align_center_cols=(0, 2),
)
callout("Kịch bản 5 cảnh chuẩn chuyển đổi (mỗi cảnh 10 giây, 3 nhịp thoại)", [
    ("Cảnh 1 — HOOK: ", "nỗi đau / tình huống gây chú ý trong 3 giây đầu (nóng bức, mồ hôi, bực bội) + câu hỏi chạm vấn đề."),
    ("Cảnh 2 — GIỚI THIỆU: ", "KOC cầm sản phẩm giơ lên ngang ngực, nói tên + lợi ích chính."),
    ("Cảnh 3 — CẬN CẢNH: ", "macro chất liệu, logo, nút bấm, màn hình — chứng minh chất lượng."),
    ("Cảnh 4 — TRẢI NGHIỆM: ", "dùng thật trong bối cảnh đời thường, cảm xúc thật (mát, dễ chịu, tiện)."),
    ("Cảnh 5 — CHỐT ĐƠN: ", "giá / ưu đãi + kêu gọi bấm giỏ hàng; giữ khung ổn định 1 giây cuối."),
], icon="🎬")
callout("Mẹo tăng chuyển đổi mà vẫn giữ đồng nhất", [
    "• Sản phẩm phải xuất hiện RÕ trong ít nhất 4/5 cảnh và luôn nằm trong tay / ngay cạnh KOC.",
    "• Lời thoại 22–28 âm tiết / cảnh, giọng tự nhiên như người thật review; 1 giọng duy nhất xuyên suốt.",
    "• Không đổi trang phục, kiểu tóc giữa các cảnh; không đổi phòng — khán giả sẽ thấy “giả”.",
    "• Làm 2 phiên bản Hook khác nhau cho cùng sản phẩm để A/B test, phần còn lại dùng chung.",
], fill="FFF8E6", bar=AMBER, icon="🚀")

# =====================================================================  11  PROMPT MẪU
FONT_MONO = "Consolas"


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
    for line in text.strip("\n").split("\n"):
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


h1("Bộ prompt mẫu dùng ngay", "11")
para("Phần trong [NGOẶC VUÔNG] là chỗ cần điền. Ví dụ điền sẵn dùng quạt cầm tay JisuLife Life 7 màu hồng, KOC nữ ~25 tuổi, phòng làm việc tại nhà.")

h2("P1 — Nhờ AI viết kịch bản 5 cảnh (gửi Gemini / ChatGPT kèm ảnh sản phẩm)")
prompt_box("Prompt P1 · Viết kịch bản", """
Bạn là đạo diễn TVC & biên kịch video Affiliate TikTok tiếng Việt.
Sản phẩm: [TÊN SẢN PHẨM] — giá [GIÁ]. Điểm nổi bật: [USP 1]; [USP 2]; [USP 3].
Khách hàng: [ĐỐI TƯỢNG]. Nỗi đau: [VẤN ĐỀ KHÁCH GẶP].
Nhân vật: @[TÊN KOC] — [MÔ TẢ KOC TỪ BƯỚC 5]. Bối cảnh cố định: [CÂU KHÓA BỐI CẢNH].
Viết ĐÚNG 5 cảnh, mỗi cảnh 10 giây, theo khung: 1 Hook 3 giây → 2 Giới thiệu → 3 Cận cảnh chi tiết
→ 4 Trải nghiệm thực tế → 5 Chốt đơn (CTA). Mỗi cảnh chia 3 nhịp 0–3.5s / 3.5–7s / 7–10s,
lời thoại tiếng Việt tự nhiên 22–28 âm tiết đặt trong ngoặc kép, đầu cảnh sau nối tiếp tư thế cuối cảnh trước.
KHÔNG mô tả lại màu áo, kiểu tóc khác với mô tả nhân vật ở trên. Sản phẩm xuất hiện rõ ở ít nhất 4/5 cảnh.
Chỉ trả về JSON: {"scenes":[{"scene":1,"title":"...","action":"...","dialogue":"..."}]}
""", "Ví dụ điền: [TÊN SẢN PHẨM] = Quạt cầm tay mini JisuLife Life 7 · [USP] = pin 5000mAh dùng 19 giờ; 5 cấp gió; màn LED hiện % pin · "
     "[VẤN ĐỀ] = mùa hè nóng, ngồi làm việc đổ mồ hôi, quạt to cồng kềnh.")

h2("P2 — Nhờ AI nhìn ảnh mô tả lại (nhân vật / sản phẩm)")
prompt_box("Prompt P2a · Mô tả nhân vật (gửi kèm ảnh KOC)", """
Mô tả CHÍNH XÁC người trong ảnh để AI tạo video giữ đúng người: giới tính, tuổi ước lượng, dáng mặt,
kiểu tóc + màu tóc, kính (nếu có), trang phục đang mặc (màu, kiểu dáng, họa tiết, chi tiết như nơ / cúc / tay áo),
giày, phụ kiện. Chỉ mô tả những gì THẤY trong ảnh, không bịa thêm. 1 đoạn tiếng Việt tối đa 60 từ, không gạch đầu dòng.
""")
prompt_box("Prompt P2b · Mô tả sản phẩm (gửi kèm ảnh sản phẩm)", """
Mô tả CHÍNH XÁC sản phẩm chính trong ảnh: loại sản phẩm, hình dáng, màu sắc, chất liệu, logo / chữ in,
nút bấm / màn hình / chi tiết nổi bật, kích thước tương đối so với bàn tay. Chỉ mô tả những gì THẤY.
1 đoạn tiếng Việt tối đa 60 từ.
""", "Kết quả mẫu: “Quạt mini cầm tay màu hồng đào, đầu quạt tròn lồng nan xoắn ốc, cánh quạt hồng, màn hình LED nhỏ hiện %, "
     "tay cầm dài thẳng in chữ JisuLife dọc thân, cỡ vừa lòng bàn tay.”")

h2("P3 — Tạo ảnh khung hình mở đầu cảnh (Muse Image + ảnh KOC + ảnh sản phẩm)")
prompt_box("Prompt P3 · Khung hình mở đầu", """
1 ẢNH TĨNH (KHÔNG tạo video), tỉ lệ 9:16, photorealistic — khung hình MỞ ĐẦU của cảnh sau.
Ảnh #1 = @[TÊN KOC]: [MÔ TẢ KOC P2a]. Ảnh #2 = sản phẩm [TÊN SẢN PHẨM]: [MÔ TẢ SẢN PHẨM P2b].
Giữ y hệt khuôn mặt, kiểu tóc, trang phục như Ảnh #1 và hình dáng, màu, logo sản phẩm như Ảnh #2.
Bối cảnh: [CÂU KHÓA BỐI CẢNH].
Cảnh: [HÀNH ĐỘNG ĐẦU CẢNH — tư thế, vị trí tay, sản phẩm ở đâu, góc máy].
Mặt nhìn rõ, ánh sáng tự nhiên, chụp bằng iPhone 16 Pro Max, da thật, không ám màu nhựa AI.
""", "Ví dụ cảnh 1: “Cô gái ngồi bàn làm việc gỗ sáng, tay trái quạt quạt bằng tập giấy, mặt nhăn vì nóng, tóc mai dính mồ hôi; "
     "chiếc quạt hồng đặt trên bàn cạnh laptop; trung cảnh ngang tầm mắt.”")

h2("P4 — Prompt video 1 cảnh đầy đủ 6 phần (Image-to-Video)")
prompt_box("Prompt P4 · Video cảnh 1 (Hook) — ví dụ điền sẵn", """
[BẢNG ÁNH XẠ ẢNH THAM CHIẾU (Image 1: NHÂN VẬT @LinhKOC; Image 2: SẢN PHẨM quạt JisuLife)]:
- Ảnh #1 (@LinhKOC): nữ ~25 tuổi, mặt trái xoan, tóc nâu dài uốn sóng, áo thun trắng cổ tròn,
  quần jean xanh nhạt (khóa 100% mặt, tóc, trang phục).
- Ảnh #2 (sản phẩm): quạt mini cầm tay màu hồng đào, đầu tròn lồng nan xoắn, màn LED hiện %,
  tay cầm dài in chữ JisuLife (giữ đúng 100% hình dáng, màu, logo).
CẢNH 01/05 (0s–10s · HOOK): Quay liền mạch 10 giây không cắt cảnh, trung cảnh ngang tầm mắt.
Từ giây 0–3.5 [CHỈ @LinhKOC (Ảnh #1) MỞ MIỆNG NÓI]: cô quạt tay bằng tập giấy, nhăn mặt vì nóng:
  "Trời ơi nóng muốn xỉu luôn, ngồi làm việc mà mồ hôi chảy ròng ròng!"
Từ giây 3.5–7.0: cô liếc sang chiếc quạt hồng (Ảnh #2) trên bàn, mắt sáng lên, cầm quạt giơ lên ngang mặt:
  "May mà có em này cứu mình nè mọi người!"
Từ giây 7.0–10.0: bật quạt, tóc mai bay nhẹ, cô nhắm mắt cười thư giãn, giữ khung ổn định 1 giây cuối.
[KHÓA BỐI CẢNH CỐ ĐỊNH: góc làm việc tại nhà, bàn gỗ sồi sáng, laptop bạc, cây xanh nhỏ,
 cửa sổ rèm trắng, nắng chiều ấm 4500K — giữ nguyên ở mọi cảnh]
[KHÓA KHỚP MIỆNG: chỉ @LinhKOC nói, môi khớp từng âm tiết tiếng Việt, giọng nữ trẻ tươi sáng tự nhiên]
[ƯU TIÊN ẢNH THAM CHIẾU: nếu chữ khác ảnh thì LUÔN theo ảnh — giữ y hệt khuôn mặt, kiểu tóc, áo thun
 trắng, quần jean (Ảnh #1) và quạt hồng JisuLife (Ảnh #2) ở MỌI khung hình; không đổi màu áo,
 không thay sản phẩm khác]
[KHÓA CHÂN THẬT: quay như iPhone 16 Pro Max 4K, da thật, ánh sáng tự nhiên, không ám màu nhựa AI]
""", "Các cảnh 2–5 giữ NGUYÊN bảng ánh xạ, khóa bối cảnh, khóa ưu tiên ảnh, khóa chân thật — chỉ thay đoạn “CẢNH 0x/05” và 3 nhịp hành động / thoại.")
data_table(
    ["Cảnh", "Hành động gợi ý (thay vào phần CẢNH của P4)", "Lời thoại mẫu"],
    [
        ["2 · Giới thiệu", "Cô cầm quạt giơ ngang ngực, xoay nhẹ cho thấy toàn thân sản phẩm, chỉ tay vào màn LED", "“Quạt JisuLife Life 7 nè, nhỏ xíu cầm vừa tay mà gió mạnh cực luôn!”"],
        ["3 · Cận cảnh", "Macro tay bấm nút đổi 5 cấp gió, màn LED hiện 100%, lướt dọc logo JisuLife trên tay cầm", "“Pin 5000mAh, màn hình báo phần trăm pin, năm cấp gió tùy chỉnh.”"],
        ["4 · Trải nghiệm", "Cô vừa gõ laptop vừa cầm quạt hướng vào mặt, tóc bay nhẹ, gật gù thoải mái", "“Mình dùng cả ngày làm việc vẫn còn pin, mát rượi luôn đó!”"],
        ["5 · Chốt đơn", "Cô nhìn thẳng camera, giơ quạt cạnh mặt, tay kia chỉ xuống góc dưới màn hình", "“Giá chỉ hơn trăm nghìn thôi, bấm giỏ hàng ngay kẻo hết nha!”"],
    ],
    [2.6, 7.4, 7.0],
)

h2("P5 — Biến thể POV không lộ mặt (đồ ăn, gia dụng, mỹ phẩm)")
prompt_box("Prompt P5 · POV chỉ thấy tay", """
GÓC MÁY POV NGÔI THỨ NHẤT 100%: camera ở tầm mắt người xem nhìn xuống, chỉ thấy đôi bàn tay thật
(móng tay tự nhiên, không đeo nhẫn), TUYỆT ĐỐI KHÔNG lộ mặt hay cơ thể.
Ảnh #1 = sản phẩm [TÊN SẢN PHẨM]: [MÔ TẢ SẢN PHẨM P2b] — giữ đúng 100% hình dáng, màu, logo, bao bì.
CẢNH 0x/05: [HÀNH ĐỘNG TAY — mở hộp / bóc seal / bẻ đôi / thoa lên mu bàn tay / bấm nút...], cận cảnh macro 4K.
Âm thanh ASMR rõ (tiếng bóc seal, mở nắp), lời thoại thì thầm ngắn: "[CÂU THOẠI]".
[KHÓA BỐI CẢNH CỐ ĐỊNH: mặt bàn gỗ sồi sáng, khăn linen be, ánh sáng cửa sổ dịu — giữ nguyên mọi cảnh]
[ƯU TIÊN ẢNH THAM CHIẾU: chữ khác ảnh thì theo ảnh; không thay sản phẩm khác]
""")
callout("Lỗi hay gặp khi dùng prompt mẫu", [
    "• Quên thay [MÔ TẢ KOC] bằng mô tả thật từ P2a → Muse vẽ người khác.",
    "• Mỗi cảnh viết một câu bối cảnh khác nhau → 5 cảnh 5 căn phòng. Copy y nguyên khóa bối cảnh.",
    "• Gửi prompt P4 (video) sang tạo ẢNH → Muse trả về video. Ảnh dùng P3 (“1 ẢNH TĨNH”).",
    "• Lời thoại quá dài (> 30 âm tiết / cảnh) → nói nhanh, khớp miệng kém, bị cắt giữa câu.",
], fill="FFF4F4", bar=RED, icon="⚠️")

# =====================================================================  12
h1("Hạn chế & hướng nghiên cứu tiếp theo", "12")
bullet("Thí nghiệm tập trung vào 1 kịch bản gia đình (3 nhân vật + 1 sản phẩm), mỗi cấu hình chạy 1–2 lần; cần mở rộng sang các mẫu thời trang, ăn uống, mỹ phẩm.", "Quy mô: ")
bullet("tỉ lệ “cùng người” dùng ngưỡng nghiêm của OpenCV; nên bổ sung đánh giá người xem thật.", "Thước đo: ")
bullet("nhân vật Mẹ (ảnh AI lý tưởng hóa) mới đạt 60% — thử ảnh người thật, thêm ảnh cận mặt riêng, hoặc gửi ảnh mặt trong cả bước tạo khung hình và bước video.", "Nhân vật khó: ")
bullet("dùng khung hình cảnh 1 làm ảnh bối cảnh cho các cảnh sau để phòng khách đồng nhất tuyệt đối.", "Bối cảnh: ")
bullet("đo độ giữ chữ / logo sản phẩm và giọng nói (voice) nhất quán giữa các cảnh.", "Logo & giọng: ")

doc.add_paragraph()
end = doc.add_table(rows=1, cols=1)
no_borders(end)
ec = end.cell(0, 0)
shade(ec, BLUE)
cell_margins(ec, 200, 200, 300, 300)
q = ec.paragraphs[0]
q.alignment = WD_ALIGN_PARAGRAPH.CENTER
run(q, "FastAIVN.com — Xây kênh Affiliate bằng AI", bold=True, color="FFFFFF", size=13)
q2 = ec.add_paragraph()
q2.alignment = WD_ALIGN_PARAGRAPH.CENTER
run(q2, "Báo cáo được thực hiện bởi đội ngũ nghiên cứu FastAIVN.com · Mọi số liệu đo trên muse.ai, tháng 11/2026", color="EAF2FF", size=9.5)

doc.core_properties.author = "FastAIVN.com"
doc.core_properties.title = "Báo cáo nghiên cứu: Giữ đồng nhất tham chiếu khi tạo video AI với Muse"
doc.core_properties.subject = "Nhân vật, khuôn mặt, trang phục, sản phẩm, bối cảnh"
doc.save(OUT)
print("saved", OUT)
