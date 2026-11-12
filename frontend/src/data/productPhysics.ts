// Luật CỨNG / MỀM cho AI viết kịch bản (rút từ app review tại xưởng 1.12): tự phân loại sản phẩm để mô tả thao tác
// đúng vật lý — giảm lỗi video làm sản phẩm cứng bị méo / bóp, hoặc sản phẩm mềm cứng đơ như nhựa.
export const PRODUCT_PHYSICS_RULE =
  'LUẬT VẬT LIỆU SẢN PHẨM (tự phân loại theo ảnh + tên): ' +
  'SẢN PHẨM CỨNG (đồ điện, máy móc, nồi, hộp nhựa / kim loại / thủy tinh, điện thoại, mũ bảo hiểm, dụng cụ…) → mọi thao tác gõ, ấn, xoay, ' +
  'thả đều GIỮ NGUYÊN hình dạng vỏ, bề mặt cứng cáp, TUYỆT ĐỐI không cong, móp, méo, bóp lại. ' +
  'SẢN PHẨM MỀM (vải, quần áo, khẩu trang, khăn, đệm mút, màng bọc, găng cao su…) → được co giãn, uốn, nhăn tự nhiên theo tay / cơ thể ' +
  'nhưng giữ đúng chất liệu, màu, họa tiết, chữ in. Ghi rõ điều này trong mô tả hành động của từng cảnh.';
