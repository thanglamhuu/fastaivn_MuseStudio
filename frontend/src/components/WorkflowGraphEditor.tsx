import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
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
  CharSource,
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
import type { StepStatus, WorkflowRow, WorkflowTemplate } from '../types/workflow';
import { StudioCharacter, newLibraryId } from '../types/library';
import { fileToResizedDataUrl } from '../utils/image';
import { parseHndWorkflow } from '../services/hndImport';

type BlockNode = Node<BlockData, 'block'>;

/** Thư viện nhân vật (Cài đặt) cho khối Nhân vật — khối do ReactFlow vẽ nên truyền qua context. */
export interface CharacterLibraryApi {
  characters: StudioCharacter[];
  addCharacter: (c: StudioCharacter) => void;
  updateCharacter: (id: string, patch: Partial<StudioCharacter>) => void;
  onOpenSettings?: () => void;
}
const CharLibContext = createContext<CharacterLibraryApi>({
  characters: [],
  addCharacter: () => undefined,
  updateCharacter: () => undefined,
});

/** Lượt chạy gần nhất của sơ đồ — để tô trạng thái lên từng khối. */
const RunContext = createContext<WorkflowRow | undefined>(undefined);

const BADGE: Record<StepStatus, string> = {
  pending: 'bg-slate-700 text-slate-300',
  running: 'bg-indigo-600 text-white animate-pulse',
  done: 'bg-emerald-600 text-white',
  skipped: 'bg-slate-700 text-slate-400',
  failed: 'bg-red-600 text-white',
  review: 'bg-amber-500 text-slate-950',
};
const STATUS_TEXT: Record<StepStatus, string> = {
  pending: 'chờ',
  running: 'đang chạy',
  done: 'xong',
  skipped: 'bỏ qua',
  failed: 'lỗi',
  review: 'chờ duyệt',
};

/** Trạng thái của 1 khối theo bước tương ứng trong lượt chạy. */
const blockRunState = (kind: BlockKind, row?: WorkflowRow): { status: StepStatus; text: string; title?: string } | null => {
  if (!row) return null;
  const s = row.steps;
  const scenes = row.scenes ?? [];
  const done = scenes.filter((x) => x.status === 'done').length;
  switch (kind) {
    case 'product':
      return { status: s.product.status, text: STATUS_TEXT[s.product.status], title: s.product.error || s.product.detail };
    case 'script':
    case 'prompts':
    case 'dialogue':
      return { status: s.script.status, text: STATUS_TEXT[s.script.status], title: s.script.error || s.script.detail };
    case 'character':
    case 'outfit': {
      // Ảnh tham chiếu được chuẩn bị đầu bước Render (AI vẽ chân dung / tạo ảnh trang phục)
      const prep = s.scenes.status === 'running' && !scenes.some((x) => x.status !== 'pending');
      if (prep) return { status: 'running', text: s.scenes.detail?.slice(0, 26) || 'chuẩn bị ảnh', title: s.scenes.detail };
      if (scenes.some((x) => x.status !== 'pending')) return { status: 'done', text: 'xong' };
      return null;
    }
    case 'render':
      return {
        status: s.scenes.status,
        text: scenes.length ? `${done}/${scenes.length} cảnh` : STATUS_TEXT[s.scenes.status],
        title: s.scenes.error || s.scenes.detail,
      };
    case 'merge':
      return { status: s.merge.status, text: STATUS_TEXT[s.merge.status], title: s.merge.error || s.merge.detail };
    case 'blur':
    case 'upscale':
      return { status: s.post.status, text: STATUS_TEXT[s.post.status], title: s.post.error || s.post.detail };
    case 'result': {
      const out = row.final || row.merged;
      if (out) return { status: 'done', text: 'đã xuất clip', title: out.path };
      const failed = Object.values(s).some((x) => x.status === 'failed');
      return failed ? { status: 'failed', text: 'lỗi' } : { status: 'pending', text: 'chờ' };
    }
  }
};

