// Nhập workflow xuất từ HND Muse AI (kind = "flow-workflow") thành sơ đồ khối của Muse Studio.
//
// Sơ đồ HND: mỗi cảnh = 1 khối Prompt → 1 khối Generate Video; các khối Upload Image
// (vai trò Nhân vật / Trang phục / Sản phẩm) nối vào mọi Generate Video; Merge Video ghép
// theo thứ tự cổng video-in-N → Result. Khối Upload Image để trống = AI tự tạo ảnh lúc chạy.
//
// Dịch sang: 👤 Nhân vật (thư viện, chưa có ảnh → AI vẽ chân dung) + 👗 Trang phục (mô tả →
// AI tạo ảnh) → 📝 Prompt nhập tay (mỗi cảnh 1 dòng) → 🎬 Render → 🎞 Ghép → ✅ Kết quả.
import { StudioCharacter, newLibraryId } from '../types/library';
import { BlockData, GraphEdge, GraphNode, newNodeId } from './workflowGraph';

interface HndNode {
  id: string;
  type: string;
  position?: { x: number; y: number };
  data?: Record<string, any>;
}
interface HndEdge {
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface HndImportResult {
  name: string;
  description: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Nhân vật mới cần thêm vào thư viện (chưa có ảnh: AI vẽ chân dung khi chạy) */
  newCharacters: StudioCharacter[];
  notes: string[];
}

const DURATIONS = [4, 6, 8, 10];
const clampDuration = (d: unknown) => {
  const n = Number(d) || 8;
  return DURATIONS.reduce((best, x) => (Math.abs(x - n) < Math.abs(best - n) ? x : best), 8);
};

const refRoleOf = (d: Record<string, any>) => {
  const r = String(d.refRole || '').toLowerCase();
  if (r === 'outfit' || r === 'product' || r === 'character') return r;
  const label = String(d.batchLabel || d.batchKey || '').toLowerCase();
  if (/trang ph|outfit/.test(label)) return 'outfit';
  if (/sản phẩm|san-pham|product/.test(label)) return 'product';
  return 'character';
};

/** Tag @Tên xuất hiện nhiều nhất trong các prompt cảnh. */
const topTag = (texts: string[]) => {
  const count = new Map<string, number>();
  texts.forEach((t) =>
    (t.match(/@([\p{L}\p{N}_]+)/gu) || []).forEach((m) => count.set(m.slice(1), (count.get(m.slice(1)) || 0) + 1))
  );
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
};

/**
 * Tên + mô tả nhân vật của 1 khối Upload Image HND. Ưu tiên tag trong sheetPrompt
 * (vd. "(@ModelCatwalkNu): Người mẫu nữ...") vì đó là tên các prompt cảnh thực sự dùng.
 */
const characterInfo = (d: Record<string, any>, sceneTags: string[], index: number) => {
  const sheet = String(d.sheetPrompt || '');
  const m = /\(@([\p{L}\p{N}_]+)\)\s*:\s*([\s\S]*)/u.exec(sheet);
  let name = m?.[1] || '';
  let desc = '';
  if (m) desc = m[2].split(/QUY TẮC|Mặc đúng bộ trang phục|RULES?:/i)[0].trim().replace(/\.\s*$/, '');
  if (!name) {
    const tag = String(d.characterTag || '').replace(/^@/, '');
    name = sceneTags.includes(tag) ? tag : sceneTags[index] || tag || String(d.characterName || '') || `NhanVat${index + 1}`;
  }
  if (!desc) desc = String(d.prompt || '').trim();
  return { name, description: desc.slice(0, 1400) };
};

export const parseHndWorkflow = (raw: unknown, library: StudioCharacter[]): HndImportResult => {
  const wf = raw as { kind?: string; name?: string; description?: string; nodes?: HndNode[]; edges?: HndEdge[]; syncConfig?: any };
  if (!wf || !Array.isArray(wf.nodes) || !Array.isArray(wf.edges)) {
    throw new Error('File không đúng định dạng workflow HND (thiếu nodes / edges).');
  }
  const notes: string[] = [];
  const hndNodes = wf.nodes;
  const byId = new Map(hndNodes.map((n) => [n.id, n]));
  const sync = wf.syncConfig || {};

  // --- Cảnh: Generate Video theo thứ tự cổng Merge (video-in-N), không có thì theo vị trí
  const videos = hndNodes.filter((n) => n.type === 'generate-video');
  if (!videos.length) throw new Error('Workflow HND không có khối Generate Video nào.');
  const mergePort = (id: string) => {
    const e = wf.edges!.find((x) => x.source === id && /video-in-(\d+)/.test(x.targetHandle || ''));
    return e ? Number(/video-in-(\d+)/.exec(e.targetHandle!)![1]) : undefined;
  };
  const sceneNo = (n: HndNode) => Number(/scene\s*(\d+)/i.exec(String(n.data?.batchLabel || ''))?.[1]) || undefined;
  videos.sort((a, b) => {
    const ka = mergePort(a.id) ?? sceneNo(a) ?? 999;
    const kb = mergePort(b.id) ?? sceneNo(b) ?? 999;
    return ka - kb || (a.position?.y ?? 0) - (b.position?.y ?? 0);
  });
  const prompts = videos.map((v, i) => {
    const promptNode = wf
      .edges!.filter((e) => e.target === v.id)
      .map((e) => byId.get(e.source))
      .find((n) => n?.type === 'prompt' && String(n.data?.prompt || '').trim());
    const text = String(promptNode?.data?.prompt || v.data?.prompt || '').trim();
    if (!text) notes.push(`Cảnh ${i + 1} không có prompt — đã bỏ qua.`);
    // Khối Prompt nhập tay: mỗi dòng 1 cảnh nên gộp xuống dòng thành 1 dòng
    return text.replace(/\s*\n+\s*/g, ' ');
  }).filter(Boolean);
  if (!prompts.length) throw new Error('Không tìm thấy prompt cảnh nào trong workflow HND.');
  const sceneTags = topTag(prompts);

  const first = videos[0].data || {};
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const add = (data: BlockData, x: number, y: number) => {
    const id = newNodeId(data.kind);
    nodes.push({ id, type: 'block', position: { x, y }, data });
    return id;
  };
  const link = (a: string, b: string) => edges.push({ id: `e_${a}_${b}`, source: a, target: b });

  const promptsId = add({ kind: 'prompts', prompts: prompts.join('\n') }, 320, 40);

  // --- Ảnh tham chiếu (Upload Image)
  const uploads = hndNodes
    .filter((n) => n.type === 'upload-image')
    .sort((a, b) => (Number(a.data?.batchOrder) || 99) - (Number(b.data?.batchOrder) || 99));
  const newCharacters: StudioCharacter[] = [];
  let y = 0;
  let charIndex = 0;
  let hasOutfit = false;
  uploads.forEach((u) => {
    const d = u.data || {};
    const role = refRoleOf(d);
    if (d.localPath) notes.push(`Ảnh "${d.fileName || d.localPath}" là đường dẫn trên máy HND — hãy tải lại ảnh ở khối tương ứng.`);
    if (role === 'character') {
      const info = characterInfo(d, sceneTags, charIndex++);
      const existing = [...library, ...newCharacters].find((c) => c.name.trim().toLowerCase() === info.name.toLowerCase());
      let charId = existing?.id;
      if (!existing) {
        const c: StudioCharacter = {
          id: newLibraryId('char'),
          name: info.name,
          description: info.description,
          images: [],
          // Giọng theo giới tính trong mô tả: nam → 02. Nam Tri Kỷ, còn lại → 03. Nữ Tươi Sáng
          voicePresetId: /(^|[^\p{L}])(nam|bố|cha|ông|anh|chàng|trai|đàn ông|male|man)([^\p{L}]|$)/iu.test(
            `${info.name} ${info.description}`.replace(/miền nam|việt nam/gi, '')
          ) && !/(^|[^\p{L}])(nữ|cô|chị|bà|mẹ|gái|female|woman)([^\p{L}]|$)/iu.test(info.description)
            ? 'voice_02'
            : 'voice_03',
          emotion: 'Natural',
          createdAt: Date.now(),
        };
        newCharacters.push(c);
        charId = c.id;
      }
      link(add({ kind: 'character', charSource: 'library', characterId: charId, autoPortrait: true }, 0, y), promptsId);
      y += 230;
    } else if (role === 'outfit') {
      if (hasOutfit) return notes.push('Có nhiều khối Trang phục — chỉ lấy khối đầu tiên.');
      hasOutfit = true;
      const desc = String(d.prompt || sync.outfitDesc || '').trim();
      link(add({ kind: 'outfit', outfitImage: '', outfitDesc: desc }, 0, y), promptsId);
      y += 230;
    } else {
      notes.push(
        `Khối Sản phẩm "${d.batchLabel || ''}" chưa được chuyển — chọn sản phẩm khi chạy hoặc thêm khối 🛒 Sản phẩm.`
      );
    }
  });

  // --- Render → Ghép → Kết quả
  // Bối cảnh cố định HND viết sẵn trong prompt → hiện ra ô Bối cảnh (prompt đã có khóa nên không chèn trùng)
  const setting = /\[KHÓA BỐI CẢNH CỐ ĐỊNH XUYÊN SUỐT:\s*([^\]]+?)\s*(?:cố định 100%[^\]]*)?\]/i.exec(prompts[0])?.[1] || '';
  const render = add(
    {
      kind: 'render',
      duration: clampDuration(first.duration ?? sync.sceneDurationSec),
      aspectRatio: ['9:16', '16:9', '1:1'].includes(first.ratio) ? first.ratio : '9:16',
      cameraMotion: '',
      chainEndFrame: false,
      rotateProductImages: false,
      refMode: 'reference',
      setting: setting.trim(),
      realismLock: true,
    },
    660,
    40
  );
  link(promptsId, render);
  let prev = render;
  let x = 960;
  if (hndNodes.some((n) => n.type === 'merge-video') || prompts.length > 1) {
    const m = add({ kind: 'merge' }, x, 60);
    link(prev, m);
    prev = m;
    x += 240;
  }
  link(prev, add({ kind: 'result' }, x, 60));

  if (Number(first.duration) && clampDuration(first.duration) !== Number(first.duration)) {
    notes.push(`Thời lượng ${first.duration}s không hỗ trợ — dùng ${clampDuration(first.duration)}s.`);
  }
  if (videos.some((v) => v.data?.videoMode && v.data.videoMode !== 'reference-to-video')) {
    notes.push('Một số cảnh HND dùng chế độ khác Reference-to-Video — Muse Studio render bằng ảnh tham chiếu.');
  }

  return {
    name: String(wf.name || 'Workflow HND').trim(),
    description: String(wf.description || '').trim(),
    nodes,
    edges,
    newCharacters,
    notes,
  };
};
