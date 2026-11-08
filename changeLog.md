Các thay đổi P0, P1 trong i:/Claude/Srcs/MuseStudio:

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