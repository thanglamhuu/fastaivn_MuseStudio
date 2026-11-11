// Bộ chạy sơ đồ Node (kiểu HND workflow_runtime.py) — chạy ngay trong trình duyệt, gọi Gateway:
//  - Lập lịch DAG: node chạy khi mọi node phía trước xong; node Generate chạy song song tối đa
//    = số luồng render của các tài khoản Muse; node lỗi chặn các node phía sau (báo "bị chặn bởi …").
//  - Kết quả mỗi node lưu vào node.data.results ⇒ "Chạy tiếp" chỉ chạy node chưa xong,
//    "Chạy lại từ node" xóa kết quả node đó + mọi node phía sau rồi chạy lại.
//  - Ảnh tham chiếu (Upload Image) phía trước được tự gửi kèm node Generate (Reference-to-Video),
//    xếp Nhân vật → Trang phục → Sản phẩm như HND; prompt chưa có bảng ánh xạ thì tự dựng.
import { GATEWAY_URL, MUSE_API_KEY } from '../../config/appConfig';
import {
  DEFAULT_MUSE_CONFIG,
  MuseTaskStoppedError,
  ReferenceImage,
  createAndPollMuseVideo,
  exportVideo,
  generateMuseKeyframe,
  mergeVideos,
} from '../museBatchService';
import { blurRegions, cutFrame, upscaleMedia } from '../libraryService';
import { buildReferencePrompt, RefImageInfo } from '../referencePrompt';
import { composeSideBySide, cropCharacterSheet, urlToResizedDataUrl } from '../../utils/image';
import type { AspectRatio, ShotDuration } from '../../types/videoStudio';
import type { StudioCharacter, StudioProduct } from '../../types/library';
import {
  FlowNode,
  FlowNodeData,
  FlowWorkflow,
  LOGO_SPOTS,
  NODE_DEFS,
  NodeResult,
  PortKind,
  RefLock,
  downstreamOf,
  locksOf,
  portKind,
  validateWorkflow,
} from './definitions';

export const STOPPED_MSG = '⏹ Đã dừng theo yêu cầu';

export interface FlowRunDeps {
  /** Số node Generate chạy song song (tổng luồng tài khoản Muse) */
  threads: () => number;
  shouldStop: () => boolean;
  /** Cập nhật trạng thái / kết quả 1 node (UI + lưu) */
  patchNode: (id: string, patch: Partial<FlowNodeData>) => void;
  log: (msg: string) => void;
  /** Thư mục con trong thư mục xuất file */
  project: string;
  characters?: StudioCharacter[];
  products?: StudioProduct[];
}

interface RefItem {
  value: string;
  roles: RefLock[];
  name?: string;
  desc?: string;
  /** Mô tả AI nhìn ảnh viết lại (khớp đúng ảnh) */
  ai?: string;
  order: number;
}

const DESCRIBE: Record<RefLock, string> = {
  character:
    'Mô tả CHÍNH XÁC người trong ảnh để AI tạo video giữ đúng người: giới tính, tuổi ước lượng, dáng mặt, kiểu tóc + màu tóc, kính (nếu có), ' +
    'trang phục đang mặc (màu, kiểu dáng, họa tiết, chi tiết như nơ / cúc / tay áo), giày, phụ kiện.',
  outfit: 'Mô tả CHÍNH XÁC bộ trang phục trong ảnh: loại đồ, màu, chất liệu, kiểu dáng, họa tiết, chi tiết đặc trưng.',
  product: 'Mô tả CHÍNH XÁC sản phẩm chính trong ảnh: loại sản phẩm, hình dáng, màu sắc, chất liệu, logo / chữ in, chi tiết nổi bật.',
  scene: 'Mô tả CHÍNH XÁC bối cảnh trong ảnh: không gian, đồ nội thất / vật dụng chính, màu sắc, ánh sáng.',
};

/** AI nhìn ảnh tham chiếu và mô tả lại đúng những gì thấy (1 đoạn ngắn). */
export const describeReference = async (image: string, roles: RefLock[]): Promise<string> => {
  const ask =
    roles.map((r) => DESCRIBE[r]).join('\n') +
    '\nChỉ mô tả những gì THẤY trong ảnh, không bịa thêm. Trả về 1 đoạn tiếng Việt tối đa 60 từ, không gạch đầu dòng, không lời dẫn. ' +
    'Nếu ảnh có nhiều góc của cùng 1 người (character sheet) thì mô tả người đó.';
  const r = await aiText(ask, [await toDataUrl(image)]);
  return r.text.replace(/\s+/g, ' ').replace(/^["'“]|["'”]$/g, '').trim().slice(0, 600);
};

const ROLE_ORDER: Record<RefLock, number> = { character: 0, outfit: 1, product: 2, scene: 3 };
const ROLE_VI: Record<RefLock, string> = { character: 'nhân vật', outfit: 'trang phục', product: 'sản phẩm', scene: 'bối cảnh' };

/**
 * @Tên nhân vật / @@Tên sản phẩm trong prompt (gõ từ ô gợi ý) → ảnh + mô tả của chúng trong Cài đặt.
 * Trả prompt đã bỏ ký hiệu @@ (tên sản phẩm giữ nguyên) và danh sách ảnh tham chiếu cần gửi kèm.
 */
export const resolveMentions = (
  text: string,
  characters: StudioCharacter[] = [],
  products: StudioProduct[] = []
): { text: string; refs: RefItem[] } => {
  const refs: RefItem[] = [];
  let out = text;
  [...products].sort((a, b) => b.name.length - a.name.length).forEach((p) => {
    const tag = `@@${p.name}`;
    if (!p.name.trim() || !out.includes(tag)) return;
    out = out.split(tag).join(p.name);
    if (p.images[0]) refs.push({ value: p.images[0], roles: ['product'], name: p.name, desc: p.visual || p.description, order: 50 });
  });
  [...characters].sort((a, b) => b.name.length - a.name.length).forEach((c) => {
    if (!c.name.trim() || !out.includes(`@${c.name}`)) return;
    if (c.images[0]) refs.push({ value: c.images[0], roles: ['character'], name: c.name, desc: c.description, order: 40 });
  });
  return { text: out, refs };
};

export type RunMode = { kind: 'all' } | { kind: 'resume' } | { kind: 'from'; nodeId: string } | { kind: 'only'; nodeId: string };

interface Input extends NodeResult {
  handle: string;
  sourceId: string;
}

/**
 * Gateway trả "all accounts are busy" khi mọi tài khoản Muse đang đủ luồng (vd. chạy 2 workflow cùng lúc,
 * hoặc tab Tạo video đang render) → chờ rồi thử lại thay vì báo lỗi node.
 */
const BUSY_RE = /all accounts are busy|try again later|tài khoản.*bận|rate.?limit|429|fetch failed|failed to fetch|ECONNRESET|socket hang up/i;
const withBusyRetry = async <T,>(fn: () => Promise<T>, opts: { shouldStop: () => boolean; log: (m: string) => void; what: string }): Promise<T> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (!BUSY_RE.test(msg) || attempt >= 90 || opts.shouldStop()) throw err;
      const wait = Math.min(60, 10 + attempt * 5);
      opts.log(`${opts.what}: tài khoản Muse đang bận — chờ ${wait}s rồi thử lại (lần ${attempt})`);
      const end = Date.now() + wait * 1000;
      while (Date.now() < end && !opts.shouldStop()) await new Promise((r) => setTimeout(r, 500));
    }
  }
};

