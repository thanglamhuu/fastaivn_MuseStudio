# Muse AI Video Batch Studio (ReactJS + TypeScript + Local Cookie Gateway)

Bộ công cụ tạo video AI hàng loạt (Batch Image-to-Video & Reference-to-Video) giữ **nhất quán Nhân vật, Trang phục và Sản phẩm** bằng cách sử dụng **Cookies đăng nhập từ `muse.ai`** kết hợp Local Gateway (`muse2api`) và giao diện **ReactJS + Vite + Tailwind CSS**.

---

## 1. Cấu trúc thư mục dự án

```text
MuseStudio/
├── README.md
├── studio_settings.py                 # Cổng + API key dùng chung; luôn nạp muse2api nhúng trong repo
├── studio_api.py                      # API /studio: đăng nhập muse.ai bằng Chrome, luồng theo tài khoản
├── studio_product.py                  # API /studio/product: đọc link Shopee/TikTok (tên, giá, mô tả, ảnh)
├── studio_media.py                    # API /studio: lưu trạng thái, xuất file, ghép video (FFmpeg), giọng đọc
├── studio_ai.py                       # API /studio/ai: Gemini (xoay vòng key) / endpoint OpenAI cho trợ lý kịch bản
├── tests/                             # Test cho studio_media.py (python -m pytest tests)
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
        ├── services/workflowRunner.ts # Bộ chạy Workflow: Sản phẩm → Kịch bản → Render cảnh → Ghép, chạy tiếp từ bước lỗi
        ├── data/workflowTemplates.ts  # 8 mẫu workflow có sẵn (TVC, unboxing, lookbook, street walk...)
        ├── utils/videoFrameExtractor.ts # Cắt frame cuối để nối cảnh
        ├── utils/download.ts          # Tải 1 video / tải tất cả
        └── components/
            ├── MuseBatchStudio.tsx    # Màn hình chính: chạy hàng loạt, chạy lại cảnh lỗi, tải tất cả
            ├── WorkflowStudio.tsx     # Tab Workflow làm clip: mẫu, dòng sản phẩm / CSV, tiến độ 4 bước
            ├── ProductScriptPanel.tsx # Sản phẩm từ link / tự nhập + 44 mẫu kịch bản, AI viết kịch bản chia cảnh
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

## 3. Tạo video từ sản phẩm

1. Khối **0. Sản phẩm & Kịch bản**: dán link Shopee / TikTok Shop rồi bấm **Phân tích** (app mở một cửa sổ Chrome ẩn
   để đọc trang). Shopee/TikTok đòi đăng nhập thì bấm **Đăng nhập Shopee/TikTok (1 lần)**, đăng nhập rồi đóng cửa sổ;
   các lần sau dùng lại phiên đó. Không có link thì tự gõ tên + tải ảnh sản phẩm ở khối 2.
2. Rê chuột lên ảnh sản phẩm ➔ **Dùng làm ảnh SP** (ảnh đầu tiên được chọn sẵn).
3. Chọn **mẫu kịch bản**, tổng thời lượng, có/không lời thoại ➔ **AI viết kịch bản** (muse-chat xem ảnh sản phẩm thật
   và viết từng cảnh) ➔ kịch bản tự đổ vào danh sách prompt.
4. **Bắt đầu Tạo Hàng Loạt**: mỗi video gửi kèm ảnh nhân vật + ảnh sản phẩm + ảnh trang phục, prompt ghi rõ ảnh nào là gì
   và tên/ngoại hình sản phẩm để muse.ai không tự đổi sang sản phẩm khác.

## 4. Lưu file, ghép video, giọng đọc, dừng / chạy lại

- **Lưu tiến trình**: danh sách cảnh, prompt, ảnh tham chiếu và sản phẩm được lưu ở localStorage **và** trên Gateway
  (`data/studio/state/`), nên ảnh lớn không bị mất khi localStorage đầy (~5MB). Tải lại trang thì các cảnh đang render
  được chờ tiếp.
- **Tự lưu video**: mỗi cảnh xong được chép vào `Downloads\MuseStudio\<Tên dự án>\Canh_01.mp4`
  (đổi bằng `MUSE2API_STUDIO_OUTPUT_DIR`). Bản trong `data/media` của Gateway bị tự dọn sau 14 ngày.
- **Ghép video**: nút **🎞 Ghép N cảnh** (hoặc tick "Xong cả lô thì tự ghép") ghép các cảnh đã xong theo thứ tự thành
  `<Tên dự án>_full.mp4` bằng FFmpeg (tìm `ffmpeg.exe` cạnh app, trong PATH, hoặc `MUSE2API_FFMPEG_PATH`).
- **Giọng đọc**: chọn 1 giọng muse.ai cho cả lô để các cảnh không bị đổi giọng.
- **Dừng**: "⏸ Dừng sau cảnh đang chạy" không nhận cảnh mới nhưng để cảnh đang render chạy nốt; "⏹ Dừng hẳn" hủy luôn.
- **Sửa từng cảnh**: sửa prompt ngay trên thẻ cảnh rồi bấm **Chạy lại / Tạo lại**; bản cũ giữ trong "Bản tạo trước".
- **Nối End-frame**: luôn lấy khung cuối của cảnh **liền trước** (kể cả khi chạy lại cảnh lỗi).
- **Tài khoản**: tài khoản chạm giới hạn video trong ngày / bị chặn video theo vùng hiện huy hiệu đếm ngược và tự được
  bỏ qua khi tạo video; tài khoản hết hạn mức tuần cũng bị bỏ qua. Việc mới ưu tiên tài khoản ít việc và còn nhiều hạn mức.
- **Driver không cần Chrome (thử nghiệm)**: đặt `MUSE2API_DRIVER=http` trước khi chạy Gateway. Chưa kiểm chứng với muse.ai thật.

## 4b. Cài đặt, nhân vật, giọng đọc, trợ lý AI, ghép ảnh (P2)

- **⚙️ Cài đặt** gom: Tài khoản Muse (chuyển từ tab cũ), **Nhân vật**, **Sản phẩm**, **Giọng đọc**, **Trợ lý AI**, Chung.
- **Nhân vật**: tên gọi + mô tả + ảnh khóa mặt (thẻ 9:16) + trang phục cố định + **giọng đọc cố định** (12 hồ sơ Matrix,
  Nam trước Nữ sau) + cảm xúc. Prompt nhắc tên nhân vật (hoặc `@tên`) thì cảnh đó tự gửi ảnh và dùng giọng của nhân vật.
- **Giọng đọc trên Muse**: Muse có thư viện giọng riêng (40 giọng, 6 giọng tiếng Việt: 4 nam, 2 nữ), đặt theo tài khoản.
  Mỗi hồ sơ Matrix = 1 giọng gốc Muse + chỉ dẫn `[Voice Profile: ...]` (tốc độ, cao độ, chất âm) gắn trước lời thoại.
  Trộn nhiều giọng trong một lô thì nên để 1 luồng / tài khoản.
- **Trợ lý AI** (Cài đặt ➔ 🤖): Gemini API key (nhiều key, tự xoay vòng khi key hết hạn mức) hoặc endpoint tương thích
  OpenAI. Viết kịch bản thử Gemini/OpenAI trước, lỗi hoặc chưa cấu hình thì dùng muse-chat; dưới kịch bản ghi rõ nguồn.
  Kiểu kịch bản: theo mẫu có sẵn, **TVC 5 bước**, **Phim ngắn** (dùng tên nhân vật trong thư viện), **POV Affiliate**.
- **Cách ghép ảnh tham chiếu (khối 2b)**: dùng chung cho mọi cảnh · ghép theo nhóm · khung đầu → khung cuối ·
  khóa người mẫu + xoay vòng sản phẩm / trang phục (lookbook).
- **Khung 9:16 mặc định** cho thẻ nhân vật, sản phẩm, thẻ cảnh, clip đã render và lịch sử video.
- **Đọc link sản phẩm**: thêm dò giá dạng `₫199.000` trên trang khi Shopee/TikTok không có dữ liệu giá có cấu trúc.

## 4c. Workflow làm clip (🧩)

Tab **🧩 Workflow làm clip**: mỗi dòng sản phẩm chạy qua 4 bước và ra **1 clip hoàn chỉnh**:

1. **🛒 Sản phẩm** – lấy từ thư viện; dòng là link Shopee/TikTok thì tự đọc link và **lưu vào thư viện** (kèm ảnh).
   Dòng chỉ có tên sản phẩm (không ảnh) vẫn chạy được nếu có nhân vật có ảnh.
2. **✍️ Kịch bản** – Gemini / OpenAI / muse-chat viết theo kiểu kịch bản của mẫu (ghi chú của dòng được gửi kèm).
   Bật *“Dừng sau kịch bản để duyệt / sửa”* để xem, sửa prompt từng cảnh rồi bấm **Duyệt & render**.
3. **🎬 Render cảnh** – song song theo tổng số luồng của các tài khoản (mẫu nối khung cuối thì tuần tự).
   Cảnh nhắc tên nhân vật dùng ảnh + giọng của nhân vật đó; mỗi cảnh xong tự lưu file.
4. **🎞 Ghép clip** – FFmpeg nối các cảnh thành `<thời điểm>_FULL.mp4`.

- File lưu ở `<thư mục xuất>\Workflow - <tên sản phẩm>\` (`..._Canh_01.mp4`, ..., `..._FULL.mp4`); nút 📂 mở thư mục.
- **8 mẫu có sẵn**: TVC 5 bước, Unboxing ASMR, POV review, Trước & Sau, Lookbook nhiều mẫu/màu (khóa người mẫu,
  xoay vòng ảnh sản phẩm), Street walk (nối khung), Tiểu phẩm gia đình, Review 7 ngày. Chỉnh số cảnh, giây/cảnh, tỉ lệ,
  góc máy, lời thoại, không lộ mặt... rồi **Lưu thành workflow mới** (lưu cả trên Gateway).
- **Thêm nhiều dòng**: dán từ Excel / Google Sheets, mỗi dòng `link hoặc tên SP | tên nhân vật | ghi chú`.
- **Chạy tiếp từ bước lỗi**: mỗi bước lưu kết quả, nên *Chạy tiếp* bắt đầu lại đúng bước lỗi (chỉ render lại cảnh lỗi);
  *Chạy lại từ…* chọn bước bất kỳ. **Dừng** hủy task trên Gateway. Tải lại trang giữa chừng thì *Chạy tiếp* chờ tiếp
  các task cũ, không tạo video trùng.

---

## 5. Cách chạy ở chế độ Phát triển (Development)

1. Đảm bảo máy đã cài đặt **Node.js (18+)**, **Python (3.10+)**, **Git** và trình duyệt **Google Chrome**.
2. Nhấp đúp vào file **`run_dev.bat`** (hoặc chạy lần lượt lệnh cài đặt trong đó).

---

## 6. Cách đóng gói thành 1 file `.EXE` duy nhất (Chạy không cần Python)

1. Nhấp đúp vào file **`build_exe.bat`**.
2. Script sẽ tự động:
   - Kiểm tra thư mục `muse2api/` (đã nhúng sẵn, không clone lại vì bản gốc thiếu bản vá Windows).
   - Chạy `npm install` và `npm run build` trong thư mục `frontend/`.
   - Cài đặt `pywebview`, `pyinstaller`, `fastapi`, `uvicorn`.
   - Đóng gói tất cả thành file thực thi duy nhất tại: **`dist/MuseVideoStudio.exe`**.
