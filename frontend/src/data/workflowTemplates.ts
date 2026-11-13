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
    // Công thức rút từ phân tích kênh phim drama gia đình nhiều tập (taiLieu/PHAN_TICH_PHIM_DRAMA_GIA_DINH.md) — học CẤU TRÚC, không chép nội dung
    ...base,
    id: 'wf-phim-drama-gia-dinh',
    name: 'Phim Drama Gia Đình (tập 60 giây)',
    icon: '🎭',
    category: 'Câu chuyện',
    description:
      'Phim drama gia đình nhiều tập kiểu mẹ chồng – nàng dâu: mở giữa xung đột → dồn nén → sự thật → giọt nước tràn ly → phản đòn → kết treo. ' +
      'Chọn 3 nhân vật (Con dâu, Chồng, Mẹ chồng) trong Cài đặt; mỗi tập 6 cảnh × 10 giây, không bán sản phẩm.',
    scriptMode: 'short_film',
    noProduct: true,
    characterIds: ['', '', ''],
    duration: 10,
    sceneCount: 6,
    cameraMotion: 'Medium Close-up, Slow Dolly In',
    setting:
      'Biệt thự gia đình Việt Nam sang trọng tông gỗ ấm (phòng khách có đèn chùm pha lê và sofa da, bếp lớn mặt đá cẩm thạch, phòng làm việc có kệ sách gỗ), buổi tối, ánh đèn vàng ấm kiểu phim truyền hình',
    extraNote:
      'CÔNG THỨC PHIM DRAMA GIA ĐÌNH (1 tập 60 giây = 6 cảnh × 10 giây, video dọc 9:16, hình ảnh như phim truyền hình Việt Nam, điện ảnh, chân thật):\n' +
      '- CẢNH 1 HOOK: mở NGAY giữa xung đột — nhân vật chính bị coi thường / xúc phạm trước mặt người khác; câu thoại gây sốc nhất của tập nằm trong 3 giây đầu.\n' +
      '- CẢNH 2 DỒN NÉN: người thứ ba (mẹ chồng) nói thêm một câu đổ dầu vào lửa; nhân vật chính nhịn, chỉ đáp ngắn, mặt kìm nén.\n' +
      '- CẢNH 3 SỰ THẬT: cho khán giả THẤY công sức / sự hy sinh thầm lặng của nhân vật chính bằng hành động + MỘT đạo cụ (laptop, sổ chi tiêu, mâm cơm, tập hồ sơ…).\n' +
      '- CẢNH 4 GIỌT NƯỚC TRÀN LY: thêm một yêu cầu vô lý → nhân vật chính lần đầu nhìn thẳng và nói "không".\n' +
      '- CẢNH 5 PHẢN ĐÒN: nhân vật chính đưa ra bằng chứng hoặc một quyết định dứt khoát; phía bên kia sững sờ, không nói được.\n' +
      '- CẢNH 6 KẾT TREO: một chi tiết MỚI mở ra (điện thoại rung, tin nhắn, người xuất hiện ở cửa, tờ giấy trên bàn) rồi dừng ở cận mặt; KHÔNG giải quyết hết để người xem chờ tập sau.\n' +
      'VAI TRÒ: CON DÂU = nhân vật chính, hiền, giỏi, bị xem nhẹ, điềm tĩnh rồi cứng rắn dần; CHỒNG = thành đạt, vô tâm, quen được phục vụ, sĩ diện; ' +
      'MẸ CHỒNG = gia trưởng, bênh con trai, lời nói sắc. Nhân vật phụ khác (bố chồng, đồng nghiệp, bạn thân) chỉ tả bằng chữ, đứng xa / mờ.\n' +
      'THOẠI: MỖI CẢNH CHỈ MỘT NGƯỜI NÓI (1-2 câu liền nhau của cùng người đó, tổng 15-22 từ); những người còn lại im lặng, chỉ phản ứng bằng nét mặt. ' +
      'Đầu mô tả mỗi cảnh ghi rõ "CHỈ @Tên nói" rồi mới tới câu thoại trong ngoặc kép; người nói đổi qua từng cảnh theo nhịp đối đáp ' +
      '(vd. cảnh 1 @MinhKhang, cảnh 2 @BaLien, cảnh 3 @ThuHa, cảnh 4 @MinhKhang, cảnh 5 @ThuHa, cảnh 6 @ThuHa hoặc không thoại); giọng đúng giới tính / tuổi; ' +
      'câu ngắn, sắc, đời thường, đúng xưng hô gia đình Việt (mẹ – con, anh – em); KHÔNG chửi tục, KHÔNG bạo lực thể xác, KHÔNG xúc phạm vùng miền / nghề nghiệp.\n' +
      'HÌNH ẢNH: mỗi nhân vật giữ NGUYÊN trang phục và kiểu tóc như ảnh mẫu ở mọi cảnh; mỗi cảnh chỉ có đúng những nhân vật được nêu tên, mỗi người xuất hiện MỘT lần ' +
      '(không nhân bản, không thêm người lạ, không người đứng sau lưng), tối đa 3 người trong khung, ghi rõ ai đứng đâu (trái / giữa / phải); ' +
      'màn hình laptop / điện thoại quay chéo hoặc để mờ, KHÔNG cận cảnh chữ trên màn hình hay giấy tờ, thiết bị trơn không logo thương hiệu; ' +
      'trung cảnh hoặc cận cảnh ngang tầm mắt, máy tĩnh hoặc đẩy chậm vào gương mặt người đang nói; biểu cảm rõ (kìm nén, khinh khỉnh, sững sờ); ' +
      'các cảnh ở những phòng khác nhau của CÙNG một ngôi nhà; không chữ, phụ đề, logo trên màn hình.\n' +
      'THÔNG ĐIỆP: phim hư cấu, hướng tới sự tôn trọng trong gia đình; người bị coi thường giành lại tiếng nói bằng năng lực, không trả thù độc ác.\n' +
      'Ý TƯỞNG trống thì tự chọn 1 chủ đề kiểu: con dâu thức đêm làm hộ báo cáo, chồng nhận hết công trước cả nhà; mẹ chồng đòi giữ thẻ lương của con dâu; ' +
      'mâm cỗ con dâu nấu cả ngày nhưng không được ngồi cùng bàn; chồng lén đem tiền tiết kiệm chung cho em trai vay; con dâu bị bắt nghỉ việc đúng ngày được thăng chức; ' +
      'mẹ chồng chê con dâu trước mặt họ hàng, không biết căn nhà đang ở do con dâu trả góp.',
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
    // Mẫu Xưởng & Kho (rút từ app review tại xưởng 1.12): bối cảnh vẽ trước 1 lần + luật cứng / mềm khi AI viết kịch bản
    ...base,
    id: 'wf-xuong-review-4',
    name: 'Review tại xưởng 4 cảnh',
    icon: '🏭',
    category: 'Xưởng & Kho',
    description:
      'Chủ xưởng cầm hàng review ngay tại kho: Hook → chi tiết chất liệu → test công năng → kêu gọi giỏ hàng. Phía sau là kho tổng chất đầy CHÍNH sản phẩm đó (AI vẽ bối cảnh 1 lần, mọi cảnh dùng chung).',
    scriptMode: 'short_film',
    sceneCount: 4,
    cameraMotion: 'Medium Shot, Gentle Handheld Movement',
    setting: 'Kho hàng tổng rộng lớn, giá kệ kim loại nhiều tầng cao tới trần, lối đi sơn vạch vàng, đèn trần công nghiệp',
    backdrop: { id: 'kho-tong', density: 'massive' },
    extraNote: 'CÔNG THỨC REVIEW TẠI XƯỞNG / KHO (4 cảnh × 8 giây): CẢNH 1 HOOK = cầm sản phẩm đưa sát camera, câu mở theo kiểu chủ xưởng nói thật (vd. \"Không hiểu xưởng làm kiểu gì mà…\", \"Bằng vài cốc trà đá…\"), phía sau thấy rõ hàng chất đầy; CẢNH 2 CHI TIẾT & CHẤT LIỆU = cận tay gõ / xoay / miết bề mặt, khoe độ dày, đường hoàn thiện; CẢNH 3 CÔNG NĂNG = test trực tiếp tại chỗ (ấn, thả, đổ nước, chạy thử…) không cắt cảnh; CẢNH 4 CTA = chỉ xuống góc trái màn hình (giỏ hàng), nhắc giá xuất xưởng, được kiểm hàng trước khi thanh toán. Lời thoại 20-25 từ mỗi cảnh, giọng dân dã gần gũi, xưng \"em - các bác\" hoặc \"bên em - anh chị\". Người dẫn mặc đồng phục xưởng / áo polo tối màu, nhìn thẳng camera, tự tin như chủ xưởng.',
  },
  {
    ...base,
    id: 'wf-xuong-vong-kho',
    name: 'Đi một vòng kho / xưởng',
    icon: '🚶',
    category: 'Xưởng & Kho',
    description:
      'Dẫn người xem đi một vòng: cửa kho → dây chuyền → khu kiểm định → bàn đóng gói, mỗi cảnh một khu, kết ở sản phẩm chính và giá xuất xưởng.',
    scriptMode: 'short_film',
    sceneCount: 4,
    cameraMotion: 'Tracking shot, walking forward, Gentle Handheld Movement',
    extraNote:
      'Video đi một vòng xưởng / kho, máy đi theo người dẫn: CẢNH 1 ở cửa kho tổng hàng chất cao ("vào xưởng em xem tận gốc"); CẢNH 2 dây chuyền / khu sản xuất đang chạy; ' +
      'CẢNH 3 khu kiểm định cầm sản phẩm kiểm tra chi tiết; CẢNH 4 bàn đóng gói đơn, giơ sản phẩm, mời xem giỏ hàng (chỉ tay về góc trái). ' +
      'Cả 4 cảnh cầm CÙNG MỘT sản phẩm, cùng một màu như ảnh mẫu. Mỗi cảnh bắt đầu khi người dẫn vừa bước tới khu đó, lời thoại 20-25 từ, giọng chủ xưởng dân dã.',
  },
  {
    ...base,
    id: 'wf-xuong-cua-hang-lon',
    name: 'Đập hộp tại cửa hàng lớn',
    icon: '🏬',
    category: 'Xưởng & Kho',
    description:
      'Mở hộp ngay giữa siêu thị điện máy / showroom, phía sau là cả bức tường trưng bày chính sản phẩm đó. Hợp đồ gia dụng, điện máy.',
    scriptMode: 'template',
    scriptTemplateId: 'dap-hop-cua-hang',
    sceneCount: 4,
    cameraMotion: 'Medium Shot, Slow Dolly In',
    setting: 'Siêu thị điện máy lớn, dãy kệ trưng bày sáng đèn, biển giá khuyến mãi, sàn bóng',
    backdrop: { id: 'sieu-thi-dien-may', density: 'full', extras: true },
    extraNote:
      'Bối cảnh cửa hàng lớn sáng đèn, phía sau là kệ trưng bày đầy chính sản phẩm này. Cảnh 1 bê hộp ra quầy, cảnh 2 bóc hộp lấy sản phẩm, ' +
      'cảnh 3 bật / dùng thử ngay tại quầy, cảnh 4 khen đặt online tiện, giao tận nhà, xem giá ở giỏ hàng góc trái (KHÔNG nêu con số giá). Lời thoại 20-25 từ mỗi cảnh.',
  },
  {
    ...base,
    id: 'wf-xuong-don-hang',
    name: 'Đơn hàng hôm nay tại bàn đóng gói',
    icon: '📦',
    category: 'Xưởng & Kho',
    description:
      'Không khí kho đang chạy đơn: chất cả núi hàng, đóng gói, dán tem, xếp lên xe. Tạo cảm giác hàng bán chạy, khách đặt nhanh.',
    scriptMode: 'template',
    scriptTemplateId: 'don-hang-hom-nay',
    sceneCount: 4,
    cameraMotion: 'Medium Shot, Gentle Handheld Movement',
    setting: 'Khu bàn đóng gói đơn hàng xuất kho, cuộn băng keo, máy in tem, hộp ship xếp sẵn',
    backdrop: { id: 'ban-dong-goi', density: 'massive' },
    extraNote:
      'Cảnh 1 đứng trước núi đơn hàng ("hôm nay bên em ra mấy nghìn đơn"), cảnh 2 cầm 1 sản phẩm khoe trước khi cho vào hộp, ' +
      'cảnh 3 đóng hộp dán tem, cảnh 4 xếp lên xe giao + nhắc đặt nhanh ở giỏ hàng góc trái. Lời thoại 20-25 từ mỗi cảnh, nhịp nhanh.',
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
