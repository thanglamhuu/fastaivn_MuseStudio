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
import { urlToResizedDataUrl } from '../../utils/image';
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
    'Chỉ trả về các đoạn prompt, không giải thích, không đánh số tiêu đề thừa.'
  );
};

export const splitScript = (raw: string, count: number, idea: string, firstIsChar: boolean): string[] => {
  let parts = raw
    .replace(/```[a-z]*\n?/gi, '')
    .split(/\n\s*-{3,}\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
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
          out.push({ kind: 'image', value: ch.images[0], roles: ['character'], name: ch.name, desc: ch.description });
          covered.add('character');
          // Nhân vật có trang phục cố định trong Cài đặt + tích Khóa trang phục mà không tải ảnh riêng
          if (locks.includes('outfit') && ch.outfitImage && !d.image) {
            out.push({ kind: 'image', value: ch.outfitImage, roles: ['outfit'], name: ch.name, desc: `trang phục cố định của ${ch.name}` });
            covered.add('outfit');
          }
        }
        if (pr?.images[0]) {
          out.push({ kind: 'image', value: pr.images[0], roles: ['product'], name: pr.name, desc: pr.visual || pr.description });
          covered.add('product');
        }
        const rest = locks.filter((l) => !covered.has(l));
        const desc = String(d.prompt || '').trim();
        const name = String(d.characterName || '').replace(/^@/, '') || undefined;
        if (rest.length) {
          if (d.image) {
            out.push({ kind: 'image', value: String(d.image), roles: rest, name, desc });
          } else if (desc || d.sheetPrompt) {
            deps.log(`${label(n)}: chưa có ảnh ${rest.map((x) => ROLE_VI[x]).join(' + ')} → AI (muse-image) tự tạo ảnh tham chiếu`);
            const img = await generateMuseKeyframe({ ...DEFAULT_MUSE_CONFIG, aspectRatio: '9:16' }, autoImagePrompt(d, rest), []);
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
        try {
          const r = await aiText(scriptInstruction(idea, count, first, Math.max(2, Math.min(10, Number(d.sceneSeconds) || 10))), imgs);
          raw = r.text;
          deps.log(`${label(n)}: AI viết kịch bản (${r.source})`);
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
          out.push({ kind: 'image', value: await generateMuseKeyframe({ ...DEFAULT_MUSE_CONFIG, aspectRatio: ratioOf(d) }, stillPrompt, useRefs) });
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
          if (m === 'image-to-video' && direct[0] && !upVals.has(direct[0].value)) firstFrame = direct[0].value;
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
        // muse.ai nhận tối đa 4 ảnh / tin nhắn: có khung mở đầu thì còn 3 chỗ cho tham chiếu
        const refs = refItems.slice(0, firstFrame ? 3 : 4);
        if (refItems.length > refs.length) deps.log(`${label(n)}: ${refItems.length} ảnh tham chiếu, muse.ai chỉ nhận ${refs.length} — bỏ bớt ảnh cuối`);
        const hasMap = /BẢNG ÁNH XẠ|ATTACHMENT ROLES|\[Khóa đồng nhất/i.test(text);
        let prompt =
          refs.length && !hasMap
            ? buildReferencePrompt({ images: refs.map((r) => r.info), scenePrompt: text, realism: true })
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
            'không đổi màu áo, không thêm / bớt phụ kiện, không thay sản phẩm khác, không tráo mặt giữa các nhân vật.]';
        }
        const ff = firstFrame ? await toDataUrl(firstFrame) : '';
        const refData = await Promise.all(refs.map((r) => toDataUrl(r.value)));
        const url = await createAndPollMuseVideo(
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
        );
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