/** muse.ai đôi khi trả lời bằng chữ / lỗi render / quá giờ thay vì ảnh, video → làm lại tối đa 2 lần */
const NO_MEDIA_RE = /Internal Server Error|Bad Gateway|text only|no video|no image|did not (produce|return) an? (video|image)|Timeout|quá thời gian chờ|báo lỗi trong lúc render/i;
const retryNoMedia = async <T,>(fn: () => Promise<T>, what: string, deps: { shouldStop: () => boolean; log: (m: string) => void }): Promise<T> => {
  for (let k = 0; ; k++) {
    try {
      return await fn();
    } catch (err: any) {
      if (k >= 2 || deps.shouldStop() || !NO_MEDIA_RE.test(String(err?.message || err))) throw err;
      deps.log(`${what}: muse.ai không trả kết quả (trả lời bằng chữ / lỗi render / quá giờ) → làm lại (lần ${k + 2})`);
    }
  }
};

const pad2 = (n: number) => String(n).padStart(2, '0');
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const stamp = () => {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
};
const abs = (u: string) => (u.startsWith('/') ? `${GATEWAY_URL}${u}` : u);
const isData = (u: string) => u.startsWith('data:');

const gw = async <T,>(path: string, body: unknown): Promise<T> => {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MUSE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text || res.statusText;
    try {
      msg = JSON.parse(text).error?.message || JSON.parse(text).detail || msg;
    } catch {
      /* giữ nguyên */
    }
    if (res.status === 404 && path.startsWith('/studio')) msg = 'Gateway chưa có API này — khởi động lại gateway_server.py (run_dev.bat).';
    throw new Error(String(msg).slice(0, 400));
  }
  return JSON.parse(text) as T;
};

/** Ảnh / video data URL → media trên Gateway (để hậu kỳ, xuất file). URL Gateway giữ nguyên. */
export const toGatewayMedia = async (value: string, note?: string): Promise<string> => {
  if (!isData(value)) return abs(value);
  const r = await gw<{ url: string }>('/studio/media/upload', { data: value, source: 'node-flow', note });
  return abs(r.url);
};

/** Muse chỉ nhận ảnh dạng data URL (chặn URL 127.0.0.1) → tải ảnh Gateway về data URL. */
const toDataUrl = async (value: string) => (isData(value) ? value : urlToResizedDataUrl(abs(value), 1536));

/** Gọi AI viết chữ: Gemini / OpenAI (Cài đặt ➔ Trợ lý AI), lỗi thì dùng muse-chat. */
export const aiText = async (prompt: string, images: string[]): Promise<{ text: string; source: string }> => {
  // Tài khoản Muse bận / lỗi mạng → chờ rồi thử lại (lỗi thật: "viết tiếp đoạn thiếu" gặp busy → mất cả kịch bản AI)
  for (let attempt = 1; ; attempt++) {
    try {
      return await aiTextOnce(prompt, images);
    } catch (err: any) {
      if (attempt >= 12 || !BUSY_RE.test(String(err?.message || err))) throw err;
      await new Promise((r) => setTimeout(r, Math.min(60, 10 + attempt * 5) * 1000));
    }
  }
};

const aiTextOnce = async (prompt: string, images: string[]): Promise<{ text: string; source: string }> => {
  try {
    const r = await gw<{ text: string; source?: string; model?: string }>('/studio/ai/chat', {
      prompt,
      images: images.slice(0, 4),
      json_output: false,
    });
    return { text: r.text || '', source: `${r.source || 'ai'}${r.model ? ` · ${r.model}` : ''}` };
  } catch {
    const content: any[] = [{ type: 'text', text: prompt }];
    images.slice(0, 3).forEach((url) => content.push({ type: 'image_url', image_url: { url } }));
    const r = await gw<any>('/v1/chat/completions', { model: 'muse-chat', stream: false, messages: [{ role: 'user', content }] });
    return { text: r.choices?.[0]?.message?.content || '', source: 'muse-chat' };
  }
};

/** Vai trò kịch tính của cảnh i/N (khung Dramatic Spine giống HND). */
export const dramaticRole = (i: number, total: number): string => {
  if (total <= 1) return 'Hook + trải nghiệm + chốt trong 1 cảnh';
  if (i === 0) return 'HOOK — gây chú ý 3 giây đầu, giới thiệu nhân vật & bối cảnh';
  if (i === total - 1) return 'KẾT — hạ màn cảm xúc / chốt thông điệp, giữ khung ổn định 1 giây cuối';
  if (i === total - 2 && total >= 4) return 'CAO TRÀO — khoảnh khắc ấn tượng nhất, điểm nhấn đắt giá';
  return 'DIỄN BIẾN — phát triển tình huống, chi tiết & trải nghiệm';
};

const scriptInstruction = (idea: string, count: number, firstIsChar: boolean, seconds = 10) => {
  const a = (seconds * 0.35).toFixed(1);
  const b = (seconds * 0.7).toFixed(1);
  const syllables = `${Math.round(seconds * 2.2)}-${Math.round(seconds * 2.8)}`;
  const scenes = firstIsChar && count >= 2 ? count - 1 : count;
  const spine = Array.from({ length: scenes }, (_, i) => `  + Cảnh ${i + 1}/${scenes}: ${dramaticRole(i, scenes)}`).join('\n');
  return (
    'Bạn là đạo diễn hình ảnh & biên kịch AI cho Muse Studio (video dọc TikTok, tiếng Việt).\n' +
    `Yêu cầu gốc:\n${idea}\n\n` +
    `KHUNG KỊCH TÍNH BẮT BUỘC (liền mạch giữa các cảnh, đầu cảnh sau nối tiếp tư thế cuối cảnh trước):\n${spine}\n` +
    '- Khóa cố định 1 bối cảnh xuyên suốt, giữ đồng nhất ngoại hình nhân vật (khuôn mặt, tóc, trang phục) ở MỌI cảnh.\n' +
    `- Mỗi cảnh đúng ${seconds} giây, chia 3 nhịp 0-${a}s / ${a}-${b}s / ${b}-${seconds}s; lời thoại tiếng Việt tự nhiên ${syllables} âm tiết / cảnh, đặt trong ngoặc kép.\n\n` +
    (firstIsChar && count >= 2
      ? `Viết đúng ${count} đoạn, ngăn cách bằng dòng ---\n- Đoạn 1: prompt ẢNH NHÂN VẬT GỐC (1 người, 1 khung, nền studio sáng) khóa khuôn mặt, tuổi, tóc, trang phục.\n- Đoạn 2..${count}: prompt VIDEO từng cảnh 1..${scenes}.\n`
      : `Viết đúng ${count} đoạn prompt VIDEO cho Cảnh 1..${count}, ngăn cách bằng dòng ---\n`) +
    'Đây là một yêu cầu MỚI, độc lập: bỏ qua mọi cuộc trò chuyện, dự án, video đã làm trước đó. ' +
    'KHÔNG hỏi lại người dùng: nếu mô tả chữ khác ảnh tham chiếu thì tự theo ẢNH và viết luôn. ' +
    'Mỗi đoạn là prompt video đầy đủ (hành động, camera, bối cảnh, lời thoại riêng của cảnh đó — không lặp câu thoại giữa các cảnh). ' +
    'Chỉ trả về các đoạn prompt, không giải thích, không đánh số tiêu đề thừa.'
  );
};

/**
 * Tách câu trả lời của AI thành các đoạn: theo dòng --- ; nếu AI không kẻ --- mà viết tiêu đề "CẢNH 01/03" / "Scene 2"
 * thì tách theo tiêu đề. Bỏ đoạn trùng (AI hay lặp lại đoạn trước khi bị cắt).
 */
