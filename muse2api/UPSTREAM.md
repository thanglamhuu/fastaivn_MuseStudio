# muse2api (vendored)

Thư mục này là bản nhúng của https://github.com/www222fff/muse2api
tại commit `3a20b5e` ("chore: bump version to 0.4.0", v0.4.0). Thư mục `.git` gốc đã được xóa.

## Bản vá cục bộ so với upstream

- `src/muse2api/drivers/browser/cdp.py`: khối `# === WINDOWS WS ORIGIN SYNC PATCH ===` ở cuối file
  (đổi `localhost`/`[::1]` thành `127.0.0.1` và đồng bộ cổng WebSocket của DevTools).
- `src/muse2api/drivers/browser/chromium.py`: khối `# === WINDOWS CHROMIUM START PATCH ===` ở cuối file
  (tìm Chrome/Edge trên Windows, profile tạm riêng cho mỗi phiên, `--headless=new`, cổng DevTools ngẫu nhiên).

- `src/muse2api/accounts/pool.py`: khối `[MuseStudio patch]` thêm `limit_of()` / `inflight_of()`,
  giới hạn luồng riêng cho từng tài khoản qua `meta["max_concurrency"]` (đặt từ trang Dàn tài khoản).
  Kèm test `tests/test_studio_limits.py`.

API riêng của MuseStudio (đăng nhập bằng trình duyệt, sửa tài khoản) nằm ngoài thư mục này,
ở `studio_api.py` của repo gốc, nên không đụng tới code upstream.

## Cập nhật lên bản upstream mới

1. Tải bản mới vào một thư mục tạm.
2. Chép đè `src/`, rồi dán lại các khối vá ở trên (`cdp.py`, `chromium.py`, `pool.py`).
3. Chạy `pytest` trong `muse2api/` và thử tạo 1 video trước khi commit.
