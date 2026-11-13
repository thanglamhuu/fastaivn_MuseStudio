// Tách 1 sản phẩm rõ nhất khỏi ảnh ghép nhiều mẫu / nhiều màu (ảnh bìa Shopee hay xếp 6-8 mẫu trong 1 ảnh).
// Lỗi thật 13/11: ảnh 6 đôi dép xếp vòng tròn, mỗi đôi ~200 px → muse.ai không thấy rõ kiểu lỗ, vẽ lỗ tròn + gân chéo
// thay cho lỗ vuông đan lưới. Cắt riêng 1 đôi rồi phóng to thì chi tiết chiếm trọn khung ảnh tham chiếu.
import { aiText } from './nodeFlow/runtime';
import { extractJsonObject } from './productService';
import { cropBoxDataUrl } from '../utils/image';

export interface IsolatedProduct {
  dataUrl: string;
  /** Số sản phẩm / bộ AI đếm được trong ảnh gốc */
  count: number;
  /** Màu / mô tả ngắn của sản phẩm được chọn */
  label: string;
}

const INSTRUCTION =
  'Ảnh đính kèm là ảnh sản phẩm để bán. Hãy đếm xem trong ảnh có bao nhiêu SẢN PHẨM / BỘ sản phẩm riêng biệt ' +
  '(vd. 1 đôi dép = 1 bộ; 6 đôi 6 màu = 6). Chọn MỘT bộ rõ nét nhất, thấy trọn vẹn nhất, ít bị che / cắt nhất, ' +
  'ưu tiên bộ nhìn từ trên xuống hoặc chính diện thấy rõ họa tiết. Trả về DUY NHẤT JSON: ' +
  '{"count": <số bộ trong ảnh>, "box_2d": [ymin, xmin, ymax, xmax], "label": "<màu + tên ngắn của bộ đã chọn>"} ' +
  'với box_2d là khung bao VỪA KHÍT bộ đã chọn, toạ độ chuẩn hoá 0-1000 (gốc trên-trái). Ảnh chỉ có 1 sản phẩm thì count = 1 và box bao sản phẩm đó.';

/** Nhờ AI (Gemini qua Gateway) đếm sản phẩm và khoanh 1 sản phẩm rõ nhất (toạ độ 0..1, đã nới 6% mỗi cạnh). */
export const locateProductUnit = async (
  image: string
): Promise<{ count: number; label: string; box: { x0: number; y0: number; x1: number; y1: number }; whole: boolean }> => {
  const res = await aiText(INSTRUCTION, [image]);
  const j = extractJsonObject(res.text) || {};
  const b: number[] = Array.isArray(j.box_2d) ? j.box_2d.map(Number) : [];
  if (b.length !== 4 || b.some((n) => !Number.isFinite(n))) throw new Error('AI không xác định được vị trí sản phẩm trong ảnh.');
  const count = Math.max(1, Number(j.count) || 1);
  let [y0, x0, y1, x1] = b.map((n) => Math.max(0, Math.min(1000, n)) / 1000);
  if (x1 - x0 < 0.05 || y1 - y0 < 0.05) throw new Error('Khung sản phẩm AI trả về quá nhỏ.');
  // 1 sản phẩm đã chiếm gần hết ảnh: không cần cắt
  const whole = count === 1 && (x1 - x0) * (y1 - y0) > 0.55;
  const px = (x1 - x0) * 0.06;
  const py = (y1 - y0) * 0.06;
  x0 = Math.max(0, x0 - px);
  y0 = Math.max(0, y0 - py);
  x1 = Math.min(1, x1 + px);
  y1 = Math.min(1, y1 + py);
  return { count, label: String(j.label || '').trim(), box: { x0, y0, x1, y1 }, whole };
};

/**
 * Tách 1 sản phẩm rõ nhất: AI khoanh vùng → cắt + phóng to. Ném lỗi khi AI không trả khung hợp lệ.
 * Ảnh chỉ có 1 sản phẩm chiếm phần lớn khung thì trả ảnh gốc (count = 1).
 */
export const isolateProductUnit = async (image: string): Promise<IsolatedProduct> => {
  const r = await locateProductUnit(image);
  if (r.whole) return { dataUrl: image, count: r.count, label: r.label };
  return { dataUrl: await cropBoxDataUrl(image, r.box), count: r.count, label: r.label };
};
