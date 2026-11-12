// Sơ đồ Node kiểu MV1 Muse AI: tự lắp workflow bằng các node Prompt / Upload Image / Gemini Script /
// Generate Image / Generate Video / Upscale / Merge / Trích frame cuối / Xóa logo / Result, nối dây
// theo cổng text-image-video, chạy song song trên các tài khoản Muse. Nhập / xuất JSON tương thích MV1
// và có sẵn 13 mẫu Workflow của MV1 (tab Mẫu Workflow).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Connection,
  Controls,
  Edge,
  EdgeChange,
  Handle,
  MiniMap,
  Node,
  NodeChange,
  NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { usePersistentState } from '../hooks/usePersistentState';
import type { StudioCharacter, StudioProduct } from '../types/library';
import { fileToResizedDataUrl } from '../utils/image';
import { openProjectFolder } from '../services/museBatchService';
import {
  FieldDef,
  FlowEdge,
  FlowNode,
  FlowNodeData,
  FlowWorkflow,
  LOGO_SPOTS,
  NODE_DEFS,
  NODE_GROUPS,
  NodeResult,
  NodeType,
  PORT_COLOR,
  REF_LOCKS,
  RefLock,
  RunStatus,
  locksOf,
  connectionError,
  emptyWorkflow,
  makeNode,
  newId,
  nodePorts,
  portKind,
  validateWorkflow,
} from '../services/nodeFlow/definitions';
import { RunMode, aiText, runFlow } from '../services/nodeFlow/runtime';
import { HndFlowTemplate, buildTemplatePackage, exportFlowJson, loadHndFlowTemplates, parseFlowJson } from '../services/nodeFlow/flowIO';
import { APP_VERSION } from '../services/templateCatalog';
import { cutFrame } from '../services/libraryService';
import { urlToResizedDataUrl } from '../utils/image';
import { extractJson, getScrapeStatus, getShopLoginState, openShopLogin, scrapeProductLink } from '../services/productService';
import { mergeProductIntoPrompt, productIdeaInstruction, shortProductName } from '../services/nodeFlow/shopeePrompt';
import { newLibraryId } from '../types/library';
import { GATEWAY_URL } from '../config/appConfig';

interface FlowLibrary {
  workflows: FlowWorkflow[];
  activeId: string;
}

const STATUS_STYLE: Record<RunStatus, string> = {
  idle: 'bg-slate-700 text-slate-300',
  queued: 'bg-slate-600 text-slate-200',
  running: 'bg-indigo-600 text-white animate-pulse',
  done: 'bg-emerald-600 text-white',
  error: 'bg-red-600 text-white',
  skipped: 'bg-amber-600 text-white',
};
const STATUS_TEXT: Record<RunStatus, string> = {
  idle: 'chưa chạy',
  queued: 'chờ',
  running: 'đang chạy',
  done: 'xong',
  error: 'lỗi',
  skipped: 'bị chặn',
};

const projectOf = (wf: FlowWorkflow) => `Node - ${wf.name}`.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 70);
const short = (s = '', n = 120) => (s.length > n ? `${s.slice(0, n)}…` : s);

type RFNode = Node<{ node: FlowNode }, 'flow'>;

const ResultThumbs: React.FC<{ results?: NodeResult[]; big?: boolean }> = ({ results, big }) => {
  if (!results?.length) return null;
  return (
    <div className={`flex flex-wrap gap-1 ${big ? '' : 'mt-1'}`}>
      {results.slice(0, big ? 12 : 4).map((r, i) =>
        r.kind === 'image' ? (
          <img key={i} src={r.value} className={`${big ? 'w-28' : 'w-12 h-16 object-cover'} rounded border border-white/10`} />
        ) : r.kind === 'video' ? (
          <video key={i} src={r.value} controls={big} muted className={`${big ? 'w-40' : 'w-12 h-16 object-cover'} rounded border border-emerald-600/50 bg-black`} />
        ) : big ? (
          <pre key={i} className="w-full whitespace-pre-wrap text-[10px] text-slate-300 bg-slate-950 rounded p-1.5 max-h-40 overflow-auto">
            {`#${i} ${r.value}`}
          </pre>
        ) : null
      )}
    </div>
  );
};

const nodeSummary = (n: FlowNode): string => {
  const d = n.data;
  switch (n.type) {
    case 'prompt':
      return short(String(d.prompt || '(trống)'), 110);
    case 'upload-image': {
      const locks = locksOf(d);
      const icons = locks.map((l) => REF_LOCKS.find((x) => x.id === l)!.icon).join('');
      const from = [d.characterId ? '👤 từ Cài đặt' : '', d.productId ? '📦 từ Cài đặt' : ''].filter(Boolean).join(' · ');
      return `${icons} ${locks.map((l) => REF_LOCKS.find((x) => x.id === l)!.label.replace('Khóa ', '')).join(' + ')}${d.characterName ? ` · ${d.characterName}` : ''} · ${from || (d.image ? 'ảnh tải lên' : 'AI tự tạo')}`;
    }
    case 'gemini-script':
      return `${d.outputCount || 1} đoạn prompt${d.firstOutputIsCharacter ? ' (đoạn 1 = nhân vật)' : ''}`;
    case 'generate-image':
      return `Muse Image · ${d.imageMode || 'text-to-image'} · ${d.ratio || '9:16'} · ${d.count || 1} ảnh`;
    case 'generate-video':
      return `Muse Video · ${d.videoMode || 'text-to-video'} · ${d.ratio || '9:16'} · ${d.duration || 10}s`;
    case 'merge-video':
      return `${d.portCount || 2} cổng video`;
    case 'upscale-image':
    case 'upscale-video':
      return String(d.resolution || '');
    case 'remove-image-logo':
    case 'remove-video-logo':
      return `Vùng: ${(d.spots || ['br']).join(', ')}`;
    default:
      return '';
  }
};

/** Cho node trên canvas đọc sơ đồ (tên nguồn của từng cổng) và sửa nhanh cấu hình (+/− cổng Merge). */
const NodeCtx = createContext<{ wf: FlowWorkflow | null; patchNode: (id: string, p: Partial<FlowNodeData>) => void; busy: boolean }>({
  wf: null,
  patchNode: () => undefined,
  busy: false,
});

