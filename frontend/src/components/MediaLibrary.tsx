import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BlurRegion,
  LibraryItem,
  SOURCE_LABEL,
  blurRegions,
  cutFrame,
  deleteLibraryItem,
  listLibrary,
  patchLibraryItem,
  upscaleMedia,
} from '../services/libraryService';
import { StudioLibraryState } from '../hooks/useStudioLibrary';
import { sendToStudio } from '../utils/studioBus';
import { urlToResizedDataUrl } from '../utils/image';
import { downloadFile } from '../utils/download';

const btn = 'px-2.5 py-1.5 rounded-lg text-[11px] font-semibold disabled:opacity-40';
const inputCls =
  'bg-slate-950 border border-white/5 text-[11px] text-slate-200 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-indigo-500';

const fmtSize = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const fmtTime = (t: number) => new Date(t * 1000).toLocaleString('vi-VN');

/** Ảnh / video có lớp vẽ vùng chọn (tọa độ 0..1 theo đúng khung media). */
const RegionEditor: React.FC<{
  item: LibraryItem;
  drawing: boolean;
  regions: BlurRegion[];
  onRegions: (r: BlurRegion[]) => void;
  videoRef: React.RefObject<HTMLVideoElement>;
}> = ({ item, drawing, regions, onRegions, videoRef }) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<BlurRegion | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  const pos = (e: React.PointerEvent) => {
    const r = boxRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
  const toRect = (a: { x: number; y: number }, b: { x: number; y: number }): BlurRegion => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  });

  return (
    <div ref={boxRef} className="relative inline-block max-w-full">
      {item.kind === 'image' ? (
        <img src={item.url} alt="" className="block max-h-[62vh] max-w-full rounded-lg" />
      ) : (
        <video ref={videoRef} src={item.url} controls className="block max-h-[62vh] max-w-full rounded-lg bg-black" />
      )}
      <div
        className={`absolute inset-0 ${drawing ? 'cursor-crosshair' : 'pointer-events-none'}`}
        onPointerDown={(e) => {
          if (!drawing) return;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          start.current = pos(e);
          setDraft(toRect(start.current, start.current));
        }}
        onPointerMove={(e) => start.current && setDraft(toRect(start.current, pos(e)))}
        onPointerUp={(e) => {
          if (!start.current) return;
          const r = toRect(start.current, pos(e));
          start.current = null;
          setDraft(null);
          if (r.w > 0.01 && r.h > 0.01) onRegions([...regions, r]);
        }}
      >
        {[...regions, ...(draft ? [draft] : [])].map((r, i) => (
          <div
            key={i}
            className="absolute border-2 border-fuchsia-400 bg-fuchsia-500/25"
            style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
          >
            {i < regions.length && (
              <button
                onClick={() => onRegions(regions.filter((_, j) => j !== i))}
                className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-red-600 text-[9px] text-white pointer-events-auto"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export const MediaLibrary: React.FC<{ library: StudioLibraryState; active: boolean }> = ({ library, active }) => {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [kind, setKind] = useState<'' | 'image' | 'video'>('');
  const [source, setSource] = useState('');
  const [q, setQ] = useState('');
  const [favOnly, setFavOnly] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<LibraryItem | null>(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [toast, setToast] = useState('');
  const [sceneNo, setSceneNo] = useState(1);
  const [charId, setCharId] = useState('');
  const [upSide, setUpSide] = useState(1080);
  const [drawing, setDrawing] = useState(false);
  const [regions, setRegions] = useState<BlurRegion[]>([]);
  const [blurMode, setBlurMode] = useState<'blur' | 'pixelate'>('blur');
  const [strength, setStrength] = useState(20);
  const videoRef = useRef<HTMLVideoElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await listLibrary({ kind, q: q.trim(), favorite: favOnly });
      setItems(res.data);
      setTotal(res.total);
      setError('');
      setSelected((cur) => (cur ? res.data.find((x) => x.name === cur.name) ?? cur : cur));
    } catch (err: any) {
      setError(err.message);
    }
  }, [kind, q, favOnly]);

  useEffect(() => {
    if (!active) return;
    const t = window.setTimeout(load, 250);
    return () => window.clearTimeout(t);
  }, [active, load]);

  useEffect(() => {
    setNote(selected?.note || '');
    setRegions([]);
    setDrawing(false);
  }, [selected?.name]);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 3500);
  };

  const run = async (label: string, job: () => Promise<void>) => {
    setBusy(label);
    try {
      await job();
    } catch (err: any) {
      alert(err.message || String(err));
    } finally {
      setBusy('');
    }
  };

  /** Kết quả hậu kỳ mới: tải lại thư viện và chọn luôn file mới */
  const showResult = async (name: string) => {
    const res = await listLibrary({});
    setItems(res.data);
    setTotal(res.total);
    setKind('');
    setSource('');
    setQ('');
    setFavOnly(false);
    const it = res.data.find((x) => x.name === name);
    if (it) setSelected(it);
  };

  const imageDataUrl = async (it: LibraryItem) => {
    if (it.kind === 'image') return urlToResizedDataUrl(it.url);
    // video: dùng khung đang xem (hoặc khung cuối)
    const t = videoRef.current && videoRef.current.currentTime > 0 ? videoRef.current.currentTime : undefined;
    const frame = await cutFrame(it.name, t);
    return urlToResizedDataUrl(frame.url);
  };

  const sources = [...new Set(items.map((x) => x.source))];
  const shown = source ? items.filter((x) => x.source === source) : items;

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2 bg-slate-900 border border-slate-800 rounded-2xl p-3">
        <div className="flex bg-slate-950 rounded-lg p-0.5">
          {(
            [
              ['', 'Tất cả'],
              ['image', '🖼 Ảnh'],
              ['video', '🎬 Video'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`px-3 py-1 rounded-md text-[11px] ${kind === k ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <select className={inputCls} value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">Mọi nguồn</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABEL[s] || s}
            </option>
          ))}
        </select>
        <input
          className={`${inputCls} flex-1 min-w-[180px]`}
          placeholder="Tìm theo prompt, ghi chú..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
          <input type="checkbox" checked={favOnly} onChange={(e) => setFavOnly(e.target.checked)} />★ Yêu thích
        </label>
        <button onClick={load} className={`${btn} bg-slate-800 text-slate-200`}>
          ↻
        </button>
        <span className="text-[11px] text-slate-500">
          {shown.length}/{total} file
        </span>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {toast && (
        <p className="fixed bottom-4 right-4 z-30 bg-emerald-600 text-white text-xs px-3 py-2 rounded-lg shadow-lg">
          {toast}
        </p>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_440px] gap-4 items-start">
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
          {shown.map((it) => (
            <button
              key={it.name}
              onClick={() => setSelected(it)}
              className={`text-left rounded-lg overflow-hidden border bg-slate-950 ${
                selected?.name === it.name ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-slate-800'
              }`}
            >
              <div className="relative aspect-[9/16] bg-black">
                {it.kind === 'image' ? (
                  <img src={it.url} alt="" loading="lazy" className="w-full h-full object-cover" />
                ) : (
                  <video src={`${it.url}#t=0.5`} muted preload="metadata" className="w-full h-full object-cover" />
                )}
                <span className="absolute top-1 left-1 text-[9px] bg-black/70 text-slate-200 px-1 rounded">
                  {SOURCE_LABEL[it.source] || it.source}
                </span>
                {it.favorite && <span className="absolute top-1 right-1 text-amber-300 text-xs">★</span>}
              </div>
              <p className="text-[9px] text-slate-400 px-1.5 py-1 truncate" title={it.prompt}>
                {it.note || it.prompt || fmtTime(it.created)}
              </p>
            </button>
          ))}
          {!shown.length && !error && (
            <p className="col-span-full text-center text-xs text-slate-500 py-10">
              Chưa có file nào. Ảnh / clip tạo ra, khung cắt và kết quả hậu kỳ sẽ hiện ở đây.
            </p>
          )}
        </div>

        {selected && (
          <aside className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 xl:sticky xl:top-20">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-white truncate">{SOURCE_LABEL[selected.source] || selected.source}</span>
              <button onClick={() => setSelected(null)} className="text-slate-400 text-xs">
                ✕
              </button>
            </div>
            <div className="text-center">
              <RegionEditor
                item={selected}
                drawing={drawing}
                regions={regions}
                onRegions={setRegions}
                videoRef={videoRef}
              />
            </div>
            <p className="text-[10px] text-slate-500">
              {fmtTime(selected.created)} · {fmtSize(selected.size)}
              {selected.parent && ` · từ ${selected.parent}`}
            </p>
            {selected.prompt && (
              <p className="text-[10px] text-slate-400 max-h-20 overflow-y-auto whitespace-pre-wrap">{selected.prompt}</p>
            )}
            <div className="flex gap-2">
              <input
                className={`${inputCls} flex-1`}
                placeholder="Ghi chú (để tìm lại)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onBlur={() =>
                  note !== selected.note && patchLibraryItem(selected.name, { note }).then(load).catch(() => undefined)
                }
              />
              <button
                onClick={() => patchLibraryItem(selected.name, { favorite: !selected.favorite }).then(load)}
                className={`${btn} ${selected.favorite ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-200'}`}
              >
                ★
              </button>
              <button
                onClick={() => downloadFile(selected.url, selected.name).catch((e) => alert(e.message))}
                className={`${btn} bg-slate-800 text-slate-200`}
              >
                ⬇
              </button>
              <button
                onClick={() =>
                  confirm('Xóa file này khỏi thư viện (không khôi phục được)?') &&
                  run('delete', async () => {
                    await deleteLibraryItem(selected.name);
                    setSelected(null);
                    await load();
                  })
                }
                className={`${btn} bg-red-600/80 text-white`}
              >
                🗑
              </button>
            </div>

            {/* Dùng lại */}
            <section className="border-t border-slate-800 pt-3 space-y-2">
              <h4 className="text-[11px] font-bold text-slate-200">
                ♻️ Dùng lại {selected.kind === 'video' && <span className="font-normal text-slate-500">(lấy khung đang xem)</span>}
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ['character', '👤 Ảnh nhân vật'],
                    ['outfit', '👗 Trang phục'],
                    ['product', '🛍 Sản phẩm'],
                  ] as const
                ).map(([role, label]) => (
                  <button
                    key={role}
                    disabled={!!busy}
                    onClick={() =>
                      run('use', async () => {
                        sendToStudio({ type: 'reference', role, dataUrl: await imageDataUrl(selected), name: selected.name });
                        flash(`Đã đặt làm ${label} ở tab Tạo video`);
                      })
                    }
                    className={`${btn} bg-indigo-600/80 text-white`}
                  >
                    {label}
                  </button>
                ))}
                <button
                  disabled={!!busy}
                  onClick={() =>
                    run('use', async () => {
                      sendToStudio({ type: 'pool', dataUrl: await imageDataUrl(selected), name: selected.name });
                      flash('Đã thêm vào kho ảnh ghép (khối 2b)');
                    })
                  }
                  className={`${btn} bg-indigo-600/80 text-white`}
                >
                  🧩 Kho ảnh 2b
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-slate-400">Khung đầu cho cảnh</span>
                <input
                  type="number"
                  min={1}
                  value={sceneNo}
                  onChange={(e) => setSceneNo(Math.max(1, Number(e.target.value) || 1))}
                  className={`${inputCls} w-16`}
                />
                <button
                  disabled={!!busy}
                  onClick={() =>
                    run('use', async () => {
                      const dataUrl =
                        selected.kind === 'image'
                          ? await urlToResizedDataUrl(selected.url)
                          : await urlToResizedDataUrl((await cutFrame(selected.name)).url);
                      sendToStudio({ type: 'startFrame', sceneIndex: sceneNo, dataUrl, name: selected.name });
                      flash(`Cảnh ${sceneNo} sẽ bắt đầu từ ${selected.kind === 'video' ? 'khung cuối của clip này' : 'ảnh này'}`);
                    })
                  }
                  className={`${btn} bg-emerald-600/80 text-white`}
                >
                  🎞 {selected.kind === 'video' ? 'Khung cuối → khung đầu' : 'Đặt khung đầu'}
                </button>
              </div>
              {library.characters.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <select className={inputCls} value={charId} onChange={(e) => setCharId(e.target.value)}>
                    <option value="">-- Nhân vật --</option>
                    {library.characters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name || '(chưa đặt tên)'}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={!charId || !!busy}
                    onClick={() =>
                      run('use', async () => {
                        const dataUrl = await imageDataUrl(selected);
                        library.setCharacters((prev) =>
                          prev.map((c) => (c.id === charId ? { ...c, images: [...c.images, dataUrl] } : c))
                        );
                        flash('Đã thêm vào ảnh khóa mặt của nhân vật');
                      })
                    }
                    className={`${btn} bg-slate-700 text-white`}
                  >
                    + Ảnh khóa mặt
                  </button>
                </div>
              )}
            </section>

            {/* Hậu kỳ */}
            <section className="border-t border-slate-800 pt-3 space-y-2">
              <h4 className="text-[11px] font-bold text-slate-200">🛠 Hậu kỳ (FFmpeg, tạo file mới)</h4>
              {selected.kind === 'video' && (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    disabled={!!busy}
                    onClick={() =>
                      run('frame', async () => {
                        const t = videoRef.current?.currentTime ?? 0;
                        const r = await cutFrame(selected.name, t);
                        await showResult(r.name);
                        flash(`Đã cắt khung tại ${t.toFixed(2)}s`);
                      })
                    }
                    className={`${btn} bg-slate-700 text-white`}
                  >
                    ✂️ Cắt khung đang xem
                  </button>
                  <button
                    disabled={!!busy}
                    onClick={() =>
                      run('frame', async () => {
                        const r = await cutFrame(selected.name);
                        await showResult(r.name);
                        flash('Đã cắt khung cuối');
                      })
                    }
                    className={`${btn} bg-slate-700 text-white`}
                  >
                    ✂️ Cắt khung cuối
                  </button>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                <select className={inputCls} value={upSide} onChange={(e) => setUpSide(Number(e.target.value))}>
                  {[720, 1080, 1440, 2160].map((n) => (
                    <option key={n} value={n}>
                      Cạnh ngắn {n}px{n === 1080 ? ' (Full HD)' : n === 2160 ? ' (4K)' : ''}
                    </option>
                  ))}
                </select>
                <button
                  disabled={!!busy}
                  onClick={() =>
                    run('upscale', async () => {
                      const r = await upscaleMedia(selected.name, upSide);
                      await showResult(r.name);
                      flash('Đã nâng độ phân giải');
                    })
                  }
                  className={`${btn} bg-slate-700 text-white`}
                >
                  {busy === 'upscale' ? '⏳ Đang xử lý...' : '⬆️ Nâng độ phân giải'}
                </button>
              </div>
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={() => {
                      setDrawing((v) => !v);
                      videoRef.current?.pause();
                    }}
                    className={`${btn} ${drawing ? 'bg-fuchsia-600 text-white' : 'bg-slate-700 text-white'}`}
                  >
                    {drawing ? '✔ Xong chọn vùng' : '▭ Chọn vùng logo / watermark'}
                  </button>
                  <select
                    className={inputCls}
                    value={blurMode}
                    onChange={(e) => setBlurMode(e.target.value as 'blur' | 'pixelate')}
                  >
                    <option value="blur">Làm mờ</option>
                    <option value="pixelate">Làm vỡ hạt</option>
                  </select>
                  <input
                    type="range"
                    min={4}
                    max={60}
                    value={strength}
                    onChange={(e) => setStrength(Number(e.target.value))}
                    title={`Độ mạnh ${strength}`}
                  />
                </div>
                <p className="text-[10px] text-slate-500">
                  Bấm “Chọn vùng” rồi kéo chuột trên ảnh / video để khoanh vùng (tối đa 8 vùng). Đã chọn {regions.length}{' '}
                  vùng.
                </p>
                <button
                  disabled={!regions.length || !!busy}
                  onClick={() =>
                    run('blur', async () => {
                      const r = await blurRegions(selected.name, regions, blurMode, strength);
                      await showResult(r.name);
                      flash('Đã làm mờ vùng chọn');
                    })
                  }
                  className={`${btn} bg-fuchsia-600 text-white`}
                >
                  {busy === 'blur' ? '⏳ Đang xử lý...' : `🫥 Làm mờ ${regions.length} vùng`}
                </button>
              </div>
            </section>
            {busy && <p className="text-[11px] text-indigo-300">⏳ Đang xử lý...</p>}
          </aside>
        )}
      </div>
    </div>
  );
};
