// Xuất / nhập "bộ workflow" (.musestudio.json): nhiều mẫu + sơ đồ khối + nhân vật / sản phẩm dùng kèm, ảnh nhúng sẵn.
// Dùng để chuyển sang máy mới, chia sẻ cho học viên, hoặc cài bộ mẫu đăng trên fastaivn.com.
import React, { useMemo, useRef, useState } from 'react';
import type { StudioCharacter, StudioProduct } from '../types/library';
import type { WorkflowTemplate } from '../types/workflow';
import type { FlowWorkflow } from '../services/nodeFlow/definitions';
import type { CatalogEntry } from '../services/templateCatalog';
import {
  ImportPlan,
  WorkflowBundle,
  buildBundle,
  bundleFileName,
  bundleSummary,
  fetchBundleFromUrl,
  parseBundle,
  planImport,
  referencedLibrary,
} from '../services/workflowBundle';

const inputCls = 'bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500';
const btn = 'px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40';

interface Props {
  mode: 'export' | 'import';
  onClose: () => void;
  /** Mẫu tự lưu ("Mẫu & danh sách dòng") */
  templates: WorkflowTemplate[];
  /** Mẫu có sẵn của app (MuseStudio + MV1 + FastAIVN + catalog) */
  builtinTemplates: WorkflowTemplate[];
  /** Sơ đồ đã lưu trong Sơ đồ khối */
  flows: FlowWorkflow[];
  characters: StudioCharacter[];
  products: StudioProduct[];
  /** Mẫu trên fastaivn.com có bộ workflow (bundleUrl) */
  remoteBundles: CatalogEntry[];
  onImport: (plan: ImportPlan, bundle: WorkflowBundle) => void;
}

