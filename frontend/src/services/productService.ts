// Sản phẩm (đọc từ link Shopee/TikTok hoặc tự nhập) và AI viết kịch bản theo sản phẩm.
import { GATEWAY_URL, MUSE_API_KEY } from '../config/appConfig';
import { ScriptTemplate } from '../data/scriptTemplates';

export interface ProductInfo {
  url: string;
  name: string;
  price: string;
  brand: string;
  description: string;
  /** Chữ trên trang sản phẩm (dùng làm ngữ cảnh cho AI, không hiển thị) */
  pageText: string;
  /** Ảnh đã lưu trên Gateway (URL /v1/media/...) */
  images: string[];
  /** Mô tả ngoại hình sản phẩm do AI rút ra, gắn vào prompt video để giữ đúng sản phẩm */
  visual: string;
}

export const EMPTY_PRODUCT: ProductInfo = {
  url: '',
  name: '',
  price: '',
  brand: '',
  description: '',
  pageText: '',
  images: [],
  visual: '',
};

export interface ScrapeResult {
  url: string;
  title: string;
  price: string;
  brand: string;
  description: string;
  text: string;
  images: { url: string; source: string }[];
  warning: string;
  needs_login: boolean;
  site: 'shopee' | 'tiktok' | '';
}

export interface ScriptScene {
  title: string;
  voiceover: string;
  prompt: string;
}

/** Kịch bản do ai viết: Gemini / endpoint OpenAI (cấu hình ở Cài đặt) hay muse-chat (dự phòng). */
export interface ScriptSource {
  provider: 'gemini' | 'openai' | 'muse';
  model?: string;
  keyIndex?: number | null;
  /** Lý do phải dùng muse-chat (Gemini/OpenAI chưa cấu hình hoặc lỗi) */
  fallbackReason?: string;
}

export interface GeneratedScript {
  product: { name?: string; category?: string; key_points?: string[]; visual?: string };
  scenes: ScriptScene[];
  source?: ScriptSource;
}

export const describeScriptSource = (s?: ScriptSource): string => {
  if (!s) return '';
  if (s.provider === 'gemini') return `Gemini (${s.model}${s.keyIndex ? `, key #${s.keyIndex}` : ''})`;
  if (s.provider === 'openai') return `Endpoint OpenAI (${s.model})`;
  return `muse-chat (dự phòng${s.fallbackReason ? `: ${s.fallbackReason}` : ''})`;
};

/** Kiểu kịch bản. "template" = dùng 1 trong các mẫu có sẵn. */
export type ScriptMode = 'template' | 'tvc5' | 'short_film' | 'pov_aff';

export const SCRIPT_MODES: { id: ScriptMode; label: string; hint: string }[] = [
  { id: 'template', label: 'Theo mẫu có sẵn', hint: 'Chọn 1 trong các mẫu kịch bản bán hàng bên dưới.' },
  {
    id: 'tvc5',
    label: 'TVC / Review 5 bước',
    hint: 'Hook 3 giây → Giới thiệu tổng quan → Cận cảnh chi tiết → Trải nghiệm thực tế → Chốt đơn (CTA).',
  },
  {
    id: 'short_film',
    label: 'Phim ngắn / Cốt truyện',
    hint: 'Thiết lập nhân vật → Khởi đầu sự việc → Diễn biến & cao trào → Kết. Dùng tên nhân vật trong thư viện.',
  },
  {
    id: 'pov_aff',
    label: 'POV Affiliate (giấu mặt)',
    hint: 'Góc nhìn thứ nhất, chỉ thấy tay thao tác với sản phẩm; hợp unbox / review đồ ăn, gia dụng, công nghệ.',
  },
];

const MODE_INSTRUCTIONS: Record<Exclude<ScriptMode, 'template'>, string> = {
  tvc5:
    'KIỂU KỊCH BẢN: TVC / Review sản phẩm chuẩn 5 bước chuyển đổi affiliate, chia đều các cảnh theo thứ tự: ' +
    '(1) Hook gây ấn tượng thị giác mạnh trong 3 giây đầu; (2) Giới thiệu tổng quan sản phẩm và nhân vật; ' +
    '(3) Cận cảnh chi tiết (macro chất liệu, bao bì, kết cấu); (4) Trải nghiệm thực tế, nhân vật dùng sản phẩm; ' +
    '(5) Chốt đơn: khẳng định chất lượng và kêu gọi mua. Ít cảnh hơn 5 thì gộp bước, nhiều hơn thì kéo dài bước 3-4.',
  short_film:
    'KIỂU KỊCH BẢN: Phim ngắn có cốt truyện liền mạch: thiết lập thế giới & nhân vật → khởi đầu sự việc → ' +
    'diễn biến & cao trào → giải quyết nút thắt & kết. Mỗi cảnh nối tiếp cảnh trước (cùng nhân vật, trang phục, bối cảnh). ' +
    'Có hội thoại thì ghi rõ ai nói, giữ đúng tính cách mỗi nhân vật. Sản phẩm (nếu có) xuất hiện tự nhiên trong truyện.',
  pov_aff:
    'KIỂU KỊCH BẢN: POV Affiliate — camera ở tầm mắt người xem, KHÔNG lộ mặt, chỉ thấy bàn tay tương tác với sản phẩm ' +
    '(1 tay giữ, 1 tay mở hộp / thao tác). Nhịp nhanh, cận cảnh, lời thoại như người thật đang review. ' +
    'Cấu trúc: hook → mở hộp / cầm thử → chi tiết nổi bật → dùng thử → chốt đơn.',
};

