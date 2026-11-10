26/11/10 (23h) — Hieu POV AIO giữ đúng bao bì & màu sản phẩm (thí nghiệm VijiFarm: hộp khớp 11 → 454 điểm, quả hết nâu sẫm)
   - Brief: bỏ thông tin mẫu điền sẵn (chữ "phủ phấn trắng" làm quả ra nâu sẫm), ánh sáng ban ngày, tả sản phẩm chỉ theo ảnh,
     hộp giữ thẳng không xoay lật, mỗi cảnh có mục Bao bì + Màu sản phẩm.
   - Runtime: khóa ưu tiên ảnh nhắc màu + bao bì khi có ảnh khóa sản phẩm; ảnh khung hình không đòi "nhìn rõ mặt" khi không có nhân vật (hết lộ môi).
   - Báo cáo: HNDWorkflow/HND worflows export/6_pov_giu_bao_bi_mau/BAO_CAO_GIU_BAO_BI_MAU.md

26/11/10 (khuya) — Mẫu "Hieu POV AIO" (chuyển từ Flow App Review POV AIO, fastaivn.com/flow-apps/u8xd)
   - Sơ đồ node data/hieuPovAio.flow.json: 2 ô ảnh sản phẩm + ô bối cảnh góc bàn POV (ảnh đi kèm public/workflow-thumbs/fastaivn-pov-desk.jpg)
     + Brief POV AIO (4 dòng sửa: sản phẩm, điểm nổi bật, phong cách lời thoại HYPE / TÒ MÒ / ASMR, giọng đọc)
     → AI viết 3 cảnh (Hook–khoe hộp / Cận cảnh–cảm giác / Trải nghiệm–chốt đơn) → 3 Generate Video (khung hình trước + khóa ưu tiên ảnh) → Ghép → Kết quả ~30s.
   - Card mẫu nhóm "Review POV (FastAIVN)" (data/fastaivnWorkflowTemplates.ts) có thumbnail + video xem trước; 🧩 Sơ đồ mở đúng sơ đồ trên.
   - Mẫu có thể khai báo flowGraphId (sơ đồ dựng sẵn) và preview (ảnh / video card); 📚 Mẫu Workflow trong Sơ đồ khối liệt kê cả mẫu FastAIVN.
   - Gemini Script: AI trả thiếu đoạn → tự viết tiếp đoạn còn thiếu; tách đoạn theo cả tiêu đề "CẢNH x/y" giữa dòng, bỏ đoạn trùng
     (lỗi gặp khi chạy thử: cảnh 3 lặp thoại cảnh 2 / cảnh 2 dính cảnh 1).
   - Chạy thử 3 lần Hồng treo gió trên Muse, lần 3 đạt (~5.5 phút / video 30s).
   - Phân tích: HNDWorkflow/HND worflows export/5_hieu_pov_aio/PHAN_TICH_HIEU_POV_AIO.md

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



Khuya 26/11/10 – sáng 26/11/11: mẫu Hieu POV AIO

4. Mẫu mới "Hieu POV AIO" — video review sản phẩm góc nhìn thứ nhất
Chuyển từ Flow App "Review POV AIO" (fastaivn.com/flow-apps/u8xd). File ReviewPovAllInOne.js chỉ là Flow SDK nên quy trình được dựng lại từ video thành phẩm (cắt cảnh, khung hình, chép lời thoại).
Nằm ở nhóm "Review POV (FastAIVN)" trong lưới card, có ảnh thu nhỏ và video xem trước. Nút 🧩 Sơ đồ mở sơ đồ 10 node; 📚 Mẫu Workflow trong Sơ đồ khối cũng liệt kê mẫu này.
Cách dùng: tải ảnh sản phẩm (ô 📦, ô 🔍 tùy chọn), sửa vài dòng ô 🎯 Brief (sản phẩm, điểm nổi bật, phong cách lời thoại HYPE / TÒ MÒ / ASMR, giọng đọc), ô 🏠 có sẵn ảnh góc bàn → Chạy toàn bộ.
App tự viết 3 cảnh 10 giây (Hook khoe hộp → Cận cảnh → Trải nghiệm & chốt đơn), tạo ảnh khung hình rồi video từng cảnh, ghép thành ~30 giây. Chạy thử Hồng treo gió: ~5,5 phút / video.
Mẫu giờ khai báo được flowGraphId (sơ đồ dựng sẵn) và preview (ảnh / video card).

5. Sửa node AI viết kịch bản (Gemini Script) — áp dụng cho mọi workflow
AI trả thiếu cảnh (câu trả lời dài bị cắt) thì app tự nhờ viết tiếp cảnh còn thiếu. Trước đây cảnh 3 lặp lời cảnh 2 và mất câu chốt đơn.
Tách cảnh theo cả tiêu đề "CẢNH x/y" nằm giữa dòng và bỏ đoạn trùng. Trước đây AI dán lại cảnh 1 vào cuối cảnh 2 nên cảnh 2 đọc 2 câu.

6. Giữ đúng bao bì và màu sản phẩm (từ lượt chạy Hồng treo gió VijiFarm của bạn)
Lỗi: hộp bị vẽ lại, quả nâu sẫm thay vì vàng cam, cảnh 3 lộ môi.
Nguyên nhân: Brief còn chữ mẫu "phủ phấn trắng" nên AI tả quả "cam nâu"; ánh sáng "ấm buổi tối"; prompt bảo xoay nghiêng hộp; lệnh tạo ảnh khung hình đòi "nhìn rõ mặt".
Đã sửa:
Brief bỏ thông tin điền sẵn, để AI tả sản phẩm chỉ theo ảnh; ánh sáng ban ngày trung tính; hộp giữ thẳng, mặt in hướng ống kính, không xoay lật; mỗi cảnh có mục Bao bì và Màu sản phẩm giống nhau.
Khi có ảnh khóa sản phẩm, khóa ưu tiên ảnh nhắc thêm giữ màu thật và hình in bao bì.
Cảnh không có nhân vật thì lệnh tạo ảnh khung hình không đòi "nhìn rõ mặt" nữa.
Kết quả cùng ảnh VijiFarm: điểm khớp hộp 11 → 454, cảnh 3 giữ hộp đúng 20/21 khung hình, quả vàng cam, hết lộ môi. Video vẫn tối hơn ảnh gốc vì ảnh góc bàn chụp buổi tối.
Workflow đã mở trước đó vẫn giữ Brief cũ: mở lại mẫu hoặc xóa chữ "phủ phấn trắng…" trong ô 🎯 Brief.

7. Tài liệu (ngoài mã nguồn)
Phân tích app POV AIO: HNDWorkflow/HND worflows export/5_hieu_pov_aio/PHAN_TICH_HIEU_POV_AIO.md
Báo cáo giữ bao bì & màu: HNDWorkflow/HND worflows export/6_pov_giu_bao_bi_mau/BAO_CAO_GIU_BAO_BI_MAU.md
Word hướng dẫn làm tay: HNDWorkflow/HuongDan_POV_HongTreoGio/FastAIVN - Huong dan thuc hanh video POV review Hong treo gio.docx

File thay đổi: data/hieuPovAio.flow.json, data/fastaivnWorkflowTemplates.ts (mới), services/nodeFlow/runtime.ts, flowIO.ts, fromTemplate.ts,
types/workflow.ts, components/WorkflowStudio.tsx, WorkflowTemplateGallery.tsx, NodeFlowStudio.tsx, public/workflow-thumbs/fastaivn-*.
Vẫn chưa commit.