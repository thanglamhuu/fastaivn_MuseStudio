26/11/10 (tối) — Mẫu Workflow dùng chung quản trị trên fastaivn.com (Giải pháp 2: catalog tĩnh)
   - Gateway: studio_catalog.py — GET /studio/catalog (tải catalog.v1.json, ETag, lưu đệm đĩa dùng khi mất mạng),
     /studio/catalog/graph (sơ đồ từng mẫu, có đệm), /studio/catalog/config (đổi địa chỉ). Mặc định https://fastaivn.com/workflows/catalog.v1.json.
   - Màn mẫu: mẫu fastaivn.com đứng đầu lưới card (thumbnail / video từ web, nhãn 🌐 fastaivn, PRO), thanh trạng thái + 🔄 Cập nhật mẫu,
     ẩn mẫu cần bản app mới hơn (minAppVersion). 🧩 Sơ đồ mở đúng sơ đồ soạn trên web.
   - Sơ đồ khối: 📤 Xuất mẫu cho fastaivn.com (gói sơ đồ + thông tin + thumbnail cắt từ video kết quả).
   - Tài liệu: taiLieu/FASTAIVN_CATALOG.md (định dạng catalog, Firestore/Storage, Security Rules, prompt AI Studio cho trang quản trị).

26/11/10 (chiều) — Lưới card mẫu + tăng độ đồng nhất nhân vật / trang phục / sản phẩm

1. Màn "Mẫu & danh sách dòng": các mẫu thành lưới card thumbnail 9:16 (chọn 4 hoặc 6 card / dòng), rê chuột phát video mẫu.
   Thumbnail: clip mới nhất bạn đã chạy bằng mẫu đó → video chạy thử của 13 mẫu HND (public/workflow-thumbs) → ô màu.
   Lọc theo loại như HND, tìm kiếm, nút 🧩 Sơ đồ mở mẫu trong Sơ đồ khối. app_launcher.py phục vụ /workflow-thumbs khi đóng gói exe.

2. Sơ đồ khối — tăng độ đồng nhất (thí nghiệm 9 lượt mẫu Gia đình, xem HNDWorkflow/HND worflows export/4_thi_nghiem_dong_nhat):
   - Generate Video: 🖼 tạo ảnh khung hình trước rồi Image→Video (mặc định bật) — mặt Bố 6% → 93%, Mẹ 7% → 60% khung hình đúng người.
   - Generate Video: 🔒 khóa "ưu tiên ảnh tham chiếu" cuối prompt (mặc định bật) — trang phục từ sai → đúng cả 3 người.
   - Upload Image: 🔍 AI nhìn ảnh mô tả lại (mặc định bật, có cache); ✂️ cắt character sheet 2×2 (toàn thân + cận mặt);
     ô ảnh cận mặt (ghép cạnh ảnh toàn thân); nhân vật trong Cài đặt có ≥2 ảnh tự ghép 2 ảnh đầu.
   - Tối đa 4 ảnh tham chiếu / video khi không có khung mở đầu (gateway schemas.py + museBatchService) — đủ chỗ cho 3 nhân vật + sản phẩm.
   - Tài khoản Muse bận ("all accounts are busy") → tự chờ & thử lại.
   - Sửa lỗi Image→Video: lấy đúng ảnh khung hình làm khung mở đầu khi ảnh khóa nối vào trước.



Chiều nay MuseStudio có hai nhóm thay đổi chính, cộng thêm phần catalog làm lúc tối.

1. Màn “Mẫu & danh sách dòng”: lưới card
Mẫu workflow giờ là card có ảnh thu nhỏ dọc 9:16. Chọn được 4 hoặc 6 card mỗi dòng, máy nhớ lựa chọn này. Rê chuột lên card thì phát video mẫu.
Ảnh thu nhỏ lấy theo thứ tự:
Clip mới nhất bạn đã chạy bằng mẫu đó.
Nếu chưa có thì lấy video chạy thử của 13 mẫu HND.
Nếu vẫn không có thì hiện ô màu.
Lọc theo loại giống HND, có ô tìm kiếm. Nút 🧩 Sơ đồ mở mẫu thẳng trong Sơ đồ khối.
Khi đóng gói exe, ảnh và video mẫu vẫn hiện bình thường.
2. Sơ đồ khối: tăng độ đồng nhất nhân vật, trang phục, sản phẩm

Rút ra từ 9 lượt thí nghiệm với mẫu Gia đình:

Tạo ảnh khung hình trước rồi mới tạo video từ ảnh đó (bật sẵn). Đây là bước tăng mặt đúng người nhiều nhất: Bố từ 6% lên 93%, Mẹ từ 7% lên 60% số khung hình.
Khóa ưu tiên ảnh tham chiếu ở cuối prompt (bật sẵn). Nhờ khóa này, trang phục đúng cho cả 3 người.
Node Upload Image có thêm:
AI nhìn ảnh rồi mô tả lại (bật sẵn, có lưu đệm).
Cắt ảnh nhân vật dạng lưới 2×2.
Ô thêm ảnh cận mặt để ghép cạnh ảnh toàn thân. Nhân vật trong Cài đặt có từ 2 ảnh trở lên thì app tự ghép.
Tối đa 4 ảnh tham chiếu mỗi video (trước là 3), vừa đủ cho 3 nhân vật và 1 sản phẩm.
Khi Muse báo hết tài khoản rảnh (“all accounts are busy”), app tự chờ rồi thử lại.
Sửa lỗi tạo video từ ảnh: trước đây app có thể lấy nhầm ảnh khóa làm khung mở đầu, giờ lấy đúng ảnh khung hình.
3. (Tối) Mẫu workflow dùng chung từ fastaivn.com, giải pháp 2 — đang tạm dừng
App tải danh sách mẫu (catalog.v1.json) từ fastaivn.com và lưu sẵn trên máy, nên mất mạng vẫn dùng được.
Mẫu từ web đứng đầu lưới card, có nút 🔄 Cập nhật mẫu. Mẫu cần bản app mới hơn thì bị ẩn.
Trong Sơ đồ khối có nút 📤 Xuất mẫu cho fastaivn.com.
Hướng dẫn làm phía web nằm ở FASTAIVN_CATALOG.md. Trang quản trị trên fastaivn.com chưa làm.

Chi tiết từng mục có trong 261110_dong_nhat_va_mau_card.md. Toàn bộ thay đổi trong MuseStudio vẫn chưa commit.