// Mẫu workflow có sẵn cho video affiliate (dựa trên nhóm mẫu của MV1 Muse AI, viết lại cho MuseStudio).
import type { WorkflowTemplate } from '../types/workflow';

const base = {
  builtin: true,
  duration: 8 as const,
  aspectRatio: '9:16' as const,
  cameraMotion: '',
  autoMerge: true,
  rotateProductImages: false,
  chainEndFrame: false,
  faceless: false,
  withDialogue: true,
};

export const BUILTIN_WORKFLOWS: WorkflowTemplate[] = [
  {
    ...base,
    id: 'wf-tvc5',
    name: 'TVC / Review 5 bước',
    icon: '📣',
    category: 'Bán hàng',
    description: 'Hook 3 giây → giới thiệu → cận cảnh chi tiết → trải nghiệm → chốt đơn. Hợp hầu hết ngành hàng.',
    scriptMode: 'tvc5',
    extraNote: '',
    sceneCount: 5,
  },
  {
    ...base,
    id: 'wf-unbox-asmr',
    name: 'Đập hộp Unboxing ASMR',
    icon: '📦',
    category: 'Không lộ mặt',
    description: 'Chỉ thấy tay mở hộp, cận cảnh sản phẩm, âm thanh ASMR, ít lời. Hợp mỹ phẩm, đồ công nghệ, blindbox.',
    scriptMode: 'pov_aff',
    extraNote:
      'Video ASMR đập hộp: tiếng bóc seal, mở nắp, sột soạt giấy gói rõ ràng; lời thoại rất ngắn, thì thầm. Cảnh cuối đặt sản phẩm lên bàn đẹp mắt.',
    sceneCount: 4,
    faceless: true,
    cameraMotion: 'Close-up Shot, Slow Dolly In',
  },
  {
    ...base,
    id: 'wf-pov-review',
    name: 'POV Review nhanh',
    icon: '👀',
    category: 'Không lộ mặt',
    description: 'Góc nhìn thứ nhất, tay cầm sản phẩm review như người thật, nhịp nhanh. Hợp đồ ăn vặt, gia dụng.',
    scriptMode: 'pov_aff',
    extraNote: '',
    sceneCount: 4,
    faceless: true,
  },
  {
    ...base,
    id: 'wf-truoc-sau',
    name: 'Trước & Sau khi dùng',
    icon: '🔁',
    category: 'Bán hàng',
    description: 'Vấn đề trước khi dùng → thao tác với sản phẩm → kết quả rõ ràng. Hợp gia dụng, vệ sinh, làm đẹp.',
    scriptMode: 'template',
    scriptTemplateId: 'truoc-sau',
    extraNote: 'Cảnh đầu cho thấy vấn đề thật rõ, cảnh cuối cho thấy kết quả tương phản mạnh.',
    sceneCount: 4,
  },
  {
    ...base,
    id: 'wf-lookbook',
    name: 'Lookbook nhiều mẫu / màu',
    icon: '👗',
    category: 'Thời trang',
    description:
      'Khóa người mẫu, mỗi cảnh thay một ảnh sản phẩm (mẫu / màu khác). Ảnh sản phẩm trong thư viện được xoay vòng qua các cảnh.',
    scriptMode: 'tvc5',
    extraNote:
      'Video lookbook thời trang: cùng một người mẫu, mỗi cảnh mặc / dùng một mẫu khác của sản phẩm theo ảnh đính kèm của cảnh đó (ghi rõ cảnh nào mặc mẫu nào, tả đúng mẫu theo ảnh), tạo dáng, xoay người khoe form. Lời thoại ngắn khen chất liệu và cách phối.',
    sceneCount: 5,
    rotateProductImages: true,
    cameraMotion: 'Medium Shot, Gentle Handheld Movement',
  },
  {
    ...base,
    id: 'wf-street-walk',
    name: 'Đi bộ tạo dáng Street Look',
    icon: '🚶',
    category: 'Thời trang',
    description: 'Người mẫu đi bộ trên phố, quay lưng, tạo dáng slow-mo. Các cảnh nối khung cuối → khung đầu cho liền mạch.',
    scriptMode: 'short_film',
    extraNote:
      'Không có lời thoại. Người mẫu đi bộ tự tin trên phố đẹp, quay lưng, ngoái lại, tạo dáng slow-motion; mỗi cảnh nối tiếp động tác của cảnh trước.',
    sceneCount: 4,
    withDialogue: false,
    chainEndFrame: true,
    cameraMotion: 'Medium Shot, Gentle Handheld Movement',
  },
  {
    ...base,
    id: 'wf-gia-dinh',
    name: 'Tiểu phẩm gia đình hài',
    icon: '👨‍👩‍👧',
    category: 'Câu chuyện',
    description:
      'Tình huống vui trong gia đình xoay quanh sản phẩm. Dùng nhân vật trong thư viện (gọi đúng tên để giữ mặt + giọng).',
    scriptMode: 'short_film',
    extraNote:
      'Tiểu phẩm gia đình Việt hài hước, đáng yêu: có mâu thuẫn nhỏ (chê mua đồ linh tinh, tranh nhau dùng...) rồi sản phẩm giải quyết; kết vui vẻ và nhắc mua. ' +
      'Mỗi câu thoại ghi rõ AI nói (CHỈ @Tên nói, người khác ngậm miệng), giọng đúng giới tính / tuổi người nói; nhân vật chính luôn quay mặt về camera.',
    sceneCount: 5,
  },
  {
    // Công thức rút từ phân tích 5 reel sitcom gia đình > 500k view (taiLieu/PHAN_TICH_PHIM_GIA_DINH_NHO.md) — học CẤU TRÚC, không chép nội dung
    ...base,
    id: 'wf-phim-gia-dinh-nho',
    name: 'Phim Gia Đình Nhỏ',
    icon: '👨‍👩‍👧',
    category: 'Gia đình',
    description:
      'Sitcom gia đình 12 giây: bé gái nghịch theo logic trẻ con → bố mẹ phản ứng phóng đại → lật cảm xúc (ồn ào hoá ngọt) → chốt bằng nụ cười / cái hôn. ' +
      'Kể bằng hình ảnh, ít thoại. Chọn 3 nhân vật Bố, Mẹ, Bé gái trong thư viện; ô ý tưởng để trống thì AI tự chọn chủ đề.',
    scriptMode: 'short_film',
    duration: 6,
    sceneCount: 2,
    cameraMotion: 'Medium shot, static camera, eye level',
    setting: 'Căn nhà Việt hiện đại sáng sủa, sạch, gọn (phòng khách sofa xám / bếp - bàn ăn / phòng tắm trắng), ánh sáng ban ngày tự nhiên',
    extraNote:
      'CÔNG THỨC PHIM GIA ĐÌNH NHỎ (sitcom 12 giây, 2 cảnh × 6 giây, video dọc 9:16):\n' +
      '- CẢNH 1 (0-6 s): HOOK 0-2 s = một hành động lạ / một ĐẠO CỤ CHÍNH gây tò mò xuất hiện ngay (nồi + muỗng, khay bát, lát bánh, son môi…); ' +
      'THIẾT LẬP 2-4 s = khung cảnh gia đình bình thường, cả 3 người có mặt hoặc sắp có mặt; LEO THANG 4-6 s = bé gái làm việc theo LOGIC TRẺ CON, càng lúc càng rõ.\n' +
      '- CẢNH 2 (6-12 s): PHẢN ỨNG = bố hoặc mẹ phản ứng bằng biểu cảm PHÓNG ĐẠI (sững sờ, giật mình, dỗi, bật cười); LẬT = cảm xúc đổi chiều ' +
      '(ồn ào → hôn má, dỗi → được ưu ái, nghịch → cười); CHỐT = dừng ở nụ cười, cái hôn hoặc gương mặt sững sờ — KHÔNG giải thích, KHÔNG mắng, KHÔNG bài học đạo đức.\n' +
      'VAI TRÒ CỐ ĐỊNH: BÉ GÁI = trung tâm, gây chuyện bằng hành động, ít nói nhưng biểu cảm lớn; BỐ = người "chịu trận", hiền, chiều con, phản ứng bằng mặt + hành động; ' +
      'MẸ = người chứng kiến, giữ nhịp ấm (cười, giả vờ ghen, sững sờ), ít khi gây chuyện chính.\n' +
      'THOẠI: kể bằng hình ảnh trước, thoại sau; tối đa 1-2 câu RẤT NGẮN mỗi cảnh, xưng hô bố - mẹ - con tự nhiên; câu của bé là câu chốt hoặc gợi ra cú chốt; ' +
      'bố mẹ chỉ cảm thán ngắn. Mỗi câu ghi rõ AI nói (CHỈ @Tên nói, người khác ngậm miệng), giọng đúng giới tính / tuổi (bé = giọng trẻ em).\n' +
      'HÌNH ẢNH: máy gần như CỐ ĐỊNH, trung cảnh ngang tầm mắt thấy cả 3 người; nhà sáng sạch hiện đại; trang phục cả nhà tông màu đồng điệu (vd. đồ ngủ sọc giống nhau); ' +
      'MỖI clip MỘT đạo cụ chính; biểu cảm cuối đủ lớn để hiểu khi tắt tiếng; không chữ lớn che mặt.\n' +
      'Ý TƯỞNG trống thì tự chọn 1 chủ đề kiểu: bé tô son cho bố đang ngủ; bé trèo ghế lấy kẹo bố giấu rồi chia bố 1 viên; bé "gấp" quần áo vào tủ lạnh "cho mát"; ' +
      'bé bắt bố chơi bác sĩ, nghe tim bằng muỗng, kê đơn "bố phải ăn kem"; bé lén bỏ đường vào nồi canh của mẹ; bé giấu dép bố, bố đi nhầm dép mẹ ra cửa; ' +
      'bé gọi video khoe bà "bố đang rửa bát" nhưng bố đang ngủ; bé cắt tóc búp bê rồi định cắt tóc bố.',
  },
  {
    ...base,
    id: 'wf-review-7-ngay',
    name: 'Review sau 7 ngày dùng',
    icon: '🗓',
    category: 'Bán hàng',
    description: 'Chia sẻ trải nghiệm thật sau 1 tuần: điều thích nhất, thay đổi nhận thấy, có nên mua.',
    scriptMode: 'template',
    scriptTemplateId: 'review-7-ngay',
    extraNote: '',
    sceneCount: 4,
  },
];
