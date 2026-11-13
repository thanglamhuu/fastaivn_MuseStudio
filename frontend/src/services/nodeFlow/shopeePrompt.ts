// Node Prompt: dán link Shopee / TikTok Shop → đọc thông tin sản phẩm → PHỐI vào prompt có sẵn (không thay thế).
//
// Prompt mẫu (chuyển từ mẫu workflow) thường có chỗ trống "Sản phẩm: @@ (gõ @@ để chọn sản phẩm)" và các yêu cầu kịch bản.
// Khi lấy link: điền chỗ trống thành "@@<Tên>" (sản phẩm được lưu vào thư viện Cài đặt để @@ gửi kèm ảnh khi render),
// giữ nguyên mọi câu khác, và thêm 1 khối "SẢN PHẨM TỪ LINK" ở cuối. Lấy lại link khác chỉ thay khối đó.
import { PRODUCT_VISUAL_SPEC } from '../../data/productPhysics';

export const BLOCK_START = '[SẢN PHẨM TỪ LINK';
export const BLOCK_END = '[/SẢN PHẨM TỪ LINK]';

/** Khi chạy: bỏ link khỏi dòng tiêu đề khối (Muse thấy link trong prompt video có thể đi mở link thay vì tạo video) */
export const stripBlockUrl = (text: string): string =>
  text.replace(/\[SẢN PHẨM TỪ LINK:\s*\S+\]/g, '[THÔNG TIN SẢN PHẨM]').replace(/\[\/SẢN PHẨM TỪ LINK\]/g, '[/THÔNG TIN SẢN PHẨM]');

export interface LinkProductInfo {
  /** Tên ngắn dùng làm tên sản phẩm trong thư viện + @@mention */
  name: string;
  url: string;
  price?: string;
  brand?: string;
  /** Điểm nổi bật / tính năng chính */
  highlights?: string[];
  /** Ý tưởng video ngắn cho sản phẩm */
  idea?: string;
}

/** Gợi ý chọn sản phẩm của prompt mẫu: "(gõ @@ để chọn sản phẩm)" */
const PRODUCT_HINT_RE = /\s*\(\s*gõ\s*@@\s*để\s*chọn\s*sản\s*phẩm\s*\)/giu;
/** "@@" trống (chưa chọn sản phẩm): sau nó là khoảng trắng, dấu câu hoặc hết dòng */
const EMPTY_PRODUCT_TAG_RE = /@@(?=[\s(),.;:—–-]|$)/u;

const removeBlock = (prompt: string): string => {
  const i = prompt.indexOf(BLOCK_START);
  if (i < 0) return prompt;
  const j = prompt.indexOf(BLOCK_END, i);
  const end = j < 0 ? prompt.length : j + BLOCK_END.length;
  return (prompt.slice(0, i).replace(/\s+$/, '') + '\n' + prompt.slice(end).replace(/^\s+/, '')).trim();
};

export const buildBlock = (p: LinkProductInfo): string => {
  const lines = [`${BLOCK_START}: ${p.url}]`, `Tên sản phẩm: ${p.name}`];
  if (p.brand) lines.push(`Thương hiệu: ${p.brand}`);
  const hl = (p.highlights || []).map((x) => x.trim()).filter(Boolean);
  if (hl.length) lines.push(`Điểm nổi bật: ${hl.join('; ')}`);
  if (p.idea?.trim()) lines.push(`Ý tưởng video: ${p.idea.trim()}`);
  lines.push(BLOCK_END);
  return lines.join('\n');
};

/**
 * Phối thông tin sản phẩm vào prompt có sẵn.
 * - Có "@@" trống (kể cả kèm gợi ý "(gõ @@ để chọn sản phẩm)") → điền "@@<Tên>".
 * - Đã có "@@<Tên>" này → giữ. Đã chọn sản phẩm KHÁC bằng @@ → giữ lựa chọn đó (chỉ thêm khối thông tin).
 * - Không nhắc sản phẩm nào → thêm dòng "Sản phẩm: @@<Tên>" lên đầu.
 * - Khối "SẢN PHẨM TỪ LINK" cũ (lần lấy trước) được thay bằng khối mới; mọi câu khác giữ nguyên.
 */
