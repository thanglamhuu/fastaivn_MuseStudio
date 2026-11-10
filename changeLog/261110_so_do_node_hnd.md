26/11/10 — Sơ đồ Node kiểu HND (tab 🧩 Workflow làm clip → 🔗 Sơ đồ Node (kiểu HND))

Thay cho "Sơ đồ khối" cũ (chỉ dịch sang pipeline tuyến tính, chưa chạy được đúng nghĩa). Sơ đồ khối cũ vẫn giữ ở mục "🧩 Sơ đồ khối (cũ)".

1. 12 loại node như HND Muse AI, cổng nối có kiểu (text / image / video, tô màu dây):
   Prompt · Upload Image (khóa Nhân vật / Trang phục / Sản phẩm, để trống = AI tự tạo ảnh, lấy ảnh từ thư viện nhân vật)
   · Gemini Script (AI viết N đoạn prompt theo khung kịch tính, mỗi đoạn 1 cổng ra; Gemini/OpenAI, dự phòng muse-chat)
   · Generate Image (Text→Image / Image→Image) · Generate Video (Text / Image / Reference / Frame→Frame)
   · Upscale Image 2K/4K · Upscale Video 1080P/4K · Merge Video (N cổng) · Trích frame cuối
   · Xóa logo ảnh / video (chọn 4 góc) · Result / Output.
2. Bộ chạy DAG trong trình duyệt: song song theo số luồng tài khoản Muse, node lỗi chặn node phía sau,
   ⏩ Chạy tiếp (chỉ node chưa xong), ♻️ Chạy lại từ node, ▶ Chạy riêng node, ⏹ Dừng. Kết quả lưu trong node.
3. Ảnh Upload Image phía trước tự gửi kèm mọi node Generate (Reference-to-Video, thứ tự Nhân vật → Trang phục → Sản phẩm);
   prompt chưa có bảng ánh xạ "Ảnh #N" thì tự dựng.
4. 📚 Mẫu Workflow: 13 mẫu của HND (Gia đình, Thời trang ×4, Thời trang nam, Mỹ phẩm, Ăn uống, Gia dụng, Gia dụng bếp,
   Sức khỏe, Đồ chơi, Thiết kế) — sơ đồ node đầy đủ, tải lười (src/data/hndFlowTemplates.json).
5. Nhập / xuất JSON "flow-workflow" tương thích file Export của HND (xuất kèm ảnh tải lên).
6. Gateway: POST /studio/media/upload (lưu ảnh/video data URL thành media để hậu kỳ, xuất file).
   → Cần khởi động lại gateway_server.py.

File: frontend/src/services/nodeFlow/{definitions,runtime,flowIO}.ts, frontend/src/components/NodeFlowStudio.tsx,
frontend/src/data/hndFlowTemplates.json, studio_library.py.

Đã chạy thử thật: mẫu HND Gia đình (3 ảnh nhân vật AI tự tạo → 3 cảnh → ghép 30s) và sơ đồ kiểm thử dùng đủ 11 loại node còn lại
(Gemini → ảnh → upscale/xóa logo; Image→Video → trích frame cuối → Frame→Frame → ghép → upscale → xóa logo → Result).
Ghi chú: muse.ai hiện trả mọi cảnh 10s dù chọn 4/6/8s.
