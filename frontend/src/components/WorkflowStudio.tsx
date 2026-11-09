import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePersistentState } from '../hooks/usePersistentState';
import { MuseAccountsState } from '../hooks/useMuseAccounts';
import { StudioLibraryState } from '../hooks/useStudioLibrary';
import { BUILTIN_WORKFLOWS } from '../data/workflowTemplates';
import { SCRIPT_TEMPLATES, TEMPLATE_GROUPS } from '../data/scriptTemplates';
import { SCRIPT_MODES, describeScriptSource } from '../services/productService';
import { openProjectFolder } from '../services/museBatchService';
import {
  RunnerDeps,
  firstOpenStep,
  resetFrom,
  rowProduct,
  runWorkflowRow,
  workflowCast,
} from '../services/workflowRunner';
import {
  StepStatus,
  WORKFLOW_STEPS,
  WorkflowRow,
  WorkflowStepId,
  WorkflowTemplate,
  freshSteps,
  normalizeRow,
} from '../types/workflow';
import { StudioCharacter, StudioProduct, newLibraryId } from '../types/library';
import { aspectClass } from '../utils/image';
import { WorkflowGraphEditor } from './WorkflowGraphEditor';

const inputCls =
  'w-full bg-slate-950 border border-white/5 text-[11px] text-slate-200 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-indigo-500';
const labelCls = 'block text-[10px] uppercase tracking-wide text-slate-500 mb-1';

const CAMERA_OPTIONS = [
  { value: '', label: 'Không ép góc máy' },
  { value: 'Medium Close-up, Static Tripod Shot', label: 'Trung cận cố định' },
  { value: 'Close-up Shot, Slow Dolly In', label: 'Cận cảnh đẩy nhẹ vào' },
  { value: 'Medium Shot, Gentle Handheld Movement', label: 'Trung cảnh cầm tay tự nhiên' },
];

const STEP_STYLE: Record<StepStatus, string> = {
  pending: 'bg-slate-800 text-slate-400 border-slate-700',
  running: 'bg-indigo-600/30 text-indigo-200 border-indigo-500 animate-pulse',
  done: 'bg-emerald-600/20 text-emerald-300 border-emerald-600/60',
  skipped: 'bg-slate-800 text-slate-500 border-slate-700 line-through',
  failed: 'bg-red-600/20 text-red-300 border-red-600/60',
  review: 'bg-amber-500/20 text-amber-200 border-amber-500/60',
};

/** Vị trí watermark hay gặp (tỉ lệ theo khung) */
const WATERMARK_SPOTS = [
  { id: 'tl', label: 'Trên trái', region: { x: 0.02, y: 0.02, w: 0.34, h: 0.08 } },
  { id: 'tr', label: 'Trên phải', region: { x: 0.64, y: 0.02, w: 0.34, h: 0.08 } },
  { id: 'bl', label: 'Dưới trái', region: { x: 0.02, y: 0.9, w: 0.34, h: 0.08 } },
  { id: 'br', label: 'Dưới phải', region: { x: 0.64, y: 0.9, w: 0.34, h: 0.08 } },
];
const sameRegion = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

const INTERRUPTED ='Bị gián đoạn do tải lại trang — bấm Chạy tiếp.';

/** Tách 1 dòng dán vào: "link hoặc tên SP | tên nhân vật | ghi chú" (phân cách bằng Tab, | hoặc ;). */
const splitLine = (line: string) => {
  const sep = line.includes('\t') ? '\t' : line.includes('|') ? '|' : ';';
  return line.split(sep).map((s) => s.trim());
};

