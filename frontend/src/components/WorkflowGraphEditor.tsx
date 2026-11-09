import React, { useCallback, useMemo, useState } from 'react';
import {
  Background,
  Connection,
  Controls,
  Edge,
  Handle,
  MiniMap,
  Node,
  NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  BLOCKS,
  BlockData,
  BlockKind,
  WATERMARK_SPOTS,
  canConnect,
  compileGraph,
  defaultData,
  hasInput,
  hasOutput,
  newNodeId,
  templateToGraph,
} from '../services/workflowGraph';
import { SCRIPT_MODES } from '../services/productService';
import { SCRIPT_TEMPLATES, TEMPLATE_GROUPS } from '../data/scriptTemplates';
import type { WorkflowTemplate } from '../types/workflow';

type BlockNode = Node<BlockData, 'block'>;

const field =
  'nodrag w-full bg-slate-950 border border-white/10 text-[10px] text-slate-200 rounded p-1 focus:outline-none focus:ring-1 focus:ring-indigo-500';
const lbl = 'block text-[9px] uppercase tracking-wide text-slate-500 mt-1';

const CAMERA = [
  ['', 'Không ép góc máy'],
  ['Medium Close-up, Static Tripod Shot', 'Trung cận cố định'],
  ['Close-up Shot, Slow Dolly In', 'Cận cảnh đẩy vào'],
  ['Medium Shot, Gentle Handheld Movement', 'Trung cảnh cầm tay'],
];