/** Khối Trang phục: tải ảnh lên, hoặc chỉ mô tả để AI tạo ảnh trang phục lúc chạy. */
const OutfitBlockBody: React.FC<{ data: BlockData; set: (patch: Partial<BlockData>) => void }> = ({ data, set }) => {
  const [dragOver, setDragOver] = useState(false);
  const img = String(data.outfitImage || '');
  const take = async (file?: File) => {
    if (!file || !file.type.startsWith('image/')) return;
    set({ outfitImage: await fileToResizedDataUrl(file) });
  };
  return (
    <>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          take(e.dataTransfer.files?.[0]);
        }}
        className={`nodrag mt-1 flex items-center gap-1.5 rounded border border-dashed p-1 cursor-pointer ${
          dragOver ? 'border-pink-400 bg-pink-500/10' : 'border-white/20 hover:border-pink-400'
        }`}
        title="Bấm để chọn ảnh, hoặc kéo thả ảnh vào đây"
      >
        {img ? (
          <img src={img} alt="Trang phục" className="w-12 h-16 object-cover rounded" />
        ) : (
          <div className="w-12 h-16 rounded bg-slate-950 flex items-center justify-center text-lg">👗</div>
        )}
        <span className="text-[9px] text-slate-300">
          {img ? 'Đổi ảnh (bấm / kéo thả)' : 'Chọn / kéo thả ảnh trang phục. Để trống = AI tự tạo theo mô tả'}
        </span>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            take(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>
      {img && (
        <button className="nodrag text-[9px] text-red-300 mt-0.5" onClick={() => set({ outfitImage: '' })}>
          ✕ Bỏ ảnh (để AI tự tạo)
        </button>
      )}
      <label className={lbl}>Mô tả trang phục</label>
      <textarea
        rows={2}
        className={`${field} nowheel`}
        placeholder="vd. Set blazer croptop trắng kem phối chân váy xếp ly..."
        value={String(data.outfitDesc || '')}
        onChange={(e) => set({ outfitDesc: e.target.value })}
      />
    </>
  );
};

const CHAR_SOURCES: [CharSource, string, string][] = [
  ['library', '📚 Thư viện', 'Chọn nhân vật đã cấu hình trong Cài đặt'],
  ['upload', '⬆ Tải ảnh', 'Tải ảnh nhân vật lên (tự lưu vào thư viện nhân vật)'],
  ['row', '🔁 Theo dòng', 'Mỗi dòng tự chọn nhân vật ở danh sách dòng'],
];

