// Node "🖼 Tạo thumbnail": brief thiết kế thumbnail TikTok / YouTube Shorts / Facebook Reels theo phong cách FastAIVN
// (prompt người dùng đang dùng với ChatGPT), điền tỷ lệ, tiêu đề, subtitle, kiểu nội dung, vị trí chữ.

export type ThumbContentType = 'auto' | 'review' | 'app' | 'film' | 'life';
export type ThumbPlacement = 'auto' | 'bottom-third';

export const THUMB_CONTENT_TYPES: [ThumbContentType, string][] = [
  ['auto', 'Tự nhận theo ảnh'],
  ['review', 'Review sản phẩm'],
  ['app', 'Hướng dẫn app'],
  ['film', 'Phim AI / drama'],
  ['life', 'Đời sống / giáo dục'],
];

const CONTENT_HINT: Record<ThumbContentType, string> = {
  auto: '',
  review: 'Đây là thumbnail REVIEW SẢN PHẨM: sản phẩm phải rõ, đẹp, có cảm giác "đáng mua".',
  app: 'Đây là thumbnail HƯỚNG DẪN APP: kết hợp nhân vật + giao diện app/screenshot + hiệu ứng công nghệ.',
  film: 'Đây là thumbnail PHIM AI / DRAMA: tạo cảm giác điện ảnh, cảm xúc và có tính kể chuyện.',
  life: 'Đây là thumbnail NỘI DUNG ĐỜI SỐNG / GIÁO DỤC: ưu tiên cảm xúc nhân vật và typography dễ đọc.',
};

/** Brief gốc (giữ nguyên ý người dùng), phần biến số điền ở buildThumbnailPrompt */
export const THUMBNAIL_BRIEF = `Bạn là chuyên gia thiết kế thumbnail chuyên nghiệp cho video TikTok, YouTube Shorts, Facebook Reels và video AI. Hãy tạo thumbnail dựa trên ảnh gốc đính kèm, giữ nhân vật và sản phẩm chính giống ảnh gốc, không tự ý thay đổi nhận diện sản phẩm.

YÊU CẦU CHUNG
- Thumbnail phải có cảm giác viral, bắt mắt, chuyên nghiệp, hiện đại, giống thumbnail video AI/affiliate đang được sử dụng trên mạng xã hội.
- Giữ chủ thể chính rõ ràng, nổi bật, có chiều sâu. Không làm ảnh quá rối.
- Có thể thêm hiệu ứng ánh sáng, glow, viền sáng, sparkle, mũi tên, khung phóng đại hoặc các graphic nhỏ nếu phù hợp với nội dung.
- Ưu tiên màu sắc tương phản mạnh giữa nhân vật/sản phẩm và typography.
- Typography lớn, đậm, dễ đọc ngay cả khi thumbnail hiển thị nhỏ trên điện thoại. Tiêu đề chính phải là yếu tố nổi bật nhất. Subtitle nhỏ hơn rõ ràng, nhưng vẫn dễ đọc.
- Bố cục có khoảng thở, không che mặt hoặc sản phẩm.
- Với thumbnail 9:16, không đặt tiêu đề sát mép trên; giữ vùng trên cùng tương đối thoáng để tránh bị giao diện TikTok/Shorts che.
- Không thêm những câu chữ không được yêu cầu. Không tự thêm giá, CTA, logo hoặc thông tin quảng cáo.

PHONG CÁCH FASTAIVN
- Năng lượng cao nhưng không rẻ tiền.
- Chữ chính có thể dùng trắng/vàng/đỏ tùy nền; có outline, shadow và glow nhẹ để chữ nổi bật.
- Có thể dùng các mảng màu dạng brush stroke, ribbon hoặc badge phía sau chữ.
- Graphic phụ nên liên quan trực tiếp đến chủ đề.
- Thumbnail review sản phẩm: sản phẩm phải rõ, đẹp, có cảm giác "đáng mua". Thumbnail hướng dẫn app: nhân vật + giao diện app/screenshot + hiệu ứng công nghệ. Thumbnail phim AI/drama: cảm giác điện ảnh, cảm xúc, có tính kể chuyện. Thumbnail đời sống/giáo dục: ưu tiên cảm xúc nhân vật và typography dễ đọc.
- Không sử dụng quá nhiều hiệu ứng khiến ảnh giống poster game.

QUY TẮC CHỮ
- Viết ĐÚNG CHÍNH XÁC nội dung được cung cấp, đặc biệt là dấu tiếng Việt; không làm biến dạng hoặc sai chính tả.
- Title: rất lớn, có hierarchy rõ ràng, có thể chia thành 1–3 dòng tùy bố cục.
- Subtitle: nhỏ hơn title, có thể đặt trong một thanh/ribbon/badge hiện đại, không được lấn át title.

XỬ LÝ ẢNH GỐC
- Sử dụng ảnh gốc (ảnh #1) làm nguồn chính. Các ảnh còn lại (nếu có) là ảnh tham chiếu nhân vật / sản phẩm để giữ đúng khuôn mặt và sản phẩm.
- Giữ khuôn mặt, tóc, trang phục, sản phẩm và bối cảnh quan trọng. Có thể crop, phóng to, reposition hoặc làm background blur để phù hợp thumbnail.
- Không thay đổi sản phẩm thành sản phẩm khác. Không tự ý thêm nhân vật không liên quan.
- Nếu ảnh có sản phẩm, ưu tiên làm sản phẩm lớn và rõ. Nếu ảnh có người, ưu tiên giữ khuôn mặt đẹp, tự nhiên và biểu cảm phù hợp với nội dung.

BỐ CỤC ƯU TIÊN (tự chọn bố cục tốt nhất theo ảnh gốc)
1. Nhân vật lớn + title ở 1/3 dưới. 2. Sản phẩm lớn + title ở vùng trống. 3. Nhân vật bên trái + typography bên phải.
4. Nhân vật bên phải + typography bên trái. 5. Sản phẩm chính + vòng tròn zoom chi tiết. 6. Collage 2–3 hình ảnh liên quan.
7. Background cinematic + title dạng poster. 8. Screenshot app + nhân vật chỉ vào giao diện.

Không hỏi lại. Tự quyết định layout, màu sắc, font, hiệu ứng và vị trí chữ sao cho thumbnail có khả năng thu hút click cao nhất.
QUAN TRỌNG: thumbnail phải nhìn giống một sản phẩm thiết kế hoàn chỉnh, không giống ảnh AI có chữ chèn sơ sài.
Ưu tiên: HOOK → NHÂN VẬT/SẢN PHẨM → TITLE → SUBTITLE → BRANDING NHẸ.`;