/** Một khối trên sơ đồ: tiêu đề + các ô cấu hình ngay trong khối. */
const BlockNodeView: React.FC<NodeProps<BlockNode>> = ({ id, data, selected }) => {
  const { updateNodeData, deleteElements } = useReactFlow();
  const meta = BLOCKS[data.kind];
  const set = (patch: Partial<BlockData>) => updateNodeData(id, patch);
  const check = (key: keyof BlockData, label: string) => (
    <label className="nodrag flex items-center gap-1 text-[10px] text-slate-300 mt-1 cursor-pointer">
      <input type="checkbox" checked={!!data[key]} onChange={(e) => set({ [key]: e.target.checked })} />
      {label}
    </label>
  );

  return (
    <div
      className={`rounded-xl bg-slate-900 border text-left shadow-lg ${selected ? 'ring-2 ring-indigo-400' : ''}`}
      style={{ borderColor: meta.color, width: data.kind === 'prompts' || data.kind === 'script' ? 240 : 190 }}
    >
      {hasInput(data.kind) && <Handle type="target" position={Position.Left} style={{ background: meta.color, width: 10, height: 10 }} />}
      <div className="flex items-center justify-between px-2 py-1.5 rounded-t-xl" style={{ background: `${meta.color}33` }}>
        <span className="text-[11px] font-bold text-white">
          {meta.icon} {meta.label}
        </span>
        <button
          onClick={() => deleteElements({ nodes: [{ id }] })}
          className="nodrag text-[10px] text-slate-400 hover:text-red-300"
          title="Xóa khối"
        >
          ✕
        </button>
      </div>
      <div className="px-2 pb-2 pt-1">
        <p className="text-[9px] text-slate-500">{meta.hint}</p>

        {data.kind === 'character' && check('autoPortrait', 'Chưa có ảnh → AI vẽ chân dung')}

        {data.kind === 'script' && (
          <>
            <label className={lbl}>Kiểu kịch bản</label>
            <select className={field} value={data.scriptMode} onChange={(e) => set({ scriptMode: e.target.value as BlockData['scriptMode'] })}>
              {SCRIPT_MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            {data.scriptMode === 'template' && (
              <select className={`${field} mt-1`} value={data.scriptTemplateId || ''} onChange={(e) => set({ scriptTemplateId: e.target.value })}>
                {TEMPLATE_GROUPS.map((g) => (
                  <optgroup key={g} label={g}>
                    {SCRIPT_TEMPLATES.filter((t) => t.group === g).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
            <label className={lbl}>Số cảnh</label>
            <input
              type="number"
              min={1}
              max={12}
              className={field}
              value={data.sceneCount ?? 4}
              onChange={(e) => set({ sceneCount: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })}
            />
            {check('withDialogue', 'Có lời thoại')}
            <label className={lbl}>Hướng dẫn thêm cho AI</label>
            <textarea rows={2} className={field} value={data.extraNote || ''} onChange={(e) => set({ extraNote: e.target.value })} />
          </>
        )}

        {data.kind === 'prompts' && (
          <>
            <label className={lbl}>Mỗi dòng 1 cảnh</label>
            <textarea rows={5} className={`${field} nowheel`} value={data.prompts || ''} onChange={(e) => set({ prompts: e.target.value })} />
          </>
        )}

        {data.kind === 'render' && (
          <>
            <div className="grid grid-cols-2 gap-1">
              <div>
                <label className={lbl}>Giây / cảnh</label>
                <select className={field} value={data.duration ?? 8} onChange={(e) => set({ duration: Number(e.target.value) })}>
                  {[4, 6, 8, 10].map((d) => (
                    <option key={d} value={d}>
                      {d}s
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={lbl}>Tỉ lệ</label>
                <select className={field} value={data.aspectRatio || '9:16'} onChange={(e) => set({ aspectRatio: e.target.value })}>
                  {['9:16', '16:9', '1:1'].map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <label className={lbl}>Góc máy</label>
            <select className={field} value={data.cameraMotion || ''} onChange={(e) => set({ cameraMotion: e.target.value })}>
              {CAMERA.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            {check('chainEndFrame', 'Nối khung cuối → khung đầu')}
            {check('rotateProductImages', 'Xoay vòng ảnh sản phẩm')}
          </>
        )}

        {data.kind === 'upscale' && (
          <select className={`${field} mt-1`} value={data.shortSide ?? 1080} onChange={(e) => set({ shortSide: Number(e.target.value) })}>
            {[1080, 1440, 2160].map((n) => (
              <option key={n} value={n}>
                Cạnh ngắn {n}px
              </option>
            ))}
          </select>
        )}

        {data.kind === 'blur' && (
          <div className="grid grid-cols-2 gap-x-1">
            {WATERMARK_SPOTS.map((s) => (
              <label key={s.id} className="nodrag flex items-center gap-1 text-[10px] text-slate-300 mt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={(data.spots ?? []).includes(s.id)}
                  onChange={(e) =>
                    set({ spots: e.target.checked ? [...(data.spots ?? []), s.id] : (data.spots ?? []).filter((x) => x !== s.id) })
                  }
                />
                {s.label}
              </label>
            ))}
          </div>
        )}
      </div>
      {hasOutput(data.kind) && <Handle type="source" position={Position.Right} style={{ background: meta.color, width: 10, height: 10 }} />}
    </div>
  );
};

const NODE_TYPES = { block: BlockNodeView };
const PALETTE: BlockKind[] = ['product', 'character', 'script', 'prompts', 'dialogue', 'render', 'merge', 'blur', 'upscale', 'result'];

const EditorInner: React.FC<{
  template: WorkflowTemplate;
  onApply: (tpl: WorkflowTemplate) => void;
}> = ({ template, onApply }) => {
  const initial = useMemo(() => templateToGraph(template), [template]);
  const [nodes, setNodes, onNodesChange] = useNodesState<BlockNode>(initial.nodes as BlockNode[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges as Edge[]);
  const [report, setReport] = useState<{ errors: string[]; warnings: string[]; ok?: string } | null>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();

  const kindOf = useCallback((id: string) => nodes.find((n) => n.id === id)?.data.kind, [nodes]);

  const isValidConnection = useCallback(
    (c: Connection | Edge) => c.source !== c.target && canConnect(kindOf(c.source), kindOf(c.target)),
    [kindOf]
  );

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge({ ...c, id: `e_${c.source}_${c.target}`, animated: true }, eds)),
    [setEdges]
  );

  const addBlock = (kind: BlockKind) => {
    const pos = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    setNodes((ns) => [
      ...ns,
      { id: newNodeId(kind), type: 'block', position: { x: pos.x + Math.random() * 60, y: pos.y + Math.random() * 60 }, data: defaultData(kind) },
    ]);
  };

  const reset = () => {
    const g = templateToGraph({ ...template, graph: undefined });
    setNodes(g.nodes as BlockNode[]);
    setEdges(g.edges as Edge[]);
    setReport(null);
    window.setTimeout(() => fitView({ padding: 0.2 }), 50);
  };

  const compile = () =>
    compileGraph(
      nodes.map((n) => ({ id: n.id, type: 'block' as const, position: n.position, data: n.data })),
      edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
      {
        id: template.builtin ? newNodeId('result').replace('result', 'wf') : template.id,
        name: template.builtin ? `${template.name} (sơ đồ)` : template.name,
        icon: template.icon,
        category: template.category || 'Sơ đồ khối',
        description: template.description,
      }
    );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-xl p-2">
        <span className="text-[10px] text-slate-500 mr-1">Thêm khối:</span>
        {PALETTE.map((k) => (
          <button
            key={k}
            onClick={() => addBlock(k)}
            className="px-2 py-1 rounded-lg text-[10px] text-white border"
            style={{ borderColor: BLOCKS[k].color, background: `${BLOCKS[k].color}22` }}
            title={BLOCKS[k].hint}
          >
            {BLOCKS[k].icon} {BLOCKS[k].label}
          </button>
        ))}
        <div className="ml-auto flex gap-1.5">
          <button onClick={reset} className="px-2.5 py-1 rounded-lg bg-slate-800 text-[10px] text-slate-200" title="Dựng lại sơ đồ từ mẫu đang chọn">
            ↺ Dựng từ mẫu
          </button>
          <button
            onClick={() => {
              const r = compile();
              setReport({ ...r, ok: r.template ? 'Sơ đồ hợp lệ.' : undefined });
            }}
            className="px-2.5 py-1 rounded-lg bg-slate-700 text-[10px] text-white"
          >
            🔍 Kiểm tra
          </button>
          <button
            onClick={() => {
              const r = compile();
              setReport({ ...r, ok: r.template ? 'Đã áp dụng: workflow này dùng cho các dòng chạy từ đầu.' : undefined });
              if (r.template) onApply(r.template);
            }}
            className="px-3 py-1 rounded-lg bg-emerald-600 text-[10px] font-bold text-white"
          >
            ✔ Áp dụng & lưu workflow
          </button>
        </div>
      </div>
      {report && (
        <div className="text-[11px] space-y-0.5">
          {report.errors.map((e) => (
            <p key={e} className="text-red-300">
              ⛔ {e}
            </p>
          ))}
          {report.warnings.map((w) => (
            <p key={w} className="text-amber-300">
              ⚠ {w}
            </p>
          ))}
          {report.ok && <p className="text-emerald-300">✅ {report.ok}</p>}
        </div>
      )}
      <div className="h-[560px] rounded-2xl border border-slate-800 overflow-hidden bg-slate-950">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          nodeTypes={NODE_TYPES}
          colorMode="dark"
          fitView
          fitViewOptions={{ padding: 0.2 }}
          defaultEdgeOptions={{ animated: true }}
          deleteKeyCode={['Delete', 'Backspace']}
        >
          <Background gap={20} />
          <Controls />
          <MiniMap pannable zoomable nodeColor={(n) => BLOCKS[(n.data as BlockData).kind]?.color || '#64748b'} />
        </ReactFlow>
      </div>
      <p className="text-[10px] text-slate-500">
        Kéo từ chấm bên phải khối này sang chấm bên trái khối kia để nối. Chỉ nối được các cặp hợp lệ (vd. Sản phẩm →
        AI viết kịch bản → Render → Ghép → Kết quả). Chọn khối / dây rồi bấm Delete để xóa. Sơ đồ được dịch thành mẫu
        workflow và chạy bằng đúng bộ máy của tab Workflow (danh sách dòng, chạy tiếp từ bước lỗi...).
      </p>
    </div>
  );
};

export const WorkflowGraphEditor: React.FC<{
  template: WorkflowTemplate;
  onApply: (tpl: WorkflowTemplate) => void;
}> = (props) => (
  <ReactFlowProvider>
    {/* key: đổi mẫu thì dựng lại sơ đồ */}
    <EditorInner key={props.template.id} {...props} />
  </ReactFlowProvider>
);