/** Phần cấu hình của khối Nhân vật: chọn từ thư viện / tải ảnh lên / theo dòng. */
const CharacterBlockBody: React.FC<{ data: BlockData; set: (patch: Partial<BlockData>) => void }> = ({ data, set }) => {
  const { characters, addCharacter, updateCharacter, onOpenSettings } = useContext(CharLibContext);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const source: CharSource = (data.charSource as CharSource) || 'row';
  const chosen = data.characterId ? characters.find((c) => c.id === data.characterId) : undefined;
  const missing = !!data.characterId && !chosen;

  /** Ảnh tải lên: cập nhật nhân vật đã tải ở khối này, chưa có thì tạo nhân vật mới trong thư viện. */
  const takeFile = async (file?: File) => {
    if (!file || !file.type.startsWith('image/')) return;
    setLoading(true);
    try {
      const img = await fileToResizedDataUrl(file);
      if (source === 'upload' && chosen) {
        updateCharacter(chosen.id, { images: [img, ...chosen.images.filter((x) => x !== img)].slice(0, 4) });
        return;
      }
      const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 40);
      const item: StudioCharacter = {
        id: newLibraryId('char'),
        name: baseName || `Nhân vật ${characters.length + 1}`,
        description: '',
        images: [img],
        voicePresetId: 'voice_03',
        emotion: 'Natural',
        createdAt: Date.now(),
      };
      addCharacter(item);
      set({ charSource: 'upload', characterId: item.id });
    } finally {
      setLoading(false);
    }
  };

  const tabs = (
    <div className="nodrag grid grid-cols-3 gap-0.5 mt-1 bg-slate-950 rounded p-0.5">
      {CHAR_SOURCES.map(([id, label, tip]) => (
        <button
          key={id}
          title={tip}
          onClick={() => {
            // Đổi sang "tải ảnh" thì bắt đầu ô trống, tránh ghi đè ảnh của nhân vật thư viện
            if (id === 'upload' && source !== 'upload') set({ charSource: id, characterId: '' });
            else set({ charSource: id });
          }}
          className={`text-[9px] rounded py-0.5 ${source === id ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const preview = chosen && (
    <div className="flex gap-1.5 mt-1.5 items-start">
      {chosen.images[0] ? (
        <img src={chosen.images[0]} alt={chosen.name} className="w-12 h-16 object-cover rounded border border-white/10" />
      ) : (
        <div className="w-12 h-16 rounded border border-dashed border-white/20 flex items-center justify-center text-[8px] text-slate-500 text-center">
          Chưa có ảnh
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold text-white truncate">{chosen.name}</p>
        <p className="text-[9px] text-slate-400 line-clamp-3">{chosen.description || 'Chưa có mô tả ngoại hình'}</p>
      </div>
    </div>
  );

  return (
    <>
      {tabs}
      {source === 'library' && (
        <>
          <select
            className={`${field} mt-1`}
            value={chosen ? chosen.id : ''}
            onChange={(e) => set({ characterId: e.target.value })}
          >
            <option value="">— Chọn nhân vật —</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.images.length ? '🖼' : '·'} {c.name || '(chưa đặt tên)'}
              </option>
            ))}
          </select>
          {characters.length === 0 && (
            <p className="text-[9px] text-amber-300 mt-1">
              Thư viện trống.{' '}
              {onOpenSettings && (
                <button className="nodrag underline" onClick={onOpenSettings}>
                  Mở Cài đặt
                </button>
              )}{' '}
              hoặc chuyển sang ⬆ Tải ảnh.
            </p>
          )}
          {preview}
        </>
      )}

      {source === 'upload' && (
        <>
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              takeFile(e.dataTransfer.files?.[0]);
            }}
            className={`nodrag mt-1 flex items-center gap-1.5 rounded border border-dashed p-1 cursor-pointer ${
              dragOver ? 'border-purple-400 bg-purple-500/10' : 'border-white/20 hover:border-purple-400'
            }`}
            title="Bấm để chọn ảnh, hoặc kéo thả ảnh vào đây"
          >
            {chosen?.images[0] ? (
              <img src={chosen.images[0]} alt={chosen.name} className="w-12 h-16 object-cover rounded" />
            ) : (
              <div className="w-12 h-16 rounded bg-slate-950 flex items-center justify-center text-lg">🖼</div>
            )}
            <span className="text-[9px] text-slate-300">
              {loading ? 'Đang đọc ảnh...' : chosen ? 'Đổi ảnh (bấm / kéo thả)' : 'Chọn ảnh hoặc kéo thả ảnh nhân vật vào đây'}
            </span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                takeFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          {chosen && (
            <>
              <label className={lbl}>Tên gọi trong prompt</label>
              <input className={field} value={chosen.name} onChange={(e) => updateCharacter(chosen.id, { name: e.target.value })} />
              <label className={lbl}>Ngoại hình / tính cách</label>
              <textarea
                rows={2}
                className={`${field} nowheel`}
                placeholder="vd. Nữ 23 tuổi, tóc đen dài, da trắng..."
                value={chosen.description}
                onChange={(e) => updateCharacter(chosen.id, { description: e.target.value })}
              />
              <p className="text-[9px] text-emerald-300/80 mt-1">✔ Đã lưu vào thư viện nhân vật (chỉnh giọng ở Cài đặt).</p>
            </>
          )}
        </>
      )}

      {source === 'row' && (
        <p className="text-[9px] text-slate-400 mt-1">Mỗi dòng ở danh sách dòng tự chọn nhân vật. Dòng không chọn → không khóa mặt.</p>
      )}

      {missing && <p className="text-[9px] text-red-300 mt-1">Nhân vật đã bị xóa khỏi thư viện — chọn lại.</p>}
      {(source === 'row' || (chosen && !chosen.images.length)) && (
        <label className="nodrag flex items-center gap-1 text-[10px] text-slate-300 mt-1 cursor-pointer">
          <input type="checkbox" checked={data.autoPortrait !== false} onChange={(e) => set({ autoPortrait: e.target.checked })} />
          Chưa có ảnh → AI vẽ chân dung
        </label>
      )}
    </>
  );
};

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
  const runRow = useContext(RunContext);
  const run = blockRunState(data.kind, runRow);
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
      style={{
        borderColor: run?.status === 'running' ? '#818cf8' : run?.status === 'failed' ? '#ef4444' : meta.color,
        width: ['prompts', 'script', 'character', 'outfit', 'render'].includes(data.kind) ? 240 : 190,
      }}
    >
      {hasInput(data.kind) && <Handle type="target" position={Position.Left} style={{ background: meta.color, width: 10, height: 10 }} />}
      <div className="flex items-center justify-between px-2 py-1.5 rounded-t-xl" style={{ background: `${meta.color}33` }}>
        <span className="text-[11px] font-bold text-white">
          {meta.icon} {meta.label}
        </span>
        {run && (
          <span className={`ml-auto mr-1.5 px-1.5 rounded text-[9px] font-semibold truncate max-w-[120px] ${BADGE[run.status]}`} title={run.title}>
            {run.text}
          </span>
        )}
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

        {data.kind === 'character' && <CharacterBlockBody data={data} set={set} />}
        {data.kind === 'outfit' && <OutfitBlockBody data={data} set={set} />}

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
            <label className={lbl}>Cách dùng ảnh tham chiếu</label>
            <select
              className={field}
              value={data.refMode === 'firstframe' ? 'firstframe' : 'reference'}
              onChange={(e) => set({ refMode: e.target.value as BlockData['refMode'] })}
              title="Reference-to-Video: ảnh chỉ để giữ mặt / trang phục / sản phẩm, cảnh dựng theo lời mô tả (khuyên dùng)"
            >
              <option value="reference">Reference-to-Video (khuyên dùng)</option>
              <option value="firstframe">Ảnh nhân vật làm khung mở đầu</option>
            </select>
            <label className={lbl}>Bối cảnh cố định (mọi cảnh)</label>
            <textarea
              rows={2}
              className={`${field} nowheel`}
              placeholder="vd. Hành lang studio thời trang tối giản, tường trắng kem, sàn bê tông mài bóng, đèn softbox 5600K"
              value={String(data.setting || '')}
              onChange={(e) => set({ setting: e.target.value })}
            />
            {check('chainEndFrame', 'Nối khung cuối → khung đầu')}
            {check('rotateProductImages', 'Xoay vòng ảnh sản phẩm')}
            <label className="nodrag flex items-center gap-1 text-[10px] text-slate-300 mt-1 cursor-pointer">
              <input type="checkbox" checked={data.realismLock !== false} onChange={(e) => set({ realismLock: e.target.checked })} />
              Khóa chân thật (chống màu AI)
            </label>
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
const PALETTE: BlockKind[] = ['product', 'character', 'outfit', 'script', 'prompts', 'dialogue', 'render', 'merge', 'blur', 'upscale', 'result'];

interface RunControls {
  /** Chạy workflow ngay từ sơ đồ (đã kiểm tra hợp lệ) */
  onRun: (tpl: WorkflowTemplate) => void;
  onStop: () => void;
  /** Đang có workflow / dòng khác chạy */
  busy: boolean;
}

const EditorInner: React.FC<
  {
    template: WorkflowTemplate;
    onApply: (tpl: WorkflowTemplate) => void;
  } & RunControls
> = ({ template, onApply, onRun, onStop, busy }) => {
  const initial = useMemo(() => templateToGraph(template), [template]);
  const [nodes, setNodes, onNodesChange] = useNodesState<BlockNode>(initial.nodes as BlockNode[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges as Edge[]);
  const [report, setReport] = useState<{ errors: string[]; warnings: string[]; ok?: string } | null>(null);
  /** Workflow nhập từ file HND: lưu thành workflow mới mang tên file */
  const [imported, setImported] = useState<{ id: string; name: string; description: string } | null>(null);
  const { addCharacter, characters } = useContext(CharLibContext);
  const { screenToFlowPosition, fitView } = useReactFlow();

  const importHnd = async (file?: File) => {
    if (!file) return;
    try {
      const res = parseHndWorkflow(JSON.parse(await file.text()), characters);
      res.newCharacters.forEach(addCharacter);
      setNodes(res.nodes as BlockNode[]);
      setEdges(res.edges.map((e) => ({ ...e, animated: true })) as Edge[]);
      setImported({ id: newLibraryId('wf'), name: res.name, description: res.description });
      const sceneCount = String(res.nodes.find((n) => n.data.kind === 'prompts')?.data.prompts || '').split('\n').length;
      setReport({
        errors: [],
        warnings: res.notes,
        ok: `Đã nhập "${res.name}": ${sceneCount} cảnh${
          res.newCharacters.length ? `, thêm nhân vật ${res.newCharacters.map((c) => c.name).join(', ')} vào thư viện (chưa có ảnh → AI vẽ chân dung khi chạy)` : ''
        }. Kiểm tra rồi bấm ▶ Chạy Workflow.`,
      });
      window.setTimeout(() => fitView({ padding: 0.2 }), 50);
    } catch (err: any) {
      setReport({ errors: [`Không nhập được file: ${err?.message || err}`], warnings: [] });
    }
  };

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
    const id = newNodeId(kind);
    setNodes((ns) => [
      ...ns,
      { id, type: 'block', position: { x: pos.x + Math.random() * 60, y: pos.y + Math.random() * 60 }, data: defaultData(kind) },
    ]);
    // Nhân vật mới: tự nối vào nguồn cảnh (AI viết kịch bản / Prompt nhập tay) đang có
    if (kind === 'character' || kind === 'outfit') {
      const targets = nodes.filter((n) => n.data.kind === 'script' || n.data.kind === 'prompts');
      if (targets.length) {
        setEdges((eds) => [
          ...eds,
          ...targets.map((t) => ({ id: `e_${id}_${t.id}`, source: id, target: t.id, animated: true })),
        ]);
      }
    }
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
      imported
        ? { id: imported.id, name: imported.name, icon: '🧩', category: 'Nhập từ HND', description: imported.description }
        : {
            id: template.builtin ? newNodeId('result').replace('result', 'wf') : template.id,
            name: template.builtin ? `${template.name} (sơ đồ)` : template.name,
            icon: template.icon,
            category: template.category || 'Sơ đồ khối',
            description: template.description,
          }
    );

  const run = () => {
    const r = compile();
    if (!r.template) {
      setReport({ ...r });
      return;
    }
    setReport({ ...r, ok: 'Đã lưu workflow và bắt đầu chạy — theo dõi tiến độ trên từng khối và bảng bên dưới.' });
    onRun(r.template);
  };

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
        <div className="ml-auto flex flex-wrap gap-1.5">
          <label
            className="px-2.5 py-1 rounded-lg bg-slate-800 text-[10px] text-slate-200 cursor-pointer"
            title="Nhập file workflow .json xuất từ HND Muse AI (Prompt / Generate Video / Merge)"
          >
            📥 Nhập workflow HND
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                importHnd(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
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
          {busy ? (
            <button onClick={onStop} className="px-3 py-1 rounded-lg bg-red-600 text-[10px] font-bold text-white">
              ⏹ Dừng
            </button>
          ) : (
            <button
              onClick={run}
              className="px-3 py-1 rounded-lg bg-indigo-600 text-[10px] font-bold text-white"
              title="Kiểm tra, lưu và chạy workflow ngay: tạo ảnh tham chiếu → render các cảnh → ghép clip"
            >
              ▶ Chạy Workflow
            </button>
          )}
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

export const WorkflowGraphEditor: React.FC<
  {
    template: WorkflowTemplate;
    onApply: (tpl: WorkflowTemplate) => void;
    characterLibrary: CharacterLibraryApi;
    /** Lượt chạy gần nhất của workflow này (tô trạng thái lên khối) */
    runRow?: WorkflowRow;
  } & RunControls
> = ({ characterLibrary, runRow, ...props }) => (
  <CharLibContext.Provider value={characterLibrary}>
    <RunContext.Provider value={runRow}>
      <ReactFlowProvider>
        {/* key: đổi mẫu thì dựng lại sơ đồ */}
        <EditorInner key={props.template.id} {...props} />
      </ReactFlowProvider>
    </RunContext.Provider>
  </CharLibContext.Provider>
);
