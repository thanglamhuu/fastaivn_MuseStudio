// Nhập / xuất sơ đồ Node dạng JSON "flow-workflow" — tương thích file Export của MV1 Muse AI.
import { FlowEdge, FlowNode, FlowNodeData, FlowWorkflow, NODE_DEFS, NodeType, RefLock, newId } from './definitions';

export interface HndFlowTemplate {
  id: string;
  title: string;
  category: string;
  categoryLabel: string;
  description: string;
  templateStyle: string;
  videoUrl: string;
  graph: { name: string; description: string; nodes: FlowNode[]; edges: FlowEdge[] };
}

/**
 * Mẫu sơ đồ node có sẵn: mẫu FastAIVN (Hieu POV AIO…) + 13 mẫu Workflow của MV1 — tải lười để không làm nặng lần mở app.
 */
export const loadHndFlowTemplates = async (): Promise<HndFlowTemplate[]> => {
  const [hnd, pov] = await Promise.all([import('../../data/hndFlowTemplates.json'), import('../../data/hieuPovAio.flow.json')]);
  const povGraph = pov.default as unknown as HndFlowTemplate['graph'];
  const fastaivn: HndFlowTemplate[] = [
    {
      id: 'fastaivn-hieu-pov-aio',
      title: 'Hieu POV AIO — Review sản phẩm góc nhìn thứ nhất',
      category: 'review-pov',
      categoryLabel: 'Review POV (FastAIVN)',
      description: povGraph.description,
      templateStyle: 'pov_aio',
      videoUrl: 'https://fastaivn.com/flow-apps/u8xd',
      graph: povGraph,
    },
  ];
  return [...fastaivn, ...(hnd.default as unknown as HndFlowTemplate[])];
};

const RUNTIME_KEYS = ['runStatus', 'error', 'results', 'progress', 'startedAt', 'finishedAt', 'taskId', 'accountId', 'previewUrl', 'prompts', 'rerun'];

const cleanData = (type: NodeType, raw: Record<string, unknown> = {}): FlowNodeData => {
  const data: FlowNodeData = { ...JSON.parse(JSON.stringify(NODE_DEFS[type].defaults)) };
  Object.entries(raw).forEach(([k, v]) => {
    if (RUNTIME_KEYS.includes(k) || v === undefined || v === null) return;
    // Đường dẫn file trên máy MV1 không đọc được từ trình duyệt
    if (k === 'localPath' || k === 'generatedPath' || k === 'path') return;
    data[k] = v as never;
  });
  if (type === 'generate-video' && data.duration) data.duration = Number(data.duration);
  // Sơ đồ MV1 chỉ có refRole (1 vai: product / outfit / scene…) → không để refRoles mặc định ['character'] đè lên
  // (trước đây khối "KHÓA SẢN PHẨM" bị coi là ảnh nhân vật: sai bảng ánh xạ ảnh, thiếu khóa bao bì / màu sản phẩm)
  if (type === 'upload-image' && raw.refRole && !(Array.isArray(raw.refRoles) && raw.refRoles.length)) data.refRoles = [raw.refRole as RefLock];
  return data;
};

/** Đọc JSON (MV1 export / MuseStudio export / mẫu catalog) thành workflow mới (id mới). */
export const parseFlowJson = (raw: unknown, fallbackName = 'Workflow nhập'): { workflow: FlowWorkflow; notes: string[] } => {
  const src = raw as any;
  const g = src?.graph && Array.isArray(src.graph.nodes) ? src.graph : src;
  if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) throw new Error('File không đúng định dạng flow-workflow (thiếu nodes / edges).');
  const notes: string[] = [];
  const idMap = new Map<string, string>();
  const nodes: FlowNode[] = [];
  g.nodes.forEach((n: any) => {
    if (!NODE_DEFS[n?.type as NodeType]) {
      notes.push(`Bỏ qua node không hỗ trợ: ${n?.type}`);
      return;
    }
    const id = newId('node');
    idMap.set(String(n.id), id);
    if (n.data?.localPath) notes.push(`"${n.data.batchLabel || n.data.fileName || 'Upload Image'}": ảnh trên máy MV1 (${n.data.fileName || n.data.localPath}) không mang theo — chọn lại ảnh hoặc để trống cho AI tự tạo.`);
    nodes.push({ id, type: n.type, position: { x: Number(n.position?.x) || 0, y: Number(n.position?.y) || 0 }, data: cleanData(n.type, n.data) });
  });
  const edges: FlowEdge[] = [];
  g.edges.forEach((e: any) => {
    const s = idMap.get(String(e.source));
    const t = idMap.get(String(e.target));
    if (!s || !t) return;
    edges.push({ id: newId('edge'), source: s, sourceHandle: e.sourceHandle ?? null, target: t, targetHandle: e.targetHandle ?? null });
  });
  return {
    workflow: {
      id: newId('wf'),
      kind: 'flow-workflow',
      schemaVersion: 1,
      name: String(src.title || g.name || src.name || fallbackName),
      description: String(src.description || g.description || ''),
      category: src.categoryLabel || src.category,
      templateId: src.id && String(src.id).startsWith('hnd-') ? String(src.id) : src.templateId,
      videoUrl: src.videoUrl,
      nodes,
      edges,
      updatedAt: Date.now(),
    },
    notes,
  };
};