const FlowNodeView: React.FC<NodeProps<RFNode>> = ({ data, selected }) => {
  const n = data.node;
  const def = NODE_DEFS[n.type];
  const { inputs, outputs } = nodePorts(n);
  const st = (n.data.runStatus || 'idle') as RunStatus;
  const rows = Math.max(inputs.length, outputs.length);
  const { wf, patchNode, busy } = useContext(NodeCtx);
  /** Merge: cổng video-in-i đang nối từ node nào (để thấy thứ tự ghép ngay trên node) */
  const srcLabel = (h: string) => {
    if (n.type !== 'merge-video' || !wf) return h;
    const e = wf.edges.find((x) => x.target === n.id && x.targetHandle === h);
    const s = e && wf.nodes.find((x) => x.id === e.source);
    const idx = Number(h.split('-').pop()) + 1;
    return s ? `${idx}. ${short(String(s.data.batchLabel || NODE_DEFS[s.type].label), 26)}` : `${idx}. (trống)`;
  };
  return (
    <div
      className={`w-[260px] rounded-xl bg-slate-900/95 border text-left shadow-lg ${selected ? 'border-indigo-400 ring-2 ring-indigo-500/40' : 'border-white/10'}`}
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-t-xl" style={{ background: `${def.color}33`, borderBottom: `1px solid ${def.color}66` }}>
        <span>{def.icon}</span>
        <span className="text-[11px] font-bold text-white truncate flex-1">{n.data.batchLabel || def.label}</span>
        <span className={`text-[9px] px-1.5 py-0.5 rounded ${STATUS_STYLE[st]}`}>
          {st === 'running' && typeof n.data.progress === 'number' ? `${n.data.progress}%` : STATUS_TEXT[st]}
        </span>
      </div>
      <div className="px-2.5 pt-1.5 pb-2">
        {n.data.batchLabel && <p className="text-[9px] uppercase tracking-wide text-slate-500">{def.label}</p>}
        {n.type === 'upload-image' && n.data.image && <img src={String(n.data.image)} className="w-full h-24 object-cover rounded mb-1 border border-white/10" />}
        <p className="text-[10px] text-slate-300 leading-snug break-words">{nodeSummary(n)}</p>
        {n.data.error && <p className="text-[10px] text-red-300 mt-1 break-words">{short(String(n.data.error), 140)}</p>}
        {n.type !== 'upload-image' && <ResultThumbs results={n.data.results} />}
        {n.type === 'merge-video' && (
          <div className="nodrag mt-1 flex items-center gap-1 text-[10px] text-slate-300">
            Số cổng video
            <button
              disabled={busy || inputs.length <= 2}
              onClick={() => patchNode(n.id, { portCount: Math.max(2, inputs.length - 1) })}
              className="px-1.5 rounded bg-slate-700 disabled:opacity-30"
            >
              −
            </button>
            <b className="w-5 text-center">{inputs.length}</b>
            <button disabled={busy || inputs.length >= 20} onClick={() => patchNode(n.id, { portCount: inputs.length + 1 })} className="px-1.5 rounded bg-slate-700 disabled:opacity-30">
              ＋
            </button>
          </div>
        )}
        {/* Nhãn cổng */}
        <div className="mt-1.5 space-y-0.5">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex justify-between gap-2 text-[9px] text-slate-500 h-[14px] leading-[14px]">
              <span className={`truncate ${n.type === 'merge-video' ? 'text-amber-200/80' : ''}`}>{inputs[i] ? srcLabel(inputs[i]) : ''}</span>
              <span>{outputs[i] || ''}</span>
            </div>
          ))}
        </div>
      </div>
      {inputs.map((h, i) => (
        <Handle
          key={h}
          id={h}
          type="target"
          position={Position.Left}
          style={{ top: `calc(100% - ${(rows - i) * 15.5 + 4}px)`, background: PORT_COLOR[portKind(h) as 'text'], width: 11, height: 11, border: '2px solid #0f172a' }}
        />
      ))}
      {outputs.map((h, i) => (
        <Handle
          key={h}
          id={h}
          type="source"
          position={Position.Right}
          style={{ top: `calc(100% - ${(rows - i) * 15.5 + 4}px)`, background: PORT_COLOR[portKind(h) as 'text'], width: 11, height: 11, border: '2px solid #0f172a' }}
        />
      ))}
    </div>
  );
};

const nodeTypes = { flow: FlowNodeView };

/* ------------------------------------------------------------------ Inspector */
const inputCls = 'w-full bg-slate-950 border border-white/10 text-[11px] text-slate-200 rounded-lg p-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500';

/** Thư viện trong Cài đặt (nhân vật / sản phẩm) cho gợi ý @ / @@ và khóa tham chiếu */
interface Lib {
  characters: StudioCharacter[];
  products: StudioProduct[];
  /** Lưu / cập nhật sản phẩm vào thư viện Cài đặt (node Prompt lấy từ link Shopee) */
  saveProduct?: (p: StudioProduct) => void;
}

/**
 * Node Prompt: dán link Shopee / TikTok Shop → đọc trang (bộ đọc link có sẵn, tự mở Chrome khi gặp captcha / cần đăng nhập)
 * → AI rút tên ngắn, điểm nổi bật, ý tưởng, ngoại hình → lưu sản phẩm vào thư viện (để @@ gửi kèm ảnh khi render)
 * → PHỐI vào prompt có sẵn (điền chỗ trống @@, thêm khối "SẢN PHẨM TỪ LINK"), không thay thế prompt mẫu.
 */
const ProductLinkField: React.FC<{ d: FlowNodeData; set: (p: Partial<FlowNodeData>) => void; lib: Lib; label: string }> = ({ d, set, lib, label }) => {
  const [url, setUrl] = useState(String(d.shopeeUrl || ''));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [needsLogin, setNeedsLogin] = useState<'' | 'shopee' | 'tiktok'>('');
  useEffect(() => setUrl(String(d.shopeeUrl || '')), [d.shopeeUrl]);

  const fetchInfo = async () => {
    const link = url.trim();
    if (!/^https?:\/\//i.test(link)) return setNote('Dán link sản phẩm Shopee / TikTok Shop (bắt đầu bằng https://).');
    setBusy(true);
    setNeedsLogin('');
    setNote('Đang mở trang sản phẩm (15-40 giây)…');
    const timer = window.setInterval(async () => {
      try {
        const st = await getScrapeStatus();
        if (st.busy && st.message) setNote(st.message);
      } catch {
        /* Gateway cũ chưa có /status */
      }
    }, 1500);
    try {
      const r = await scrapeProductLink(link);
      if (r.needs_login && r.site) setNeedsLogin(r.site);
      if (!r.title && !r.images.length) {
        setNote(`⚠️ ${r.warning || 'Không đọc được trang sản phẩm.'}`);
        return;
      }
      setNote('Đã đọc trang — AI đang rút điểm nổi bật & ý tưởng…');
      const prompt = String(d.prompt || '');
      let ai: any = {};
      try {
        const img = r.images[0] ? [await urlToResizedDataUrl(r.images[0].url, 1024)] : [];
        const res = await aiText(productIdeaInstruction(r.title, r.price, r.brand, r.description, r.text, prompt), img);
        ai = extractJson(res.text) || {};
      } catch {
        /* AI lỗi: vẫn dùng thông tin đọc được từ trang */
      }
      const name = String(ai.short_name || '').trim().slice(0, 60) || shortProductName(r.title) || 'Sản phẩm';
      const highlights: string[] = Array.isArray(ai.highlights) ? ai.highlights.map(String).slice(0, 5) : [];
      // Lưu vào thư viện (cập nhật nếu đã có cùng link / cùng tên) → @@<tên> gửi kèm ảnh + mô tả khi render
      const images: string[] = [];
      for (const im of r.images.slice(0, 3)) {
        try {
          images.push(await urlToResizedDataUrl(im.url, 1280));
        } catch {
          /* bỏ ảnh lỗi */
        }
      }
      const old = lib.products.find((p) => (p.url && p.url === r.url) || p.name === name);
      lib.saveProduct?.({
        id: old?.id || newLibraryId('prod'),
        name,
        price: r.price || old?.price || '',
        url: r.url || link,
        description: (highlights.length ? `${highlights.join('; ')}. ` : '') + (r.description || '').slice(0, 800),
        visual: String(ai.visual || old?.visual || ''),
        images: images.length ? images : old?.images || [],
        createdAt: old?.createdAt || Date.now(),
      });
      const merged = mergeProductIntoPrompt(
        prompt,
        { name, url: r.url || link, price: r.price, brand: r.brand, highlights, idea: String(ai.idea || '') },
        lib.products.map((p) => p.name),
        String(d.shopeeProductName || '')
      );
      set({ prompt: merged, shopeeUrl: link, shopeeProductName: name });
      setNote(
        `✅ ${name}${r.price ? ` — ${r.price}` : ''}: đã thêm vào prompt` +
          (lib.saveProduct ? ` và lưu vào thư viện sản phẩm (${images.length} ảnh)` : '') +
          (r.warning ? ` · ⚠️ ${r.warning}` : '')
      );
    } catch (err: any) {
      setNote(`❌ ${err.message}`);
    } finally {
      window.clearInterval(timer);
      setBusy(false);
    }
  };

  const login = async () => {
    if (!needsLogin) return;
    try {
      await openShopLogin(needsLogin);
      setNote(`Đăng nhập ${needsLogin === 'shopee' ? 'Shopee' : 'TikTok'} trong cửa sổ Chrome vừa mở, xong thì ĐÓNG cửa sổ đó rồi bấm "Lấy thông tin" lại.`);
      const t = window.setInterval(async () => {
        try {
          if (!(await getShopLoginState()).open) {
            window.clearInterval(t);
            setNeedsLogin('');
          }
        } catch {
          window.clearInterval(t);
        }
      }, 2000);
    } catch (err: any) {
      setNote(`❌ ${err.message}`);
    }
  };

  return (
    <div>
      <span className="block text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">{label}</span>
      <div className="flex gap-1">
        <input
          className={inputCls}
          value={url}
          placeholder="https://s.shopee.vn/… hoặc vt.tiktok.com/…"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && fetchInfo()}
        />
        <button
          type="button"
          onClick={fetchInfo}
          disabled={busy || !url.trim()}
          className="shrink-0 px-2 py-1 rounded-lg text-[11px] font-semibold bg-orange-600 hover:bg-orange-500 disabled:bg-slate-700 text-white"
        >
          {busy ? '…' : 'Lấy thông tin'}
        </button>
      </div>
      {needsLogin && (
        <button type="button" onClick={login} className="mt-1 px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-[10px] text-white">
          🔑 Đăng nhập {needsLogin === 'shopee' ? 'Shopee' : 'TikTok'} để đọc đủ thông tin
        </button>
      )}
      <span className="block text-[9px] text-slate-500 mt-0.5">
        {note ||
          'Thông tin sản phẩm được PHỐI vào prompt bên dưới (điền chỗ @@ trống + thêm khối "Sản phẩm từ link"), không thay prompt có sẵn.'}
      </span>
    </div>
  );
};

