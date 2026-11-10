// Lưới card mẫu Workflow (màn "Mẫu & danh sách dòng"): mỗi mẫu 1 card có thumbnail 9:16 lấy từ video đã tạo,
// rê chuột vào thì phát đoạn xem trước. Nguồn thumbnail, theo thứ tự ưu tiên:
//  1. Clip mới nhất bạn đã chạy bằng mẫu đó trong MuseStudio (clip ghép / sau hậu kỳ / cảnh đầu)
//  2. Video chạy thử sẵn của 13 mẫu HND (public/workflow-thumbs/hnd-<id>.jpg + .mp4)
//  3. Không có video: ô màu với biểu tượng mẫu
import React, { useMemo, useRef } from 'react';
import type { WorkflowRow, WorkflowTemplate } from '../types/workflow';
import type { CatalogState } from '../services/templateCatalog';

const BASE = import.meta.env.BASE_URL || './';

interface Thumb {
  img?: string;
  video?: string;
  /** Video lấy từ lượt chạy của bạn */
  own?: boolean;
}

const latestOwnVideo = (rows: WorkflowRow[], id: string): string | undefined => {
  const mine = rows
    .filter((r) => r.template?.id === id)
    .map((r) => ({ at: r.stamp || '', url: r.final?.url || r.merged?.url || r.scenes?.find((s) => s.videoUrl)?.videoUrl }))
    .filter((x): x is { at: string; url: string } => !!x.url)
    .sort((a, b) => b.at.localeCompare(a.at));
  return mine[0]?.url;
};

const thumbOf = (t: WorkflowTemplate, rows: WorkflowRow[]): Thumb => {
  const own = latestOwnVideo(rows, t.id);
  if (own) return { video: own, own: true };
  // Mẫu từ fastaivn.com: thumbnail / video xem trước do trang quản trị tải lên
  if (t.remote && (t.remote.thumbnailUrl || t.remote.previewUrl)) return { img: t.remote.thumbnailUrl, video: t.remote.previewUrl };
  if (t.preview) return { img: t.preview.img && `${BASE}${t.preview.img}`, video: t.preview.video && `${BASE}${t.preview.video}` };
  if (t.hnd?.templateId) return { img: `${BASE}workflow-thumbs/hnd-${t.hnd.templateId}.jpg`, video: `${BASE}workflow-thumbs/hnd-${t.hnd.templateId}.mp4` };
  return {};
};

/** Màu nền ô không có video, theo nhóm mẫu */
const GRAD = [
  'from-indigo-700 to-fuchsia-700',
  'from-emerald-700 to-teal-700',
  'from-amber-600 to-rose-700',
  'from-sky-700 to-indigo-700',
  'from-pink-600 to-purple-700',
];
const gradOf = (s: string) => GRAD[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % GRAD.length];

