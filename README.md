# Muse AI Video Batch Studio (ReactJS + TypeScript + Local Cookie Gateway)

Bộ công cụ tạo video AI hàng loạt (Batch Image-to-Video & Reference-to-Video) giữ **nhất quán Nhân vật, Trang phục và Sản phẩm** bằng cách sử dụng **Cookies đăng nhập từ `muse.ai`** kết hợp Local Gateway (`muse2api`) và giao diện **ReactJS + Vite + Tailwind CSS**.

---

## 1. Cấu trúc thư mục dự án

```text
MuseStudio/
├── README.md
├── studio_settings.py                 # Cổng + API key dùng chung; luôn nạp muse2api nhúng trong repo
├── studio_api.py                      # API /studio: đăng nhập muse.ai bằng Chrome, luồng theo tài khoản
├── gateway_server.py                  # Gateway cho môi trường dev (run_dev.bat)
├── app_launcher.py                    # Launcher .EXE: chạy muse2api + phục vụ giao diện React + cửa sổ desktop
├── build_exe.bat                      # Build React và đóng gói ra dist/MuseVideoStudio.exe
├── run_dev.bat                        # Chạy Gateway + Vite dev server
├── requirements.txt
├── muse2api/                          # Gateway muse2api nhúng sẵn, có bản vá Windows (xem muse2api/UPSTREAM.md)
└── frontend/                          # ReactJS + TypeScript + Vite + Tailwind CSS
    ├── .env.example                   # VITE_GATEWAY_URL / VITE_MUSE_API_KEY (khớp studio_settings.py)
    └── src/
        ├── App.tsx                    # Khung ứng dụng + chỉ báo kết nối Gateway
        ├── config/appConfig.ts        # Địa chỉ Gateway + API key phía frontend (1 chỗ duy nhất)
        ├── hooks/usePersistentState.ts# Lưu cấu hình / prompt / ảnh tham chiếu / lô hiện tại vào localStorage
        ├── services/museBatchService.ts # Mọi lời gọi Gateway: tài khoản, keyframe, video, task
        ├── utils/videoFrameExtractor.ts # Cắt frame cuối để nối cảnh
        ├── utils/download.ts          # Tải 1 video / tải tất cả
        └── components/
            ├── MuseBatchStudio.tsx    # Màn hình chính: chạy hàng loạt, chạy lại cảnh lỗi, tải tất cả
            ├── AccountsPage.tsx       # Dàn tài khoản: đăng nhập bằng Chrome, dán cookie, luồng, hạn mức
            └── VideoHistory.tsx       # Lịch sử video đọc từ GET /admin/tasks của Gateway
```

---

## 2. Thêm tài khoản muse.ai

Vào tab **👥 Dàn tài khoản Muse**:

- **+ Thêm tài khoản (đăng nhập)**: app mở một cửa sổ Chrome riêng (profile trắng). Đăng nhập muse.ai như bình thường;
  khi đăng nhập xong app tự lấy cookie, lưu tài khoản và đóng cửa sổ. Nút **Đăng nhập** trên từng tài khoản dùng để
  đăng nhập lại khi cookie hết hạn.
- **Cookie** / **+ Thêm nhiều TK (cookie)**: dán dòng `cookie:` lấy từ F12 ➔ Network (chứa `hatch_sess=...;
  hatch_native_auth_device=...`). Nhiều tài khoản thì mỗi dòng một tài khoản, dạng `tên | cookie`.
- **Số luồng** của từng tài khoản = số video tài khoản đó tạo cùng lúc (tối đa = `MUSE2API_ACCOUNT_MAX_CONCURRENCY`, mặc định 4).

Khi chạy hàng loạt, Gateway tự **xoay tua**: mỗi video được giao cho tài khoản đang rảnh lâu nhất; tài khoản hết hạn mức
hoặc cookie hỏng được bỏ qua. Chế độ "Số luồng chạy: Tự động" = tổng luồng của các tài khoản dùng được.

---

## 3. Cách chạy ở chế độ Phát triển (Development)

1. Đảm bảo máy đã cài đặt **Node.js (18+)**, **Python (3.10+)**, **Git** và trình duyệt **Google Chrome**.
2. Nhấp đúp vào file **`run_dev.bat`** (hoặc chạy lần lượt lệnh cài đặt trong đó).

---

## 4. Cách đóng gói thành 1 file `.EXE` duy nhất (Chạy không cần Python)

1. Nhấp đúp vào file **`build_exe.bat`**.
2. Script sẽ tự động:
   - Kiểm tra thư mục `muse2api/` (đã nhúng sẵn, không clone lại vì bản gốc thiếu bản vá Windows).
   - Chạy `npm install` và `npm run build` trong thư mục `frontend/`.
   - Cài đặt `pywebview`, `pyinstaller`, `fastapi`, `uvicorn`.
   - Đóng gói tất cả thành file thực thi duy nhất tại: **`dist/MuseVideoStudio.exe`**.