const call = async (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${MUSE_API_KEY}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const res = await fetch(`${GATEWAY_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = text || res.statusText;
    try {
      msg = JSON.parse(text).error?.message || msg;
    } catch {
      /* giữ nguyên chữ */
    }
    if (res.status === 404 && path.startsWith('/studio')) {
      msg = 'Gateway chưa có API này — hãy khởi động lại gateway_server.py (run_dev.bat).';
    }
    throw new Error(msg);
  }
  return res.json();
};

export const scrapeProductLink = (url: string): Promise<ScrapeResult> =>
  call('/studio/product/scrape', { method: 'POST', body: JSON.stringify({ url }) });

export const openShopLogin = (site: 'shopee' | 'tiktok'): Promise<{ open: boolean }> =>
  call('/studio/product/login', { method: 'POST', body: JSON.stringify({ site }) });

export const getShopLoginState = (): Promise<{ open: boolean }> => call('/studio/product/login');

/** Tiến trình đọc link: `waiting_user` = đang chờ người dùng kéo captcha / đăng nhập trong cửa sổ Chrome. */
export const getScrapeStatus = (): Promise<{ busy: boolean; message: string; waiting_user: boolean }> =>
  call('/studio/product/status');

/** Ảnh trên Gateway -> data URL (gửi lại cho muse.ai: URL 127.0.0.1 bị chặn SSRF). */
export const urlToDataUrl = async (url: string): Promise<string> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Không tải được ảnh (HTTP ${res.status})`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Không đọc được ảnh'));
    reader.readAsDataURL(blob);
  });
};

/** Đọc một object JSON cân bằng ngoặc bắt đầu tại `start` (bỏ qua ngoặc nằm trong chuỗi). */
const balancedObjectAt = (text: string, start: number): string | null => {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
};

/**
 * Lấy kịch bản JSON từ câu trả lời. muse-chat có thể trả về lẫn các bản nháp dở dang
 * (do giao diện muse.ai cập nhật chữ dần) trước bản hoàn chỉnh, nên thử mọi điểm bắt đầu
 * và giữ bản HỢP LỆ CUỐI CÙNG có mảng "scenes".
 */
export const extractJson = (text: string): any => {
  let found: any = null;
  for (let i = text.indexOf('{'); i >= 0; i = text.indexOf('{', i + 1)) {
    const candidate = balancedObjectAt(text, i);
    if (!candidate) continue;
    try {
      const obj = JSON.parse(candidate);
      if (obj && Array.isArray(obj.scenes)) {
        found = obj;
        i += candidate.length - 1; // bỏ qua phần đã đọc
      }
    } catch {
      /* bản nháp dở dang, thử điểm bắt đầu tiếp theo */
    }
  }
  if (!found) throw new Error('AI không trả về kịch bản JSON hợp lệ. Hãy bấm viết lại.');
  return found;
};

export interface ScriptRequest {
  product: ProductInfo;
  template: ScriptTemplate;
  mode: ScriptMode;
  /** Nhân vật trong thư viện (tên + mô tả) để kịch bản gọi đúng tên -> app tự gắn ảnh + giọng */
  characters: { name: string; description: string; voice?: string }[];
  sceneCount: number;
  secondsPerScene: number;
  withDialogue: boolean;
  /** Ảnh sản phẩm (data URL) để AI nhìn thấy sản phẩm thật */
  productImages: string[];
  extraNote: string;
}