const TemplateCard: React.FC<{
  t: WorkflowTemplate;
  thumb: Thumb;
  group: string;
  selected: boolean;
  onSelect: () => void;
  onOpenNodes: () => void;
}> = ({ t, thumb, group, selected, onSelect, onOpenNodes }) => {
  const vref = useRef<HTMLVideoElement>(null);
  const play = () => {
    const v = vref.current;
    if (!v) return;
    v.currentTime = 0;
    v.play().catch(() => undefined);
  };
  const stop = () => {
    const v = vref.current;
    if (!v) return;
    v.pause();
    if (thumb.img) v.currentTime = 0;
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect()}
      onMouseEnter={play}
      onMouseLeave={stop}
      className={`group rounded-xl overflow-hidden border text-left cursor-pointer transition bg-slate-950 ${
        selected ? 'border-indigo-400 ring-2 ring-indigo-500/60' : 'border-slate-800 hover:border-slate-500'
      }`}
    >
      {/* Thumbnail 9:16 */}
      <div className={`relative aspect-[9/16] bg-gradient-to-br ${thumb.img || thumb.video ? 'from-slate-900 to-slate-950' : gradOf(group)}`}>
        {thumb.img && <img src={thumb.img} alt={t.name} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />}
        {thumb.video && (
          <video
            ref={vref}
            src={thumb.img ? thumb.video : `${thumb.video}#t=2`}
            muted
            loop
            playsInline
            preload={thumb.img ? 'none' : 'metadata'}
            className={`absolute inset-0 w-full h-full object-cover ${thumb.img ? 'opacity-0 group-hover:opacity-100 transition-opacity' : ''}`}
          />
        )}
        {!thumb.img && !thumb.video && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/90">
            <span className="text-5xl drop-shadow">{t.icon}</span>
            <span className="text-[10px] px-2 text-center text-white/70">Chưa có video mẫu — chạy thử để có thumbnail</span>
          </div>
        )}
        <span className="absolute top-1.5 left-1.5 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-black/60 text-emerald-300 backdrop-blur">{group}</span>
        <span className="absolute top-1.5 right-1.5 flex gap-1">
          {t.remote && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-600/90 text-white" title={`Mẫu dùng chung từ fastaivn.com · phiên bản ${t.remote.version}`}>
              🌐 fastaivn
            </span>
          )}
          {t.remote?.isPremium && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-yellow-500 text-slate-950">PRO</span>}
          {t.hnd && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-orange-600/90 text-white">HND</span>}
          {!t.builtin && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/90 text-slate-950">Của tôi</span>}
          {thumb.own && <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-600/90 text-white" title="Thumbnail từ clip bạn đã tạo">▶ clip của bạn</span>}
        </span>
        <div className="absolute inset-x-0 bottom-0 p-1.5 bg-gradient-to-t from-black/85 to-transparent">
          <p className="text-[10px] text-white/90">
            {t.icon} {t.sceneCount} cảnh × {t.duration}s · {t.aspectRatio}
            {t.faceless ? ' · không lộ mặt' : ''}
          </p>
        </div>
        {selected && <span className="absolute inset-0 ring-2 ring-inset ring-indigo-400 pointer-events-none" />}
      </div>
      {/* Thông tin */}
      <div className="p-2 space-y-1">
        <p className="text-[11px] font-semibold text-slate-100 leading-snug line-clamp-2 min-h-[2.4em]">{t.name}</p>
        <p className="text-[10px] text-slate-400 leading-snug line-clamp-2 min-h-[2.4em]">{t.description}</p>
        <div className="flex gap-1 pt-0.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
            }}
            className={`flex-1 text-[10px] px-1.5 py-1 rounded-lg font-semibold ${selected ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`}
          >
            {selected ? '✓ Đang dùng' : 'Dùng mẫu'}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenNodes();
            }}
            title="Mở mẫu trong Sơ đồ khối để chỉnh từng node"
            className="text-[10px] px-1.5 py-1 rounded-lg bg-emerald-700/80 text-white hover:bg-emerald-600"
          >
            🧩 Sơ đồ
          </button>
          {(t.hnd?.videoUrl || t.remote?.trendUrl) && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                window.open(t.remote?.trendUrl || t.hnd!.videoUrl, '_blank', 'noopener');
              }}
              title="Video trend tham khảo"
              className="text-[10px] px-1.5 py-1 rounded-lg bg-slate-800 text-sky-300 hover:bg-slate-700"
            >
              ↗
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export const WorkflowTemplateGallery: React.FC<{
  templates: WorkflowTemplate[];
  rows: WorkflowRow[];
  groupOf: (t: WorkflowTemplate) => string;
  filter: string;
  setFilter: (v: string) => void;
  search: string;
  setSearch: (v: string) => void;
  cols: 4 | 6;
  setCols: (v: 4 | 6) => void;
  selectedId: string;
  onSelect: (id: string) => void;
  onOpenNodes: (t: WorkflowTemplate) => void;
  /** Trạng thái catalog mẫu dùng chung (fastaivn.com) */
  catalog?: CatalogState | null;
  catalogCount?: number;
  catalogNeedUpdate?: number;
  catalogBusy?: boolean;
  onRefreshCatalog?: () => void;
}> = ({
  templates,
  rows,
  groupOf,
  filter,
  setFilter,
  search,
  setSearch,
  cols,
  setCols,
  selectedId,
  onSelect,
  onOpenNodes,
  catalog,
  catalogCount = 0,
  catalogNeedUpdate = 0,
  catalogBusy,
  onRefreshCatalog,
}) => {
  const groups = useMemo(() => [...new Set(templates.map(groupOf))], [templates, groupOf]);
  const shown = templates.filter(
    (t) =>
      (filter === 'all' || groupOf(t) === filter) &&
      (!search.trim() || `${t.name} ${t.description}`.toLowerCase().includes(search.trim().toLowerCase()))
  );
  const grid =
    cols === 6
      ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6'
      : 'grid-cols-2 md:grid-cols-3 xl:grid-cols-4';
  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h2 className="text-sm font-bold text-white">1. Chọn mẫu Workflow</h2>
          <p className="text-[11px] text-slate-400">
            Mỗi dòng sản phẩm chạy qua: 🛒 Sản phẩm → ✍️ Kịch bản → 🎬 Render cảnh → 🎞 Ghép. Rê chuột vào card để xem video mẫu.
          </p>
        </div>
        <input
          className="bg-slate-950 border border-white/10 text-[11px] text-slate-200 rounded-lg p-1.5 w-56 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          placeholder="🔎 Tìm mẫu…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex bg-slate-950 border border-slate-800 rounded-lg p-0.5" title="Số card mỗi dòng">
          {([4, 6] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCols(c)}
              className={`text-[10px] px-2 py-1 rounded-md font-semibold ${cols === c ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}
            >
              {c} / dòng
            </button>
          ))}
        </div>
      </div>
      {/* Mẫu dùng chung từ fastaivn.com */}
      {onRefreshCatalog && (
        <div className="flex flex-wrap items-center gap-2 text-[10px] rounded-lg border border-sky-800/60 bg-sky-950/30 px-2 py-1.5">
          <span className="text-sky-300 font-semibold">🌐 Mẫu dùng chung fastaivn.com</span>
          <span className="text-slate-400">
            {catalogBusy
              ? 'Đang tải…'
              : catalog?.catalog
                ? `${catalogCount} mẫu · ${catalog.source === 'online' ? 'vừa cập nhật' : 'bản lưu trên máy'}${
                    catalog.catalog.publishedAt ? ` · xuất bản ${new Date(catalog.catalog.publishedAt).toLocaleString('vi-VN')}` : ''
                  }`
                : 'Chưa tải được danh sách mẫu'}
            {catalogNeedUpdate > 0 && <span className="text-amber-300"> · {catalogNeedUpdate} mẫu cần bản app mới hơn</span>}
          </span>
          {catalog?.error && (
            <span className="text-amber-300 truncate max-w-[420px]" title={`${catalog.url}\n${catalog.error}`}>
              ⚠ {catalog.catalog ? 'Không kết nối được, đang dùng bản lưu' : 'Lỗi'}: {catalog.error}
            </span>
          )}
          <button
            disabled={catalogBusy}
            onClick={onRefreshCatalog}
            className="ml-auto px-2 py-0.5 rounded-md bg-sky-700 text-white font-semibold disabled:opacity-50"
          >
            🔄 Cập nhật mẫu
          </button>
        </div>
      )}
      {/* Lọc theo loại như tab Mẫu Workflow của HND */}
      <div className="flex flex-wrap gap-1">
        {['all', ...groups].map((g) => (
          <button
            key={g}
            onClick={() => setFilter(g)}
            className={`text-[10px] px-2 py-1 rounded-lg border ${
              filter === g ? 'bg-emerald-600 border-emerald-500 text-white' : 'border-slate-700 text-slate-300 hover:border-slate-500'
            }`}
          >
            {g === 'all' ? `Tất cả (${templates.length})` : `${g} (${templates.filter((t) => groupOf(t) === g).length})`}
          </button>
        ))}
      </div>
      {shown.length ? (
        <div className={`grid ${grid} gap-3`}>
          {shown.map((t) => (
            <TemplateCard
              key={t.id}
              t={t}
              thumb={thumbOf(t, rows)}
              group={groupOf(t)}
              selected={t.id === selectedId}
              onSelect={() => onSelect(t.id)}
              onOpenNodes={() => onOpenNodes(t)}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-500 py-6 text-center">Không có mẫu nào khớp bộ lọc.</p>
      )}
    </section>
  );
};
