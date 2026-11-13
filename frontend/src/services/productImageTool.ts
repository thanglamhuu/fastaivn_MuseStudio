// Chuẩn bị ẢNH SẢN PHẨM ĐƠN, CHI TIẾT làm tham chiếu: cắt vùng sản phẩm → nâng nét → AI phân tích mô tả chi tiết.
// Dùng chung cho khối Upload Image (Sơ đồ khối), Cài đặt ➔ Sản phẩm (kể cả ảnh lấy từ link TikTok / Shopee) và Tạo video hàng loạt.
// Lý do: ảnh bìa sàn thường nhỏ, ghép nhiều mẫu, dán chữ quảng cáo → muse.ai không thấy rõ chi tiết nên vẽ lệch sản phẩm.
import { aiText } from './nodeFlow/runtime';
import { upscaleMedia, uploadDataUrl, mediaUrl } from './libraryService';
import { cropBoxDataUrl, urlToResizedDataUrl } from '../utils/image';

export interface CropBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Cắt theo khung (toạ độ 0..1), giữ nguyên điểm ảnh gốc rồi nâng nét bằng Gateway (lanczos + làm nét) khi vùng cắt nhỏ
 * (cạnh ngắn < `minShort`). Gateway lỗi / chưa chạy thì phóng bằng canvas như cũ.
 */
export const cropProductImage = async (image: string, box: CropBox, minShort = 1440): Promise<{ image: string; upscaled: boolean }> => {
  const raw = await cropBoxDataUrl(image, box, 1);
  const short = await new Promise<number>((resolve) => {
    const im = new Image();
    im.onload = () => resolve(Math.min(im.naturalWidth, im.naturalHeight));
    im.onerror = () => resolve(0);
    im.src = raw;
  });
  if (!short || short >= minShort) return { image: raw, upscaled: false };
  try {
    return { image: await upscaleProductImage(raw, minShort), upscaled: true };
  } catch {
    return { image: await cropBoxDataUrl(image, box, 1536), upscaled: false };
  }
};

/**
 * Nâng nét: Gateway (FFmpeg lanczos + làm nét nhẹ) phóng cạnh ngắn lên `shortSide` px rồi trả lại data URL (≤ 2048 px cạnh dài,
 * vừa giới hạn ảnh gửi muse.ai). Ảnh đã lớn hơn mức đó thì chỉ làm nét.
 */
export const upscaleProductImage = async (image: string, shortSide = 1440): Promise<string> => {
  const media = image.startsWith('data:') ? mediaUrl((await uploadDataUrl(image, 'product-tool')).url) : image;
  const r = await upscaleMedia(media, shortSide, true);
  return urlToResizedDataUrl(mediaUrl(r.url), 2048);
};

const DETAIL_ASK =
  'Ảnh đính kèm là ảnh MỘT sản phẩm dùng làm ảnh tham chiếu để AI tạo video. Hãy phân tích thật kỹ và mô tả sản phẩm sao cho một họa sĩ ' +
  'KHÔNG nhìn ảnh vẫn vẽ lại đúng. Viết MỘT đoạn tiếng Việt 70-110 từ, không gạch đầu dòng, không lời dẫn, theo thứ tự: ' +
  '(1) loại sản phẩm + hình dáng tổng thể và tỉ lệ (cao / dẹt / tròn / vuông, cỡ ước lượng so với bàn tay); ' +
  '(2) màu chính xác từng phần (thân, nắp, quai, đế, lòng trong…) và độ bóng / nhám; (3) chất liệu nhìn thấy; ' +
  '(4) các chi tiết nhận diện: số lượng và vị trí nút, quai, vòi, khóa kéo, đường chỉ, hoa văn, lỗ, gân; ' +
  '(5) logo / chữ IN TRÊN sản phẩm: nội dung, màu, vị trí (không có thì ghi "không có chữ in"). ' +
  'Chỉ tả những gì THẤY rõ, không đoán công dụng, không nhắc giá, không tả chữ quảng cáo / watermark dán đè lên ảnh, không tả nền hay người cầm.';

/** AI nhìn ảnh và mô tả CHI TIẾT sản phẩm (dùng cho ô Ngoại hình / Mô tả khóa tham chiếu). `name` giúp AI gọi đúng tên sản phẩm. */
export const describeProductDetailed = async (image: string, name = ''): Promise<string> => {
  const img = image.startsWith('data:') ? image : await urlToResizedDataUrl(image, 1536);
  const r = await aiText(DETAIL_ASK + (name.trim() ? `\nTên sản phẩm (chỉ để gọi tên, vẫn phải tả theo ảnh): ${name.trim()}` : ''), [img]);
  return r.text
    .replace(/\s+/g, ' ')
    .replace(/^["'“]|["'”]$/g, '')
    .trim()
    .slice(0, 900);
};
