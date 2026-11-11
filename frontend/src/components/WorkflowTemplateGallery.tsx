// Lưới card mẫu Workflow (màn "Mẫu & danh sách dòng"): mỗi mẫu 1 card có thumbnail 9:16 lấy từ video đã tạo,
// rê chuột vào thì phát đoạn xem trước. Nguồn thumbnail, theo thứ tự ưu tiên:
//  1. wfthumb/wfthumb.config.json (thumbnail + clip chạy thử đạt chuẩn của từng mẫu, link YouTube khi đã tải lên)
//  2. Clip mới nhất bạn đã chạy bằng mẫu đó trong MuseStudio (clip ghép / sau hậu kỳ / cảnh đầu)
//  3. Video chạy thử sẵn của 13 mẫu HND (public/workflow-thumbs/hnd-<id>.jpg + .mp4)
//  4. Không có video: ô màu với biểu tượng mẫu
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkflowRow, WorkflowTemplate } from '../types/workflow';
import type { CatalogState } from '../services/templateCatalog';
import { WfThumb, loadWfThumbConfig, youtubeId } from '../services/wfthumbConfig';

/** Số card mỗi dòng (10 / 12: lưới dày, card gọn) */
export type GalleryCols = 6 | 8 | 10 | 12;

/**
 * Gộp loại mẫu (category) thành 3 nhóm lớn trên thanh lọc. Loại không có trong bảng (mẫu tự lưu, catalog) giữ nguyên tên.
 */
const GROUPS: [string, string[]][] = [
  ['Review sản phẩm', ['bán hàng', 'review pov (fastaivn)', 'review pov', 'không lộ mặt', 'ăn uống', 'gia dụng', 'gia dụng bếp', 'đồ chơi', 'sức khỏe', 'sức khoẻ']],
  ['Thời trang & Mỹ phẩm', ['thời trang', 'mỹ phẩm', 'thời trang nam', 'thiết kế']],
  ['Làm phim', ['câu chuyện', 'gia đình']],
];
export const templateGroup = (category?: string): string => {
  const c = (category || 'Khác').replace(/^HND\s*·\s*/, '').trim();
  const k = c.toLowerCase();
  return GROUPS.find(([, list]) => list.includes(k))?.[0] || c;
};

const BASE = import.meta.env.BASE_URL || './';

interface Thumb {
  img?: string;
  video?: string;
  /** Video lấy từ lượt chạy của bạn */
  own?: boolean;
  /** Link YouTube (wfthumb config) */
  youtube?: string;
  /** Nhúng YouTube khi không có file video */
  youtubeEmbed?: string;
  /** Clip đầy đủ có tiếng (nút ▶ phóng to) */
  full?: string;
}

const latestOwnVideo = (rows: WorkflowRow[], id: string): string | undefined => {
  const mine = rows
    .filter((r) => r.template?.id === id)
    .map((r) => ({ at: r.stamp || '', url: r.final?.url || r.merged?.url || r.scenes?.find((s) => s.videoUrl)?.videoUrl }))
    .filter((x): x is { at: string; url: string } => !!x.url)
    .sort((a, b) => b.at.localeCompare(a.at));
  return mine[0]?.url;
};