const sizeOf = (s: string) => {
  const mb = new Blob([s]).size / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(mb * 1024))} KB`;
};

const Check: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode; sub?: string }> = ({ checked, onChange, label, sub }) => (
  <label className="flex items-start gap-2 py-1 cursor-pointer">
    <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <span className="text-xs text-slate-200">
      {label}
      {sub && <span className="block text-[11px] text-slate-500">{sub}</span>}
    </span>
  </label>
);

export const WorkflowBundleModal: React.FC<Props> = ({ mode, onClose, templates, builtinTemplates, flows, characters, products, remoteBundles, onImport }) => {
  // ---------------- Xuất ----------------
  const [pickB, setPickB] = useState<Set<string>>(() => new Set(builtinTemplates.map((t) => t.id)));
  const [pickT, setPickT] = useState<Set<string>>(() => new Set(templates.map((t) => t.id)));
  const [pickF, setPickF] = useState<Set<string>>(() => new Set(flows.map((w) => w.id)));
  const [withLib, setWithLib] = useState(true);
  const [name, setName] = useState(`Bộ workflow MuseStudio ${new Date().toLocaleDateString('vi-VN')}`);
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string; warn?: string[] }>({});
  const [progress, setProgress] = useState('');
  const chosenB = builtinTemplates.filter((t) => pickB.has(t.id));
  const chosenT = templates.filter((t) => pickT.has(t.id));
  const chosenF = flows.filter((w) => pickF.has(w.id));
  const lib = useMemo(() => referencedLibrary(chosenT, chosenF, characters, products), [chosenT, chosenF, characters, products]);
  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string, v: boolean) => {
    const n = new Set(set);
    if (v) n.add(id);
    else n.delete(id);
    setter(n);
  };

  const doExport = async () => {
    setBusy(true);
    setMsg({});
    try {
      const { bundle, warnings } = await buildBundle({
        name,
        description: desc,
        templates: chosenT,
        builtinTemplates: chosenB,
        flows: chosenF,
        characters,
        products,
        includeLibrary: withLib,
        onProgress: setProgress,
      });
      const text = JSON.stringify(bundle);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      a.download = bundleFileName(name);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      setMsg({ ok: `Đã xuất "${a.download}" (${sizeOf(text)}): ${bundleSummary(bundle)}.`, warn: warnings });
    } catch (err: any) {
      setMsg({ err: err?.message || String(err) });
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  // ---------------- Nhập ----------------
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [bundle, setBundle] = useState<WorkflowBundle | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [useT, setUseT] = useState<Set<number>>(new Set());
  const [useF, setUseF] = useState<Set<number>>(new Set());

  const load = (raw: unknown, fallback: string) => {
    const b = parseBundle(raw, fallback);
    const pl = planImport(b, { templates, builtinTemplates, flows, characters, products });
    setBundle(b);
    // Mẫu đã có sẵn ở máy này → bỏ qua (không tích)
    setUseT(new Set(b.templates.map((_, i) => i).filter((i) => pl.templateTargets[i] !== null)));
    setUseF(new Set(b.flows.map((_, i) => i)));
    setPlan(pl);
    setMsg({});
  };
  const fromFile = async (f?: File | null) => {
    if (!f) return;
    setBusy(true);
    try {
      load(JSON.parse(await f.text()), f.name.replace(/\.(musestudio\.)?json$/i, ''));
    } catch (err: any) {
      setBundle(null);
      setMsg({ err: `Không đọc được ${f.name}: ${err?.message || err}` });
    } finally {
      setBusy(false);
    }
  };
  const fromUrl = async (u: string, fallback = 'Bộ tải về') => {
    if (!u.trim()) return;
    setBusy(true);
    setMsg({});
    try {
      load(await fetchBundleFromUrl(u.trim()), fallback);
    } catch (err: any) {
      setBundle(null);
      setMsg({ err: `Không tải được bộ workflow: ${err?.message || err}` });
    } finally {
      setBusy(false);
    }
  };
  const doImport = () => {
    if (!bundle || !plan) return;
    // Chỉ nhập phần đã tích; nhân vật / sản phẩm chỉ thêm cái mà phần được nhập còn dùng
    const sub: WorkflowBundle = { ...bundle, templates: bundle.templates.filter((_, i) => useT.has(i)), flows: bundle.flows.filter((_, i) => useF.has(i)) };
    const need = referencedLibrary(sub.templates, sub.flows, bundle.characters, bundle.products);
    const p = planImport({ ...sub, characters: need.characters, products: need.products }, { templates, builtinTemplates, flows, characters, products });
    onImport(p, sub);
    setMsg({
      ok:
        `Đã nhập ${p.templates.length} mẫu (lưới card "Mẫu & danh sách dòng"), ${p.flows.length} sơ đồ (Sơ đồ khối)` +
        (p.newCharacters.length || p.newProducts.length ? `, thêm ${p.newCharacters.length} nhân vật + ${p.newProducts.length} sản phẩm vào Cài đặt` : '') +
        '.',
      warn: p.notes,
    });
    setBundle(null);
    setPlan(null);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-800 flex items-center gap-2">
          <h3 className="text-sm font-bold text-white flex-1">{mode === 'export' ? '📤 Xuất bộ workflow' : '📥 Nhập bộ workflow'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white px-2">
            ✕
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-4 text-xs text-slate-300">
          {mode === 'export' ? (
            <>
              <p className="text-slate-400">
                Gói mẫu có sẵn + mẫu tự lưu + sơ đồ khối thành 1 file <b>.musestudio.json</b> (ảnh nhúng sẵn). Mở MuseStudio ở máy khác → 📥 Nhập bộ workflow là chạy được;
                hoặc tải file lên fastaivn.com để mọi người cài.
              </p>
              <div className="grid md:grid-cols-2 gap-3">
                <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên bộ" />
                <input className={inputCls} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Mô tả (tùy chọn)" />
              </div>
              <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3">
                <div className="flex items-center mb-1">
                  <b className="text-slate-100 flex-1">
                    📚 Mẫu có sẵn ({chosenB.length}/{builtinTemplates.length})
                    <span className="font-normal text-slate-500"> — kèm sơ đồ node, máy nhận đã có mẫu này thì bỏ qua</span>
                  </b>
                  <button className="text-indigo-300" onClick={() => setPickB(new Set(pickB.size ? [] : builtinTemplates.map((t) => t.id)))}>
                    {pickB.size ? 'Bỏ hết' : 'Chọn hết'}
                  </button>
                </div>
                <div className="grid md:grid-cols-2 gap-x-3 max-h-56 overflow-y-auto pr-1">
                  {builtinTemplates.map((t) => (
                    <Check key={t.id} checked={pickB.has(t.id)} onChange={(v) => toggle(pickB, setPickB, t.id, v)} label={`${t.icon || '🎬'} ${t.name}`} sub={`${t.category} · ${t.sceneCount} cảnh`} />
                  ))}
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3 max-h-64 overflow-y-auto">
                  <div className="flex items-center mb-1">
                    <b className="text-slate-100 flex-1">📋 Mẫu tự lưu ({chosenT.length}/{templates.length})</b>
                    <button className="text-indigo-300" onClick={() => setPickT(new Set(pickT.size ? [] : templates.map((t) => t.id)))}>
                      {pickT.size ? 'Bỏ hết' : 'Chọn hết'}
                    </button>
                  </div>
                  {!templates.length && <p className="text-slate-500">Chưa có mẫu tự lưu.</p>}
                  {templates.map((t) => (
                    <Check key={t.id} checked={pickT.has(t.id)} onChange={(v) => toggle(pickT, setPickT, t.id, v)} label={`${t.icon || '🎬'} ${t.name}`} sub={`${t.category} · ${t.sceneCount} cảnh`} />
                  ))}
                </div>
                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3 max-h-64 overflow-y-auto">
                  <div className="flex items-center mb-1">
                    <b className="text-slate-100 flex-1">🧩 Sơ đồ khối ({chosenF.length}/{flows.length})</b>
                    <button className="text-indigo-300" onClick={() => setPickF(new Set(pickF.size ? [] : flows.map((w) => w.id)))}>
                      {pickF.size ? 'Bỏ hết' : 'Chọn hết'}
                    </button>
                  </div>
                  {!flows.length && <p className="text-slate-500">Chưa có sơ đồ nào.</p>}
                  {flows.map((w) => (
                    <Check
                      key={w.id}
                      checked={pickF.has(w.id)}
                      onChange={(v) => toggle(pickF, setPickF, w.id, v)}
                      label={w.name}
                      sub={`${w.nodes.length} node · ${w.nodes.filter((n) => n.type === 'generate-video').length} cảnh video${w.category ? ' · ' + w.category : ''}`}
                    />
                  ))}
                </div>
              </div>
              <Check
                checked={withLib}
                onChange={setWithLib}
                label={`Kèm nhân vật / sản phẩm đang được dùng (${lib.characters.length} nhân vật, ${lib.products.length} sản phẩm)`}
                sub={
                  [...lib.characters.map((c) => '@' + c.name), ...lib.products.map((p) => '@@' + p.name)].join(', ') ||
                  'Mẫu / sơ đồ đã chọn không dùng nhân vật hay sản phẩm nào trong Cài đặt.'
                }
              />
              <div className="flex gap-2">
                <button disabled={busy || (!chosenB.length && !chosenT.length && !chosenF.length)} onClick={doExport} className={`${btn} bg-indigo-600 text-white`}>
                  {busy ? 'Đang đóng gói…' : `📤 Xuất ${chosenB.length + chosenT.length + chosenF.length} mục`}
                </button>
                {busy && progress && <span className="self-center text-indigo-300">{progress}</span>}
              </div>
            </>
          ) : (
            <>
              <p className="text-slate-400">
                Nhận file <b>.musestudio.json</b> (bộ workflow), sơ đồ JSON xuất từ MuseStudio / MV1, hoặc gói mẫu fastaivn. Mẫu & sơ đồ nhập vào được thêm mới (không đè cái đang
                có); nhân vật / sản phẩm trùng tên dùng cái có sẵn trong Cài đặt.
              </p>
              <div className="flex flex-wrap gap-2 items-center">
                <button disabled={busy} onClick={() => fileRef.current?.click()} className={`${btn} bg-slate-700 text-white`}>
                  📂 Chọn file…
                </button>
                <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => fromFile(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
                <span className="text-slate-500">hoặc link</span>
                <input className={`${inputCls} flex-1 min-w-[220px]`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://fastaivn.com/workflows/bundles/....musestudio.json" />
                <button disabled={busy || !url.trim()} onClick={() => fromUrl(url)} className={`${btn} bg-slate-700 text-white`}>
                  ⬇ Tải
                </button>
              </div>
              {remoteBundles.length > 0 && (
                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3">
                  <b className="text-slate-100">🌐 Bộ workflow trên fastaivn.com</b>
                  <div className="mt-2 space-y-1.5">
                    {remoteBundles.map((e) => (
                      <div key={e.id} className="flex items-center gap-2">
                        <span className="flex-1">
                          {e.icon || '🌐'} {e.title}
                          {e.description && <span className="block text-[11px] text-slate-500">{e.description.slice(0, 140)}</span>}
                        </span>
                        <button disabled={busy} onClick={() => fromUrl(e.bundleUrl!, e.title)} className={`${btn} bg-emerald-700 text-white`}>
                          Xem bộ
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {busy && <p className="text-indigo-300">Đang tải…</p>}
              {bundle && plan && (
                <div className="bg-slate-950/60 border border-indigo-800/60 rounded-xl p-3 space-y-2">
                  <p className="text-slate-100">
                    <b>{bundle.name}</b> — {bundleSummary(bundle)}
                    {bundle.exportedAt && <span className="text-slate-500"> · xuất {new Date(bundle.exportedAt).toLocaleString('vi-VN')}</span>}
                    {bundle.appVersion && <span className="text-slate-500"> · app {bundle.appVersion}</span>}
                  </p>
                  {bundle.description && <p className="text-slate-400">{bundle.description}</p>}
                  <div className={`grid gap-3 ${bundle.templates.length && bundle.flows.length ? 'md:grid-cols-2' : ''}`}>
                    <div className={bundle.templates.length ? 'max-h-72 overflow-y-auto' : 'hidden'}>
                      {bundle.templates.map((t, i) =>
                        plan.templateTargets[i] === null ? (
                          <div key={i} className="py-1 text-xs text-slate-500">
                            ✓ {t.name}
                            <span className="block text-[11px]">mẫu có sẵn ở máy này — bỏ qua</span>
                          </div>
                        ) : (
                          <Check
                            key={i}
                            checked={useT.has(i)}
                            onChange={(v) => { const n = new Set(useT); v ? n.add(i) : n.delete(i); setUseT(n); }}
                            label={`📋 ${t.name}`}
                            sub={`→ ${plan.templateTargets[i]}${t.flowGraph ? ' · kèm sơ đồ node' : ''}`}
                          />
                        )
                      )}
                    </div>
                    <div className={bundle.flows.length ? 'max-h-72 overflow-y-auto' : 'hidden'}>
                      {bundle.flows.map((w, i) => (
                        <Check key={i} checked={useF.has(i)} onChange={(v) => { const n = new Set(useF); v ? n.add(i) : n.delete(i); setUseF(n); }} label={`🧩 ${w.name}`} sub={`${w.nodes.length} node → ${plan.flows[i]?.name}`} />
                      ))}
                    </div>
                  </div>
                  {(plan.newCharacters.length > 0 || plan.newProducts.length > 0) && (
                    <p>➕ Thêm vào Cài đặt: {[...plan.newCharacters.map((c) => '@' + c.name), ...plan.newProducts.map((p) => '@@' + p.name)].join(', ')}</p>
                  )}
                  {(plan.reusedCharacters.length > 0 || plan.reusedProducts.length > 0) && (
                    <p className="text-amber-300">
                      ↺ Trùng tên — dùng cái đang có trong Cài đặt: {[...plan.reusedCharacters.map((c) => '@' + c), ...plan.reusedProducts.map((p) => '@@' + p)].join(', ')}
                    </p>
                  )}
                  {plan.notes.map((n, i) => (
                    <p key={i} className="text-amber-300">
                      ⚠ {n}
                    </p>
                  ))}
                  <button disabled={!useT.size && !useF.size} onClick={doImport} className={`${btn} bg-indigo-600 text-white`}>
                    📥 Nhập {useT.size + useF.size} mục
                  </button>
                </div>
              )}
            </>
          )}
          {msg.ok && <p className="text-emerald-300">✓ {msg.ok}</p>}
          {msg.err && <p className="text-red-300">✕ {msg.err}</p>}
          {msg.warn?.map((w, i) => (
            <p key={i} className="text-amber-300">
              ⚠ {w}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
};
