// Thumbnail + video xem trước của mẫu Workflow khai báo trong wfthumb/wfthumb.config.json (cạnh dữ liệu app).
// Người dùng chỉ sửa file config (vd. dán link YouTube sau khi tải clip lên) — app đọc lại mỗi lần mở màn Workflow.
import { GATEWAY_URL } from '../config/appConfig';

export interface WfThumbEntry {
  templateId: string;
  name?: string;
  /** Tên file trong wfthumb hoặc link http(s) */
  image?: string;
  video?: string;
  flow?: string;
  /** Link YouTube (youtu.be / shorts / watch?v=) */
  youtube?: string;
  youtubeThumbnail?: string;
}

export interface WfThumb {
  img?: string;
  video?: string;
  /** Link mở trên YouTube */
  youtube?: string;
  /** Link nhúng (iframe) để phát khi không có file video */
  youtubeEmbed?: string;
}

const isUrl = (s: string) => /^https?:\/\//i.test(s) || s.startsWith('data:');

/** Mã video YouTube từ link youtu.be/<id>, /shorts/<id>, /embed/<id>, watch?v=<id> */
export const youtubeId = (url = ''): string | undefined =>
  /(?:youtu\.be\/|\/shorts\/|\/embed\/|[?&]v=)([\w-]{11})/.exec(url)?.[1];

export const loadWfThumbConfig = async (): Promise<Record<string, WfThumb>> => {
  const res = await fetch(`${GATEWAY_URL}/studio/wfthumb/config`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const cfg = (await res.json()) as { base?: string; templates?: WfThumbEntry[] };
  const base = `${GATEWAY_URL}${cfg.base || '/studio/wfthumb/file/'}`;
  const file = (s?: string) => (!s ? undefined : isUrl(s) ? s : base + s.split('/').map(encodeURIComponent).join('/'));
  const out: Record<string, WfThumb> = {};
  (cfg.templates || []).forEach((e) => {
    if (!e?.templateId) return;
    const yt = youtubeId(e.youtube);
    out[e.templateId] = {
      img: file(e.youtubeThumbnail) || file(e.image) || (yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : undefined),
      video: file(e.video),
      youtube: e.youtube || undefined,
      youtubeEmbed: yt ? `https://www.youtube.com/embed/${yt}?autoplay=1&mute=1&loop=1&playlist=${yt}&controls=0&playsinline=1` : undefined,
    };
  });
  return out;
};