export const mergeProductIntoPrompt = (
  prompt: string,
  p: LinkProductInfo,
  knownProducts: string[] = [],
  /** Tên sản phẩm do lần lấy link TRƯỚC điền vào (đổi sang sản phẩm mới); sản phẩm người dùng tự chọn thì giữ */
  prevAutoName = ''
): string => {
  let out = removeBlock(prompt || '');
  const tag = `@@${p.name}`;
  if (prevAutoName && prevAutoName !== p.name) out = out.split(`@@${prevAutoName}`).join(tag);
  if (!out.includes(tag)) {
    const hasHint = PRODUCT_HINT_RE.test(out);
    PRODUCT_HINT_RE.lastIndex = 0;
    const withoutHint = out.replace(PRODUCT_HINT_RE, '');
    // @@ đã gắn tên sản phẩm có trong thư viện (người dùng tự chọn) → giữ nguyên
    const chosenOther = knownProducts.some((n) => n && n !== p.name && withoutHint.includes(`@@${n}`));
    if (!chosenOther && EMPTY_PRODUCT_TAG_RE.test(withoutHint)) {
      out = withoutHint.replace(EMPTY_PRODUCT_TAG_RE, `${tag}`);
    } else if (!chosenOther && !/@@\S/u.test(withoutHint)) {
      out = `Sản phẩm: ${tag}\n${hasHint ? withoutHint : out}`;
    } else if (hasHint) {
      out = withoutHint;
    }
  }
  return `${out.trim()}\n\n${buildBlock(p)}`;
};

/** Rút gọn tên sản phẩm Shopee (thường rất dài, nhồi từ khóa) khi không có AI */
export const shortProductName = (title: string, max = 48): string => {
  const t = title
    .replace(/\[[^\]]*\]|【[^】]*】|\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return cut
    .slice(0, Math.max(cut.lastIndexOf(' '), 24))
    .replace(/[,\-–|/]+$/, '')
    .replace(/(\s+\d+)+$/, '') // bỏ số lẻ bị cắt dở ở cuối ("… pin 5000mAh 5")
    .trim();
};

/** Chỉ dẫn cho AI: từ dữ liệu trang sản phẩm → JSON tên ngắn, điểm nổi bật, ý tưởng, ngoại hình */
export const productIdeaInstruction = (title: string, price: string, brand: string, description: string, pageText: string, prompt: string) =>
  'Bạn là chuyên gia làm video affiliate TikTok. Dưới đây là thông tin một sản phẩm đọc từ trang bán hàng ' +
  'và yêu cầu video có sẵn của người dùng. Trả về DUY NHẤT JSON (không giải thích):\n' +
  '{"short_name": "tên sản phẩm ngắn gọn, tự nhiên, tối đa 6 từ, không nhồi từ khóa", ' +
  '"highlights": ["3-5 điểm nổi bật / tính năng thật của sản phẩm, mỗi ý ≤ 12 từ"], ' +
  '"idea": "1-2 câu ý tưởng video phù hợp YÊU CẦU CÓ SẴN bên dưới (không thay đổi kiểu kịch bản / số cảnh người dùng đã ghi)", ' +
  `"visual": "${PRODUCT_VISUAL_SPEC.replace(/"/g, "'")}"}\n` +
  'Chỉ dùng thông tin có trên trang, không bịa thông số. Bỏ qua chữ khuyến mãi / mã giảm giá / phí ship. ' +
  'KHÔNG nhắc GIÁ / số tiền ở bất kỳ trường nào (giá có thể thay đổi sau khi đăng video).\n\n' +
  `Tên trên trang: ${title}${price ? '' : ''}\nThương hiệu: ${brand || '(không rõ)'}\n` +
  `Mô tả: ${description.slice(0, 1500)}\nChữ trên trang (trích): ${pageText.slice(0, 1500)}\n\n` +
  `YÊU CẦU VIDEO CÓ SẴN CỦA NGƯỜI DÙNG:\n${prompt.slice(0, 1200) || '(trống)'}`;