/** Ô nhập prompt: gõ @ → chọn nhân vật, @@ → chọn sản phẩm (trong Cài đặt). */
export const MentionTextarea: React.FC<{ value: string; onChange: (v: string) => void; lib: Lib; rows?: number }> = ({ value, onChange, lib, rows = 7 }) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [q, setQ] = useState<{ kind: '@' | '@@'; text: string; start: number } | null>(null);
  const [hi, setHi] = useState(0);
  const detect = (text: string, caret: number) => {
    const m = /(^|[\s(,.;:"'“”])(@@?)([^\s@]*)$/u.exec(text.slice(0, caret));
    if (!m) return setQ(null);
    setQ({ kind: m[2] as '@' | '@@', text: m[3], start: caret - m[2].length - m[3].length });
    setHi(0);
  };
  const items = !q
    ? []
    : (q.kind === '@@'
        ? lib.products.map((p) => ({ id: p.id, name: p.name, sub: p.price || p.description, img: p.images[0] }))
        : lib.characters.map((c) => ({ id: c.id, name: c.name, sub: c.description, img: c.images[0] }))
      )
        .filter((x) => !q.text || x.name.toLowerCase().includes(q.text.toLowerCase()))
        .slice(0, 8);
  const pick = (name: string) => {
    if (!q) return;
    const caret = ref.current?.selectionStart ?? value.length;
    const next = `${value.slice(0, q.start)}${q.kind}${name} ${value.slice(caret)}`;
    onChange(next);
    setQ(null);
    const pos = q.start + q.kind.length + name.length + 1;
    window.setTimeout(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    }, 0);
  };
  return (
    <div className="relative">
      <textarea
        ref={ref}
        rows={rows}
        className={inputCls}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          detect(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={(e) => {
          if (!q || !items.length) return;
          if (e.key === 'ArrowDown') (e.preventDefault(), setHi((h) => (h + 1) % items.length));
          else if (e.key === 'ArrowUp') (e.preventDefault(), setHi((h) => (h - 1 + items.length) % items.length));
          else if (e.key === 'Enter' || e.key === 'Tab') (e.preventDefault(), pick(items[hi].name));
          else if (e.key === 'Escape') setQ(null);
        }}
        onBlur={() => window.setTimeout(() => setQ(null), 150)}
      />
      {q && (
        <div className="absolute z-30 left-0 right-0 mt-0.5 bg-slate-950 border border-indigo-500/60 rounded-lg shadow-xl max-h-56 overflow-y-auto">
          <p className="text-[9px] text-slate-500 px-2 pt-1">{q.kind === '@@' ? '📦 Sản phẩm trong Cài đặt' : '👤 Nhân vật trong Cài đặt'}</p>
          {items.length ? (
            items.map((x, i) => (
              <button
                key={x.id}
                type="button"
                onMouseDown={(e) => (e.preventDefault(), pick(x.name))}
                className={`w-full flex items-center gap-2 text-left px-2 py-1 ${i === hi ? 'bg-indigo-600/40' : 'hover:bg-slate-800'}`}
              >
                {x.img ? <img src={x.img} className="w-7 h-7 rounded object-cover" /> : <span className="w-7 h-7 rounded bg-slate-800 text-[10px] flex items-center justify-center">?</span>}
                <span className="min-w-0">
                  <span className="block text-[11px] text-white truncate">{x.name}</span>
                  <span className="block text-[9px] text-slate-400 truncate">{x.sub}</span>
                </span>
              </button>
            ))
          ) : (
            <p className="text-[10px] text-slate-400 px-2 py-1.5">Chưa có {q.kind === '@@' ? 'sản phẩm' : 'nhân vật'} nào khớp — thêm trong ⚙️ Cài đặt.</p>
          )}
        </div>
      )}
    </div>
  );
};

/** Tích nhiều khóa tham chiếu; khóa nhân vật / sản phẩm thì chọn từ Cài đặt. */
const LocksField: React.FC<{ d: FlowNodeData; set: (p: Partial<FlowNodeData>) => void; lib: Lib }> = ({ d, set, lib }) => {
  const locks = locksOf(d);
  const toggle = (id: RefLock, on: boolean) => {
    const next = on ? [...locks, id] : locks.filter((x) => x !== id);
    set({ refRoles: next, refRole: undefined, ...(id === 'character' && !on ? { characterId: '' } : {}), ...(id === 'product' && !on ? { productId: '' } : {}) });
  };
  const ch = lib.characters.find((c) => c.id === d.characterId);
  const pr = lib.products.find((p) => p.id === d.productId);
  return (
    <div className="space-y-1.5">
      <span className="block text-[10px] uppercase tracking-wide text-slate-500">Khóa tham chiếu (tích được nhiều)</span>
      <div className="grid grid-cols-2 gap-1">
        {REF_LOCKS.map((l) => (
          <label key={l.id} className={`flex items-center gap-1.5 text-[11px] rounded-lg border px-2 py-1 cursor-pointer ${locks.includes(l.id) ? 'border-orange-400 bg-orange-500/10 text-white' : 'border-slate-700 text-slate-400'}`}>
            <input type="checkbox" checked={locks.includes(l.id)} onChange={(e) => toggle(l.id, e.target.checked)} />
            {l.icon} {l.label}
          </label>
        ))}
      </div>
      {locks.includes('character') && (
        <label className="block">
          <span className="block text-[10px] text-slate-500 mb-0.5">👤 Nhân vật trong Cài đặt</span>
          <select
            className={inputCls}
            value={d.characterId || ''}
            onChange={(e) => {
              const c = lib.characters.find((x) => x.id === e.target.value);
              set({ characterId: e.target.value, ...(c ? { characterName: c.name } : {}) });
            }}
          >
            <option value="">— Không chọn (dùng ảnh tải lên / AI tự tạo) —</option>
            {lib.characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.images.length ? '' : ' (chưa có ảnh)'}
              </option>
            ))}
          </select>
          {ch && (
            <span className="flex items-center gap-1.5 mt-1">
              {ch.images[0] && <img src={ch.images[0]} className="w-10 h-12 rounded object-cover" />}
              {ch.outfitImage && <img src={ch.outfitImage} title="Trang phục cố định" className="w-10 h-12 rounded object-cover border border-pink-500/50" />}
              <span className="text-[9px] text-slate-400 line-clamp-3">{ch.description}</span>
            </span>
          )}
        </label>
      )}
      {locks.includes('product') && (
        <label className="block">
          <span className="block text-[10px] text-slate-500 mb-0.5">📦 Sản phẩm trong Cài đặt</span>
          <select className={inputCls} value={d.productId || ''} onChange={(e) => set({ productId: e.target.value })}>
            <option value="">— Không chọn (dùng ảnh tải lên / AI tự tạo) —</option>
            {lib.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.images.length ? '' : ' (chưa có ảnh)'}
              </option>
            ))}
          </select>
          {pr && (
            <span className="flex items-center gap-1.5 mt-1">
              {pr.images[0] && <img src={pr.images[(Number(d.productImageIndex) || 0) % pr.images.length] || pr.images[0]} className="w-10 h-10 rounded object-cover" />}
              <span className="text-[9px] text-slate-400 line-clamp-3">{pr.visual || pr.description}</span>
            </span>
          )}
          {pr && pr.images.length > 1 && (
            <span className="flex items-center gap-1 mt-1 text-[10px] text-slate-500">
              Ảnh dùng (lookbook):
              {pr.images.map((img, k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => set({ productImageIndex: k })}
                  className={`w-7 h-7 rounded overflow-hidden border ${((Number(d.productImageIndex) || 0) % pr.images.length) === k ? 'border-indigo-400' : 'border-slate-700'}`}
                >
                  <img src={img} className="w-full h-full object-cover" />
                </button>
              ))}
            </span>
          )}
        </label>
      )}
    </div>
  );
};

