# Muse AI Video Batch Studio (ReactJS + TypeScript + Local Cookie Gateway)

Bộ công cụ tạo video AI hàng loạt (Batch Image-to-Video & Reference-to-Video) giữ **nhất quán Nhân vật, Trang phục và Sản phẩm** bằng cách sử dụng **Cookies đăng nhập từ `muse.ai`** kết hợp Local Gateway (`muse2api`) và giao diện **ReactJS + Vite + Tailwind CSS**.

---

## 1. Cấu trúc thư mục dự án

```text
MuseVideoStudio/
├── README.md                          # Hướng dẫn cài đặt, lấy Cookie và đóng gói .EXE
├── app_launcher.py                    # Launcher hợp nhất: chạy ngầm muse2api + nhúng giao diện React + mở cửa sổ Desktop
├── build_exe.bat                      # Script 1-Click tự động tải muse2api, build React và xuất ra file MuseVideoStudio.exe
├── run_dev.bat                        # Script khởi chạy nhanh môi trường Dev (Backend + Frontend)
├── requirements.txt                   # Các gói Python cần thiết cho bộ khởi chạy và đóng gói
└── frontend/                          # Mã nguồn giao diện ReactJS + TypeScript + Vite + Tailwind CSS
    ├── index.html
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── electron/
    │   └── main.cjs                   # Cấu hình Electron Sidecar (tùy chọn)
    └── src/
        ├── main.tsx
        ├── App.tsx                    # Khung ứng dụng chính (Chuyển đổi Batch Mode / Single Studio Mode)
        ├── index.css
        ├── types/
        │   └── videoStudio.ts         # Định nghĩa kiểu dữ liệu TypeScript toàn hệ thống
        ├── utils/
        │   └── videoFrameExtractor.ts # Công cụ cắt Frame cuối (End-frame) để nối cảnh liên tiếp
        ├── services/
        │   ├── museBatchService.ts    # Xử lý bóc tách Cookie muse.ai, tạo Keyframe 2 bước & Polling Video
        │   └── videoAiService.ts      # Bộ biên dịch khóa Nhân vật/Trang phục/Sản phẩm & Muse Hosting API
        └── components/
            ├── MuseBatchStudio.tsx    # Giao diện chạy hàng loạt bằng Cookie muse.ai (1, 2, 4 luồng)
            └── CharacterVideoStudio.tsx # Giao diện tạo từng cảnh chi tiết
```

---

## 2. Hướng dẫn lấy Cookie chuẩn từ `muse.ai`

Vì các cookie xác thực của `muse.ai` (`hatch_sess`, `hatch_vml`, `hatch_native_auth_device`, `hatch_gw`) được gắn cờ bảo mật `httpOnly`, bạn lấy theo các bước sau:

1. Mở trình duyệt Chrome/Edge, truy cập **https://muse.ai/** và đăng nhập tài khoản.
2. Nhấn phím **F12** để mở Developer Tools -> Chọn tab **Network (Mạng)**.
3. Nhấn **F5** để tải lại trang, chọn dòng request đầu tiên gửi tới `muse.ai`.
4. Kéo xuống mục **Request Headers**, tìm dòng **`cookie:`**.
5. Copy toàn bộ chuỗi giá trị của dòng `cookie:` (có chứa `hatch_sess=...; hatch_vml=...`) và dán vào ô **Nạp Cookie** trong phần mềm.
   - *Mẹo chạy đa luồng:* Bạn có thể dán nhiều tài khoản (mỗi tài khoản 1 dòng) để hệ thống tự động chia tải khi chạy 2 hoặc 4 luồng song song.

---

## 3. Cách chạy ở chế độ Phát triển (Development)

1. Đảm bảo máy đã cài đặt **Node.js (18+)**, **Python (3.10+)**, **Git** và trình duyệt **Google Chrome**.
2. Nhấp đúp vào file **`run_dev.bat`** (hoặc chạy lần lượt lệnh cài đặt trong đó).

---

## 4. Cách đóng gói thành 1 file `.EXE` duy nhất (Chạy không cần Python)

1. Nhấp đúp vào file **`build_exe.bat`**.
2. Script sẽ tự động:
   - Clone `muse2api` từ GitHub (nếu chưa có trong thư mục).
   - Chạy `npm install` và `npm run build` trong thư mục `frontend/`.
   - Cài đặt `pywebview`, `pyinstaller`, `fastapi`, `uvicorn`.
   - Đóng gói tất cả thành file thực thi duy nhất tại: **`dist/MuseVideoStudio.exe`**.
