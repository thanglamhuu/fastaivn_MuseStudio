"""Pure helpers of studio_product.py, using data captured from real TikTok Shop / Shopee pages."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "muse2api" / "src"))

import studio_product as sp

TT = ("https://p16-oec-sg.ibyteimg.com/tos-alisg-i-aphluv4xwc-sg/badc3d5e2df84673aca8ed34077bddcb"
      "~tplv-aphluv4xwc-resize-webp:{s}:{s}.webp?dr=15582&idc=my{n}&from=1")


def test_tiktok_thumbnail_and_full_image_are_one_image():
    urls = [TT.format(s=260, n=3), TT.format(s=800, n=2),
            TT.replace("badc3d5e", "ae1b32ee").format(s=800, n=2)]
    out = sp.dedupe_image_urls(urls)
    assert len(out) == 2
    assert "resize-webp:800:800" in out[0]  # thumbnail upgraded to the 800px rendition


def test_shopee_thumbnail_suffix_is_stripped_and_deduped():
    a = "https://down-vn.img.susercontent.com/file/vn-11134207-81ztc-muod5uaia1hf36_tn"
    b = "https://down-vn.img.susercontent.com/file/vn-11134207-81ztc-muod5uaia1hf36"
    assert sp.dedupe_image_urls([a, b]) == [b]


SHOPEE_TEXT = """Ghế công thái học chống gù cho trẻ em
CHI TIẾT SẢN PHẨM
Chất liệu
Nhựa
MÔ TẢ SẢN PHẨM

Thông tin sản phẩm

✅ Để chân của ghế có thể điều chỉnh lên xuống



✅ Tay vịn có thể gập lên xuống
ĐÁNH GIÁ SẢN PHẨM
5 sao"""


def test_description_from_page_text():
    desc = sp.description_from_text(SHOPEE_TEXT)
    assert desc.startswith("Thông tin sản phẩm")
    assert "Tay vịn" in desc and "ĐÁNH GIÁ" not in desc and "\n\n\n" not in desc
    assert sp.description_from_text("không có phần mô tả") == ""


def test_tiktok_price_split_over_lines():
    # Chữ trang TikTok Shop thật: "₫" và số tiền nằm ở 2 dòng, giá gốc gạch ngang ở dòng sau
    assert sp.guess_price("-45%\n₫\n108.000\n198.000₫\nSách") == "108.000 ₫"