const FieldInput: React.FC<{ f: FieldDef; d: FlowNodeData; set: (p: Partial<FlowNodeData>) => void; lib: Lib }> = ({ f, d, set, lib }) => {
  const v = d[f.key];
  const lab = <span className="block text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">{f.label}</span>;
  switch (f.type) {
    case 'locks':
      return <LocksField d={d} set={set} lib={lib} />;
    case 'productLink':
      return <ProductLinkField d={d} set={set} lib={lib} label={f.label} />;
    case 'mention':
      return (
        <div>
          {lab}
          <MentionTextarea value={String(v ?? '')} onChange={(t) => set({ [f.key]: t })} lib={lib} />
          {f.hint && <span className="text-[9px] text-slate-500">{f.hint}</span>}
        </div>
      );
    case 'textarea':
      return (
        <label className="block">
          {lab}
          <textarea rows={7} className={inputCls} value={String(v ?? '')} onChange={(e) => set({ [f.key]: e.target.value })} />
          {f.hint && <span className="text-[9px] text-slate-500">{f.hint}</span>}
        </label>
      );
    case 'number':
      return (
        <label className="block">
          {lab}
          <input
            type="number"
            min={f.min}
            max={f.max}
            className={inputCls}
            value={Number(v ?? f.min ?? 1)}
            onChange={(e) => set({ [f.key]: Math.max(f.min ?? 0, Math.min(f.max ?? 99, Number(e.target.value) || 0)) })}
          />
        </label>
      );
    case 'select':
      return (
        <label className="block">
          {lab}
          <select
            className={inputCls}
            value={String(v ?? f.options?.[0]?.[0] ?? '')}
            onChange={(e) => set({ [f.key]: f.key === 'duration' ? Number(e.target.value) : e.target.value })}
          >
            {f.options?.map(([val, text]) => (
              <option key={val} value={val}>
                {text}
              </option>
            ))}
          </select>
        </label>
      );
    case 'checkbox':
      return (
        <label className="flex items-center gap-2 text-[11px] text-slate-300">
          {/* Khóa ưu tiên ảnh / khóa bối cảnh: runtime coi "chưa đặt" là BẬT → ô tích hiện khớp với node cũ */}
          <input
            type="checkbox"
            checked={v === undefined && (f.key === 'imagePriority' || f.key === 'lockSetting') ? true : !!v}
            onChange={(e) => set({ [f.key]: e.target.checked })}
          />
          {f.label}
        </label>
      );
    case 'spots': {
      const spots = (v as string[] | undefined) ?? ['br'];
      return (
        <div>
          {lab}
          <div className="grid grid-cols-2 gap-1">
            {LOGO_SPOTS.map((s) => (
              <label key={s.id} className="flex items-center gap-1 text-[11px] text-slate-300">
                <input
                  type="checkbox"
                  checked={spots.includes(s.id)}
                  onChange={(e) => set({ spots: e.target.checked ? [...spots, s.id] : spots.filter((x) => x !== s.id) })}
                />
                {s.label}
              </label>
            ))}
          </div>
        </div>
      );
    }
    default:
      return (
        <label className="block">
          {lab}
          <input className={inputCls} value={String(v ?? '')} onChange={(e) => set({ [f.key]: e.target.value })} />
        </label>
      );
  }
};

/** Ảnh cận mặt (tùy chọn): ghép cạnh ảnh toàn thân → mặt to hơn trong ảnh tham chiếu, giữ mặt tốt hơn. */
const FaceImageField: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => {
  const ref = useRef<HTMLInputElement>(null);
  const take = async (file?: File) => {
    if (file?.type.startsWith('image/')) onChange(await fileToResizedDataUrl(file, 1024));
  };
  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        take(e.dataTransfer.files?.[0]);
      }}
      className="flex items-center gap-2 rounded-lg border border-dashed border-purple-400/40 p-1.5"
    >
      {value ? (
        <img src={value} className="w-12 h-12 rounded object-cover" />
      ) : (
        <span className="w-12 h-12 rounded bg-slate-800 flex items-center justify-center text-lg">🙂</span>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-slate-200">Ảnh cận mặt (tùy chọn, khuyên dùng)</p>
        <p className="text-[9px] text-slate-500">Tự ghép cạnh ảnh toàn thân thành 1 ảnh tham chiếu → mặt giống hơn, không tốn thêm suất ảnh.</p>
      </div>
      <button className="text-[10px] px-2 py-1 rounded bg-purple-700/70 text-white" onClick={() => ref.current?.click()}>
        Chọn
      </button>
      {value && (
        <button className="text-[10px] px-1.5 py-1 rounded bg-red-600/30 text-red-200" onClick={() => onChange('')}>
          ✕
        </button>
      )}
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => take(e.target.files?.[0])} />
    </div>
  );
};

/**
 * Thứ tự ghép của Merge Video = thứ tự cổng video-in-0, 1, 2… Bảng này cho đổi thứ tự (↑↓), thêm / bớt cổng,
 * và "Xếp theo vị trí": nối lại các dây theo vị trí node nguồn từ trên xuống (cùng hàng thì trái → phải).
 */
const MergeOrder: React.FC<{ node: FlowNode; wf: FlowWorkflow; onReorder: (edges: FlowEdge[]) => void }> = ({ node, wf, onReorder }) => {
  const count = Math.max(2, Number(node.data.portCount) || 2);
  const into = wf.edges.filter((e) => e.target === node.id);
  const slot = (i: number) => into.find((e) => e.targetHandle === `video-in-${i}`);
  const nameOf = (id: string) => {
    const n = wf.nodes.find((x) => x.id === id);
    return n ? String(n.data.batchLabel || NODE_DEFS[n.type].label) : id;
  };
  const others = wf.edges.filter((e) => e.target !== node.id);
  const apply = (ordered: (FlowEdge | undefined)[]) =>
    onReorder([...others, ...ordered.flatMap((e, i) => (e ? [{ ...e, targetHandle: `video-in-${i}` }] : []))]);
  const slots = Array.from({ length: count }, (_, i) => slot(i));
  const swap = (a: number, b: number) => {
    const s = [...slots];
    [s[a], s[b]] = [s[b], s[a]];
    apply(s);
  };
  const byPosition = () => {
    const sorted = [...into].sort((a, b) => {
      const pa = wf.nodes.find((n) => n.id === a.source)!.position;
      const pb = wf.nodes.find((n) => n.id === b.source)!.position;
      return pa.y - pb.y || pa.x - pb.x;
    });
    apply(Array.from({ length: count }, (_, i) => sorted[i]));
  };
  return (
    <div className="border border-amber-600/30 rounded-lg p-2 space-y-1">
      <p className="text-[10px] uppercase tracking-wide text-amber-300">Thứ tự ghép ({into.length}/{count} cổng có video)</p>
      {slots.map((e, i) => (
        <div key={i} className="flex items-center gap-1 text-[10px]">
          <span className="w-16 text-slate-500">video-in-{i}</span>
          <span className={`flex-1 truncate ${e ? 'text-slate-200' : 'text-slate-600 italic'}`}>{e ? `${i + 1}. ${nameOf(e.source)}` : '(trống)'}</span>
          <button disabled={i === 0} onClick={() => swap(i, i - 1)} className="px-1 rounded bg-slate-800 text-slate-200 disabled:opacity-30">
            ↑
          </button>
          <button disabled={i === count - 1} onClick={() => swap(i, i + 1)} className="px-1 rounded bg-slate-800 text-slate-200 disabled:opacity-30">
            ↓
          </button>
        </div>
      ))}
      <button onClick={byPosition} className="w-full text-[10px] px-2 py-1 rounded bg-amber-600/80 text-white">
        ⇅ Xếp theo vị trí node render (trên → dưới)
      </button>
    </div>
  );
};