export interface ThumbOptions {
  ratio: string;
  title: string;
  subtitle: string;
  contentType: ThumbContentType;
  placement: ThumbPlacement;
  extra?: string;
}

export const buildThumbnailPrompt = (o: ThumbOptions): string => {
  const lines = [
    'Tạo 1 ẢNH THUMBNAIL (ảnh tĩnh, KHÔNG tạo video).',
    THUMBNAIL_BRIEF,
    '',
    'THÔNG TIN THUMBNAIL NÀY',
    `- Tỷ lệ ảnh: ${o.ratio}.`,
  ];
  if (o.title.trim()) {
    lines.push(`- Nội dung chính (TITLE), viết đúng từng chữ: "${o.title.trim()}"`);
    lines.push(o.subtitle.trim() ? `- Subtitle, viết đúng từng chữ: "${o.subtitle.trim()}"` : '- Không có subtitle: không thêm dòng chữ phụ nào.');
  } else {
    lines.push('- KHÔNG có tiêu đề: thiết kế thumbnail không chữ (chỉ hình ảnh + hiệu ứng), không tự thêm câu chữ nào.');
  }
  if (o.placement === 'bottom-third') {
    lines.push('- Nội dung nằm 1/3 dưới: đặt title + subtitle trong khoảng 1/3 phía dưới của ảnh, vẫn cân bằng với nhân vật/sản phẩm.');
  }
  if (CONTENT_HINT[o.contentType]) lines.push(`- ${CONTENT_HINT[o.contentType]}`);
  if (o.extra?.trim()) lines.push(`- Yêu cầu thêm: ${o.extra.trim()}`);
  return lines.join('\n');
};

/** Chỉ dẫn cho AI viết title / subtitle khi người dùng để trống (lấy ý từ kịch bản / prompt nối vào) */
export const thumbTextInstruction = (context: string, contentType: ThumbContentType) =>
  'Bạn là chuyên gia viết tiêu đề thumbnail viral cho TikTok / YouTube Shorts / Facebook Reels (tiếng Việt). Từ nội dung video dưới đây, ' +
  'viết 1 TITLE (hook mạnh, tối đa 6 từ) và 1 SUBTITLE (bổ trợ, tối đa 8 từ). Không ghi giá, không CTA ("mua ngay", "link"...), ' +
  'không emoji, không dấu ngoặc kép. Trả về DUY NHẤT JSON: {"title": "...", "subtitle": "..."}.' +
  (CONTENT_HINT[contentType] ? `\n${CONTENT_HINT[contentType]}` : '') +
  `\n\nNỘI DUNG VIDEO:\n${context.slice(0, 3000)}`;
