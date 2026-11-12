# Đóng gói MuseVideoStudio.exe để bàn giao

Chạy `build_exe.bat` (thêm `full` để kèm clip đầy đủ cho nút ▶: `build_exe.bat full`). Kết quả:

```
release/MuseVideoStudio_<ngày>/        ← thư mục bàn giao (+ MuseVideoStudio_<ngày>.zip)
  MuseVideoStudio.exe
  wfthumb/   (+ wfthumb/full/ nếu chọn full)
  ffmpeg.exe
  HUONG_DAN_CHAY.txt
```

Các bước: (1) kiểm tra `muse2api/` trong repo → (2) build giao diện bằng vite (gọi thẳng `node node_modules/vite/bin/vite.js build`,
kiểm tra có `frontend/dist/index.html`) → (3) `pip install -r requirements.txt` → (4) PyInstaller theo `MuseVideoStudio.spec`
→ (5) `tools/package_release.py` gom thư mục bàn giao + zip, tự chặn nếu lọt file dữ liệu cá nhân.

## GÓI (đủ để chạy)

| Thành phần | Nằm ở | Ghi chú |
|---|---|---|
| Mã Python: `app_launcher.py`, `studio_*.py` (Gateway MuseStudio: tài khoản, đăng nhập email/OTP, sản phẩm, media, AI, thư viện, catalog, wfthumb) | trong exe | |
| `muse2api` bản trong repo (driver trình duyệt + bản vá Windows/MuseStudio) kèm `core/voices.json` (danh mục giọng) | trong exe | `collect_all('muse2api')` |
| Thư viện chạy: fastapi, starlette, uvicorn, pywebview (cửa sổ desktop), httpx, websockets, pydantic, cryptography | trong exe | |
| Giao diện đã build `frontend/dist` → `frontend_dist`: toàn bộ màn hình, **mẫu workflow có sẵn** (MuseStudio, MV1, FastAIVN, sơ đồ khối `hndFlowTemplates`, `hieuPovAio`), ảnh/video mẫu `public/workflow-thumbs` | trong exe | |
| `wfthumb/`: thumbnail `.jpg`, video xem trước 8 s `.mp4`, sơ đồ `.flow.json`, `wfthumb.config.json` | cạnh exe | sửa config được (dán link YouTube); bỏ `testClip`/`testVersion` (đường dẫn máy dev), `fullVideoDir` = "" |
| `wfthumb/full/` clip đầy đủ có tiếng (~160 MB, từ `TestWorkFlow/thumFull`) | cạnh exe | **chỉ khi** `build_exe.bat full`; không có thì nút ▶ phát video xem trước 8 s / YouTube |
| `ffmpeg.exe` (~82 MB, lấy từ PATH máy build) | cạnh exe | cần cho ghép cảnh / cắt khung / hậu kỳ; không nhét vào exe cho exe nhẹ, mở nhanh |
| `HUONG_DAN_CHAY.txt` | cạnh exe | yêu cầu máy, cách chạy, dữ liệu lưu ở đâu |

## KHÔNG GÓI

| Thành phần | Lý do |
|---|---|
| `data/` toàn bộ: `media/` (~1,7 GB video/ảnh đã tạo), `requests.db` (log request), `tasks.json`, `gateway_run.log` | dữ liệu chạy của máy dev, nặng |
| `data/accounts.json`, `data/login-profiles/`, `data/browser-profile/`, `data/shop-profile/` | **cookie đăng nhập muse.ai / Shopee** — tuyệt đối không bàn giao |
| `data/studio/ai_config.json` | **Gemini API key** cá nhân |
| `data/studio/state/` (nhân vật, sản phẩm, sơ đồ đã lưu, mẫu tự lưu…), `data/seen_media.txt` | dữ liệu riêng; muốn chuyển thì dùng "📤 Xuất bộ workflow" trong app |
| `tmpacc.k` | danh sách email + link hộp thư tài khoản |
| `TestWorkFlow/` (lượt chạy thử, báo cáo, môi trường Python chấm điểm `.labenv`), `tools/`, `tests/`, `muse2api/tests/` | công cụ phát triển / thử nghiệm |
| `changeLog/`, `taiLieu/`, `thamK/`, `README.md`, `1HuongDanChay.md` | tài liệu nội bộ |
| `frontend/node_modules/`, `frontend/src/`, `build/`, `.git/`, `__pycache__/`, `.pytest_cache/` | mã nguồn / thư viện build / tạm |

## Trên máy người nhận

- Windows 10/11 64-bit, đã cài **Chrome hoặc Edge** (app tự tìm Chrome / Edge / Brave / Cốc Cốc).
- Dữ liệu người dùng lưu ở `%APPDATA%\MuseVideoStudio` (tài khoản, nhân vật, sản phẩm, sơ đồ…), video xuất ra `Downloads\MuseStudio`.
  Thay exe bản mới không mất dữ liệu.
- Lần đầu tự đăng nhập tài khoản muse.ai (Cài đặt → Tài khoản Muse) và (tuỳ chọn) dán Gemini key (Cài đặt → Trợ lý AI).
- Cổng 18610 phải trống (đóng `run_dev.bat` / Gateway dev nếu đang chạy trên cùng máy).
- Không mở được: xem `%APPDATA%\MuseVideoStudio\logs\launcher.log` (exe không có cửa sổ console; lỗi khởi động hiện hộp thoại).
- Sao lưu tự động: `%APPDATA%\MuseVideoStudioackup\yyyyMMdd\HH\data\…` (Cài đặt → Chung → "💾 Sao lưu & dọn dữ liệu").
