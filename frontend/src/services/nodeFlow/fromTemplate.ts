// Chuyển 1 mẫu ở "Mẫu & danh sách dòng" (WorkflowTemplate) thành sơ đồ node để chỉnh chi tiết từng node.
// - Mẫu chuyển từ HND (tpl.hnd): lấy nguyên sơ đồ gốc của HND (13 mẫu).
// - Mẫu khác: dựng sơ đồ tương đương — Upload Image (khóa nhân vật / trang phục / sản phẩm) → Gemini Script
//   (hoặc Prompt từng cảnh nếu mẫu có prompt nhập tay) → Generate Video từng cảnh → Merge → hậu kỳ → Result.
import type { WorkflowTemplate } from '../../types/workflow';
import { FlowEdge, FlowNode, FlowWorkflow, NodeType, emptyWorkflow, makeNode, newId } from './definitions';
import { loadHndFlowTemplates, parseFlowJson } from './flowIO';
import { loadRemoteGraph } from '../templateCatalog';

const MODE_NOTE: Record<string, string> = {
  tvc5: 'Kịch bản TVC / review 5 bước: Hook 3 giây → giới thiệu → cận cảnh chi tiết → trải nghiệm → chốt đơn.',
  pov_aff: 'Góc nhìn thứ nhất (POV), chỉ thấy tay cầm sản phẩm, không lộ mặt; nhịp nhanh như người thật review.',
  short_film: 'Phim ngắn / cốt truyện liền mạch giữa các cảnh, đối thoại tự nhiên.',
  template: 'Theo mẫu kịch bản bán hàng.',
};

export const templateToFlow = async (tpl: WorkflowTemplate): Promise<{ workflow: FlowWorkflow; notes: string[] }> => {
  // Mẫu dùng chung fastaivn.com: tải sơ đồ đã soạn sẵn (có bản đệm khi mất mạng)
  if (tpl.remote?.graphUrl) {
    try {
      const graph = await loadRemoteGraph(tpl.remote.graphUrl);
      const r = parseFlowJson(graph, tpl.name);
      r.workflow.name = tpl.name;
      r.workflow.description = r.workflow.description || tpl.description;
      r.workflow.category = tpl.category;
      r.workflow.templateId = tpl.id;
      r.workflow.videoUrl = tpl.remote.trendUrl || r.workflow.videoUrl;
      return r;
    } catch (err: any) {
      const fallback = await templateToFlowLocal(tpl);
      fallback.notes.unshift(`Không tải được sơ đồ mẫu từ fastaivn.com (${err?.message || err}) — dựng sơ đồ tương đương từ cấu hình mẫu.`);
      return fallback;
    }
  }
  return templateToFlowLocal(tpl);
};

