// Thư viện media, hậu kỳ (FFmpeg) và AI tạo chân dung — gọi API /studio của studio_library.py.
import { GATEWAY_URL, MUSE_API_KEY } from '../config/appConfig';

export interface LibraryItem {
  name: string;
  url: string;
  kind: 'image' | 'video';
  size: number;
  created: number;
  /** video / image / frame / upscale / blur / portrait */
  source: string;
  prompt: string;
  note: string;
  favorite: boolean;
  parent?: string | null;
  voice?: string | null;
}

export const SOURCE_LABEL: Record<string, string> = {
  video: '🎬 Video AI',
  image: '🖼 Ảnh',
  frame: '✂️ Khung cắt',
  upscale: '⬆️ Nâng độ phân giải',
  blur: '🫥 Đã làm mờ',
  portrait: '🎨 Chân dung AI',
};

const call = async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${MUSE_API_KEY}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const res = await fetch(`${GATEWAY_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = text || res.statusText;
    try {
      msg = JSON.parse(text).error?.message || msg;
    } catch {
      /* giữ nguyên */
    }
    if (res.status === 404 && /^\/studio\/(library|post|portrait)/.test(path) && /Not Found/i.test(msg)) {
      msg = 'Gateway chưa có API này — hãy khởi động lại gateway_server.py (run_dev.bat).';
    }
    throw new Error(msg);
  }
  return res.json();
};

const post = <T,>(path: string, body: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const listLibrary = (opts: { kind?: string; q?: string; favorite?: boolean } = {}) => {
  const p = new URLSearchParams();
  if (opts.kind) p.set('kind', opts.kind);
  if (opts.q) p.set('q', opts.q);
  if (opts.favorite) p.set('favorite', 'true');
  return call<{ data: LibraryItem[]; total: number }>(`/studio/library?${p}`);
};

export const patchLibraryItem = (name: string, patch: { favorite?: boolean; note?: string }) =>
  call(`/studio/library/${encodeURIComponent(name)}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteLibraryItem = (name: string) =>
  call(`/studio/library/${encodeURIComponent(name)}`, { method: 'DELETE' });

export interface PostResult {
  name: string;
  url: string;
  kind: 'image' | 'video';
}

/** Cắt 1 khung hình của video thành ảnh; `time` = giây, bỏ trống = khung cuối. */
export const cutFrame = (media: string, time?: number) => post<PostResult>('/studio/post/frame', { media, time });

/** Đưa ảnh data URL lên kho media của Gateway (để hậu kỳ: nâng nét, cắt khung…) */
export const uploadDataUrl = (data: string, source = 'upload') => post<{ url: string; name?: string }>('/studio/media/upload', { data, source });

/** URL media Gateway trả về có thể là đường dẫn tương đối → URL đầy đủ */
export const mediaUrl = (u: string) => (u.startsWith('/') ? `${GATEWAY_URL}${u}` : u);

export const upscaleMedia = (media: string, shortSide: number, sharpen = true) =>
  post<PostResult>('/studio/post/upscale', { media, short_side: shortSide, sharpen });

export interface BlurRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const blurRegions = (media: string, regions: BlurRegion[], mode: 'blur' | 'pixelate', strength: number) =>
  post<PostResult>('/studio/post/blur', { media, regions, mode, strength });

/** AI tạo ảnh chân dung nhân vật (muse-image). `reference` = ảnh mặt có sẵn để giữ đúng người. */
export const generatePortrait = (req: {
  name: string;
  description: string;
  style?: string;
  n?: number;
  size?: string;
  reference?: string;
}) => post<{ data: { name: string; url: string }[]; prompt: string }>('/studio/portrait', req);
