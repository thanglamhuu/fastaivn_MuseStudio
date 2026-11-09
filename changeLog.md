26/11/09
Những thay đổi sáng nay trong i:/Claude/Srcs/MuseStudio (chưa commit):

1. Màn hình ⚙️ Cài đặt mới

Gom các mục: Tài khoản Muse (chuyển từ tab cũ sang), Nhân vật, Sản phẩm, Giọng đọc, Trợ lý AI, Chung.
Mục Chung hiển thị thư mục lưu video (có nút mở), tình trạng FFmpeg và địa chỉ Gateway.

2. Thư viện nhân vật

Mỗi nhân vật có tên gọi, mô tả ngoại hình, ảnh khóa mặt (nhiều ảnh, chọn được ảnh chính), trang phục cố định.
Mỗi nhân vật có giọng đọc cố định và cảm xúc mặc định.
Prompt nhắc tên nhân vật (hoặc @tên) thì cảnh đó tự dùng ảnh và giọng của nhân vật đó.

3. Thư viện sản phẩm

Lưu tên, giá, link, mô tả, ngoại hình và ảnh sản phẩm để dùng lại.
Sản phẩm vừa đọc từ link có nút “Lưu vào thư viện”.
Màn hình tạo video có thêm 2 ô chọn “Nhân vật chính” và “Sản phẩm” lấy từ thư viện.

4. Giọng đọc (12 hồ sơ Matrix, chỉnh cho Muse)

Ô chọn giọng chia nhóm Nam trước, Nữ sau.
Mỗi hồ sơ ứng với một giọng gốc tiếng Việt của Muse. Prompt được chèn [Voice Profile: …] trước lời thoại, và Gateway đặt giọng Muse cho từng cảnh.
Nhân vật có thể chọn một giọng gốc khác trong 40 giọng của Muse.
Mỗi thẻ cảnh có badge giọng.
App hiện cảnh báo khi một lô trộn nhiều giọng mà tài khoản chạy hơn 1 luồng, vì Muse đặt giọng theo tài khoản nên giọng có thể bị lẫn.

5. Khung 9:16 mặc định

Áp dụng cho thẻ nhân vật, sản phẩm, ảnh tham chiếu, thẻ cảnh, clip đã render, lịch sử video và ảnh sản phẩm.
Chọn tỉ lệ khác (vd. 16:9) thì khung tự đổi theo.

6. Trợ lý viết kịch bản AI

Có hướng dẫn lấy Gemini API key. Dán nhiều key (mỗi dòng 1 key); key nào hết hạn mức hoặc lỗi thì tự chuyển sang key kế tiếp.
Hỗ trợ thêm endpoint tương thích OpenAI.
Thứ tự thử: Gemini → OpenAI → muse-chat (cách viết cũ, dùng làm dự phòng). Dưới kịch bản ghi rõ kịch bản được tạo từ nguồn nào.
Thêm 3 kiểu kịch bản: TVC 5 bước, Phim ngắn (AI được báo tên các nhân vật trong thư viện), POV Affiliate. Vẫn giữ 44 mẫu cũ.

7. Bốn cách ghép ảnh tham chiếu (khối 2b, có kho ảnh)

Dùng chung cho mọi cảnh.
Ghép theo nhóm: cảnh 1 dùng nhóm 1, cảnh 2 dùng nhóm 2…
Khung đầu → khung cuối: cảnh i đi từ ảnh i tới ảnh i+1.
Khóa người mẫu + xoay vòng sản phẩm hoặc trang phục (dùng cho lookbook).

8. Đọc link Shopee/TikTok (đã chạy thử với 2 link bạn gửi)

Thêm dò giá dạng ₫108.000 trên trang khi không có dữ liệu giá có cấu trúc.
Sửa ảnh TikTok bị trùng (cùng ảnh ở 2 kích thước); ảnh nhỏ được đổi sang bản 800px.
Lấy mô tả Shopee từ phần “MÔ TẢ SẢN PHẨM” trên trang khi trang không có sẵn mô tả.

9. Gateway và test

Thêm studio_ai.py. Thông tin task video ghi lại giọng đã dùng.
Thêm test mới; tổng 19 test qua.
README đã cập nhật.

Chưa kiểm chứng

Chưa thử Gemini với key thật.
Chưa nghe thử chất lượng giọng trên Muse.
Phần lấy mô tả Shopee mới kiểm tra bằng chữ đã đọc từ trang, chưa chạy lại qua Gateway của bạn. Cần khởi động lại Gateway (run_dev.bat) để dùng code mới.



26/11/08 Các thay đổi P0, P1 trong i:/Claude/Srcs/MuseStudio:

P0: Không mất việc, không mất file

Lưu tiến trình lên Gateway: danh sách cảnh, prompt, ảnh tham chiếu và sản phẩm được lưu thêm trên máy chủ, nên ảnh lớn không còn bị mất khi localStorage đầy.
Hai kiểu dừng:
“Dừng sau cảnh đang chạy”: không nhận cảnh mới, cảnh đang tạo vẫn chạy nốt.
“Dừng hẳn”: huỷ luôn cảnh đang tạo.
Sửa từng cảnh: sửa prompt ngay trên thẻ cảnh rồi bấm “Chạy lại” hoặc “Tạo lại”.
Giữ bản cũ: khi tạo lại một cảnh, video trước đó vẫn xem được trong mục “Bản tạo trước”.
Tự lưu video: mỗi cảnh xong được tự lưu vào Downloads\MuseStudio\<Tên dự án>\Canh_01.mp4, có nút mở thư mục.
Sửa lỗi nối cảnh: khung đầu giờ luôn lấy từ khung cuối của cảnh liền trước, kể cả khi chạy lại cảnh lỗi.

P1: Chạy nhiều tài khoản thông minh hơn và thêm tính năng

Trang tài khoản hiện rõ trạng thái: “Giới hạn video” hoặc “Chặn video theo vùng” kèm đồng hồ đếm ngược, và “Hết hạn mức tuần”.
Tự né tài khoản lỗi:
tài khoản bị giới hạn video chỉ bị bỏ qua khi tạo video, vẫn tạo ảnh được;
tài khoản hết hạn mức tuần thì bị bỏ qua.
Chia việc ưu tiên tài khoản còn nhiều hạn mức: khi các tài khoản đang chạy số việc bằng nhau.
Số luồng “Tự động” không tính các tài khoản đang bị chặn video hoặc đã hết hạn mức.
Ghép video: nút “Ghép N cảnh” hoặc tuỳ chọn tự ghép khi xong cả lô, cho ra 1 video hoàn chỉnh (cần FFmpeg).
Chọn giọng đọc Muse cho cả lô: để các cảnh không bị đổi giọng giữa chừng.
Chế độ chạy không cần Chrome (thử nghiệm): bật bằng MUSE2API_DRIVER=http. Chưa thử với muse.ai thật, nên mặc định vẫn dùng Chrome.