/** Nhờ muse-chat (qua Gateway) viết kịch bản chia cảnh theo sản phẩm + mẫu đã chọn. */
export const generateScript = async (req: ScriptRequest): Promise<GeneratedScript> => {
  const p = req.product;
  const wordsPerScene = Math.round(req.secondsPerScene * 2.6);
  const productBlock = [
    p.name && `Tên sản phẩm: ${p.name}`,
    p.brand && `Thương hiệu: ${p.brand}`,
    p.price && `Giá: ${p.price}`,
    p.description && `Mô tả từ trang bán: ${p.description.slice(0, 1500)}`,
    p.pageText && `Thông tin thêm trên trang (có thể lẫn chữ thừa): ${p.pageText.slice(0, 2000)}`,
  ]
    .filter(Boolean)
    .join('\n');

  const modeBlock =
    req.mode === 'template'
      ? `MẪU KỊCH BẢN: "${req.template.name}" — ${req.template.guide}\n${
          req.template.faceless
            ? 'Video KHÔNG lộ mặt người: chỉ quay tay và sản phẩm.'
            : 'Có một nhân vật dẫn (người mẫu trong ảnh nhân vật tham chiếu) xuất hiện xuyên suốt.'
        }`
      : MODE_INSTRUCTIONS[req.mode];
  const characterBlock =
    req.mode !== 'pov_aff' && req.characters.length
      ? `NHÂN VẬT CÓ SẴN (dùng ĐÚNG tên này trong "prompt" mỗi khi nhân vật xuất hiện, để app tự gửi ảnh và giọng của họ):\n${req.characters
          .map((c) => `- ${c.name}${c.description ? `: ${c.description}` : ''}${c.voice ? ` (giọng: ${c.voice})` : ''}`)
          .join('\n')}`
      : '';
  const instruction = `Bạn là biên kịch video bán hàng ngắn (TikTok/Reels, khung dọc) tiếng Việt.
Ảnh đính kèm là ẢNH THẬT của sản phẩm cần bán. Hãy nhìn kỹ ảnh để biết đúng sản phẩm là gì (loại, màu, chất liệu, hình dáng). TUYỆT ĐỐI không đổi sang sản phẩm khác.

THÔNG TIN SẢN PHẨM:
${productBlock || '(không có chữ, chỉ dựa vào ảnh)'}

${modeBlock}
${characterBlock}
${req.extraNote ? `Yêu cầu thêm: ${req.extraNote}` : ''}

YÊU CẦU:
- Chia thành đúng ${req.sceneCount} cảnh, mỗi cảnh ${req.secondsPerScene} giây, nối liền thành một câu chuyện theo mẫu.
- "voiceover": ${req.withDialogue ? `lời thoại tiếng Việt tự nhiên, đời thường, tối đa ${wordsPerScene} chữ mỗi cảnh` : 'để trống "" (video không lời thoại, chỉ nhạc nền/ASMR)'}.
- "prompt": mô tả hình ảnh cho AI tạo video của cảnh đó (tiếng Việt): bối cảnh, hành động của nhân vật với sản phẩm, góc máy, ánh sáng. Luôn gọi đúng tên/loại sản phẩm và mô tả đúng ngoại hình như trong ảnh.
- "product.visual": 1 câu mô tả ngoại hình sản phẩm thật trong ảnh (loại, màu, chất liệu, chi tiết nổi bật).

CHỈ trả về JSON hợp lệ, không giải thích, đúng dạng:
{"product":{"name":"...","category":"...","key_points":["..."],"visual":"..."},"scenes":[{"title":"...","voiceover":"...","prompt":"..."}]}`;

  const content: any[] = [{ type: 'text', text: instruction }];
  req.productImages.slice(0, 3).forEach((url) => content.push({ type: 'image_url', image_url: { url } }));

  // Ưu tiên Gemini / endpoint OpenAI (Cài đặt ➔ Trợ lý AI); lỗi hoặc chưa cấu hình thì dùng muse-chat
  let text = '';
  let source: ScriptSource;
  let parsed: any = null;
  try {
    const ai = await call('/studio/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ prompt: instruction, images: req.productImages.slice(0, 3), json_output: true }),
    });
    text = ai.text || '';
    parsed = extractJson(text);
    source = { provider: ai.source, model: ai.model, keyIndex: ai.key_index };
  } catch (err: any) {
    const reason = String(err?.message || err).slice(0, 160);
    const data = await call('/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'muse-chat', stream: false, messages: [{ role: 'user', content }] }),
    });
    text = data.choices?.[0]?.message?.content || '';
    parsed = extractJson(text);
    source = {
      provider: 'muse',
      model: 'muse-chat',
      fallbackReason: /Chưa cấu hình|no_ai_provider|muse-chat/i.test(reason) ? 'chưa cấu hình Gemini/OpenAI' : reason,
    };
  }
  const scenes: ScriptScene[] = (parsed.scenes || [])
    .map((s: any) => ({
      title: String(s.title || '').trim(),
      voiceover: String(s.voiceover || '').trim(),
      prompt: String(s.prompt || '').trim(),
    }))
    .filter((s: ScriptScene) => s.prompt);
  if (scenes.length === 0) throw new Error('AI trả về kịch bản rỗng. Hãy thử lại.');
  return { product: parsed.product || {}, scenes, source };
};

/** Gộp 1 cảnh thành 1 dòng prompt cho danh sách chạy hàng loạt. */
export const sceneToPromptLine = (scene: ScriptScene): string => {
  const prompt = scene.prompt.replace(/\s+/g, ' ').trim();
  if (!scene.voiceover) return `${prompt} Không lời thoại, chỉ nhạc nền / âm thanh thao tác (ASMR).`;
  const vo = scene.voiceover.replace(/\s+/g, ' ').replace(/"/g, "'").trim();
  return `${prompt} Nhân vật nói bằng tiếng Việt, khẩu hình khớp lời: "${vo}"`;
};