export const parseScriptParts = (raw: string): string[] => {
  const text = raw.replace(/```[a-z]*\n?/gi, '').trim();
  let parts = text.split(/\n\s*-{3,}\s*\n/);
  if (parts.length < 2) parts = text.split(/\n(?=\s*\**\s*(?:CẢNH|Cảnh|SCENE|Scene)\s*0?\d+\s*(?:\/\s*\d+)?\s*[—:\-–|])/);
  // AI đôi khi dán tiếp đoạn khác ngay giữa dòng ("…| CẢNH 01/03 — HOOK …", "…Cảnh 2/5 DIỄN BIẾN…") → 1 đoạn chứa từ 2 nhãn cảnh trở lên
  // thì cắt tại nhãn thứ 2 trở đi (nhãn đầu có thể đứng sau phần mở đầu "Video dọc 9:16…" — phần đó đi cùng cảnh đầu).
  const LABEL_RE = /(?:CẢNH|SCENE)\s*0?\d+\s*\/\s*0?\d+\s*[—–\-:]|(?:Cảnh|Scene)\s*0?\d+\s*\/\s*0?\d+\s*(?:[—–\-:]|[A-ZĐÂĂÊÔƠƯ]{3,})/g;
  parts = parts.flatMap((p) => {
    const at = [...p.matchAll(LABEL_RE)].map((m) => m.index || 0);
    if (at.length < 2) return [p];
    const cuts = [0, ...at.slice(1), p.length];
    return cuts.slice(0, -1).map((c, i) => p.slice(c, cuts[i + 1])).filter((x) => x.trim().length > 15);
  });
  // Đoạn bị dính 2 cảnh (AI viết tiếp ngay sau dấu nháy, không xuống dòng: "…năm|Video dọc 9:16…") → tách tại chỗ phần mở đầu lặp lại
  parts = parts.flatMap((p) => {
    const t = p.trim();
    const head = t.slice(0, 40);
    if (head.length < 40) return [t];
    const out: string[] = [];
    let rest = t;
    for (let k = rest.indexOf(head, 200); k > 0; k = rest.indexOf(head, 200)) {
      out.push(rest.slice(0, k));
      rest = rest.slice(k);
    }
    return [...out, rest];
  });
  const out: string[] = [];
  const key = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  parts
    .map((s) => s.trim().replace(/\s*\|\s*$/, ''))
    .filter((s) => s.length > 15)
    .forEach((p) => {
      // Trùng = giống hệt cả đoạn (các cảnh hay mở đầu bằng cùng 1 câu khóa bối cảnh nên không so phần đầu)
      if (!out.some((o) => key(o) === key(p))) out.push(p);
    });
  // Đoạn có nhãn "SCENE k/N" / "CẢNH k/N": AI hay viết đi viết lại 1 cảnh nhiều bản nháp (lỗi thật: 4 bản "SCENE 1/5" rồi mới tới cảnh 2
  // → 4 cảnh đầu đều là cảnh 1). Bản nháp = cùng số cảnh VÀ (cùng câu thoại hoặc 1 bản không có thoại) → giữ bản dài nhất.
  // Cùng số mà thoại khác nhau thì là 2 cảnh khác (AI ghi nhầm nhãn) → giữ cả hai, đúng thứ tự.
  const sceneNo = (p: string) => Number(/(?:SCENE|CẢNH|Cảnh|Scene)\s*0?(\d+)\s*\/\s*0?\d+/.exec(p.slice(0, 400))?.[1] || 0);
  const lines = (p: string) => new Set(dialogueLines(p).map((l) => l.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()));
  const merged: string[] = [];
  out.forEach((p) => {
    const k = sceneNo(p);
    const j = k ? merged.findIndex((m) => sceneNo(m) === k) : -1;
    if (j >= 0) {
      const a = lines(merged[j]);
      const b = lines(p);
      const draft = !a.size || !b.size || [...b].some((x) => a.has(x));
      if (draft) {
        if (p.length > merged[j].length) merged[j] = p;
        return;
      }
    }
    merged.push(p);
  });
  return merged;
};

/** Câu thoại tiếng Việt trong ngoặc kép (bỏ chữ in trên bao bì: viết hoa toàn bộ / quá ngắn) */
export const dialogueLines = (part: string): string[] =>
  // Bỏ trước các cụm ngắn trong ngoặc kép (chữ in trên sản phẩm: "01", "500 mL") — chúng làm lệch cặp ngoặc của câu thoại
  [...part.replace(/["“][^"“”\n]{0,11}["”]/g, ' ').matchAll(/["“]([^"“”]{12,})["”]/g)]
    .map((m) => m[1].trim())
    .filter((s) => s !== s.toUpperCase() && s.split(/\s+/).length >= 4);

const normLine = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Hai cảnh trùng câu thoại (lỗi thật gặp khi chạy mẫu Đập hộp: cảnh 1 và 2 đọc y một câu) → nhờ AI viết câu mới cho cảnh sau,
 * đúng vai trò của cảnh đó, rồi thay vào. Lỗi AI thì giữ nguyên.
 */
export const fixDuplicateDialogue = async (
  parts: string[],
  idea: string,
  who: string,
  log: (m: string) => void,
  imgs: string[] = []
): Promise<string[]> => {
  const out = [...parts];
  const seen = new Map<string, number>();
  for (let i = 0; i < out.length; i++) {
    for (const line of dialogueLines(out[i])) {
      const key = normLine(line);
      // Trùng cả khi chỉ khác vài chữ (lỗi thật: "chảo chống dính ceramic này xinh quá" / "chảo chống dính này xinh quá trời") — ≥ 60% từ chung
      let prev = seen.get(key);
      if (prev === undefined) {
        const w = new Set(key.split(' '));
        for (const [k2, i2] of seen) {
          const w2 = new Set(k2.split(' '));
          const common = [...w].filter((x) => w2.has(x)).length;
          if (i2 !== i && common / Math.max(w.size, w2.size) >= 0.6) {
            prev = i2;
            break;
          }
        }
      }
      if (prev === i) continue; // lặp lại trong cùng 1 cảnh (vd. nhắc lại câu thoại trong khóa khớp miệng) — không phải lỗi
      if (prev === undefined) {
        seen.set(key, i);
        continue;
      }
      try {
        const r = await aiText(
          `Kịch bản video ngắn:\n${idea.slice(0, 800)}\n\nCảnh ${i + 1}:\n${out[i]}\n\n` +
            `Câu thoại "${line}" của cảnh ${i + 1} bị TRÙNG với cảnh ${prev + 1}. Viết 1 câu thoại tiếng Việt MỚI cho cảnh ${i + 1}, ` +
            'đúng hành động và vai trò của cảnh này, cùng người nói, cùng độ dài, không lặp ý cảnh trước. Chỉ trả về đúng câu thoại, không ngoặc kép.',
          imgs
        );
        const fresh = r.text.replace(/["“”]/g, '').split('\n').map((s) => s.trim()).find((s) => s.length > 8);
        if (fresh && !seen.has(normLine(fresh))) {
          out[i] = out[i].split(line).join(fresh);
          seen.set(normLine(fresh), i);
          log(`${who}: cảnh ${i + 1} trùng thoại cảnh ${prev + 1} → viết lại: "${short(fresh, 80)}"`);
        }
      } catch {
        /* giữ nguyên */
      }
    }
  }
  return out;
};

/** Câu trả lời của AI không phải kịch bản: hỏi lại người dùng, hoặc các đoạn quá ngắn (< 120 ký tự) */
/** Câu nói chuyện / hỏi lại người dùng thay vì prompt (muse.ai có bộ nhớ chung theo tài khoản nên hay "nhớ" dự án cũ và hỏi lại) */
export const CHATTY_RE =
  /bạn muốn|bạn có muốn|bạn chọn|bạn thích bản|anh chốt|chốt giúp|em chưa viết|em sẽ sửa|em đối chiếu|anh muốn|khoan,|mình hỏi lại|which (one|version)|do you want/i;

export const badScript = (raw: string, parts: string[], count: number): boolean =>
  CHATTY_RE.test(raw) ||
  !parts.length ||
  parts.slice(0, count).some((p) => p.length < 120);

export const splitScript = (raw: string, count: number, idea: string, firstIsChar: boolean): string[] => {
  let parts = parseScriptParts(raw);
  if (parts.length < count) {
    const lines = raw.split('\n').map((l) => l.replace(/^\s*(?:đoạn|cảnh|scene)?\s*\d+[.:)\-]\s*/i, '').trim()).filter((l) => l.length > 25);
    if (lines.length >= count) parts = lines.slice(0, count);
  }
  const clean = idea.replace(/\s+/g, ' ').slice(0, 220) || 'Video ngắn liền mạch với nhân vật đồng nhất';
  const scenes = firstIsChar && count >= 2 ? count - 1 : count;
  while (parts.length < count) {
    const k = parts.length;
    if (firstIsChar && k === 0) {
      parts.push(`Ảnh chân dung nhân vật chính cho "${clean}": 1 người, 1 khung hình, nền studio sáng, khóa khuôn mặt, tóc và trang phục.`);
    } else {
      const s = firstIsChar ? k : k + 1;
      parts.push(`CẢNH ${pad2(s)}/${pad2(scenes)} [${dramaticRole(s - 1, scenes)}]: ${clean}. Giữ nguyên khuôn mặt, tóc, trang phục và bối cảnh của các cảnh khác.`);
    }
  }
  return parts.slice(0, count);
};

const autoImagePrompt = (d: FlowNodeData, locks: RefLock[]) => {
  const role = locks[0] || 'character';
  const desc = String(d.prompt || '').trim();
  if (role === 'scene' || (locks.length === 1 && locks[0] === 'scene')) {
    return `Single-frame 4K location reference photo — EMPTY SCENE, NO PEOPLE, no text: wide establishing view showing the full space, furniture, props and lighting clearly. Location: ${desc}`;
  }
  if (role === 'outfit') {
    return (
      'Single-frame 4K fashion wardrobe reference photo — ONE OUTFIT ONLY in ONE SINGLE UNDIVIDED FRAME (NO PEOPLE, NO FACES, NO COLLAGE, NO TEXT). ' +
      `Invisible ghost mannequin on a bright minimal studio background, full garment clearly visible: cut, color, fabric texture. Outfit: ${desc}`
    );
  }
  if (role === 'product') {
    return `Single-frame 4K commercial product reference photo — ONE PRODUCT ONLY, centered, clean bright studio background, sharp details of shape, color, logo and packaging, no people, no text overlay. Product: ${desc}`;
  }
  if (d.sheetPrompt) return String(d.sheetPrompt);
  return (
    'Single-frame solo portrait photo, ONE person only, one single undivided frame (no collage). Front-facing, head and upper body, ' +
    `light-grey studio background, soft even lighting, photorealistic, natural skin texture. Character — ${d.characterName ? d.characterName + ': ' : ''}${desc}`
  );
};

const durationOf = (d: FlowNodeData): ShotDuration => {
  const n = Number(d.duration) || 10;
  return ([2, 4, 6, 8, 10] as ShotDuration[]).reduce((b, x) => (Math.abs(x - n) < Math.abs(b - n) ? x : b), 10 as ShotDuration);
};
const ratioOf = (d: FlowNodeData): AspectRatio => (['9:16', '16:9', '1:1'].includes(String(d.ratio)) ? d.ratio : '9:16') as AspectRatio;

/** Chạy sơ đồ. Trả về số node lỗi. */
export async function runFlow(wf: FlowWorkflow, mode: RunMode, deps: FlowRunDeps): Promise<{ errors: number; outputs: NodeResult[] }> {
  const v = validateWorkflow(wf);
  if (!v.ok) throw new Error(v.errors.join(' '));
  const byId = new Map(wf.nodes.map((n) => [n.id, n]));
  // Trạng thái nội bộ của lượt chạy (kết quả cũ giữ lại theo chế độ chạy)
  const reset =
    mode.kind === 'all'
      ? new Set(wf.nodes.map((n) => n.id))
      : mode.kind === 'from'
        ? downstreamOf(wf, mode.nodeId)
        : mode.kind === 'only'
          ? new Set([mode.nodeId])
          : new Set(wf.nodes.filter((n) => n.data.runStatus !== 'done' || !n.data.results?.length).map((n) => n.id));
  const status = new Map<string, 'pending' | 'running' | 'done' | 'error'>();
  const results = new Map<string, NodeResult[]>();
  const errors = new Map<string, string>();
  wf.nodes.forEach((n) => {
    if (reset.has(n.id)) {
      status.set(n.id, 'pending');
      deps.patchNode(n.id, { runStatus: 'queued', error: '', results: [], progress: undefined });
    } else {
      status.set(n.id, n.data.runStatus === 'done' ? 'done' : 'error');
      results.set(n.id, n.data.results || []);
      if (n.data.runStatus !== 'done') errors.set(n.id, n.data.error || 'chưa chạy');
    }
  });
  // Chỉ chạy 1 node: các node không chạy coi như đã có kết quả
  const parents = (id: string) => wf.edges.filter((e) => e.target === id).map((e) => e.source);

  const inputsOf = (id: string): Input[] => {
    const edges = wf.edges
      .filter((e) => e.target === id)
      .sort((a, b) => {
        const ia = /^video-in-(\d+)$/.exec(String(a.targetHandle))?.[1];
        const ib = /^video-in-(\d+)$/.exec(String(b.targetHandle))?.[1];
        return (ia ? +ia : -1) - (ib ? +ib : -1) || (byId.get(a.source)!.position.x - byId.get(b.source)!.position.x);
      });
    const out: Input[] = [];
    edges.forEach((e) => {
      const kind = portKind(e.targetHandle) as PortKind;
      let res = (results.get(e.source) || []).filter((r) => r.kind === kind);
      const m = /^text-out-(\d+)$/.exec(String(e.sourceHandle));
      if (m) res = res.slice(+m[1], +m[1] + 1);
      res.forEach((r) => out.push({ ...r, handle: String(e.targetHandle), sourceId: e.source }));
    });
    return out;
  };

  /**
   * Ảnh tham chiếu phía trước node: mọi ảnh của các Upload Image (đi ngược mọi nhánh) + ảnh nhân vật / sản phẩm
   * được nhắc bằng @ / @@ trong prompt. Xếp Nhân vật → Trang phục → Sản phẩm → Bối cảnh (như HND), bỏ trùng.
   */
  const collectRefs = (id: string, mentionRefs: RefItem[] = []): RefItem[] => {
    const seen = new Set<string>();
    const stack = parents(id);
    const refs: RefItem[] = [];
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const n = byId.get(cur)!;
      if (n.type === 'upload-image') {
        const base = (Number(n.data.batchOrder) || 99) * 10000 + n.position.x + n.position.y / 1000;
        (results.get(cur) || [])
          .filter((r) => r.kind === 'image')
          .forEach((r, k) =>
            refs.push({
              value: r.value,
              roles: r.roles?.length ? r.roles : locksOf(n.data),
              name: r.name || String(n.data.characterName || n.data.characterTag || '').replace(/^@/, '') || undefined,
              desc: r.desc ?? String(n.data.prompt || '').trim(),
              ai: r.ai,
              order: base + k,
            })
          );
      }
      stack.push(...parents(cur));
    }
    const all = [...refs, ...mentionRefs];
    const uniq = all.filter((r, i) => all.findIndex((x) => x.value === r.value) === i);
    return uniq.sort((a, b) => ROLE_ORDER[a.roles[0]] - ROLE_ORDER[b.roles[0]] || a.order - b.order);
  };

  /** Mô tả 1 ảnh cho bảng ánh xạ "Ảnh #N" — ảnh khóa nhiều thứ thì ghi rõ khóa đồng thời gì. */
  const refInfo = (r: RefItem): RefImageInfo => {
    const extra = r.roles.length > 1 ? ` (ảnh này khóa đồng thời: ${r.roles.map((x) => ROLE_VI[x]).join(' + ')})` : '';
    return { role: r.roles[0], name: r.name, description: `${r.desc || ''}${extra}`.trim() };
  };

  const label = (n: FlowNode) => String(n.data.batchLabel || n.data.label || NODE_DEFS[n.type].label);

  const execute = async (n: FlowNode): Promise<NodeResult[]> => {
    const d = n.data;
    const ins = inputsOf(n.id);
    const texts = ins.filter((i) => i.kind === 'text').map((i) => i.value);
    const images = ins.filter((i) => i.kind === 'image');
    const videos = ins.filter((i) => i.kind === 'video');
    const stop = () => {
      if (deps.shouldStop()) throw new MuseTaskStoppedError();
    };
    stop();
    switch (n.type) {
      case 'prompt': {
        const t = String(d.prompt || '').trim();
        if (!t) throw new Error('Prompt trống.');
        return [{ kind: 'text', value: t }];
      }
      case 'upload-image': {
        const locks = locksOf(d);
        const out: NodeResult[] = [];
        const ch = locks.includes('character') && d.characterId ? deps.characters?.find((c) => c.id === d.characterId) : undefined;
        const pr = locks.includes('product') && d.productId ? deps.products?.find((p) => p.id === d.productId) : undefined;
        const covered = new Set<RefLock>();
        if (ch?.images[0]) {
          // Nhân vật trong Cài đặt có ≥2 ảnh: ghép 2 ảnh đầu cạnh nhau (thường là toàn thân + cận mặt)
          let chImg = ch.images[0];
          if (ch.images[1] && d.composeFace !== false) {
            try {
              chImg = await composeSideBySide(ch.images[0], ch.images[1]);
            } catch {
              /* không ghép được thì dùng ảnh chính */
            }
          }
          out.push({ kind: 'image', value: chImg, roles: ['character'], name: ch.name, desc: ch.description });
          covered.add('character');
          // Nhân vật có trang phục cố định trong Cài đặt + tích Khóa trang phục mà không tải ảnh riêng
          if (locks.includes('outfit') && ch.outfitImage && !d.image) {
            out.push({ kind: 'image', value: ch.outfitImage, roles: ['outfit'], name: ch.name, desc: `trang phục cố định của ${ch.name}` });
            covered.add('outfit');
          }
        }
        // Lookbook: khối sản phẩm của cảnh i dùng ảnh thứ i (mẫu / màu khác) của sản phẩm, xoay vòng
        const prImg = pr?.images.length ? pr.images[(Number(d.productImageIndex) || 0) % pr.images.length] : '';
        if (pr && prImg && !d.image) {
          out.push({ kind: 'image', value: prImg, roles: ['product'], name: pr.name, desc: pr.images.length > 1 ? `${pr.name} — mẫu / màu số ${((Number(d.productImageIndex) || 0) % pr.images.length) + 1}` : pr.visual || pr.description });
          covered.add('product');
        }
        const rest = locks.filter((l) => !covered.has(l));
        const desc = String(d.prompt || '').trim();
        const name = String(d.characterName || '').replace(/^@/, '') || undefined;
        if (rest.length) {
          if (d.image) {
            let img = String(d.image);
            if (rest.includes('character')) {
              try {
                if (d.sheetCrop) img = await cropCharacterSheet(img);
                else if (d.faceImage) img = await composeSideBySide(img, String(d.faceImage));
              } catch {
                /* không cắt / ghép được thì dùng ảnh gốc */
              }
            }
            out.push({ kind: 'image', value: img, roles: rest, name, desc });
          } else if (desc || d.sheetPrompt) {
            deps.log(`${label(n)}: chưa có ảnh ${rest.map((x) => ROLE_VI[x]).join(' + ')} → AI (muse-image) tự tạo ảnh tham chiếu`);
            const img = await retryNoMedia(() => withBusyRetry(() => generateMuseKeyframe({ ...DEFAULT_MUSE_CONFIG, aspectRatio: '9:16' }, autoImagePrompt(d, rest), []), {
              shouldStop: deps.shouldStop,
              log: deps.log,
              what: label(n),
            }), label(n), deps);
            // Giữ ảnh vừa tạo trong node để các lần chạy sau dùng lại (như HND generatedPath)
            deps.patchNode(n.id, { image: img, fileName: 'AI tự tạo', autoGenerated: true });
            out.push({ kind: 'image', value: img, roles: rest, name, desc });
          }
        }
        // Khối khóa để trống (chưa ảnh, chưa chọn từ Cài đặt, chưa mô tả): bỏ qua, không chặn cả sơ đồ
        if (!out.length) deps.log(`${label(n)}: chưa có ảnh / chưa chọn từ Cài đặt / chưa mô tả → bỏ qua khóa này`);
        // AI nhìn ảnh mô tả lại (khớp đúng ảnh, dùng cho khóa ƯU TIÊN ẢNH) — lưu cache theo ảnh
        if (d.autoDescribe !== false && out.length) {
          const cache: Record<string, string> = { ...((d.aiDescs as Record<string, string>) || {}) };
          for (const r of out) {
            const key = `${r.value.length}:${r.value.slice(-48)}`;
            if (!cache[key]) {
              try {
                cache[key] = await describeReference(r.value, r.roles || locks);
                deps.log(`${label(n)}: AI mô tả ảnh ${r.name || ''} — ${short(cache[key], 90)}`);
              } catch (err: any) {
                deps.log(`${label(n)}: AI mô tả ảnh lỗi (${String(err?.message || err).slice(0, 80)}) — bỏ qua`);
              }
            }
            if (cache[key]) r.ai = cache[key];
          }
          deps.patchNode(n.id, { aiDescs: cache });
        }
        return out;
      }
      case 'gemini-script': {
        const count = Math.max(1, Number(d.outputCount) || 1);
        const rawIdea = [...texts, String(d.prompt || '')].filter((s) => s.trim()).join('\n\n').trim() || wf.description || wf.name;
        const men = resolveMentions(rawIdea, deps.characters, deps.products);
        // Cho AI biết ngoại hình nhân vật / sản phẩm được nhắc để viết đúng mô tả
        const cast = men.refs.map((r) => `- ${r.roles[0] === 'product' ? 'Sản phẩm' : 'Nhân vật @'}${r.name}: ${r.desc || ''}`).join('\n');
        const idea = cast ? `${men.text}\n\nNhân vật / sản phẩm phải giữ đúng mô tả:\n${cast}` : men.text;
        const imgs = await Promise.all([...images.map((i) => i.value), ...men.refs.map((r) => r.value)].slice(0, 4).map((v) => toDataUrl(v)));
        const first = !!d.firstOutputIsCharacter;
        let raw = '';
        const secs = Math.max(2, Math.min(10, Number(d.sceneSeconds) || 10));
        try {
          const r = await withBusyRetry(() => aiText(scriptInstruction(idea, count, first, secs), imgs), { shouldStop: deps.shouldStop, log: deps.log, what: label(n) });
          raw = r.text;
          deps.log(`${label(n)}: AI viết kịch bản (${r.source})`);
          // AI trả thiếu đoạn (thường do câu trả lời dài bị cắt) → nhờ viết tiếp đúng các đoạn còn thiếu
          let got = parseScriptParts(raw);
          // AI hỏi lại / trả lời cụt (lỗi thật: muse-chat hỏi "Bạn muốn giữ bản nào?" → 5 "cảnh" vô nghĩa) → bắt viết lại 1 lần
          if (badScript(raw, got, count)) {
            stop();
            deps.log(`${label(n)}: AI trả lời không phải kịch bản (hỏi lại / quá ngắn) → yêu cầu viết lại`);
            const again = await aiText(
              `${scriptInstruction(idea, count, first, secs)}

Câu trả lời trước KHÔNG HỢP LỆ (hỏi lại hoặc quá ngắn). ` +
                'Không hỏi gì cả, tự quyết theo ảnh tham chiếu, viết NGAY đủ các đoạn prompt chi tiết.',
              imgs
            );
            const p2 = parseScriptParts(again.text);
            if (!badScript(again.text, p2, count) || p2.length > got.length) {
              raw = again.text;
              got = p2;
            }
          }
          for (let tries = 0; got.length < count && got.length > 0 && tries < 2; tries++) {
            stop();
            const missing = count - got.length;
            deps.log(`${label(n)}: AI mới viết ${got.length}/${count} đoạn → viết tiếp ${missing} đoạn còn thiếu`);
            let more: { text: string };
            try {
              more = await aiText(
                `${scriptInstruction(idea, count, first, secs)}\n\nĐÃ VIẾT ${got.length} đoạn đầu:\n${got.join('\n---\n')}\n\n` +
                  `Hãy viết TIẾP đúng ${missing} đoạn còn lại (đoạn ${got.length + 1}..${count}), cùng định dạng, ngăn cách bằng dòng ---. ` +
                  'Không lặp lại các đoạn đã viết.',
                imgs,
              );
            } catch (err: any) {
              // Lỗi khi viết tiếp: giữ các đoạn đã có, phần thiếu dùng khung dựng sẵn (không bỏ cả kịch bản AI)
              deps.log(`${label(n)}: viết tiếp lỗi (${String(err?.message || err).slice(0, 80)}) — giữ ${got.length} đoạn đã viết`);
              break;
            }
            const add = parseScriptParts(more.text).filter((p) => !got.some((g) => g.trim() === p.trim()));
            if (!add.length) break;
            got = [...got, ...add];
          }
          // Từng đoạn: là câu nói chuyện / hỏi lại hoặc quá ngắn → viết lại riêng đoạn đó (vẫn hỏng thì dùng khung dựng sẵn ở splitScript)
          for (let i = 0; i < Math.min(got.length, count); i++) {
            if (!CHATTY_RE.test(got[i]) && got[i].length >= 120) continue;
            stop();
            deps.log(`${label(n)}: đoạn ${i + 1} không phải prompt cảnh (hỏi lại / quá ngắn) → viết lại riêng đoạn này`);
            try {
              const one = await aiText(
                `${scriptInstruction(idea, count, first, secs)}

CHỈ viết DUY NHẤT đoạn ${i + 1}/${count} (không viết đoạn khác, không hỏi lại).` +
                  (i > 0 ? `
Đoạn ${i} trước đó để nối tiếp:
${got[i - 1]}` : ''),
                imgs
              );
              const p1 = parseScriptParts(one.text)[0] || '';
              got[i] = !CHATTY_RE.test(p1) && p1.length >= 120 ? p1 : '';
            } catch {
              got[i] = '';
            }
          }
          if (got.some((x) => !x)) {
            const fb = splitScript('', count, idea, first);
            got = got.map((x, i) => x || fb[i] || fb[fb.length - 1]);
          }
          // Câu thoại trùng giữa các cảnh (AI hay chép lại thoại cảnh trước) → nhờ viết lại thoại của cảnh sau
          got = await fixDuplicateDialogue(got, idea, label(n), deps.log, imgs);
          raw = got.join('\n---\n');
        } catch (err: any) {
          deps.log(`${label(n)}: AI lỗi (${String(err?.message || err).slice(0, 120)}) → dùng khung dựng sẵn`);
        }
        return splitScript(raw, count, idea, first).map((t) => ({ kind: 'text' as const, value: t }));
      }
      case 'generate-image': {
        const men = resolveMentions(texts.join('\n').trim() || String(d.prompt || '').trim(), deps.characters, deps.products);
        const prompt = men.text;
        if (!prompt) throw new Error('Thiếu prompt (nối text-in hoặc nhập Prompt).');
        const ups = collectRefs(n.id, men.refs);
        const refs: ReferenceImage[] = [];
        const toRole = (r: RefLock): ReferenceImage['role'] => (r === 'scene' ? 'product' : r);
        for (const r of [...ups.map((u) => ({ value: u.value, role: toRole(u.roles[0]), name: u.name || ROLE_VI[u.roles[0]] })), ...images.map((i) => ({ value: i.value, role: 'product' as ReferenceImage['role'], name: 'ảnh vào' }))]) {
          if (refs.some((x) => x.id === r.value.slice(-40))) continue;
          refs.push({ id: r.value.slice(-40), role: r.role, dataUrl: await toDataUrl(r.value), name: r.name });
        }
        const useRefs = d.imageMode === 'image-to-image' || refs.length ? refs.slice(0, 4) : [];
        // Prompt cảnh thường viết cho video ("Video 10 giây...") → muse.ai trả video thay vì ảnh.
        // Ép rõ: 1 ẢNH TĨNH = khung hình tiêu biểu / mở đầu của cảnh.
        const stillPrompt =
          `ONE SINGLE STILL PHOTO (ảnh tĩnh, KHÔNG tạo video, không chuyển động), tỉ lệ ${ratioOf(d)}, photorealistic. ` +
          `Chụp khung hình mở đầu tiêu biểu của cảnh sau:\n${prompt}`;
        const out: NodeResult[] = [];
        for (let k = 0; k < Math.max(1, Math.min(4, Number(d.count) || 1)); k++) {
          stop();
          out.push({
            kind: 'image',
            value: await retryNoMedia(() => withBusyRetry(() => generateMuseKeyframe({ ...DEFAULT_MUSE_CONFIG, aspectRatio: ratioOf(d) }, stillPrompt, useRefs), {
              shouldStop: deps.shouldStop,
              log: deps.log,
              what: label(n),
            }), label(n), deps),
          });
        }
        return out;
      }
      case 'generate-video': {
        const men = resolveMentions(texts.join('\n').trim() || String(d.prompt || '').trim(), deps.characters, deps.products);
        let text = men.text;
        if (!text) throw new Error('Thiếu prompt (nối text-in hoặc nhập Prompt).');
        // Có nhắc @nhân vật / @@sản phẩm thì Text→Video cũng dùng ảnh tham chiếu
        const m = d.videoMode === 'text-to-video' && men.refs.length ? 'reference-to-video' : d.videoMode || 'text-to-video';
        let firstFrame = '';
        const refItems: { value: string; info: RefImageInfo; ai?: string }[] = [];
        if (m !== 'text-to-video') {
          const start = images.find((i) => i.handle === 'image-in-start');
          const end = images.find((i) => i.handle === 'image-in-end');
          const direct = images.filter((i) => i.handle === 'image-in');
          const ups = collectRefs(n.id, men.refs);
          const upVals = new Set(ups.map((u) => u.value));
          // Khung mở đầu = ảnh nối thẳng vào image-in mà KHÔNG phải ảnh khóa (Upload Image),
          // vd. ảnh khung hình do Generate Image tạo — dù ảnh khóa nối vào trước
          if (m === 'image-to-video') firstFrame = direct.find((i) => !upVals.has(i.value))?.value || '';
          if (m === 'frame-to-frame' && start) firstFrame = start.value;
          ups.forEach((u) => refItems.push({ value: u.value, info: refInfo(u), ai: u.ai }));
          direct
            .filter((i) => i.value !== firstFrame && !upVals.has(i.value))
            .forEach((i) => refItems.push({ value: i.value, info: { role: 'keyframe' } }));
          if (end) {
            refItems.push({ value: end.value, info: { role: 'keyframe' } });
            text += '\nCảnh kết thúc đúng tư thế / bố cục của ảnh khung cuối đính kèm.';
          }
        }
        // Tạo ẢNH KHUNG HÌNH trước (muse-image + ảnh tham chiếu) rồi làm khung mở đầu video.
        // Thí nghiệm mẫu Gia đình: tỉ lệ khung hình đúng người Bố 6% → 87%, Mẹ 7% → 48% so với Reference-to-Video thẳng.
        if (d.keyframeFirst && !firstFrame && m !== 'text-to-video' && refItems.some((r) => r.info.role !== 'keyframe')) {
          const kf = refItems.filter((r) => r.info.role !== 'keyframe').slice(0, 4);
          const kfRefs: ReferenceImage[] = await Promise.all(
            kf.map(async (r, i) => ({
              id: `kf${i}`,
              role: (r.info.role === 'scene' ? 'product' : r.info.role) as ReferenceImage['role'],
              dataUrl: await toDataUrl(r.value),
              name: r.info.name || ROLE_VI[r.info.role as RefLock] || 'ref',
            }))
          );
          const who = kf.map((r, i) => `Ảnh #${i + 1} = ${r.info.name ? '@' + r.info.name : ROLE_VI[r.info.role as RefLock]}${r.ai ? `: ${r.ai}` : ''}`).join('; ');
          // Cảnh không có khóa nhân vật (POV chỉ thấy tay, sản phẩm) → không đòi "nhìn rõ mặt" (gây lộ mặt / môi)
          const hasPeople = kf.some((r) => r.info.role === 'character');
          const still =
            `ONE SINGLE STILL PHOTO (ảnh tĩnh, KHÔNG tạo video), tỉ lệ ${ratioOf(d)}, photorealistic — khung hình MỞ ĐẦU của cảnh sau. ` +
            (hasPeople
              ? `Giữ y hệt khuôn mặt, kiểu tóc, trang phục, sản phẩm như ảnh tham chiếu (${who}). Mọi nhân vật nhìn rõ mặt, đứng / ngồi đúng vị trí đầu cảnh.\n`
              : `Giữ y hệt sản phẩm / bao bì (hình in, chữ, màu sắc thật) và bối cảnh như ảnh tham chiếu (${who}); màu sản phẩm tươi đúng ảnh, không tối, không ám màu. ` +
                'KHÔNG có mặt người (nếu cần chỉ thấy đôi tay).\n') +
            text;
          deps.log(`${label(n)}: tạo ảnh khung hình mở đầu trước (giữ mặt / trang phục tốt hơn)…`);
          firstFrame = await retryNoMedia(() => withBusyRetry(() => generateMuseKeyframe({ ...DEFAULT_MUSE_CONFIG, aspectRatio: ratioOf(d) }, still, kfRefs), {
            shouldStop: deps.shouldStop,
            log: deps.log,
            what: label(n),
          }), label(n), deps);
          deps.patchNode(n.id, { keyframe: firstFrame });
        }
        // muse.ai nhận tối đa 4 ảnh / tin nhắn: có khung mở đầu thì còn 3 chỗ cho tham chiếu
        const refs = refItems.slice(0, firstFrame ? 3 : 4);
        if (refItems.length > refs.length) deps.log(`${label(n)}: ${refItems.length} ảnh tham chiếu, muse.ai chỉ nhận ${refs.length} — bỏ bớt ảnh cuối`);
        const hasMap = /BẢNG ÁNH XẠ|ATTACHMENT ROLES|\[Khóa đồng nhất/i.test(text);
        // Prompt tự mang số ảnh (mẫu HND: "Ảnh #1 = Bố") nhưng khung mở đầu được gửi làm ảnh ĐẦU TIÊN → mọi số ảnh lệch 1
        // (lỗi thật mẫu Gia đình: model nhầm ai là Ảnh #1 → Mẹ nói lời của Bố). Dời số ảnh +1 và ghi rõ Ảnh #1 = khung mở đầu.
        if (firstFrame && /Ảnh(?:\s+tham\s+chiếu)?\s*#\s*\d|Image\s+\d/i.test(text)) {
          text =
            '[Ảnh #1 / Image 1 = KHUNG HÌNH MỞ ĐẦU của cảnh (không phải nhân vật / sản phẩm); ảnh tham chiếu bắt đầu từ Ảnh #2]\n' +
            text.replace(/(Ảnh(?:\s+tham\s+chiếu)?\s*#\s*|Image\s+)(\d+)/gi, (_m, a: string, d: string) => `${a}${Number(d) + 1}`);
        }
        // Có khung mở đầu: muse.ai nhận nó là ảnh đầu tiên → bảng ánh xạ phải tính nó là Ảnh #1, khớp số với khóa ƯU TIÊN ẢNH bên dưới
        // (trước đây bảng ánh xạ ghi hộp = Ảnh #1 trong khi khóa ưu tiên ghi hộp = Ảnh #2 → model vẽ lại bao bì).
        // Mô tả ảnh: ưu tiên bản AI nhìn ảnh tả lại (khớp đúng ảnh) thay cho chữ nhập tay / chữ hướng dẫn của mẫu.
        const mapInfos: RefImageInfo[] = [
          ...(firstFrame ? [{ role: 'keyframe' as const }] : []),
          ...refs.map((r) => (r.ai && r.info.role !== 'keyframe' ? { ...r.info, description: r.ai } : r.info)),
        ];
        let prompt =
          refs.length && !hasMap
            ? buildReferencePrompt({ images: mapInfos, scenePrompt: text, realism: true })
            : text;
        // Khóa ƯU TIÊN ẢNH: prompt (nhất là prompt mẫu HND) hay mô tả trang phục / ngoại hình khác ảnh thật
        // → model bám chữ, đổi màu áo, sai người. Nhắc lại ở CUỐI prompt: chữ khác ảnh thì theo ảnh.
        const pri = refs.filter((r) => r.info.role !== 'keyframe');
        if (pri.length && d.imagePriority !== false) {
          const shift = firstFrame ? 1 : 0;
          const lines = pri.map((r) => {
            const k = refs.indexOf(r) + 1 + shift;
            const who = r.info.role === 'character' ? `${r.info.name ? '@' + r.info.name : 'nhân vật'}` : ROLE_VI[r.info.role as RefLock] || 'tham chiếu';
            return `Ảnh #${k} = ${who}${r.ai ? `: ${r.ai}` : ''}`;
          });
          prompt +=
            `\n[ƯU TIÊN ẢNH THAM CHIẾU (QUAN TRỌNG NHẤT): nếu mô tả chữ ở trên khác với ảnh đính kèm thì LUÔN làm theo ảnh. ${lines.join('; ')}. ` +
            'Giữ y hệt khuôn mặt, kiểu tóc, màu tóc, kính, trang phục (màu, kiểu dáng, họa tiết) và sản phẩm (hình dáng, màu, logo) như trong ảnh ở MỌI khung hình; ' +
            'không đổi màu áo, không thêm / bớt phụ kiện, không thay sản phẩm khác, không tráo mặt giữa các nhân vật.' +
            // Thí nghiệm POV Hồng treo gió: chữ tả sai màu ("phủ phấn trắng", "cam nâu") + ánh sáng tối → sản phẩm sẫm, bao bì bị vẽ lại
            (pri.some((r) => r.info.role === 'product')
              ? ' SẢN PHẨM & BAO BÌ: màu sản phẩm tươi, sáng đúng như ảnh (không sẫm, không ám vàng / nâu); bao bì giữ y hệt hình in, chữ, bố cục như ảnh — không vẽ lại.'
              : '') +
            ']';
        }
        const ff = firstFrame ? await toDataUrl(firstFrame) : '';
        const refData = await Promise.all(refs.map((r) => toDataUrl(r.value)));
        // muse.ai đôi khi trả lời bằng chữ thay vì video ("replied with text only…") → tạo lại tối đa 2 lần
        const createVideo = async () => {
          for (let k = 0; ; k++) {
            try {
              return await createOnce();
            } catch (err: any) {
              if (k >= 2 || deps.shouldStop() || !/text only|no video|did not (produce|return) a video|Timeout|quá thời gian chờ|báo lỗi trong lúc render/i.test(String(err?.message || err))) throw err;
              deps.log(`${label(n)}: muse.ai không trả video (trả lời bằng chữ / lỗi render / quá giờ) → tạo lại (lần ${k + 2})`);
            }
          }
        };
        const createOnce = () => withBusyRetry(
          () =>
            createAndPollMuseVideo(
              { ...DEFAULT_MUSE_CONFIG, aspectRatio: ratioOf(d), duration: durationOf(d), voice: String(d.voice || '') },
              prompt,
              ff,
              (taskId) => deps.patchNode(n.id, { taskId }),
              {
                shouldStop: deps.shouldStop,
                onProgress: (progress) => deps.patchNode(n.id, { progress }),
                onAccount: (accountId) => deps.patchNode(n.id, { accountId }),
              },
              refData
            ),
          { shouldStop: deps.shouldStop, log: deps.log, what: label(n) }
        );
        const url = await createVideo();
        let path: string | undefined;
        try {
          path = (await exportVideo(url, deps.project, `${stamp()}_${label(n).replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40)}`)).path;
        } catch {
          /* lưu file lỗi không làm hỏng node */
        }
        return [{ kind: 'video', value: url, path }];
      }
      case 'upscale-image': {
        const side = String(d.resolution).toUpperCase() === '4K' ? 2160 : 1440;
        return Promise.all(images.map(async (i) => ({ kind: 'image' as const, value: abs((await upscaleMedia(await toGatewayMedia(i.value), side)).url) })));
      }
      case 'upscale-video': {
        const side = String(d.resolution).toUpperCase() === '4K' ? 2160 : 1080;
        return Promise.all(
          videos.map(async (i) => {
            try {
              return { kind: 'video' as const, value: abs((await upscaleMedia(await toGatewayMedia(i.value), side)).url) };
            } catch (err: any) {
              if (/không cần nâng/i.test(String(err?.message))) return { kind: 'video' as const, value: i.value };
              throw err;
            }
          })
        );
      }
      case 'remove-image-logo':
      case 'remove-video-logo': {
        const spots = (d.spots?.length ? d.spots : ['br']) as string[];
        const regions = LOGO_SPOTS.filter((s) => spots.includes(s.id)).map((s) => s.region);
        const list = n.type === 'remove-image-logo' ? images : videos;
        return Promise.all(
          list.map(async (i) => ({ kind: i.kind, value: abs((await blurRegions(await toGatewayMedia(i.value), regions, 'blur', 24)).url) }))
        );
      }
      case 'extract-endframe':
        return Promise.all(videos.map(async (i) => ({ kind: 'image' as const, value: abs((await cutFrame(await toGatewayMedia(i.value))).url) })));
      case 'merge-video': {
        if (videos.length < 2) {
          if (videos.length === 1) return [{ kind: 'video', value: videos[0].value, path: videos[0].path }];
          throw new Error('Merge Video chưa có video nào.');
        }
        const urls = await Promise.all(videos.map((v) => toGatewayMedia(v.value)));
        const r = await mergeVideos(urls, deps.project, `${stamp()}_GHEP_${videos.length}_CANH`);
        return [{ kind: 'video', value: r.url, path: r.path }];
      }
      case 'result': {
        if (!ins.length) throw new Error('Result chưa có đầu vào.');
        const out: NodeResult[] = [];
        for (const i of ins) {
          let path = i.path;
          if (!path && i.kind !== 'text') {
            try {
              path = (await exportVideo(await toGatewayMedia(i.value), deps.project, `${stamp()}_KET_QUA_${out.length + 1}`)).path;
            } catch {
              /* bỏ qua */
            }
          }
          out.push({ kind: i.kind, value: i.value, path });
        }
        return out.sort((a, b) => ({ video: 0, image: 1, text: 2 })[a.kind] - ({ video: 0, image: 1, text: 2 })[b.kind]);
      }
    }
  };

  const isMedia = (n: FlowNode) => n.type === 'generate-video' || n.type === 'generate-image' || (n.type === 'upload-image' && !n.data.image);
  const running = new Set<Promise<void>>();
  let mediaRunning = 0;

  const start = (n: FlowNode) => {
    status.set(n.id, 'running');
    const media = isMedia(n);
    if (media) mediaRunning++;
    const t0 = Date.now();
    deps.patchNode(n.id, { runStatus: 'running', startedAt: t0, finishedAt: undefined, error: '' });
    deps.log(`▶ ${label(n)}`);
    const p = execute(n)
      .then((res) => {
        if (!res.length && n.type !== 'upload-image') throw new Error('Node không tạo ra kết quả.');
        results.set(n.id, res);
        status.set(n.id, 'done');
        deps.patchNode(n.id, { runStatus: 'done', results: res, finishedAt: Date.now(), progress: undefined });
        deps.log(`✓ ${label(n)} (${Math.round((Date.now() - t0) / 1000)}s)`);
      })
      .catch((err) => {
        const msg = err instanceof MuseTaskStoppedError || deps.shouldStop() ? STOPPED_MSG : String(err?.message || err);
        errors.set(n.id, msg);
        status.set(n.id, 'error');
        deps.patchNode(n.id, { runStatus: 'error', error: msg, finishedAt: Date.now() });
        deps.log(`✗ ${label(n)}: ${msg}`);
      })
      .finally(() => {
        if (media) mediaRunning--;
        running.delete(p);
      });
    running.add(p);
  };

  // Vòng lập lịch
  for (;;) {
    let progressed = false;
    for (const id of v.order) {
      if (status.get(id) !== 'pending') continue;
      const ps = parents(id);
      if (ps.some((p) => ['pending', 'running'].includes(status.get(p)!))) continue;
      const n = byId.get(id)!;
      const failed = ps.filter((p) => status.get(p) === 'error');
      if (failed.length) {
        const why = failed.map((p) => label(byId.get(p)!)).join(', ');
        errors.set(id, `Bị chặn bởi node lỗi: ${why}`);
        status.set(id, 'error');
        deps.patchNode(id, { runStatus: 'skipped', error: `Bị chặn bởi node lỗi: ${why}` });
        progressed = true;
        continue;
      }
      if (deps.shouldStop()) {
        status.set(id, 'error');
        errors.set(id, STOPPED_MSG);
        deps.patchNode(id, { runStatus: 'idle', error: STOPPED_MSG });
        progressed = true;
        continue;
      }
      if (isMedia(n) && mediaRunning >= Math.max(1, deps.threads())) continue;
      start(n);
      progressed = true;
    }
    if (!running.size && !progressed) break;
    if (running.size && !progressed) await Promise.race(running);
  }

  const outputs: NodeResult[] = [];
  wf.nodes
    .filter((n) => n.type === 'result' || !wf.edges.some((e) => e.source === n.id))
    .forEach((n) => (results.get(n.id) || []).forEach((r) => r.kind !== 'text' && outputs.push(r)));
  const errCount = [...status.values()].filter((s) => s === 'error').length;
  deps.log(errCount ? `Workflow kết thúc: ${errCount} node lỗi / bị chặn` : '✅ Workflow hoàn thành');
  return { errors: errCount, outputs };
}
