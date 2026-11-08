/**
 * Thư viện kịch bản mẫu cho video bán hàng (gộp từ 2 app: MD AI PRO và Studio Cảnh).
 * `guide` là hướng dẫn cấu trúc gửi cho AI khi viết kịch bản theo sản phẩm thật.
 * `faceless` = chỉ quay tay / sản phẩm, không lộ mặt người dẫn.
 */
export interface ScriptTemplate {
  id: string;
  name: string;
  group: string;
  guide: string;
  faceless?: boolean;
}

export const SCRIPT_TEMPLATES: ScriptTemplate[] = [
  // --- Mở đầu gây chú ý ---
  { id: 'nhin-nay', group: 'Mở đầu gây chú ý', name: 'Nhìn này! (demo)', guide: 'Câu mở đầu "Nhìn này!" kèm động tác đưa sản phẩm sát camera, sau đó khoe ngay điểm ấn tượng nhất, kết bằng lời kêu gọi mua.' },
  { id: 'dung-luot', group: 'Mở đầu gây chú ý', name: 'Đừng lướt', guide: 'Mở đầu bằng câu "Khoan đã, đừng lướt!", nêu vấn đề người xem đang gặp, đưa sản phẩm ra làm giải pháp, chốt bằng lợi ích rõ ràng.' },
  { id: 'khong-hieu-xuong', group: 'Mở đầu gây chú ý', name: 'Không hiểu xưởng làm gì', guide: 'Giọng bất ngờ, tò mò: "Không hiểu xưởng làm kiểu gì mà..." rồi lần lượt chỉ ra chi tiết chất lượng vượt mong đợi so với giá.' },
  { id: 'loi-don', group: 'Mở đầu gây chú ý', name: 'Lời đồn không đúng', guide: 'Nêu một lời đồn/định kiến phổ biến về loại sản phẩm này, rồi chứng minh trực tiếp là sai bằng thao tác với sản phẩm.' },
  { id: 'khong-nhu-mong-doi', group: 'Mở đầu gây chú ý', name: 'Không như mong đợi', guide: 'Mở đầu tưởng chê ("không như mình nghĩ"), sau đó lật lại: tốt hơn mong đợi, nêu 2-3 điểm cụ thể.' },

  // --- Giá & Deal ---
  { id: 'gio-soc', group: 'Giá & Deal', name: 'Giờ sốc hôm nay', guide: 'Tạo cảm giác khẩn cấp: deal chỉ trong hôm nay/khung giờ này, nhấn mạnh giá và số lượng có hạn, thúc giục bấm giỏ hàng.' },
  { id: 'deal-hoi', group: 'Giá & Deal', name: 'Deal hời sốc', guide: 'So sánh giá trị nhận được với số tiền bỏ ra, liệt kê nhanh những gì có trong một đơn, kết bằng "hời quá phải chốt".' },
  { id: 'tra-da', group: 'Giá & Deal', name: 'Bằng vài cốc trà đá', guide: 'So sánh giá sản phẩm với chi tiêu nhỏ hằng ngày (vài cốc trà đá), nhấn mạnh rẻ mà dùng được lâu.' },
  { id: 'gia-re-giat-minh', group: 'Giá & Deal', name: 'Giá rẻ giật mình', guide: 'Phản ứng bất ngờ khi biết giá, sau đó chứng minh chất lượng không hề rẻ tiền bằng cận cảnh chi tiết.' },
  { id: 'dung-ra-ngoai-mua', group: 'Giá & Deal', name: 'Đừng ra ngoài mua', guide: 'Khuyên đừng mua ngoài tiệm với giá cao, giới thiệu mua online rẻ hơn mà vẫn chất lượng, giao tận nhà.' },

  // --- Test & Chứng minh ---
  { id: 'test-kho', group: 'Test & Chứng minh', name: 'Test thật tại kho', guide: 'Bối cảnh kho hàng, test độ bền/chức năng ngay trước camera, nói rõ kết quả test.' },
  { id: 'test-khong-cat', group: 'Test & Chứng minh', name: 'Test trực tiếp không cắt cảnh', guide: 'Một mạch liên tục không cắt: cầm sản phẩm, thao tác test, cho thấy kết quả thật, nhấn mạnh "không cắt ghép".' },
  { id: 'truoc-sau', group: 'Test & Chứng minh', name: 'Trước và sau khi sử dụng', guide: 'Cho thấy tình trạng trước khi dùng, thao tác dùng sản phẩm, rồi kết quả sau khi dùng thật rõ ràng.' },
  { id: 'tu-chung-minh', group: 'Test & Chứng minh', name: 'Để sản phẩm tự chứng minh', guide: 'Ít lời, để thao tác và cận cảnh sản phẩm nói lên chất lượng; lời thoại ngắn gọn, tự tin.' },
  { id: 'cam-hang-xuong', group: 'Test & Chứng minh', name: 'Cầm hàng kiểm tra tại xưởng', guide: 'Tại xưởng, cầm sản phẩm kiểm tra từng chi tiết (đường may/chất liệu/kết cấu), giải thích vì sao đạt chuẩn.' },

  // --- Review & Trải nghiệm ---
  { id: 'hang-moi-mo-hop', group: 'Review & Trải nghiệm', name: 'Hàng mới về & mở hộp', guide: 'Hào hứng báo hàng mới về, mở hộp, lấy sản phẩm ra, khoe chi tiết đầu tiên gây ấn tượng.' },
  { id: 'review-7-ngay', group: 'Review & Trải nghiệm', name: 'Review sau 7 ngày sử dụng', guide: 'Chia sẻ trải nghiệm thật sau 7 ngày: điều thích nhất, thay đổi nhận thấy, có nên mua không.' },
  { id: 'mua-thu-to-mo', group: 'Review & Trải nghiệm', name: 'Mua thử vì tò mò', guide: 'Kể lý do mua thử vì tò mò, phản ứng khi dùng lần đầu, kết luận bất ngờ tích cực.' },
  { id: 'diem-khong-thich', group: 'Review & Trải nghiệm', name: 'Điểm tôi không thích', guide: 'Review trung thực: nêu 1 điểm nhỏ chưa thích (không nghiêm trọng), rồi 2-3 điểm rất thích, kết luận vẫn đáng mua.' },
  { id: 'ba-cach-dung', group: 'Review & Trải nghiệm', name: 'Ba cách dùng một sản phẩm', guide: 'Trình diễn 3 cách dùng/phối khác nhau của cùng một sản phẩm, mỗi cách một khoảnh khắc rõ ràng.' },
  { id: 'dung-sai', group: 'Review & Trải nghiệm', name: 'Dùng sai bao lâu nay', guide: 'Chỉ ra cách dùng sai phổ biến, rồi hướng dẫn cách dùng đúng với sản phẩm này.' },
  { id: 'loi-nho-phien-toai', group: 'Review & Trải nghiệm', name: 'Một lỗi nhỏ gây phiền toái', guide: 'Nêu một phiền toái nhỏ hằng ngày, sản phẩm giải quyết gọn gàng như thế nào.' },
  { id: 'meo-gia-dinh', group: 'Review & Trải nghiệm', name: 'Mẹo gia đình ít ai biết', guide: 'Chia sẻ như một mẹo hay ít người biết, trong đó sản phẩm là công cụ chính.' },
  { id: 'chon-mau', group: 'Review & Trải nghiệm', name: 'Chọn mẫu nào cho đúng', guide: 'Tư vấn chọn phân loại/màu/size phù hợp với từng nhu cầu, kết bằng gợi ý chọn ngay.' },
  { id: 'dung-mua-neu', group: 'Review & Trải nghiệm', name: 'Đừng mua nếu bạn thuộc nhóm này', guide: 'Đảo ngược: "đừng mua nếu bạn..." (nhóm không cần), rồi nói rõ ai sẽ cực kỳ hợp với sản phẩm.' },

  // --- Kho, xưởng & chủ shop ---
  { id: 'xuong-kho', group: 'Kho, xưởng & chủ shop', name: 'Xuống kho cho tận gốc', guide: 'Đi xuống kho, cho thấy số lượng hàng thật, cầm một sản phẩm lên giới thiệu, nhấn mạnh hàng có sẵn, giá tận gốc.' },
  { id: 'vong-xuong', group: 'Kho, xưởng & chủ shop', name: 'Đi một vòng xưởng', guide: 'Dẫn người xem đi một vòng xưởng/cửa hàng, dừng lại ở sản phẩm chính và giới thiệu.' },
  { id: 'don-hang-hom-nay', group: 'Kho, xưởng & chủ shop', name: 'Đơn hàng hôm nay có gì', guide: 'Đóng gói đơn hàng hôm nay, khoe sản phẩm trước khi cho vào hộp, nhắc khách đặt nhanh.' },
  { id: 'dap-hop-cua-hang', group: 'Kho, xưởng & chủ shop', name: 'Đập hộp ngay tại cửa hàng', guide: 'Mở hộp ngay tại quầy cửa hàng, phản ứng tự nhiên, khoe sản phẩm thật.' },
  { id: 'chu-shop-noi-that', group: 'Kho, xưởng & chủ shop', name: 'Chủ shop nói thật', guide: 'Chủ shop thẳng thắn nói thật về sản phẩm: chất lượng, giá, vì sao bán chạy.' },

  // --- Hỏi đáp & bình luận ---
  { id: 'khach-hoi-kho', group: 'Hỏi đáp & bình luận', name: 'Khách hỏi khó chủ shop', guide: 'Khách đặt câu hỏi khó về sản phẩm, chủ shop trả lời thuyết phục kèm thao tác chứng minh.' },
  { id: 'tra-loi-binh-luan', group: 'Hỏi đáp & bình luận', name: 'Trả lời bình luận nghi ngờ', guide: 'Đọc một bình luận nghi ngờ ("chắc hàng lởm"), rồi phản hồi bằng cách test/khoe chi tiết thật.' },
  { id: 'cau-hoi-nhieu-nguoi', group: 'Hỏi đáp & bình luận', name: 'Một câu hỏi nhiều người hỏi', guide: 'Trả lời câu hỏi được hỏi nhiều nhất về sản phẩm một cách ngắn gọn, rõ ràng.' },
  { id: 'khach-quay-lai', group: 'Hỏi đáp & bình luận', name: 'Khách quay lại mua thêm', guide: 'Kể chuyện khách đã mua rồi quay lại mua thêm, lý do họ hài lòng.' },

  // --- Gia đình & tiểu phẩm ---
  { id: 'qua-tang-gia-dinh', group: 'Gia đình & tiểu phẩm', name: 'Quà tặng gia đình', guide: 'Bối cảnh tặng quà cho người thân, phản ứng vui khi nhận, sản phẩm là món quà ý nghĩa.' },
  { id: 'chong-che-vo', group: 'Gia đình & tiểu phẩm', name: 'Chồng chê vợ mua linh tinh', guide: 'Tiểu phẩm: chồng chê vợ mua đồ linh tinh, sau đó chính chồng lại thích/dùng sản phẩm.' },
  { id: 'me-chong-khen', group: 'Gia đình & tiểu phẩm', name: 'Mẹ chồng bất ngờ khen', guide: 'Tiểu phẩm: mẹ chồng khó tính bất ngờ khen sản phẩm con dâu mua.' },
  { id: 'vo-chong-tranh-dung', group: 'Gia đình & tiểu phẩm', name: 'Hai vợ chồng tranh dùng', guide: 'Tiểu phẩm vui: hai vợ chồng giành nhau dùng sản phẩm vì quá thích.' },
  { id: 'con-hoi-kho', group: 'Gia đình & tiểu phẩm', name: 'Con hỏi một câu khó đỡ', guide: 'Đứa trẻ hỏi một câu ngây ngô về sản phẩm, người lớn trả lời và khoe công dụng.' },
  { id: 'tieu-pham-hieu-lam', group: 'Gia đình & tiểu phẩm', name: 'Tiểu phẩm hiểu lầm hài hước', guide: 'Một tình huống hiểu lầm hài hước xoay quanh sản phẩm, kết thúc bằng điểm mạnh của sản phẩm.' },

  // --- Livestream ---
  { id: 'live-test-yeu-cau', group: 'Livestream', name: 'Livestream: Test theo yêu cầu', guide: 'Không khí livestream: đọc yêu cầu của người xem, test sản phẩm ngay theo yêu cầu đó.' },
  { id: 'live-go-ly-do', group: 'Livestream', name: 'Livestream: Gỡ ba lý do chưa mua', guide: 'Livestream: lần lượt gỡ 3 lý do khiến khách còn chần chừ (giá, chất lượng, hợp hay không).' },

  // --- Không lộ mặt (chỉ tay & sản phẩm) ---
  { id: 'tay-lap-bay', group: 'Không lộ mặt (chỉ tay)', name: 'Tay review: lắp & bày', faceless: true, guide: 'Chỉ quay tay và sản phẩm, không lộ mặt: lắp/bày sản phẩm từng bước, cận cảnh thao tác, nhạc nền/ASMR.' },
  { id: 'tay-mo-hop-qua', group: 'Không lộ mặt (chỉ tay)', name: 'Tay review: mở hộp quà & chi tiết', faceless: true, guide: 'Chỉ quay tay: mở hộp quà, lấy sản phẩm ra, xoay các góc để khoe chi tiết, không lộ mặt.' },
];

export const TEMPLATE_GROUPS = Array.from(new Set(SCRIPT_TEMPLATES.map((t) => t.group)));
