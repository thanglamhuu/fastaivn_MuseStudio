// Sơ đồ khối workflow: định nghĩa các loại khối, luật nối dây, và dịch sơ đồ <-> WorkflowTemplate.
// Sơ đồ chỉ là cách lắp mẫu trực quan; khi chạy, sơ đồ được dịch thành WorkflowTemplate và chạy
// bằng đúng bộ máy của tab Workflow (workflowRunner.ts).
import type { WorkflowTemplate } from '../types/workflow';
import type { ScriptMode } from './productService';

export type BlockKind =
  | 'product'
  | 'character'
  | 'outfit'
  | 'script'
  | 'prompts'
  | 'dialogue'
  | 'render'
  | 'merge'
  | 'blur'
  | 'upscale'
  | 'result';

export type CharSource = 'library' | 'upload' | 'row';

export interface BlockData {
  kind: BlockKind;
  // script
  scriptMode?: ScriptMode;
  scriptTemplateId?: string;
  sceneCount?: number;
  withDialogue?: boolean;
  extraNote?: string;
  // prompts
  prompts?: string;
  // character
  autoPortrait?: boolean;
  /**
   * Nguồn nhân vật của khối:
   * - library: chọn nhân vật đã cấu hình trong Cài đặt
   * - upload: tải ảnh lên ngay trong khối (tự lưu thành nhân vật mới trong thư viện)
   * - row: lấy nhân vật của từng dòng (cách cũ)
   */
  charSource?: CharSource;
  /** Nhân vật trong thư viện (nguồn library / upload) */
  characterId?: string;
  // outfit
  /** Ảnh trang phục tải lên (data URL); trống = AI tự tạo theo mô tả lúc chạy */
  outfitImage?: string;
  outfitDesc?: string;
  // render
  duration?: number;
  aspectRatio?: string;
  cameraMotion?: string;
  chainEndFrame?: boolean;
  rotateProductImages?: boolean;
  refMode?: 'reference' | 'firstframe';
  setting?: string;
  realismLock?: boolean;
  // upscale
  shortSide?: number;
  // blur
  spots?: string[];
  [key: string]: unknown;
}

export interface GraphNode {
  id: string;
  type: 'block';
  position: { x: number; y: number };
  data: BlockData;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
}

export const BLOCKS: Record<BlockKind, { icon: string; label: string; hint: string; color: string }> = {
  product: { icon: '🛒', label: 'Sản phẩm', hint: 'Lấy từ dòng: thư viện hoặc link Shopee/TikTok', color: '#0ea5e9' },
  character: { icon: '👤', label: 'Nhân vật', hint: 'Chọn từ thư viện / tải ảnh lên / theo dòng (khóa mặt + giọng)', color: '#a855f7' },
  outfit: { icon: '👗', label: 'Trang phục', hint: 'Ảnh trang phục, hoặc mô tả để AI tự tạo ảnh — gửi kèm mọi cảnh', color: '#ec4899' },
  script: { icon: '✍️', label: 'AI viết kịch bản', hint: 'Gemini / OpenAI / muse-chat', color: '#6366f1' },
  prompts: { icon: '📝', label: 'Prompt nhập tay', hint: 'Mỗi dòng 1 cảnh, {product} = tên SP', color: '#6366f1' },
  dialogue: { icon: '🎭', label: 'Tách vai lời thoại', hint: 'Mỗi lượt thoại 1 shot đúng giọng', color: '#d946ef' },
  render: { icon: '🎬', label: 'Render cảnh', hint: 'muse-video, song song theo số luồng', color: '#10b981' },
  merge: { icon: '🎞', label: 'Ghép clip', hint: 'FFmpeg nối các cảnh', color: '#f59e0b' },
  blur: { icon: '🫥', label: 'Làm mờ watermark', hint: 'Làm mờ vùng logo ở góc', color: '#f43f5e' },
  upscale: { icon: '⬆️', label: 'Nâng độ phân giải', hint: 'FFmpeg lanczos + làm nét', color: '#f43f5e' },
  result: { icon: '✅', label: 'Kết quả', hint: 'File clip cuối trong thư mục dự án', color: '#22c55e' },
};

/** Khối nào được nối vào khối nào (nguồn -> đích). */
const ALLOWED: Record<BlockKind, BlockKind[]> = {
  product: ['script', 'prompts', 'render'],
  character: ['script', 'prompts', 'render'],
  outfit: ['script', 'prompts', 'render'],
  script: ['dialogue', 'render'],
  prompts: ['dialogue', 'render'],
  dialogue: ['render'],
  render: ['merge', 'blur', 'upscale', 'result'],
  merge: ['blur', 'upscale', 'result'],
  blur: ['upscale', 'result'],
  upscale: ['blur', 'result'],
  result: [],
};

