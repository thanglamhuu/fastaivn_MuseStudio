/** Không nêu giá: nhà cung cấp đổi giá sau khi video đăng → video nêu giá cũ vi phạm chính sách sàn. */
export const NO_PRICE_RULE =
  'KHÔNG nêu GIÁ hay bất kỳ con số tiền nào (đ, k, nghìn, triệu, % giảm giá) trong lời thoại, chữ trên hình hay mô tả; ' +
  'muốn nói về giá chỉ dùng cách nói chung chung không con số (vd. "giá tốt", "giá xưởng", "xem giá ở giỏ hàng").';

// Luật CỨNG / MỀM cho AI viết kịch bản (rút từ app review tại xưởng 1.12): tự phân loại sản phẩm để mô tả thao tác
// đúng vật lý — giảm lỗi video làm sản phẩm cứng bị méo / bóp, hoặc sản phẩm mềm cứng đơ như nhựa.
// 13/11: thêm nhóm BÁN CỨNG (dép / đồ nhựa dẻo, cao su đúc) và bỏ gợi ý bóp / uốn — AI video vẽ lại sản phẩm khi bị bóp nên càng lệch mẫu.
export const PRODUCT_PHYSICS_RULE =
  'LUẬT VẬT LIỆU SẢN PHẨM (tự phân loại theo ảnh + tên): ' +
  'SẢN PHẨM CỨNG (đồ điện, máy móc, nồi, hộp nhựa / kim loại / thủy tinh, điện thoại, mũ bảo hiểm, dụng cụ…) → mọi thao tác gõ, ấn, xoay, ' +
  'thả đều GIỮ NGUYÊN hình dạng vỏ, bề mặt cứng cáp, TUYỆT ĐỐI không cong, móp, méo, bóp lại. ' +
  'SẢN PHẨM BÁN CỨNG (dép / giày, đồ nhựa dẻo, cao su / silicon đúc, ốp, đồ chơi nhựa…) → GIỮ NGUYÊN FORM đúc sẵn như trong ảnh, chỉ cầm, ' +
  'xoay, lật, đưa sát camera; KHÔNG viết hành động bóp, vặn, gập đôi, kéo giãn. ' +
  'SẢN PHẨM MỀM (vải, quần áo, khẩu trang, khăn, đệm mút, màng bọc…) → được rủ, nhăn, co giãn tự nhiên theo tay / cơ thể ' +
  'nhưng giữ đúng chất liệu, màu, họa tiết, chữ in.';

/**
 * Cách AI mô tả NGOẠI HÌNH sản phẩm (ô "visual") để AI video vẽ lại đúng sản phẩm. Lỗi thật 13/11: "dép tổ ong" (tên gọi dân gian của
 * dép nhựa đục lỗ) → muse.ai vẽ dép có hoa văn LỤC GIÁC kiểu tổ ong, khác hẳn ảnh mẫu (lỗ vuông nhỏ đan lưới).
 */
export const PRODUCT_VISUAL_SPEC =
  'mô tả NGOẠI HÌNH để AI video vẽ lại ĐÚNG sản phẩm, 50-80 từ, CHỈ tả cái NHÌN THẤY trong ảnh, theo thứ tự: ' +
  '(1) loại sản phẩm gọi bằng từ trung tính + hình dáng tổng thể; (2) từng bộ phận và tỉ lệ (quai / thân / đế / nắp / tay cầm…); ' +
  '(3) họa tiết, lỗ, gân, chữ nổi: HÌNH GÌ (tròn, vuông, thoi…), to hay nhỏ, xếp thế nào; (4) chất bề mặt (bóng / nhám / trong), dày hay mỏng; ' +
  '(5) màu: ảnh có nhiều chiếc / nhiều màu thì ghi "cùng MỘT mẫu, các màu: …". ' +
  'KHÔNG dùng tên gọi dân gian / tên thương mại để tả hình (vd. "dép tổ ong" chỉ là TÊN GỌI — phải tả đúng hình lỗ thật trong ảnh, ' +
  'không viết "tổ ong" hay "lục giác" nếu lỗ không phải lục giác). Không nêu công dụng, size, giá';

/** Luật viết phần hình ảnh của cảnh để sản phẩm không bị vẽ sai / biến dạng. */
export const PRODUCT_SCENE_RULE =
  'GIỮ ĐÚNG SẢN PHẨM trong "prompt": gọi sản phẩm bằng LOẠI + đặc điểm nhìn thấy trong ảnh (đúng như "product.visual"), KHÔNG dùng tên dân gian / ' +
  'tên thương mại dễ làm AI vẽ sai hình (vd. viết "dép nhựa quai ngang đục lỗ vuông nhỏ", không viết "dép tổ ong"); ' +
  'mỗi cảnh tối đa 1-2 chiếc / đôi sản phẩm ở tiền cảnh, màu phải là màu CÓ trong ảnh mẫu, ghi rõ màu nào; sản phẩm luôn nhìn rõ, đủ sáng, ' +
  'không bị tay che quá nửa; ưu tiên hành động cầm, xoay chậm, lật, đưa sát camera, đặt lên bàn; hạn chế cảnh sản phẩm rất nhỏ ở xa ' +
  'hoặc bị bóp / uốn; KHÔNG yêu cầu chữ, phụ đề, nhãn dán, biểu tượng hiện trên màn hình (kêu gọi xem giỏ hàng thì nhân vật chỉ tay về góc trái và NÓI, không vẽ biểu tượng giỏ hàng / nút bấm); sản phẩm người dẫn cầm ở mọi cảnh là CÙNG MỘT chiếc, cùng màu, trừ khi yêu cầu khoe nhiều màu; thùng / hộp đựng (nếu có) là hộp TRƠN, không in thông số, giá hay % giảm giá.';