const templateToFlowLocal = async (tpl: WorkflowTemplate): Promise<{ workflow: FlowWorkflow; notes: string[] }> => {
  if (tpl.hnd?.templateId) {
    const all = await loadHndFlowTemplates();
    const src = all.find((t) => t.id === `hnd-${tpl.hnd!.templateId}`);
    if (src) return parseFlowJson(src);
  }
  const wf = emptyWorkflow(tpl.name);
  wf.description = tpl.description;
  wf.category = tpl.category;
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const add = (type: NodeType, x: number, y: number, data: Record<string, unknown> = {}) => {
    const n = makeNode(type, x, y);
    Object.assign(n.data, data);
    nodes.push(n);
    return n;
  };
  const link = (s: FlowNode, sh: string, t: FlowNode, th: string) =>
    edges.push({ id: newId('edge'), source: s.id, sourceHandle: sh, target: t.id, targetHandle: th });

  // Cột 1: ảnh khóa
  const refs: FlowNode[] = [];
  let y = 0;
  if (!tpl.faceless) {
    const ids = tpl.characterIds?.length ? tpl.characterIds : [''];
    ids.forEach((cid, k) => {
      refs.push(add('upload-image', 0, y, { refRoles: ['character'], characterId: cid, batchLabel: `👤 Nhân vật ${ids.length > 1 ? k + 1 : 'chính'}`, prompt: '' }));
      y += 260;
    });
  }
  if (tpl.outfit) {
    refs.push(add('upload-image', 0, y, { refRoles: ['outfit'], image: tpl.outfit.image || '', prompt: tpl.outfit.description, batchLabel: '👗 Trang phục' }));
    y += 260;
  }
  refs.push(add('upload-image', 0, y, { refRoles: ['product'], productId: '', batchLabel: '📦 Sản phẩm (chọn trong Cài đặt)', prompt: '' }));
  y += 260;

  // Cột 2: nguồn cảnh
  const n = Math.max(1, tpl.manualScenes?.length || tpl.sceneCount || 4);
  const sceneText: { node: FlowNode; handle: string }[] = [];
  if (tpl.manualScenes?.length) {
    tpl.manualScenes.forEach((p, i) => {
      const pn = add('prompt', 330, i * 230, { prompt: p.split('{product}').join('@@'), batchLabel: `Prompt cảnh ${i + 1}` });
      sceneText.push({ node: pn, handle: 'text-out' });
    });
  } else {
    const idea = add('prompt', 330, 0, {
      batchLabel: 'Ý tưởng / sản phẩm',
      prompt:
        'Sản phẩm: @@ (gõ @@ để chọn sản phẩm) — nhân vật chính: @ (gõ @ để chọn nhân vật).\n' +
        [MODE_NOTE[tpl.scriptMode] || '', tpl.extraNote, tpl.setting ? `Bối cảnh cố định: ${tpl.setting}` : '', tpl.withDialogue ? 'Có lời thoại tiếng Việt.' : 'Không có lời thoại.']
          .filter(Boolean)
          .join('\n'),
    });
    const g = add('gemini-script', 330, 300, { batchLabel: 'AI viết kịch bản', outputCount: n, sceneSeconds: tpl.duration });
    link(idea, 'text-out', g, 'text-in');
    refs.forEach((r) => link(r, 'image-out', g, 'image-in'));
    for (let i = 0; i < n; i++) sceneText.push({ node: g, handle: `text-out-${i}` });
  }

  // Cột 3: render từng cảnh (nối khung cuối nếu mẫu bật)
  const videos: FlowNode[] = [];
  sceneText.forEach((s, i) => {
    const chained = tpl.chainEndFrame && i > 0;
    const v = add('generate-video', 700, i * 230, {
      batchLabel: `Cảnh ${i + 1}`,
      videoMode: chained ? 'frame-to-frame' : 'reference-to-video',
      ratio: tpl.aspectRatio,
      duration: tpl.duration,
    });
    link(s.node, s.handle, v, 'text-in');
    refs.forEach((r) => link(r, 'image-out', v, 'image-in'));
    if (chained) {
      const ef = add('extract-endframe', 1000, i * 230 - 110, { batchLabel: `Khung cuối cảnh ${i}` });
      link(videos[i - 1], 'video-out', ef, 'video-in');
      link(ef, 'image-out', v, 'image-in-start');
    }
    videos.push(v);
  });

  // Cột 4: ghép + hậu kỳ + kết quả
  let last: FlowNode = videos[0];
  let x = 1300;
  if (videos.length > 1 && tpl.autoMerge !== false) {
    const m = add('merge-video', x, 100, { portCount: videos.length, batchLabel: `Ghép ${videos.length} cảnh` });
    videos.forEach((v, i) => link(v, 'video-out', m, `video-in-${i}`));
    last = m;
    x += 300;
  }
  if (tpl.postBlur?.regions.length) {
    const b = add('remove-video-logo', x, 100, { spots: ['br'] });
    link(last, 'video-out', b, 'video-in');
    last = b;
    x += 300;
  }
  if (tpl.postUpscale) {
    const u = add('upscale-video', x, 100, { resolution: tpl.postUpscale >= 2000 ? '4K' : '1080P' });
    link(last, 'video-out', u, 'video-in');
    last = u;
    x += 300;
  }
  const res = add('result', x, 100);
  link(last, 'video-out', res, 'video-in');
  wf.nodes = nodes;
  wf.edges = edges;
  return { workflow: wf, notes: [] };
};