/**
 * Gói mẫu để tải lên trang Quản trị mẫu của fastaivn.com (Giải pháp 2 — catalog tĩnh).
 * Trang quản trị đọc `entry` (thông tin mẫu), lưu `graph` thành graphs/<id>.v<version>.json trên Storage,
 * `thumbnailDataUrl` thành thumbs/<id>.jpg. Video xem trước tải lên riêng (file mp4 trong thư mục kết quả).
 */
export interface TemplatePackage {
  kind: 'fastaivn-template';
  packageVersion: 1;
  entry: {
    id: string;
    version: number;
    title: string;
    description: string;
    category: string;
    icon: string;
    sortOrder: number;
    isPremium: boolean;
    minAppVersion: string;
    trendUrl?: string;
    listTemplate: { sceneCount: number; duration: number; aspectRatio: string };
  };
  graph: unknown;
  thumbnailDataUrl?: string;
  /** Đường dẫn video kết quả trên máy (để quản trị viên tải lên làm video xem trước) */
  previewVideoPath?: string;
}

export const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'mau-workflow';

export const buildTemplatePackage = (
  wf: FlowWorkflow,
  opts: { appVersion: string; keepImages: boolean; thumbnailDataUrl?: string; previewVideoPath?: string }
): TemplatePackage => {
  const graph = JSON.parse(exportFlowJson(wf, opts.keepImages));
  // Bỏ dữ liệu riêng của lượt chạy: mô tả AI theo ảnh, khung hình đã tạo, cờ ảnh AI tự tạo
  (graph.nodes as { data: Record<string, unknown> }[]).forEach((n) => {
    ['aiDescs', 'keyframe', 'autoGenerated', 'characterId', 'productId'].forEach((k) => delete n.data[k]);
    if (!opts.keepImages) ['faceImage', 'fileName'].forEach((k) => delete n.data[k]);
  });
  delete graph.updatedAt;
  const videos = wf.nodes.filter((n) => n.type === 'generate-video').length;
  const dur = Number(wf.nodes.find((n) => n.type === 'generate-video')?.data.duration) || 10;
  return {
    kind: 'fastaivn-template',
    packageVersion: 1,
    entry: {
      id: slugify(wf.name),
      version: 1,
      title: wf.name,
      description: wf.description,
      category: wf.category || 'Khác',
      icon: '🎬',
      sortOrder: 100,
      isPremium: false,
      minAppVersion: opts.appVersion,
      trendUrl: wf.videoUrl,
      listTemplate: { sceneCount: Math.max(1, videos), duration: dur, aspectRatio: String(wf.nodes.find((n) => n.type === 'generate-video')?.data.ratio || '9:16') },
    },
    graph,
    thumbnailDataUrl: opts.thumbnailDataUrl,
    previewVideoPath: opts.previewVideoPath,
  };
};

/** JSON xuất ra (bỏ trạng thái chạy; ảnh tải lên giữ lại nếu withImages). */
export const exportFlowJson = (wf: FlowWorkflow, withImages = true) => {
  const out: any = { ...wf, exportedAt: new Date().toISOString() };
  delete out.id;
  out.nodes = wf.nodes.map((n) => {
    const data: Record<string, unknown> = { ...n.data };
    RUNTIME_KEYS.forEach((k) => delete data[k]);
    if (!withImages) delete data.image;
    return { ...n, data };
  });
  return JSON.stringify(out, null, 2);
};