export const canConnect = (from?: BlockKind, to?: BlockKind) => !!from && !!to && ALLOWED[from].includes(to);
export const hasInput = (k: BlockKind) => k !== 'product' && k !== 'character' && k !== 'outfit';
export const hasOutput = (k: BlockKind) => k !== 'result';

export const WATERMARK_SPOTS: { id: string; label: string; region: { x: number; y: number; w: number; h: number } }[] = [
  { id: 'tl', label: 'Trên trái', region: { x: 0.02, y: 0.02, w: 0.34, h: 0.08 } },
  { id: 'tr', label: 'Trên phải', region: { x: 0.64, y: 0.02, w: 0.34, h: 0.08 } },
  { id: 'bl', label: 'Dưới trái', region: { x: 0.02, y: 0.9, w: 0.34, h: 0.08 } },
  { id: 'br', label: 'Dưới phải', region: { x: 0.64, y: 0.9, w: 0.34, h: 0.08 } },
];

export const defaultData = (kind: BlockKind): BlockData => {
  switch (kind) {
    case 'script':
      return { kind, scriptMode: 'tvc5', sceneCount: 4, withDialogue: true, extraNote: '' };
    case 'prompts':
      return { kind, prompts: 'Cận cảnh {product} trên bàn gỗ, ánh sáng ấm\nNhân vật cầm {product} giới thiệu' };
    case 'character':
      return { kind, charSource: 'library', characterId: '', autoPortrait: true };
    case 'outfit':
      return { kind, outfitImage: '', outfitDesc: '' };
    case 'render':
      return {
        kind,
        duration: 8,
        aspectRatio: '9:16',
        cameraMotion: '',
        chainEndFrame: false,
        rotateProductImages: false,
        refMode: 'reference',
        setting: '',
        realismLock: true,
      };
    case 'upscale':
      return { kind, shortSide: 1080 };
    case 'blur':
      return { kind, spots: ['br'] };
    default:
      return { kind };
  }
};