const Inspector: React.FC<{
  node: FlowNode;
  wf: FlowWorkflow;
  lib: Lib;
  busy: boolean;
  set: (patch: Partial<FlowNodeData>) => void;
  onRunFrom: () => void;
  onRunOnly: () => void;
  onDelete: () => void;
  onReorder: (edges: FlowEdge[]) => void;
}> = ({ node, wf, lib, busy, set, onRunFrom, onRunOnly, onDelete, onReorder }) => {
  const def = NODE_DEFS[node.type];
  const d = node.data;
  const ports = nodePorts(node);
  const fileRef = useRef<HTMLInputElement>(null);
  const take = async (file?: File) => {
    if (file?.type.startsWith('image/')) set({ image: await fileToResizedDataUrl(file, 1536), fileName: file.name, autoGenerated: false });
  };
  const incoming = wf.edges.filter((e) => e.target === node.id);
  return (
    <div className="space-y-2.5">
      <div>
        <p className="text-sm font-bold text-white">
          {def.icon} {def.label}
        </p>
        <p className="text-[10px] text-slate-400 leading-snug mt-0.5">{def.role}</p>
        <p className="text-[10px] text-slate-500 mt-1">
          Cổng vào: {ports.inputs.join(', ') || '—'} · Cổng ra: {ports.outputs.join(', ') || '—'}
        </p>
      </div>
      <label className="block">
        <span className="block text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">Tên hiển thị</span>
        <input className={inputCls} value={String(d.batchLabel || '')} placeholder={def.label} onChange={(e) => set({ batchLabel: e.target.value })} />
      </label>
      {node.type === 'upload-image' && (
        <div className="space-y-1.5">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              take(e.dataTransfer.files?.[0]);
            }}
            onClick={() => fileRef.current?.click()}
            className="rounded-lg border border-dashed border-white/20 hover:border-orange-400 p-2 text-center cursor-pointer"
          >
            {d.image ? (
              <img src={String(d.image)} className="max-h-48 mx-auto rounded" />
            ) : (
              <p className="text-[11px] text-slate-400 py-4">🖼️ Bấm chọn hoặc kéo thả ảnh — để trống = AI tự tạo ảnh từ mô tả</p>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => take(e.target.files?.[0])} />
          </div>
          {d.image && (
            <button className="text-[10px] px-2 py-1 rounded bg-red-600/20 text-red-300 border border-red-600/40" onClick={() => set({ image: '', fileName: '', autoGenerated: false })}>
              ✕ Bỏ ảnh {d.autoGenerated ? '(AI tạo — bỏ để tạo lại)' : ''}
            </button>
          )}
          <p className="text-[9px] text-slate-500">
            Ảnh tải lên dùng cho các khóa chưa chọn từ Cài đặt (vd. 1 ảnh vừa khóa trang phục vừa khóa bối cảnh).
          </p>
          {locksOf(d).includes('character') && !d.characterId && !d.sheetCrop && (
            <FaceImageField value={String(d.faceImage || '')} onChange={(faceImage) => set({ faceImage })} />
          )}
        </div>
      )}
      {def.fields.filter((f) => !f.when || f.when(d)).map((f) => (
        <FieldInput key={f.key} f={f} d={d} set={set} lib={lib} />
      ))}
      {node.type === 'merge-video' && <MergeOrder node={node} wf={wf} onReorder={onReorder} />}
      {['generate-image', 'generate-video'].includes(node.type) && (
        <p className="text-[10px] text-slate-500">
          Đầu vào hiện có: {incoming.length} dây. Ảnh Upload Image phía trước được gửi kèm làm tham chiếu (tối đa 3, thứ tự Nhân vật → Trang phục → Sản phẩm).
        </p>
      )}
      {node.type === 'upload-image' && d.sheetPrompt && (
        <details className="text-[10px] text-slate-400">
          <summary className="cursor-pointer">Prompt tự tạo ảnh (từ mẫu MV1)</summary>
          <p className="whitespace-pre-wrap mt-1">{String(d.sheetPrompt)}</p>
        </details>
      )}
      {node.type === 'generate-video' && d.keyframe && (
        <div className="border-t border-white/10 pt-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">🖼 Ảnh khung hình mở đầu đã tạo</p>
          <img src={String(d.keyframe)} className="w-24 rounded border border-white/10" />
        </div>
      )}
      {(d.results?.length || d.error) && (
        <div className="border-t border-white/10 pt-2 space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">
            Kết quả {d.startedAt && d.finishedAt ? `· ${Math.round((Number(d.finishedAt) - Number(d.startedAt)) / 1000)}s` : ''}
          </p>
          {d.error && <p className="text-[11px] text-red-300 break-words">{String(d.error)}</p>}
          <ResultThumbs results={d.results} big />
          {d.results?.filter((r) => r.path).map((r, i) => (
            <p key={i} className="text-[10px] text-emerald-300 break-all">
              💾 {r.path}
            </p>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 border-t border-white/10 pt-2">
        <button disabled={busy} onClick={onRunOnly} className="text-[11px] px-2 py-1 rounded bg-slate-700 text-white disabled:opacity-40">
          ▶ Chạy riêng node này
        </button>
        <button disabled={busy} onClick={onRunFrom} className="text-[11px] px-2 py-1 rounded bg-indigo-600 text-white disabled:opacity-40">
          ♻️ Chạy lại từ node này
        </button>
        <button disabled={busy} onClick={onDelete} className="text-[11px] px-2 py-1 rounded bg-red-600/80 text-white disabled:opacity-40 ml-auto">
          🗑 Xóa node
        </button>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ Mẫu MV1 */
const TemplateGallery: React.FC<{ onUse: (t: HndFlowTemplate) => void; onClose: () => void }> = ({ onUse, onClose }) => {
  const [list, setList] = useState<HndFlowTemplate[] | null>(null);
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    loadHndFlowTemplates().then(setList).catch((e) => setErr(String(e?.message || e)));
  }, []);
  const cats = useMemo(() => [...new Map((list || []).map((t) => [t.category, t.categoryLabel])).entries()], [list]);
  const shown = (list || []).filter((t) => (cat === 'all' || t.category === cat) && (!q || `${t.title} ${t.description}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-5xl max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-800 flex items-center gap-2">
          <h3 className="text-sm font-bold text-white flex-1">📚 Mẫu Workflow (FastAIVN + MV1 Muse AI) — {list?.length ?? '…'} mẫu</h3>
          <input className={`${inputCls} w-56`} placeholder="Tìm mẫu…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button onClick={onClose} className="text-slate-400 hover:text-white px-2">
            ✕
          </button>
        </div>
        <div className="px-4 pt-3 flex flex-wrap gap-1.5">
          {[['all', 'Tất cả'] as [string, string], ...cats].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setCat(id)}
              className={`text-[11px] px-2.5 py-1 rounded-lg border ${cat === id ? 'bg-emerald-600 border-emerald-500 text-white' : 'border-slate-700 text-slate-300'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="p-4 overflow-y-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {err && <p className="text-red-300 text-xs">{err}</p>}
          {!list && !err && <p className="text-slate-400 text-xs">Đang tải mẫu…</p>}
          {shown.map((t) => {
            const types = t.graph.nodes.reduce<Record<string, number>>((m, n) => ({ ...m, [n.type]: (m[n.type] || 0) + 1 }), {});
            const ups = t.graph.nodes.filter((n) => n.type === 'upload-image').map((n) => String(n.data.batchLabel || '').replace(/\(.*?\)/g, '').trim());
            return (
              <div key={t.id} className="rounded-xl border border-slate-800 bg-slate-950 p-3 flex flex-col">
                <p className="text-[10px] text-emerald-300 uppercase">{t.categoryLabel}</p>
                <p className="text-xs font-bold text-white">{t.title}</p>
                <p className="text-[10px] text-slate-400 mt-1 line-clamp-3 flex-1">{t.description}</p>
                <p className="text-[10px] text-slate-500 mt-1.5">
                  {t.graph.nodes.length} node · {types['generate-video'] || 0} cảnh video · {Object.entries(types).map(([k, v]) => `${NODE_DEFS[k as NodeType]?.icon || ''}${v}`).join(' ')}
                </p>
                <p className="text-[10px] text-slate-500">Khóa: {ups.join(' · ') || '—'}</p>
                <div className="flex gap-1.5 mt-2">
                  <button onClick={() => onUse(t)} className="text-[11px] px-2.5 py-1 rounded-lg bg-indigo-600 text-white font-semibold">
                    Dùng mẫu
                  </button>
                  {t.videoUrl && (
                    <a href={t.videoUrl} target="_blank" rel="noreferrer" className="text-[11px] px-2 py-1 rounded-lg border border-slate-700 text-sky-300">
                      Video trend
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ Editor */
export interface NodeFlowProps {
  threads: number;
  characters: StudioCharacter[];
  products: StudioProduct[];
  /** Mở 1 workflow từ nơi khác (vd. "Mẫu & danh sách dòng" → Mở trong sơ đồ khối); đổi key để mở lại */
  incoming?: { key: number; workflow?: FlowWorkflow; workflows?: FlowWorkflow[]; note?: string };
  /** Màn đang hiển thị? Ẩn thì không vẽ canvas (vẫn giữ lượt chạy), hiện lại thì vẽ + đo node lại */
  active?: boolean;
  /** Báo danh sách sơ đồ đã lưu ra ngoài (Xuất bộ workflow) */
  onLibraryChange?: (workflows: FlowWorkflow[]) => void;
  /** Lưu / cập nhật sản phẩm vào thư viện Cài đặt (node Prompt lấy thông tin từ link Shopee) */
  onSaveProduct?: (p: StudioProduct) => void;
}

const Editor: React.FC<NodeFlowProps> = ({ threads, characters, products, incoming, active, onLibraryChange, onSaveProduct }) => {
  const libItems = useMemo(() => ({ characters, products, saveProduct: onSaveProduct }), [characters, products, onSaveProduct]);
  const [lib, setLib] = usePersistentState<FlowLibrary>('nodeflow.library.v1', { workflows: [], activeId: '' }, { server: true });
  useEffect(() => {
    onLibraryChange?.(lib.workflows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib.workflows]);
  const [wf, setWf] = useState<FlowWorkflow | null>(null);
  const wfRef = useRef(wf);
  wfRef.current = wf;
  const [selectedId, setSelectedId] = useState('');
  const [selEdge, setSelEdge] = useState('');
  const [busy, setBusy] = useState(false);
  const stopRef = useRef(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [report, setReport] = useState<{ errors: string[]; warnings: string[]; ok?: string } | null>(null);
  const [gallery, setGallery] = useState(false);
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const { screenToFlowPosition, fitView } = useReactFlow();
  const importRef = useRef<HTMLInputElement>(null);

  // Nạp workflow đang chọn vào bản làm việc
  useEffect(() => {
    if (busy) return;
    const cur = lib.workflows.find((w) => w.id === lib.activeId) || lib.workflows[0] || null;
    if (cur && cur.id !== wfRef.current?.id) {
      setWf(cur);
      setSelectedId('');
      window.setTimeout(() => fitView({ padding: 0.15 }), 60);
    }
    if (!cur) setWf(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib.activeId, lib.workflows.length]);

  // Ghi bản làm việc vào thư viện (trễ 600ms để không ghi liên tục khi kéo node)
  useEffect(() => {
    if (!wf) return;
    const t = window.setTimeout(() => {
      setLib((L) => ({ ...L, workflows: L.workflows.map((w) => (w.id === wf.id ? { ...wf, updatedAt: Date.now() } : w)) }));
    }, 600);
    return () => window.clearTimeout(t);
  }, [wf, setLib]);

  const addWorkflow = (w: FlowWorkflow) => {
    setLib((L) => ({ workflows: [...L.workflows, w], activeId: w.id }));
    setWf(w);
    setSelectedId('');
    setLogs([]);
    window.setTimeout(() => fitView({ padding: 0.15 }), 80);
  };

  // Mẫu mở từ "Mẫu & danh sách dòng"
  const lastIncoming = useRef(0);
  useEffect(() => {
    if (!incoming || incoming.key === lastIncoming.current) return;
    // Nhập bộ workflow: thêm cả loạt sơ đồ vào thư viện (không mở / không đổi sơ đồ đang chạy)
    if (incoming.workflows?.length) {
      lastIncoming.current = incoming.key;
      const add = incoming.workflows;
      setLib((L) => ({ ...L, workflows: [...L.workflows, ...add], activeId: L.activeId || add[0].id }));
      setReport({ errors: [], warnings: [], ok: incoming.note || `Đã nhập ${add.length} sơ đồ vào Sơ đồ khối.` });
      return;
    }
    if (busy || !incoming.workflow) return;
    lastIncoming.current = incoming.key;
    addWorkflow(incoming.workflow);
    setReport({ errors: [], warnings: [], ok: incoming.note || `Đã mở "${incoming.workflow.name}" trong sơ đồ khối — bấm vào từng node để chỉnh.` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming?.key]);

  const update = useCallback((fn: (w: FlowWorkflow) => FlowWorkflow) => setWf((w) => (w ? fn(w) : w)), []);
  const patchNode = useCallback(
    (id: string, patch: Partial<FlowNodeData>) =>
      update((w) => {
        const nodes = w.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));
        // Bớt cổng (số đoạn Gemini / số cổng Merge / đổi chế độ) thì gỡ dây ở cổng không còn
        const target = nodes.find((n) => n.id === id)!;
        const p = nodePorts(target);
        const edges = w.edges.filter(
          (e) => (e.source !== id || p.outputs.includes(String(e.sourceHandle))) && (e.target !== id || p.inputs.includes(String(e.targetHandle)))
        );
        return { ...w, nodes, edges };
      }),
    [update]
  );

  // React Flow (controlled) cần nhận lại kích thước đo được của node, thiếu thì không vẽ dây
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  const rfNodes: RFNode[] = useMemo(
    () =>
      (wf?.nodes || []).map((n) => ({
        id: n.id,
        type: 'flow' as const,
        position: n.position,
        data: { node: n },
        selected: n.id === selectedId,
        ...(measured[n.id] ? { measured: measured[n.id] } : {}),
      })),
    [wf?.nodes, selectedId, measured]
  );
  const rfEdges: Edge[] = useMemo(
    () =>
      (wf?.edges || []).map((e) => {
        const k = portKind(e.sourceHandle) || 'text';
        const src = wf!.nodes.find((n) => n.id === e.source);
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? undefined,
          targetHandle: e.targetHandle ?? undefined,
          animated: src?.data.runStatus === 'running' || (busy && k === 'video'),
          selected: e.id === selEdge,
          style: { stroke: PORT_COLOR[k as 'text'], strokeWidth: e.id === selEdge ? 3 : 1.6, strokeDasharray: k === 'image' ? '5 4' : undefined },
        };
      }),
    [wf?.edges, wf?.nodes, selEdge, busy]
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<RFNode>[]) => {
      const dims = changes.filter((c) => c.type === 'dimensions' && c.dimensions);
      if (dims.length) {
        setMeasured((m) => {
          const next = { ...m };
          // Bỏ qua kích thước 0 (canvas đang bị ẩn) để React Flow đo lại khi hiện ra
          dims.forEach(
            (c) =>
              c.type === 'dimensions' &&
              c.dimensions?.width &&
              c.dimensions.height &&
              (next[c.id] = { width: c.dimensions.width, height: c.dimensions.height })
          );
          return next;
        });
      }
      changes.forEach((c) => {
        if (c.type === 'position' && c.position) {
          const pos = c.position;
          update((w) => ({ ...w, nodes: w.nodes.map((n) => (n.id === c.id ? { ...n, position: pos } : n)) }));
        } else if (c.type === 'select' && c.selected) {
          setSelectedId(c.id);
          setSelEdge('');
        } else if (c.type === 'remove' && !busy) {
          update((w) => ({ ...w, nodes: w.nodes.filter((n) => n.id !== c.id), edges: w.edges.filter((e) => e.source !== c.id && e.target !== c.id) }));
          setSelectedId('');
        }
      });
    },
    [update, busy]
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      changes.forEach((c) => {
        if (c.type === 'select' && c.selected) {
          setSelEdge(c.id);
          setSelectedId('');
        } else if (c.type === 'remove' && !busy) update((w) => ({ ...w, edges: w.edges.filter((e) => e.id !== c.id) }));
      });
    },
    [update, busy]
  );
  const isValidConnection = useCallback(
    (c: Connection | Edge) => !!wfRef.current && !connectionError(wfRef.current, { source: c.source, sourceHandle: c.sourceHandle, target: c.target, targetHandle: c.targetHandle }),
    []
  );
  const onConnect = useCallback(
    (c: Connection) => {
      const w = wfRef.current;
      if (!w) return;
      const err = connectionError(w, c);
      if (err) return setReport({ errors: [err], warnings: [] });
      update((x) => ({ ...x, edges: [...x.edges, { id: newId('edge'), source: c.source, sourceHandle: c.sourceHandle, target: c.target, targetHandle: c.targetHandle }] }));
    },
    [update]
  );

  const addNode = (type: NodeType) => {
    if (!wf) addWorkflow(emptyWorkflow());
    const pos = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2.2 });
    const n = makeNode(type, pos.x + Math.random() * 40, pos.y + Math.random() * 40);
    update((w) => ({ ...w, nodes: [...w.nodes, n] }));
    setSelectedId(n.id);
  };

  const run = async (mode: RunMode) => {
    const w = wfRef.current;
    if (!w || busy) return;
    const v = validateWorkflow(w);
    setReport({ errors: v.errors, warnings: v.warnings });
    if (!v.ok) return;
    setBusy(true);
    stopRef.current = false;
    const t0 = new Date().toLocaleTimeString();
    setLogs((l) => [...l.slice(-300), `—— ${t0} · ${mode.kind === 'all' ? 'Chạy toàn bộ' : mode.kind === 'resume' ? 'Chạy tiếp' : mode.kind === 'from' ? 'Chạy lại từ node' : 'Chạy riêng node'} · ${threadsRef.current} luồng ——`]);
    try {
      const r = await runFlow(w, mode, {
        threads: () => threadsRef.current,
        shouldStop: () => stopRef.current,
        patchNode,
        log: (m) => setLogs((l) => [...l.slice(-300), `${new Date().toLocaleTimeString()} ${m}`]),
        project: projectOf(w),
        characters,
        products,
      });
      setReport({ errors: [], warnings: [], ok: r.errors ? `Xong, ${r.errors} node lỗi / bị chặn — sửa rồi bấm ⏩ Chạy tiếp.` : `✅ Hoàn thành — ${r.outputs.length} kết quả trong thư mục "${projectOf(w)}".` });
    } catch (err: any) {
      setReport({ errors: [String(err?.message || err)], warnings: [] });
    } finally {
      setBusy(false);
    }
  };

  const doImport = async (file?: File) => {
    if (!file) return;
    try {
      const { workflow, notes } = parseFlowJson(JSON.parse(await file.text()), file.name.replace(/\.json$/i, ''));
      addWorkflow(workflow);
      setReport({ errors: [], warnings: notes, ok: `Đã nhập "${workflow.name}" (${workflow.nodes.length} node, ${workflow.edges.length} dây).` });
    } catch (err: any) {
      setReport({ errors: [`Không nhập được: ${err?.message || err}`], warnings: [] });
    }
  };
  /** 📤 Gói mẫu cho trang Quản trị mẫu fastaivn.com: sơ đồ + thông tin + thumbnail cắt từ video kết quả */
  const doExportForWeb = async () => {
    if (!wf) return;
    const keepImages = window.confirm(
      'Giữ ảnh tham chiếu (ảnh tải lên ở các khối Upload Image) trong mẫu?\n\nOK = giữ (mẫu có sẵn ảnh mặc định, file nặng hơn)\nHủy = bỏ ảnh (người dùng tự chọn ảnh — khuyên dùng)'
    );
    // Video kết quả: Result → Merge → video cảnh bất kỳ
    const vids = [
      ...wf.nodes.filter((n) => n.type === 'result'),
      ...wf.nodes.filter((n) => n.type === 'merge-video'),
      ...wf.nodes.filter((n) => n.type === 'generate-video'),
    ].flatMap((n) => (n.data.results || []).filter((r) => r.kind === 'video'));
    let thumbnailDataUrl: string | undefined;
    if (vids[0]) {
      try {
        const frame = await cutFrame(vids[0].value, 3);
        thumbnailDataUrl = await urlToResizedDataUrl(frame.url.startsWith('/') ? `${GATEWAY_URL}${frame.url}` : frame.url, 640);
      } catch {
        /* không cắt được thumbnail: quản trị viên tự tải ảnh lên */
      }
    }
    const pack = buildTemplatePackage(wf, { appVersion: APP_VERSION, keepImages, thumbnailDataUrl, previewVideoPath: vids[0]?.path });
    const blob = new Blob([JSON.stringify(pack, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${pack.entry.id}.fastaivn-template.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setReport({
      errors: [],
      warnings: vids[0] ? [] : ['Workflow chưa có video kết quả → gói chưa có thumbnail. Chạy thử 1 lần rồi xuất lại, hoặc tải ảnh lên ở trang quản trị.'],
      ok: `Đã xuất "${pack.entry.id}.fastaivn-template.json"${thumbnailDataUrl ? ' (kèm thumbnail)' : ''}. Tải file này lên fastaivn.com → Quản trị mẫu → "Nhập gói từ MuseStudio"${
        vids[0]?.path ? `; video xem trước: ${vids[0].path}` : ''
      }.`,
    });
  };

  const doExport = () => {
    if (!wf) return;
    const blob = new Blob([exportFlowJson(wf)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${wf.name.replace(/[\\/:*?"<>|]+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const selected = wf?.nodes.find((n) => n.id === selectedId);
  const counts = (wf?.nodes || []).reduce<Record<string, number>>((m, n) => ({ ...m, [n.data.runStatus || 'idle']: (m[n.data.runStatus || 'idle'] || 0) + 1 }), {});
  const btn = 'text-[11px] px-2.5 py-1.5 rounded-lg font-semibold disabled:opacity-40';

  return (
    <NodeCtx.Provider value={{ wf, patchNode, busy }}>
      <div className="space-y-2">
        {/* Thanh công cụ */}
        <div className="flex flex-wrap items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-xl p-2">
          <select
            disabled={busy}
            className="bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-lg p-1.5 max-w-[320px]"
            value={wf?.id || ''}
            onChange={(e) => setLib((L) => ({ ...L, activeId: e.target.value }))}
          >
            {!lib.workflows.length && <option value="">(chưa có workflow)</option>}
            {lib.workflows.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <button disabled={busy} className={`${btn} bg-emerald-700 text-white`} onClick={() => setGallery(true)}>
            📚 Mẫu Workflow
          </button>
          <button disabled={busy} className={`${btn} bg-slate-700 text-white`} onClick={() => addWorkflow(emptyWorkflow(`Workflow ${lib.workflows.length + 1}`))}>
            ＋ Mới
          </button>
          <button
            disabled={busy || !wf}
            className={`${btn} bg-slate-700 text-white`}
            onClick={() => {
              const name = window.prompt('Tên workflow', wf?.name || '');
              if (name) update((w) => ({ ...w, name }));
            }}
          >
            ✏️ Đổi tên
          </button>
          <button
            disabled={busy || !wf}
            className={`${btn} bg-slate-700 text-white`}
            onClick={() => wf && addWorkflow({ ...JSON.parse(JSON.stringify(wf)), id: newId('wf'), name: `${wf.name} (bản sao)` })}
          >
            ⧉ Nhân bản
          </button>
          <button disabled={busy} className={`${btn} bg-slate-700 text-white`} onClick={() => importRef.current?.click()}>
            ⬆ Nhập JSON (MV1)
          </button>
          <input ref={importRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => (doImport(e.target.files?.[0]), (e.target.value = ''))} />
          <button disabled={!wf} className={`${btn} bg-slate-700 text-white`} onClick={doExport}>
            ⬇ Xuất JSON
          </button>
          <button
            disabled={busy || !wf}
            className={`${btn} bg-sky-700 text-white`}
            onClick={doExportForWeb}
            title="Đóng gói mẫu (sơ đồ + thông tin + thumbnail) để tải lên trang Quản trị mẫu của fastaivn.com"
          >
            📤 Xuất mẫu cho fastaivn.com
          </button>
          <button
            disabled={busy || !wf}
            className={`${btn} bg-red-900/70 text-red-100`}
            onClick={() => {
              if (!wf || !window.confirm(`Xóa workflow "${wf.name}"?`)) return;
              setLib((L) => {
                const rest = L.workflows.filter((w) => w.id !== wf.id);
                return { workflows: rest, activeId: rest[0]?.id || '' };
              });
              setWf(null);
            }}
          >
            🗑
          </button>
          <span className="flex-1" />
          <button disabled={!wf} className={`${btn} bg-slate-700 text-white`} onClick={() => wf && setReport({ ...validateWorkflow(wf), ok: validateWorkflow(wf).ok ? '✓ Sơ đồ hợp lệ' : undefined })}>
            ✓ Kiểm tra
          </button>
          <button disabled={busy || !wf} className={`${btn} bg-indigo-600 text-white`} onClick={() => run({ kind: 'all' })}>
            ▶ Chạy toàn bộ
          </button>
          <button disabled={busy || !wf} className={`${btn} bg-sky-700 text-white`} onClick={() => run({ kind: 'resume' })} title="Chỉ chạy node chưa xong / lỗi">
            ⏩ Chạy tiếp
          </button>
          <button disabled={!busy} className={`${btn} bg-red-600 text-white`} onClick={() => (stopRef.current = true)}>
            ⏹ Dừng
          </button>
          <button disabled={!wf} className={`${btn} bg-slate-700 text-white`} onClick={() => wf && openProjectFolder(projectOf(wf)).catch(() => undefined)}>
            📂
          </button>
        </div>
        {report && (report.errors.length || report.warnings.length || report.ok) && (
          <div className="text-[11px] bg-slate-900 border border-slate-800 rounded-xl p-2 space-y-0.5">
            {report.ok && <p className="text-emerald-300">{report.ok}</p>}
            {report.errors.map((e, i) => (
              <p key={`e${i}`} className="text-red-300">
                ✗ {e}
              </p>
            ))}
            {report.warnings.slice(0, 8).map((e, i) => (
              <p key={`w${i}`} className="text-amber-300">
                ⚠ {e}
              </p>
            ))}
          </div>
        )}
        <div className="grid grid-cols-[190px_1fr_330px] gap-2 h-[calc(100vh-230px)] min-h-[560px]">
          {/* Bảng thêm node */}
          <aside className="bg-slate-900 border border-slate-800 rounded-xl p-2 overflow-y-auto">
            <p className="text-[11px] font-bold text-white mb-1">＋ Thêm node</p>
            {NODE_GROUPS.map((g) => (
              <div key={g} className="mb-2">
                <p className="text-[9px] uppercase tracking-wide text-slate-500 mb-1">{g}</p>
                {(Object.keys(NODE_DEFS) as NodeType[])
                  .filter((t) => NODE_DEFS[t].group === g)
                  .map((t) => (
                    <button
                      key={t}
                      disabled={busy}
                      title={NODE_DEFS[t].role}
                      onClick={() => addNode(t)}
                      className="w-full text-left text-[11px] text-slate-200 px-2 py-1.5 mb-1 rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-500 disabled:opacity-40"
                    >
                      <span className="mr-1">{NODE_DEFS[t].icon}</span>
                      {NODE_DEFS[t].label}
                    </button>
                  ))}
              </div>
            ))}
            <div className="text-[9px] text-slate-500 space-y-0.5 border-t border-slate-800 pt-1.5">
              <p>
                <span style={{ color: PORT_COLOR.text }}>●</span> text <span style={{ color: PORT_COLOR.image }}>●</span> image{' '}
                <span style={{ color: PORT_COLOR.video }}>●</span> video
              </p>
              <p>Kéo từ chấm bên phải sang chấm cùng màu bên trái để nối. Chọn dây / node + Delete để xóa.</p>
            </div>
          </aside>

          {/* Canvas */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden relative">
            {wf && active === false ? null : wf ? (
              <ReactFlow
                key={wf.id}
                nodes={rfNodes}
                edges={rfEdges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                isValidConnection={isValidConnection}
                onPaneClick={() => {
                  setSelectedId('');
                  setSelEdge('');
                }}
                deleteKeyCode={busy ? null : ['Delete', 'Backspace']}
                minZoom={0.15}
                fitView
                colorMode="dark"
              >
                <Background gap={22} color="#1e293b" />
                <Controls />
                <MiniMap
                  pannable
                  zoomable
                  bgColor="#0f172a"
                  maskColor="rgba(2,6,23,0.6)"
                  nodeColor={(n) => NODE_DEFS[(n.data as any).node.type as NodeType]?.color || '#334155'}
                />
              </ReactFlow>
            ) : (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-400 text-sm">
                <p>Chưa có workflow nào.</p>
                <div className="flex gap-2">
                  <button className={`${btn} bg-emerald-700 text-white`} onClick={() => setGallery(true)}>
                    📚 Chọn từ 13 mẫu Workflow MV1
                  </button>
                  <button className={`${btn} bg-slate-700 text-white`} onClick={() => addWorkflow(emptyWorkflow())}>
                    ＋ Sơ đồ trống
                  </button>
                </div>
              </div>
            )}
            {wf && (
              <div className="absolute top-2 left-2 text-[10px] text-slate-400 bg-slate-900/90 rounded-lg px-2 py-1 pointer-events-none">
                {wf.nodes.length} node · {wf.edges.length} dây · {threads} luồng ·{' '}
                {Object.entries(counts)
                  .map(([k, v]) => `${STATUS_TEXT[k as RunStatus]} ${v}`)
                  .join(' · ')}
              </div>
            )}
          </div>

          {/* Inspector + nhật ký */}
          <aside className="bg-slate-900 border border-slate-800 rounded-xl p-2.5 overflow-y-auto flex flex-col gap-2">
            {selected && wf ? (
              <Inspector
                node={selected}
                wf={wf}
                lib={libItems}
                busy={busy}
                onReorder={(edges) => update((w) => ({ ...w, edges }))}
                set={(p) => patchNode(selected.id, p)}
                onRunFrom={() => run({ kind: 'from', nodeId: selected.id })}
                onRunOnly={() => run({ kind: 'only', nodeId: selected.id })}
                onDelete={() => {
                  update((w) => ({ ...w, nodes: w.nodes.filter((n) => n.id !== selected.id), edges: w.edges.filter((e) => e.source !== selected.id && e.target !== selected.id) }));
                  setSelectedId('');
                }}
              />
            ) : wf ? (
              <div className="space-y-1.5">
                <p className="text-xs font-bold text-white">{wf.name}</p>
                {wf.category && <p className="text-[10px] text-emerald-300">{wf.category}</p>}
                <textarea className={inputCls} rows={4} placeholder="Mô tả workflow" value={wf.description} onChange={(e) => update((w) => ({ ...w, description: e.target.value }))} />
                {wf.videoUrl && (
                  <a className="text-[11px] text-sky-300" href={wf.videoUrl} target="_blank" rel="noreferrer">
                    ▶ Video trend tham khảo
                  </a>
                )}
                <p className="text-[10px] text-slate-500">Bấm vào 1 node để cấu hình. File xuất vào thư mục “{projectOf(wf)}”.</p>
              </div>
            ) : null}
            <div className="mt-auto border-t border-slate-800 pt-1.5">
              <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Nhật ký chạy</p>
              <div className="text-[10px] text-slate-400 font-mono max-h-48 overflow-y-auto space-y-0.5">
                {logs.length ? logs.slice(-80).map((l, i) => <p key={i}>{l}</p>) : <p>—</p>}
              </div>
            </div>
          </aside>
        </div>
        {gallery && (
          <TemplateGallery
            onClose={() => setGallery(false)}
            onUse={(t) => {
              const { workflow, notes } = parseFlowJson(t);
              addWorkflow(workflow);
              setGallery(false);
              setReport({
                errors: [],
                warnings: notes,
                ok: `Đã dùng mẫu "${t.title}". Chọn ảnh cho các node Upload Image (hoặc để trống cho AI tự tạo), sửa prompt rồi bấm ▶ Chạy toàn bộ.`,
              });
            }}
          />
        )}
      </div>
    </NodeCtx.Provider>
  );
};

export const NodeFlowStudio: React.FC<NodeFlowProps> = (props) => (
  <ReactFlowProvider>
    <Editor {...props} />
  </ReactFlowProvider>
);
