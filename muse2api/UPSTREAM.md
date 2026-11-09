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
  Thêm: khi không có hint (video, ảnh), chọn tài khoản đang chạy ÍT request nhất rồi mới LRU, để chia đều.
  Kèm test `tests/test_studio_limits.py`.
- `drivers/base.py` (`VideoRequest.on_account`), `services/gateway.py`, `api/routes/videos.py`: task video ghi lại
  `account_id` đang render nó (trả về trong `GET /v1/videos/{id}`), để giao diện hiện tài khoản từng cảnh.

- `drivers/base.py` (`VideoRequest.reference_images`), `api/schemas.py` (`VideoCreateRequest.reference_images`,
  tối đa 3), `api/routes/videos.py`, `drivers/browser/driver.py` (`generate_video` gửi frame đầu + ảnh tham chiếu,
  tối đa 4 ảnh/tin nhắn): video nhận thêm ảnh sản phẩm / trang phục, đánh dấu `[MuseStudio patch]`.

- `drivers/browser/driver.py`: `_ensure_browser()` tự kết nối lại khi kết nối CDP cấp trình duyệt bị đứt
  (Chrome còn chạy thì gắn lại, Chrome chết thì mở mới); lỗi CDP khi mở tab trả về `UpstreamError` (JSON có CORS)
  thay vì lỗi 500 làm trình duyệt báo "Failed to fetch".

- `errors.py` (`UpstreamKindBlocked`), `accounts/pool.py` (`block_kind`, `kind_blocks`, `quota_used_pct`,
  `quota_exhausted`): tài khoản chạm giới hạn video trong ngày / bị chặn video theo vùng chỉ bị chặn **video**
  (ảnh vẫn chạy) tới mốc mở lại; tài khoản hết hạn mức tuần bị bỏ qua (trừ khi mọi tài khoản đều hết);
  khi số việc đang chạy bằng nhau thì ưu tiên tài khoản còn nhiều hạn mức hơn. Test: `tests/test_studio_kind_blocks.py`.
- `drivers/base.py` (`VideoRequest.voice`), `api/schemas.py` (`VideoCreateRequest.voice`), `api/routes/videos.py`,
  `drivers/browser/driver.py`: chọn giọng đọc muse.ai cho video. `core/voices.py` + `core/voices.json`: danh sách giọng.
- `drivers/http/` (mới, thay bản stub): driver HTTP/WebSocket Noise không cần Chrome (`MUSE2API_DRIVER=http`).
  `drivers/http/noise/` là mã Apache-2.0 của Meta (giữ LICENSE/NOTICE). Giao thức: `docs/protocol.md`.
  Test: `tests/test_http_driver.py` (chỉ offline, chưa thử với muse.ai thật). Thêm phụ thuộc `cryptography>=42`.
- `accounts/pool.py` (`dedicated_voice`, `_voice_ok`, tham số `voice`/`wait` của `acquire`/`lease`),
  `services/gateway.py` (`generate_video` chuyển `req.voice`): muse.ai đặt giọng theo tài khoản, nên tài khoản
  đang render giọng A không nhận task giọng B cùng lúc; tài khoản có `meta.dedicated_voice` chỉ nhận đúng giọng đó
  và được ưu tiên cho giọng đó. Task video có giọng chờ tài khoản hợp giọng tối đa bằng thời gian render.
  Test: `tests/test_studio_voice_pool.py` (repo gốc).

API riêng của MuseStudio (đăng nhập bằng trình duyệt, sửa tài khoản) nằm ngoài thư mục này,
ở `studio_api.py` và `studio_product.py` (đọc link Shopee/TikTok) của repo gốc, nên không đụng tới code upstream.

## Cập nhật lên bản upstream mới

1. Tải bản mới vào một thư mục tạm.
2. Chép đè `src/`, rồi dán lại các khối vá ở trên (`cdp.py`, `chromium.py`, `pool.py`, `base.py`, `schemas.py`, `videos.py`, `driver.py`, `errors.py`) và chép lại `core/voices.*`, `drivers/http/`.
3. Chạy `pytest` trong `muse2api/` và thử tạo 1 video trước khi commit.