let seq = 0;
export const newNodeId = (kind: BlockKind) => `${kind}_${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Dựng sơ đồ từ một mẫu dạng danh sách (để bắt đầu chỉnh từ mẫu có sẵn). */
export const templateToGraph = (tpl: WorkflowTemplate): { nodes: GraphNode[]; edges: GraphEdge[] } => {
  if (tpl.graph?.nodes?.length) return tpl.graph as { nodes: GraphNode[]; edges: GraphEdge[] };
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const add = (data: BlockData, x: number, y: number) => {
    const id = newNodeId(data.kind);
    nodes.push({ id, type: 'block', position: { x, y }, data });
    return id;
  };
  const link = (a: string, b: string) => edges.push({ id: `e_${a}_${b}`, source: a, target: b });
  const prod = add({ kind: 'product' }, 0, 0);
  const autoPortrait = tpl.autoPortrait !== false;
  const chars = tpl.faceless
    ? []
    : tpl.characterIds?.length
      ? tpl.characterIds.map((id, k) => add({ kind: 'character', charSource: 'library', characterId: id, autoPortrait }, 0, 220 + k * 230))
      : [add({ kind: 'character', charSource: 'row', autoPortrait }, 0, 220)];
  const src = tpl.manualScenes?.length
    ? add({ kind: 'prompts', prompts: tpl.manualScenes.join('\n') }, 300, 60)
    : add(
        {
          kind: 'script',
          scriptMode: tpl.scriptMode,
          scriptTemplateId: tpl.scriptTemplateId,
          sceneCount: tpl.sceneCount,
          withDialogue: tpl.withDialogue,
          extraNote: tpl.extraNote,
        },
        300,
        60
      );
  link(prod, src);
  chars.forEach((ch) => link(ch, src));
  if (tpl.outfit) {
    const o = add({ kind: 'outfit', outfitImage: tpl.outfit.image || '', outfitDesc: tpl.outfit.description }, 0, 220 + chars.length * 230);
    link(o, src);
  }
  let x = 620;
  let prev = src;
  if (tpl.splitDialogue) {
    const d = add({ kind: 'dialogue' }, x, 100);
    link(prev, d);
    prev = d;
    x += 260;
  }
  const render = add(
    {
      kind: 'render',
      duration: tpl.duration,
      aspectRatio: tpl.aspectRatio,
      cameraMotion: tpl.cameraMotion,
      chainEndFrame: tpl.chainEndFrame,
      rotateProductImages: tpl.rotateProductImages,
      refMode: tpl.refMode ?? 'reference',
      setting: tpl.setting ?? '',
      realismLock: tpl.realismLock !== false,
    },
    x,
    60
  );
  link(prev, render);
  prev = render;
  x += 300;
  const chain = (data: BlockData) => {
    const id = add(data, x, 80);
    link(prev, id);
    prev = id;
    x += 240;
  };
  if (tpl.autoMerge) chain({ kind: 'merge' });
  if (tpl.postBlur?.regions.length) {
    const spots = WATERMARK_SPOTS.filter((s) =>
      tpl.postBlur!.regions.some((r) => Math.abs(r.x - s.region.x) < 1e-6 && Math.abs(r.y - s.region.y) < 1e-6)
    ).map((s) => s.id);
    chain({ kind: 'blur', spots });
  }
  if (tpl.postUpscale) chain({ kind: 'upscale', shortSide: tpl.postUpscale });
  chain({ kind: 'result' });
  return { nodes, edges };
};

export interface CompileResult {
  template?: WorkflowTemplate;
  errors: string[];
  warnings: string[];
}

/** Dịch sơ đồ thành WorkflowTemplate (kiểm tra sơ đồ hợp lệ trước). */
export const compileGraph = (
  nodes: GraphNode[],
  edges: GraphEdge[],
  base: Pick<WorkflowTemplate, 'id' | 'name' | 'icon' | 'category' | 'description'>
): CompileResult => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const of = (kind: BlockKind) => nodes.filter((n) => n.data.kind === kind);
  const ins = (id: string) => edges.filter((e) => e.target === id).map((e) => byId.get(e.source)!).filter(Boolean);
  const outs = (id: string) => edges.filter((e) => e.source === id).map((e) => byId.get(e.target)!).filter(Boolean);

  const renders = of('render');
  if (renders.length !== 1) errors.push(renders.length ? 'Chỉ được có 1 khối Render cảnh.' : 'Thiếu khối 🎬 Render cảnh.');
  const results = of('result');
  if (results.length !== 1) errors.push(results.length ? 'Chỉ được có 1 khối Kết quả.' : 'Thiếu khối ✅ Kết quả.');
  edges.forEach((e) => {
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    if (a && b && !canConnect(a.data.kind, b.data.kind)) {
      errors.push(`Không nối được ${BLOCKS[a.data.kind].label} → ${BLOCKS[b.data.kind].label}.`);
    }
  });
  if (errors.length) return { errors, warnings };
  const render = renders[0];

  // Nguồn cảnh: đi ngược từ Render (qua Tách vai nếu có)
  let upstream = ins(render.id);
  const dialogue = upstream.find((n) => n.data.kind === 'dialogue');
  if (dialogue) upstream = [...upstream.filter((n) => n !== dialogue), ...ins(dialogue.id)];
  const sources = upstream.filter((n) => n.data.kind === 'script' || n.data.kind === 'prompts');
  if (sources.length !== 1) {
    errors.push(sources.length ? 'Render chỉ nhận 1 nguồn cảnh (AI viết kịch bản HOẶC Prompt nhập tay).' : 'Nối 1 khối ✍️ AI viết kịch bản hoặc 📝 Prompt nhập tay vào Render.');
    return { errors, warnings };
  }
  const src = sources[0];
  const feeders = [...ins(src.id), ...ins(render.id)];
  const product = feeders.find((n) => n.data.kind === 'product');
  const charBlocks = [...new Set(feeders.filter((n) => n.data.kind === 'character'))];
  const charSourceOf = (n: GraphNode): CharSource => (n.data.charSource as CharSource) || 'row';
  const characterIds: string[] = [];
  charBlocks.forEach((n) => {
    if (charSourceOf(n) === 'row') return;
    const id = String(n.data.characterId || '');
    if (!id) {
      errors.push(
        charSourceOf(n) === 'upload'
          ? 'Khối 👤 Nhân vật (tải ảnh lên) chưa có ảnh.'
          : 'Khối 👤 Nhân vật (thư viện) chưa chọn nhân vật.'
      );
    } else if (characterIds.includes(id)) {
      warnings.push('Có 2 khối Nhân vật trùng cùng một nhân vật — chỉ tính 1 lần.');
    } else {
      characterIds.push(id);
    }
  });
  const outfits = [...new Set(feeders.filter((n) => n.data.kind === 'outfit'))];
  if (outfits.length > 1) errors.push('Chỉ được nối 1 khối 👗 Trang phục.');
  const outfitBlock = outfits[0];
  if (outfitBlock && !outfitBlock.data.outfitImage && !String(outfitBlock.data.outfitDesc || '').trim()) {
    errors.push('Khối 👗 Trang phục cần ảnh hoặc mô tả (để AI tự tạo ảnh).');
  }
  if (charBlocks.filter((n) => charSourceOf(n) === 'row').length > 1) {
    warnings.push('Có nhiều khối Nhân vật "theo dòng" — chỉ cần 1 khối.');
  }
  if (src.data.kind === 'script' && !product) errors.push('AI viết kịch bản cần khối 🛒 Sản phẩm nối vào.');
  const manual = src.data.kind === 'prompts' ? String(src.data.prompts || '').split('\n').map((l) => l.trim()).filter(Boolean) : [];
  if (src.data.kind === 'prompts' && !manual.length) errors.push('Khối Prompt nhập tay chưa có dòng nào.');

  // Chuỗi sau Render: Render → (Ghép) → (Làm mờ / Nâng) → Kết quả
  const after: GraphNode[] = [];
  let cur = render;
  const seen = new Set<string>();
  while (cur.data.kind !== 'result') {
    const next = outs(cur.id);
    if (next.length !== 1) {
      errors.push(next.length ? `${BLOCKS[cur.data.kind].label} chỉ được nối tới 1 khối.` : `${BLOCKS[cur.data.kind].label} chưa nối tới khối nào (cần đi tới ✅ Kết quả).`);
      break;
    }
    cur = next[0];
    if (seen.has(cur.id)) {
      errors.push('Sơ đồ bị nối vòng.');
      break;
    }
    seen.add(cur.id);
    after.push(cur);
  }
  const loose = nodes.filter(
    (n) => !edges.some((e) => e.source === n.id || e.target === n.id) && n.data.kind !== 'result'
  );
  if (loose.length) warnings.push(`Khối chưa nối (bị bỏ qua): ${loose.map((n) => BLOCKS[n.data.kind].label).join(', ')}.`);
  if (errors.length) return { errors, warnings };

  const r = render.data;
  const up = after.find((n) => n.data.kind === 'upscale');
  const blur = after.find((n) => n.data.kind === 'blur');
  const spots = (blur?.data.spots as string[] | undefined) ?? [];
  const sd = src.data;
  const template: WorkflowTemplate = {
    ...base,
    builtin: false,
    scriptMode: (sd.scriptMode as ScriptMode) || 'tvc5',
    scriptTemplateId: sd.scriptTemplateId,
    extraNote: String(sd.extraNote || ''),
    sceneCount: manual.length || Number(sd.sceneCount) || 4,
    withDialogue: sd.withDialogue !== false,
    manualScenes: manual.length ? manual : undefined,
    duration: (Number(r.duration) || 8) as WorkflowTemplate['duration'],
    aspectRatio: (r.aspectRatio as WorkflowTemplate['aspectRatio']) || '9:16',
    cameraMotion: String(r.cameraMotion || ''),
    chainEndFrame: !!r.chainEndFrame,
    rotateProductImages: !!r.rotateProductImages,
    refMode: r.refMode === 'firstframe' ? 'firstframe' : 'reference',
    setting: String(r.setting || '').trim() || undefined,
    realismLock: r.realismLock !== false,
    faceless: !charBlocks.length,
    autoPortrait: charBlocks.some((n) => n.data.autoPortrait !== false),
    characterIds: characterIds.length ? characterIds : undefined,
    outfit: outfitBlock
      ? {
          image: String(outfitBlock.data.outfitImage || '') || undefined,
          description: String(outfitBlock.data.outfitDesc || '').trim(),
        }
      : undefined,
    splitDialogue: !!dialogue,
    autoMerge: after.some((n) => n.data.kind === 'merge'),
    postUpscale: up ? Number(up.data.shortSide) || 1080 : 0,
    postBlur: spots.length
      ? { regions: WATERMARK_SPOTS.filter((s) => spots.includes(s.id)).map((s) => s.region), mode: 'blur', strength: 24 }
      : undefined,
    graph: { nodes, edges },
  };
  if (!product) warnings.push('Không có khối Sản phẩm: dòng chạy không cần sản phẩm.');
  return { template, errors, warnings };
};