export const WorkflowStudio: React.FC<{
  accountsState: MuseAccountsState;
  library: StudioLibraryState;
  onOpenSettings: () => void;
}> = ({ accountsState, library, onOpenSettings }) => {
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const threadsRef = useRef(accountsState.totalThreads);
  threadsRef.current = accountsState.totalThreads;

  const [customs, setCustoms] = usePersistentState<WorkflowTemplate[]>('workflow.custom.v1', [], { server: true });
  const [selectedId, setSelectedId] = usePersistentState('workflow.selected.v1', BUILTIN_WORKFLOWS[0].id);
  const [reviewScript, setReviewScript] = usePersistentState('workflow.review.v1', false);
  const [rows, setRows] = usePersistentState<WorkflowRow[]>('workflow.rows.v1', [], {
    server: true,
    // dòng lưu từ bản cũ chưa có bước Hậu kỳ
    merge: (stored) => (Array.isArray(stored) ? stored.map(normalizeRow) : []),
  });
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const allTemplates = useMemo(() => [...BUILTIN_WORKFLOWS, ...customs], [customs]);
  const selected = allTemplates.find((t) => t.id === selectedId) ?? BUILTIN_WORKFLOWS[0];
  const [draft, setDraft] = useState<WorkflowTemplate>(selected);
  useEffect(() => setDraft(selected), [selected]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(selected);

  const [view, setView] = usePersistentState<'list' | 'graph'>('workflow.view.v1', 'list');
  /** Áp dụng sơ đồ: lưu thành workflow riêng (mới hoặc ghi đè workflow riêng đang chọn) */
  const applyGraph = (tpl: WorkflowTemplate) => {
    setCustoms((prev) => (prev.some((t) => t.id === tpl.id) ? prev.map((t) => (t.id === tpl.id ? tpl : t)) : [...prev, tpl]));
    setSelectedId(tpl.id);
    setDraft(tpl);
  };
  const [busy, setBusy] = useState(false);
  const [runningRowId, setRunningRowId] = useState<string | null>(null);
  const stopRef = useRef(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Ô thêm dòng
  const [newProductId, setNewProductId] = useState('');
  const [newLink, setNewLink] = useState('');
  const [newCharId, setNewCharId] = useState('');
  const [newNote, setNewNote] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');

  // Tải lại trang giữa chừng: bước đang chạy thành lỗi, cảnh đang render giữ task id để chờ tiếp
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    setRows((prev) =>
      prev.map((r) => {
        const running = WORKFLOW_STEPS.some((s) => r.steps[s.id].status === 'running');
        if (!running) return r;
        const steps = { ...r.steps };
        WORKFLOW_STEPS.forEach((s) => {
          if (steps[s.id].status === 'running') steps[s.id] = { ...steps[s.id], status: 'failed', error: INTERRUPTED };
        });
        return {
          ...r,
          steps,
          scenes: r.scenes?.map((s) => (s.status === 'running' ? { ...s, status: 'pending' as const } : s)),
        };
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patchRow = (id: string, fn: (r: WorkflowRow) => WorkflowRow) => {
    rowsRef.current = rowsRef.current.map((r) => (r.id === id ? fn(r) : r));
    setRows(rowsRef.current);
  };

  const deps: RunnerDeps = {
    getRow: (id) => rowsRef.current.find((r) => r.id === id),
    patchRow,
    library: () => libraryRef.current,
    // Cập nhật luôn bản đang đọc để bước sau thấy ngay, không chờ React vẽ lại
    addProduct: (p) => {
      libraryRef.current = { ...libraryRef.current, products: [...libraryRef.current.products, p] };
      libraryRef.current.setProducts((prev) => [...prev, p]);
    },
    updateProduct: (id, patch) => {
      const fn = (list: StudioProduct[]) => list.map((p) => (p.id === id ? { ...p, ...patch } : p));
      libraryRef.current = { ...libraryRef.current, products: fn(libraryRef.current.products) };
      libraryRef.current.setProducts(fn);
    },
    updateCharacter: (id, patch) => {
      const fn = (list: StudioCharacter[]) => list.map((c) => (c.id === id ? { ...c, ...patch } : c));
      libraryRef.current = { ...libraryRef.current, characters: fn(libraryRef.current.characters) };
      libraryRef.current.setCharacters(fn);
    },
    threads: () => threadsRef.current,
    shouldStop: () => stopRef.current,
    reviewScript,
  };

  /** Mẫu dùng cho dòng: dòng chưa có kịch bản thì lấy mẫu đang chọn, còn lại giữ mẫu lúc chạy trước. */
  const templateFor = (row: WorkflowRow) => {
    const from = firstOpenStep(row);
    return !row.template || from === 'product' || from === 'script' ? draft : row.template;
  };

  const runRows = async (ids: string[], tplOverride?: WorkflowTemplate) => {
    if (busy) return;
    if (accountsState.usableCount === 0) {
      alert('Chưa có tài khoản Muse dùng được. Thêm tài khoản ở Cài đặt ➔ Tài khoản Muse.');
      return;
    }
    stopRef.current = false;
    setBusy(true);
    try {
      for (const id of ids) {
        if (stopRef.current) break;
        const row = rowsRef.current.find((r) => r.id === id);
        if (!row || !firstOpenStep(row)) continue;
        const tpl = tplOverride ?? templateFor(row);
        patchRow(id, (r) => ({ ...r, template: tpl }));
        setRunningRowId(id);
        await runWorkflowRow(id, tpl, deps);
      }
    } finally {
      setRunningRowId(null);
      setBusy(false);
    }
  };

  /** Lượt chạy từ Sơ đồ khối (1 dòng mang sẵn mẫu của sơ đồ) — giữ lại sau khi tải lại trang. */
  const [graphRunId, setGraphRunId] = usePersistentState<string>('workflow.graphRun.v1', '');
  const graphRow = rows.find((r) => r.id === graphRunId);
  const [graphProductId, setGraphProductId] = useState('');
  const [graphLink, setGraphLink] = useState('');

  /** ▶ Chạy Workflow ở Sơ đồ khối: lưu workflow, tạo 1 dòng mới rồi chạy ngay bằng bộ máy chung. */
  const runGraph = (tpl: WorkflowTemplate) => {
    if (busy) return;
    if (!tpl.manualScenes?.length && !graphProductId && !graphLink.trim()) {
      alert('Workflow dùng AI viết kịch bản: chọn sản phẩm hoặc dán link / tên sản phẩm ở thanh Chạy bên dưới sơ đồ.');
      return;
    }
    applyGraph(tpl);
    const row: WorkflowRow = {
      id: newLibraryId('wfr'),
      steps: freshSteps(),
      productId: graphProductId || undefined,
      link: graphProductId ? undefined : graphLink.trim() || undefined,
      template: tpl,
    };
    rowsRef.current = [...rowsRef.current, row];
    setRows(rowsRef.current);
    setGraphRunId(row.id);
    runRows([row.id], tpl);
  };

  const runAll = () =>
    runRows(
      rows
        .filter((r) => {
          const open = firstOpenStep(r);
          return open && r.steps[open].status !== 'review';
        })
        .map((r) => r.id)
    );

  const addRow = (partial: Partial<WorkflowRow>) =>
    setRows((prev) => [...prev, { id: newLibraryId('wfr'), steps: freshSteps(), ...partial }]);

  const addFromForm = () => {
    if (!newProductId && !newLink.trim() && !draft.manualScenes?.length) {
      return alert('Chọn sản phẩm trong thư viện hoặc dán link / tên sản phẩm.');
    }
    addRow({
      productId: newProductId || undefined,
      link: newProductId ? undefined : newLink.trim(),
      characterId: newCharId || undefined,
      note: newNote.trim() || undefined,
    });
    setNewLink('');
    setNewNote('');
  };

  const addFromPaste = () => {
    const lines = pasteText.split('\n').map((l) => l.trim()).filter(Boolean);
    let added = 0;
    const unknownChars = new Set<string>();
    lines.forEach((line) => {
      const [first, charName, note] = splitLine(line);
      if (!first) return;
      const prod = library.products.find((p) => p.name.trim().toLowerCase() === first.toLowerCase());
      const ch = charName
        ? library.characters.find((c) => c.name.trim().toLowerCase() === charName.toLowerCase())
        : undefined;
      if (charName && !ch) unknownChars.add(charName);
      addRow({
        productId: prod?.id,
        link: prod ? undefined : first,
        characterId: ch?.id ?? (newCharId || undefined),
        note: note || undefined,
      });
      added++;
    });
    setPasteText('');
    setPasteOpen(false);
    if (unknownChars.size) {
      alert(`Đã thêm ${added} dòng. Không thấy nhân vật trong thư viện: ${[...unknownChars].join(', ')}.`);
    }
  };

  const retryFrom = (row: WorkflowRow, from: WorkflowStepId) => {
    patchRow(row.id, (r) => resetFrom(r, from));
    runRows([row.id]);
  };

  const approveScript = (row: WorkflowRow) => {
    patchRow(row.id, (r) => ({ ...r, steps: { ...r.steps, script: { ...r.steps.script, status: 'done' } } }));
    runRows([row.id]);
  };

  // --- Mẫu tự tạo ---
  const saveAsNew = () => {
    const name = prompt('Tên workflow mới:', draft.builtin ? `${draft.name} (của tôi)` : draft.name);
    if (!name) return;
    const item: WorkflowTemplate = { ...draft, id: newLibraryId('wf'), name: name.trim(), builtin: false };
    setCustoms((prev) => [...prev, item]);
    setSelectedId(item.id);
  };
  const saveChanges = () => setCustoms((prev) => prev.map((t) => (t.id === draft.id ? draft : t)));
  const deleteCustom = () => {
    if (!confirm(`Xóa workflow "${draft.name}"?`)) return;
    setCustoms((prev) => prev.filter((t) => t.id !== draft.id));
    setSelectedId(BUILTIN_WORKFLOWS[0].id);
  };

  const categories = useMemo(() => [...new Set(allTemplates.map((t) => t.category || 'Khác'))], [allTemplates]);
  const set = <K extends keyof WorkflowTemplate>(k: K, v: WorkflowTemplate[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const productLabel = (row: WorkflowRow) => {
    const p = rowProduct(row, library.products);
    if (p) return p.name;
    return row.link || '(chưa có sản phẩm)';
  };
  const charName = (id?: string) => library.characters.find((c) => c.id === id)?.name;
  const draftCast = workflowCast(draft, library.characters);

  const doneCount = rows.filter((r) => !firstOpenStep(r)).length;

  /** Thẻ 1 dòng: tiến độ từng bước, duyệt kịch bản, cảnh đã render, clip cuối (dùng cả ở Sơ đồ khối). */
  const renderRowCard = (row: WorkflowRow, idx: number) => {
          const open = firstOpenStep(row);
          const isRunning = runningRowId === row.id;
          const tpl = row.template ?? draft;
          const show = expanded[row.id] ?? (isRunning || row.steps.script.status === 'review');
          const scenes = row.scenes ?? [];
          const failedStep = WORKFLOW_STEPS.find((s) => row.steps[s.id].status === 'failed');
          return (
            <section
              key={row.id}
              className={`bg-slate-900 border rounded-2xl p-4 space-y-3 ${
                isRunning ? 'border-indigo-500' : 'border-slate-800'
              }`}
            >
              <div className="flex flex-wrap items-start gap-3">
                <span className="text-xs font-bold text-slate-500 pt-0.5">#{idx + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-100 truncate" title={row.link}>
                    {productLabel(row)}
                  </p>
                  <p className="text-[10px] text-slate-400 truncate">
                    {row.template ? `${row.template.icon} ${row.template.name}` : 'Chưa chạy'}
                    {row.characterId
                      ? ` · 👤 ${charName(row.characterId) || '(nhân vật đã xóa)'}`
                      : (() => {
                          const cast = workflowCast(row.template ?? draft, library.characters);
                          return cast.length ? ` · 👤 ${cast.map((c) => c.name).join(', ')} (workflow)` : '';
                        })()}
                    {row.note && ` · 📝 ${row.note}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {open && !busy && row.steps[open].status !== 'review' && (
                    <button
                      onClick={() => runRows([row.id])}
                      className="px-2.5 py-1 rounded-lg bg-emerald-600/80 text-white text-[10px] font-semibold"
                    >
                      ▶ {failedStep || row.steps[open].status !== 'pending' || open !== 'product' ? 'Chạy tiếp' : 'Chạy'}
                    </button>
                  )}
                  {!busy && (
                    <select
                      value=""
                      onChange={(e) => e.target.value && retryFrom(row, e.target.value as WorkflowStepId)}
                      className="bg-slate-950 border border-slate-700 text-[10px] text-slate-300 rounded-lg px-1.5"
                    >
                      <option value="">↻ Chạy lại từ…</option>
                      {WORKFLOW_STEPS.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.icon} {s.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {row.project && (
                    <button
                      onClick={() => openProjectFolder(row.project).catch((e) => alert(e.message))}
                      className="px-2 py-1 rounded-lg bg-slate-800 text-[10px] text-slate-300"
                      title={row.project}
                    >
                      📂
                    </button>
                  )}
                  <button
                    onClick={() => setExpanded((m) => ({ ...m, [row.id]: !show }))}
                    className="px-2 py-1 rounded-lg bg-slate-800 text-[10px] text-slate-300"
                  >
                    {show ? '▲' : '▼'}
                  </button>
                  {!isRunning && (
                    <button
                      onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
                      className="px-2 py-1 rounded-lg bg-slate-800 text-[10px] text-red-300"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* Tiến độ 4 bước */}
              <div className="flex flex-wrap items-center gap-1.5">
                {WORKFLOW_STEPS.map((s, i) => {
                  const st = row.steps[s.id];
                  const extra =
                    s.id === 'scenes' && scenes.length
                      ? ` ${scenes.filter((x) => x.status === 'done').length}/${scenes.length}`
                      : '';
                  return (
                    <React.Fragment key={s.id}>
                      {i > 0 && <span className="text-slate-600 text-[10px]">→</span>}
                      <span
                        className={`px-2 py-1 rounded-lg border text-[10px] ${STEP_STYLE[st.status]}`}
                        title={st.error || st.detail || ''}
                      >
                        {s.icon} {s.label}
                        {extra}
                        {st.status === 'review' && ' · chờ duyệt'}
                      </span>
                    </React.Fragment>
                  );
                })}
              </div>
              {failedStep && (
                <p className="text-[11px] text-red-300">
                  ⚠ {failedStep.label}: {row.steps[failedStep.id].error}
                </p>
              )}

              {show && (
                <div className="space-y-3 pt-1">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[10px] text-slate-400">
                    {WORKFLOW_STEPS.map((s) =>
                      row.steps[s.id].detail ? (
                        <p key={s.id} className="truncate" title={row.steps[s.id].detail}>
                          {s.icon} {row.steps[s.id].detail}
                        </p>
                      ) : null
                    )}
                    {row.script?.source && (
                      <p>🤖 Kịch bản tạo bởi: {describeScriptSource(row.script.source)}</p>
                    )}
                  </div>

                  {row.steps.script.status === 'review' && (
                    <div className="space-y-2 bg-amber-500/5 border border-amber-500/30 rounded-xl p-3">
                      <p className="text-[11px] text-amber-200">
                        Xem / sửa prompt từng cảnh rồi bấm Duyệt để render.
                      </p>
                      {scenes.map((sc, i) => (
                        <div key={i}>
                          <label className={labelCls}>
                            Cảnh {i + 1}
                            {sc.title ? ` — ${sc.title}` : ''}
                          </label>
                          <textarea
                            rows={3}
                            className={inputCls}
                            value={sc.prompt}
                            onChange={(e) =>
                              patchRow(row.id, (r) => ({
                                ...r,
                                scenes: r.scenes?.map((x, j) => (j === i ? { ...x, prompt: e.target.value } : x)),
                              }))
                            }
                          />
                        </div>
                      ))}
                      <button
                        onClick={() => approveScript(row)}
                        disabled={busy}
                        className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 text-[11px] font-bold disabled:opacity-40"
                      >
                        ✅ Duyệt & render
                      </button>
                    </div>
                  )}

                  {scenes.length > 0 && row.steps.script.status !== 'review' && (
                    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                      {scenes.map((sc, i) => (
                        <div key={i} className="rounded-lg overflow-hidden border border-slate-800 bg-slate-950">
                          <div className={`${aspectClass(tpl.aspectRatio)} bg-black flex items-center justify-center`}>
                            {sc.videoUrl ? (
                              <video src={sc.videoUrl} controls className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-[10px] text-slate-500 px-1 text-center">
                                {sc.status === 'running'
                                  ? `⏳ ${sc.progress ? `${Math.round(sc.progress)}%` : 'Đang render'}`
                                  : sc.status === 'failed'
                                    ? '❌ Lỗi'
                                    : 'Chờ'}
                              </span>
                            )}
                          </div>
                          <p
                            className={`text-[9px] px-1.5 py-1 truncate ${sc.error ? 'text-red-300' : 'text-slate-400'}`}
                            title={sc.error || sc.prompt}
                          >
                            {i + 1}. {sc.error || sc.title || sc.prompt}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {(row.final || row.merged) && (
                    <div className="flex flex-wrap gap-3 items-start">
                      <video
                        src={(row.final || row.merged)!.url}
                        controls
                        className={`${aspectClass(tpl.aspectRatio)} w-48 rounded-lg border border-emerald-600/50 bg-black`}
                      />
                      <div className="text-[11px] text-emerald-300 break-all flex-1 min-w-[200px] space-y-1">
                        {row.merged && <p>🎞 Clip ghép: {row.merged.path}</p>}
                        {row.final && <p>🛠 Sau hậu kỳ: {row.final.path}</p>}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          );
  };

  const viewSwitch = (
    <div className="px-4 lg:px-6 pt-4 flex flex-wrap items-center gap-2">
      <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1">
        {(
          [
            ['list', '📋 Mẫu & danh sách dòng'],
            ['graph', '🧩 Sơ đồ khối (tự lắp workflow)'],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${view === v ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {view === 'graph' && (
        <>
          <select
            value={selected.id}
            onChange={(e) => setSelectedId(e.target.value)}
            className="bg-slate-900 border border-slate-700 text-xs text-slate-200 rounded-lg p-1.5"
          >
            {allTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.icon} {t.name}
                {t.builtin ? '' : ' • của tôi'}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-slate-500">
            Mẫu có sẵn được lưu thành bản “(sơ đồ)” của bạn; sau khi áp dụng, chuyển sang “Mẫu & danh sách dòng” để chạy.
          </span>
        </>
      )}
    </div>
  );

  if (view === 'graph') {
    return (
      <div>
        {viewSwitch}
        <div className="p-4 lg:p-6">
          <WorkflowGraphEditor
            template={selected}
            onApply={applyGraph}
            characterLibrary={{
              characters: library.characters,
              addCharacter: (c) => library.setCharacters((prev) => [...prev, c]),
              updateCharacter: deps.updateCharacter,
              onOpenSettings,
            }}
            runRow={graphRow && graphRow.template?.id === selected.id ? graphRow : undefined}
            onRun={runGraph}
            onStop={() => (stopRef.current = true)}
            busy={busy}
          />
          <section className="mt-3 bg-slate-900 border border-slate-800 rounded-2xl p-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-white">▶ Chạy Workflow</span>
            <span className="text-[10px] text-slate-500">Sản phẩm (chỉ cần khi dùng ✍️ AI viết kịch bản / khóa sản phẩm):</span>
            <select
              className="bg-slate-950 border border-slate-700 text-[11px] text-slate-200 rounded-lg p-1.5"
              value={graphProductId}
              onChange={(e) => setGraphProductId(e.target.value)}
            >
              <option value="">— Không / nhập link —</option>
              {library.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {!graphProductId && (
              <input
                className="bg-slate-950 border border-slate-700 text-[11px] text-slate-200 rounded-lg p-1.5 w-64"
                placeholder="Link Shopee / TikTok hoặc tên SP (tùy chọn)"
                value={graphLink}
                onChange={(e) => setGraphLink(e.target.value)}
              />
            )}
            <span className="text-[10px] text-slate-500 ml-auto">
              {accountsState.usableCount} tài khoản · {accountsState.totalThreads} luồng render song song
            </span>
          </section>
          {graphRow && <div className="mt-3">{renderRowCard(graphRow, rows.indexOf(graphRow))}</div>}
        </div>
      </div>
    );
  }

  return (
    <div>
    {viewSwitch}
    <div className="p-4 lg:p-6 grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-5">
      {/* ---------------- Cột trái: mẫu workflow ---------------- */}
      <aside className="space-y-4">
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <h2 className="text-sm font-bold text-white mb-1">1. Chọn mẫu Workflow</h2>
          <p className="text-[11px] text-slate-400 mb-3">
            Mỗi dòng sản phẩm chạy qua: 🛒 Sản phẩm → ✍️ Kịch bản → 🎬 Render cảnh → 🎞 Ghép thành 1 clip.
          </p>
          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
            {categories.map((cat) => (
              <div key={cat}>
                <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">{cat}</p>
                <div className="space-y-1.5">
                  {allTemplates
                    .filter((t) => (t.category || 'Khác') === cat)
                    .map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setSelectedId(t.id)}
                        className={`w-full text-left rounded-xl border px-3 py-2 transition ${
                          t.id === selected.id
                            ? 'border-indigo-500 bg-indigo-600/15'
                            : 'border-slate-800 bg-slate-950 hover:border-slate-600'
                        }`}
                      >
                        <p className="text-xs font-semibold text-slate-100">
                          {t.icon} {t.name}
                          {!t.builtin && <span className="ml-1 text-[9px] text-amber-300">• của tôi</span>}
                        </p>
                        <p className="text-[10px] text-slate-400 line-clamp-2">{t.description}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          {t.sceneCount} cảnh × {t.duration}s · {t.aspectRatio}
                          {t.faceless ? ' · không lộ mặt' : ''}
                          {t.chainEndFrame ? ' · nối khung' : ''}
                          {t.rotateProductImages ? ' · xoay ảnh SP' : ''}
                        </p>
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">
              2. Tùy chỉnh {dirty && <span className="text-[10px] text-amber-300 font-normal">(chưa lưu)</span>}
            </h2>
            {dirty && (
              <button onClick={() => setDraft(selected)} className="text-[10px] text-slate-400 hover:text-white">
                ↺ Hoàn tác
              </button>
            )}
          </div>
          <div className="grid grid-cols-[48px_1fr] gap-2">
            <input className={inputCls} value={draft.icon} onChange={(e) => set('icon', e.target.value)} />
            <input className={inputCls} value={draft.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Kiểu kịch bản</label>
            <select
              className={inputCls}
              value={draft.scriptMode}
              onChange={(e) => set('scriptMode', e.target.value as WorkflowTemplate['scriptMode'])}
            >
              {SCRIPT_MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          {draft.scriptMode === 'template' && (
            <div>
              <label className={labelCls}>Mẫu kịch bản</label>
              <select
                className={inputCls}
                value={draft.scriptTemplateId || ''}
                onChange={(e) => set('scriptTemplateId', e.target.value)}
              >
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
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className={labelCls}>Số cảnh</label>
              <input
                type="number"
                min={1}
                max={12}
                className={inputCls}
                value={draft.sceneCount}
                onChange={(e) => set('sceneCount', Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
              />
            </div>
            <div>
              <label className={labelCls}>Giây / cảnh</label>
              <select
                className={inputCls}
                value={draft.duration}
                onChange={(e) => set('duration', Number(e.target.value) as WorkflowTemplate['duration'])}
              >
                {[4, 6, 8, 10].map((d) => (
                  <option key={d} value={d}>
                    {d}s
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Tỉ lệ</label>
              <select
                className={inputCls}
                value={draft.aspectRatio}
                onChange={(e) => set('aspectRatio', e.target.value as WorkflowTemplate['aspectRatio'])}
              >
                {['9:16', '16:9', '1:1'].map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Góc máy</label>
            <select className={inputCls} value={draft.cameraMotion} onChange={(e) => set('cameraMotion', e.target.value)}>
              {CAMERA_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Hướng dẫn thêm cho AI viết kịch bản</label>
            <textarea
              rows={3}
              className={inputCls}
              value={draft.extraNote}
              onChange={(e) => set('extraNote', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 gap-1.5 text-[11px] text-slate-300">
            {(
              [
                ['withDialogue', 'Có lời thoại (khẩu hình tiếng Việt)'],
                ['faceless', 'Không lộ mặt (không gửi ảnh nhân vật)'],
                ['rotateProductImages', 'Xoay vòng ảnh sản phẩm qua từng cảnh (lookbook)'],
                ['chainEndFrame', 'Nối khung cuối → khung đầu (chạy tuần tự)'],
                ['autoMerge', 'Tự ghép các cảnh thành 1 clip'],
                ['splitDialogue', 'Tách lời thoại nhiều nhân vật: mỗi lượt thoại 1 shot đúng giọng'],
                ['autoPortrait', 'Nhân vật chưa có ảnh: AI tự vẽ chân dung (lưu vào thư viện)'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={k === 'autoPortrait' ? draft.autoPortrait !== false : !!draft[k]}
                  onChange={(e) => set(k, e.target.checked)}
                />
                {label}
              </label>
            ))}
          </div>
          <div className="border-t border-slate-800 pt-2 space-y-2">
            <p className={labelCls}>🛠 Hậu kỳ clip cuối</p>
            <select
              className={inputCls}
              value={draft.postUpscale || 0}
              onChange={(e) => set('postUpscale', Number(e.target.value))}
            >
              <option value={0}>Không nâng độ phân giải</option>
              {[1080, 1440, 2160].map((n) => (
                <option key={n} value={n}>
                  Nâng cạnh ngắn lên {n}px{n === 2160 ? ' (4K)' : ''}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-300">
              <span className="text-slate-500">Làm mờ watermark ở:</span>
              {WATERMARK_SPOTS.map((spot) => {
                const on = !!draft.postBlur?.regions.some((r) => sameRegion(r, spot.region));
                return (
                  <label key={spot.id} className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => {
                        const cur = draft.postBlur?.regions ?? [];
                        const regions = on
                          ? cur.filter((r) => !sameRegion(r, spot.region))
                          : [...cur, spot.region];
                        set('postBlur', regions.length ? { regions, mode: 'blur', strength: 24 } : undefined);
                      }}
                    />
                    {spot.label}
                  </label>
                );
              })}
            </div>
            <p className="text-[10px] text-slate-500">
              Vùng tùy ý: dùng tab Thư viện media (kéo chuột khoanh vùng) cho từng clip.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button onClick={saveAsNew} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-[11px] font-semibold">
              💾 Lưu thành workflow mới
            </button>
            {!draft.builtin && (
              <>
                <button
                  onClick={saveChanges}
                  disabled={!dirty}
                  className="px-3 py-1.5 rounded-lg bg-slate-700 text-white text-[11px] disabled:opacity-40"
                >
                  Lưu thay đổi
                </button>
                <button onClick={deleteCustom} className="px-3 py-1.5 rounded-lg bg-red-600/80 text-white text-[11px]">
                  Xóa
                </button>
              </>
            )}
          </div>
          {dirty && (
            <p className="text-[10px] text-slate-500">
              Thay đổi chưa lưu vẫn được dùng cho các dòng chạy từ đầu.
            </p>
          )}
        </section>
      </aside>

      {/* ---------------- Cột phải: dòng sản phẩm ---------------- */}
      <div className="space-y-4 min-w-0">
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-white">3. Danh sách sản phẩm (mỗi dòng = 1 clip)</h2>
            <button onClick={() => setPasteOpen((v) => !v)} className="text-[11px] text-indigo-300 hover:text-white">
              📋 Dán nhiều dòng / CSV
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr_1.2fr_auto] gap-2 items-end">
            <div>
              <label className={labelCls}>Sản phẩm (thư viện) hoặc link / tên</label>
              <div className="flex gap-1.5">
                <select
                  className={inputCls}
                  value={newProductId}
                  onChange={(e) => setNewProductId(e.target.value)}
                  style={{ maxWidth: newProductId ? undefined : '45%' }}
                >
                  <option value="">-- Thư viện --</option>
                  {library.products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {!newProductId && (
                  <input
                    className={inputCls}
                    placeholder="Link Shopee / TikTok hoặc tên SP"
                    value={newLink}
                    onChange={(e) => setNewLink(e.target.value)}
                  />
                )}
              </div>
            </div>
            <div>
              <label className={labelCls}>Nhân vật</label>
              <select className={inputCls} value={newCharId} onChange={(e) => setNewCharId(e.target.value)}>
                <option value="">{draftCast.length ? `-- Theo workflow (${draftCast[0].name}) --` : '-- Không / tự do --'}</option>
                {library.characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Ghi chú cho AI</label>
              <input
                className={inputCls}
                placeholder="vd. nhấn mạnh freeship, giọng hài"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
              />
            </div>
            <button onClick={addFromForm} className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-[11px] font-semibold">
              + Thêm dòng
            </button>
          </div>
          {draftCast.length > 0 && (
            <p className="text-[10px] text-purple-300">
              👤 Workflow có dàn nhân vật cố định: {draftCast.map((c) => c.name).join(', ')} (đặt ở 🧩 Sơ đồ khối). Chọn
              nhân vật ở dòng sẽ thay nhân vật chính cho dòng đó.
            </p>
          )}
          {library.characters.length === 0 && (
            <p className="text-[10px] text-slate-500">
              Chưa có nhân vật nào —{' '}
              <button onClick={onOpenSettings} className="text-indigo-300 underline">
                tạo nhân vật ở Cài đặt
              </button>{' '}
              để khóa mặt + giọng.
            </p>
          )}
          {pasteOpen && (
            <div className="space-y-2">
              <p className="text-[10px] text-slate-400">
                Mỗi dòng: <code>link hoặc tên sản phẩm | tên nhân vật | ghi chú</code> (phân cách bằng Tab, | hoặc ;).
                Dán thẳng từ Excel / Google Sheets được. Tên sản phẩm trùng thư viện thì dùng sản phẩm trong thư viện;
                dòng không ghi nhân vật thì dùng nhân vật đang chọn ở trên.
              </p>
              <textarea
                rows={5}
                className={inputCls}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={'https://s.shopee.vn/xxxx | Lan | nhấn mạnh giá rẻ\nhttps://vt.tiktok.com/yyyy | Minh'}
              />
              <button onClick={addFromPaste} className="px-3 py-1.5 rounded-lg bg-slate-700 text-white text-[11px]">
                Thêm {pasteText.split('\n').filter((l) => l.trim()).length} dòng
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800">
            {!busy ? (
              <button
                onClick={runAll}
                disabled={rows.length === doneCount}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold disabled:opacity-40"
              >
                ▶ Chạy {rows.length - doneCount} dòng với “{draft.icon} {draft.name}”
              </button>
            ) : (
              <button
                onClick={() => (stopRef.current = true)}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-bold"
              >
                ⏹ Dừng
              </button>
            )}
            <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
              <input type="checkbox" checked={reviewScript} onChange={(e) => setReviewScript(e.target.checked)} />
              Dừng sau kịch bản để duyệt / sửa
            </label>
            <span className="text-[11px] text-slate-500 ml-auto">
              {doneCount}/{rows.length} xong · {accountsState.totalThreads} luồng render
            </span>
            {doneCount > 0 && !busy && (
              <button
                onClick={() => setRows((prev) => prev.filter((r) => firstOpenStep(r)))}
                className="text-[11px] text-slate-400 hover:text-white"
              >
                🧹 Bỏ dòng đã xong
              </button>
            )}
          </div>
        </section>

        {rows.length === 0 && (
          <p className="text-center text-xs text-slate-500 py-10">
            Chưa có dòng nào. Thêm sản phẩm ở trên, mỗi dòng sẽ ra 1 clip hoàn chỉnh theo mẫu đã chọn.
          </p>
        )}

        {rows.map(renderRowCard)}
      </div>
    </div>
    </div>
  );
};
