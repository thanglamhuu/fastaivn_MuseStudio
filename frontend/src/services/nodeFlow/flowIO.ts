// Nhập / xuất sơ đồ Node dạng JSON "flow-workflow" — tương thích file Export của HND Muse AI.
import { FlowEdge, FlowNode, FlowNodeData, FlowWorkflow, NODE_DEFS, NodeType, newId } from './definitions';

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

/** 13 mẫu Workflow của HND (sơ đồ node đầy đủ) — tải lười để không làm nặng lần mở app. */
export const loadHndFlowTemplates = async (): Promise<HndFlowTemplate[]> =>
  (await import('../../data/hndFlowTemplates.json')).default as unknown as HndFlowTemplate[];

const RUNTIME_KEYS = ['runStatus', 'error', 'results', 'progress', 'startedAt', 'finishedAt', 'taskId', 'accountId', 'previewUrl', 'prompts'];

const cleanData = (type: NodeType, raw: Record<string, unknown> = {}): FlowNodeData => {
  const data: FlowNodeData = { ...JSON.parse(JSON.stringify(NODE_DEFS[type].defaults)) };
  Object.entries(raw).forEach(([k, v]) => {
    if (RUNTIME_KEYS.includes(k) || v === undefined || v === null) return;
    // Đường dẫn file trên máy HND không đọc được từ trình duyệt
    if (k === 'localPath' || k === 'generatedPath' || k === 'path') return;
    data[k] = v as never;
  });
  if (type === 'generate-video' && data.duration) data.duration = Number(data.duration);
  return data;
};

/** Đọc JSON (HND export / MuseStudio export / mẫu catalog) thành workflow mới (id mới). */
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
    if (n.data?.localPath) notes.push(`"${n.data.batchLabel || n.data.fileName || 'Upload Image'}": ảnh trên máy HND (${n.data.fileName || n.data.localPath}) không mang theo — chọn lại ảnh hoặc để trống cho AI tự tạo.`);
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