const thumbOf = (t: WorkflowTemplate, rows: WorkflowRow[], wf?: WfThumb): Thumb => {
  // Thumbnail khai báo trong wfthumb/wfthumb.config.json (chỉ sửa file config, không build lại app)
  if (wf && (wf.img || wf.video || wf.youtubeEmbed))
    return { img: wf.img, video: wf.video, full: wf.full, youtube: wf.youtube, youtubeEmbed: wf.video ? undefined : wf.youtubeEmbed };
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
  /** Lưới dày (10 / 12 mỗi dòng): ẩn mô tả, nút gọn */
  compact?: boolean;
  /** Bấm ▶: phóng to phát clip có tiếng */
  onPlay?: () => void;
}> = ({ t, thumb, group, selected, onSelect, onOpenNodes, compact, onPlay }) => {
  const vref = useRef<HTMLVideoElement>(null);
  const [hover, setHover] = useState(false);
  const play = () => {
    setHover(true);
    const v = vref.current;
    if (!v) return;
    v.currentTime = 0;
    v.play().catch(() => undefined);
  };
  const stop = () => {
    setHover(false);
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
        {/* Chỉ có link YouTube (không có file video): rê chuột phát bản nhúng */}
        {!thumb.video && thumb.youtubeEmbed && hover && (
          <iframe
            src={thumb.youtubeEmbed}
            title={t.name}
            allow="autoplay; encrypted-media"
            className="absolute inset-0 w-full h-full pointer-events-none"
          />
        )}
        {!thumb.img && !thumb.video && !thumb.youtubeEmbed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/90">
            <span className="text-5xl drop-shadow">{t.icon}</span>
            <span className="text-[10px] px-2 text-center text-white/70">Chưa có video mẫu — chạy thử để có thumbnail</span>
          </div>
        )}
        {!compact && <span className="absolute top-1.5 left-1.5 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-black/60 text-emerald-300 backdrop-blur">{group}</span>}
        <span className={`absolute top-1.5 right-1.5 flex gap-1 ${compact ? 'hidden' : ''}`}>
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
        <div className={`absolute inset-x-0 bottom-0 p-1.5 bg-gradient-to-t from-black/85 to-transparent ${compact ? 'hidden' : ''}`}>
          <p className="text-[10px] text-white/90">
            {t.icon} {t.sceneCount} cảnh × {t.duration}s · {t.aspectRatio}
            {t.faceless ? ' · không lộ mặt' : ''}
          </p>
        </div>
        {onPlay && (thumb.full || thumb.video || thumb.youtube) && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPlay();
            }}
            title="Phóng to, phát clip mẫu có âm thanh"
            className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/55 hover:bg-indigo-600 text-white flex items-center justify-center backdrop-blur border border-white/30 shadow-lg transition ${
              compact ? 'w-8 h-8 text-xs' : 'w-12 h-12 text-lg'
            }`}
          >
            ▶
          </button>
        )}
        {selected && <span className="absolute inset-0 ring-2 ring-inset ring-indigo-400 pointer-events-none" />}
      </div>
      {/* Thông tin */}
      <div className={compact ? 'p-1 space-y-0.5' : 'p-2 space-y-1'}>
        <p className={`${compact ? 'text-[9px]' : 'text-[11px]'} font-semibold text-slate-100 leading-snug line-clamp-2 min-h-[2.4em]`} title={t.name}>
          {t.name}
        </p>
        {!compact && <p className="text-[10px] text-slate-400 leading-snug line-clamp-2 min-h-[2.4em]">{t.description}</p>}
        <div className={`flex gap-1 pt-0.5 ${compact ? 'flex-wrap' : ''}`}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
            }}
            className={`flex-1 text-[10px] px-1.5 py-1 rounded-lg font-semibold ${selected ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`}
          >
            {compact ? (selected ? '✓' : 'Dùng') : selected ? '✓ Đang dùng' : 'Dùng mẫu'}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenNodes();
            }}
            title="Mở mẫu trong Sơ đồ khối để chỉnh từng node"
            className="text-[10px] px-1.5 py-1 rounded-lg bg-emerald-700/80 text-white hover:bg-emerald-600"
          >
            {compact ? '🧩' : '🧩 Sơ đồ'}
          </button>
          {thumb.youtube && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                window.open(thumb.youtube, '_blank', 'noopener');
              }}
              title="Xem clip mẫu trên YouTube"
              className="text-[10px] px-1.5 py-1 rounded-lg bg-red-700/90 text-white hover:bg-red-600"
            >
              {compact ? 'YT' : '▶ YouTube'}
            </button>
          )}
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

/** Khung phóng to phát clip mẫu có âm thanh (bấm nền / ✕ / Esc để đóng) */
const PlayerModal: React.FC<{ t: WorkflowTemplate; thumb: Thumb; onClose: () => void }> = ({ t, thumb, onClose }) => {
  const yt = youtubeId(thumb.youtube);
  const src = thumb.full || thumb.video;
  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4" onClick={onClose}>
      <div className="relative flex flex-col items-center gap-2 max-h-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 w-full">
          <p className="flex-1 text-sm font-semibold text-white truncate">
            {t.icon} {t.name}
          </p>
          {thumb.youtube && (
            <a href={thumb.youtube} target="_blank" rel="noopener noreferrer" className="text-[11px] px-2 py-1 rounded-lg bg-red-700 text-white">
              ▶ Mở trên YouTube
            </a>
          )}
          <button onClick={onClose} className="text-slate-300 hover:text-white text-lg px-2" title="Đóng (Esc)">
            ✕
          </button>
        </div>
        {yt ? (
          <iframe
            src={`https://www.youtube.com/embed/${yt}?autoplay=1&playsinline=1&rel=0`}
            title={t.name}
            allow="autoplay; encrypted-media; fullscreen"
            allowFullScreen
            className="h-[82vh] aspect-[9/16] max-w-[92vw] rounded-xl bg-black"
          />
        ) : src ? (
          <video src={src} poster={thumb.img} autoPlay controls playsInline className="h-[82vh] max-w-[92vw] rounded-xl bg-black object-contain" />
        ) : (
          <p className="text-slate-400 text-sm">Mẫu này chưa có clip.</p>
        )}
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
  cols: GalleryCols;
  setCols: (v: GalleryCols) => void;
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
  // wfthumb/wfthumb.config.json — đọc lại mỗi lần mở màn (sửa file config là thấy ngay)
  const [wfThumbs, setWfThumbs] = useState<Record<string, WfThumb>>({});
  useEffect(() => {
    loadWfThumbConfig()
      .then(setWfThumbs)
      .catch(() => undefined); // Gateway cũ chưa có API / chưa có config: dùng nguồn thumbnail cũ
  }, []);
  const shown = templates.filter(
    (t) =>
      (filter === 'all' || groupOf(t) === filter) &&
      (!search.trim() || `${t.name} ${t.description}`.toLowerCase().includes(search.trim().toLowerCase()))
  );
  const grid =
    cols === 8
      ? 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8'
      : cols === 12
      ? 'grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12'
      : cols === 10
        ? 'grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 xl:grid-cols-10'
        : cols === 6
          ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6'
          : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6';
  const compact = cols >= 10;
  // Nút ▶ trên card: phóng to phát clip có âm thanh (YouTube nếu đã điền link → clip đầy đủ → video xem trước)
  const [playing, setPlaying] = useState<{ t: WorkflowTemplate; thumb: Thumb } | null>(null);
  useEffect(() => {
    if (!playing) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setPlaying(null);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [playing]);
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
          {([6, 8, 10, 12] as const).map((c) => (
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
      {playing && <PlayerModal t={playing.t} thumb={playing.thumb} onClose={() => setPlaying(null)} />}
      {shown.length ? (
        <div className={`grid ${grid} ${compact ? 'gap-2' : 'gap-3'}`}>
          {shown.map((t) => (
            <TemplateCard
              key={t.id}
              t={t}
              thumb={thumbOf(t, rows, wfThumbs[t.id])}
              group={groupOf(t)}
              selected={t.id === selectedId}
              onSelect={() => onSelect(t.id)}
              onOpenNodes={() => onOpenNodes(t)}
              compact={compact}
              onPlay={() => setPlaying({ t, thumb: thumbOf(t, rows, wfThumbs[t.id]) })}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-500 py-6 text-center">Không có mẫu nào khớp bộ lọc.</p>
      )}
    </section>
  );
};
