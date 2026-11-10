// Mẫu Workflow dùng chung, quản trị trên fastaivn.com (Firebase) — "Giải pháp 2: catalog tĩnh".
// Trang quản trị bấm "Xuất bản" → file catalog.v1.json (+ thumbnail, video xem trước, sơ đồ) trên Firebase Hosting.
// App đọc qua Gateway (/studio/catalog): có bản đệm đĩa khi mất mạng, ETag, không cần Firebase SDK.
// Định dạng: taiLieu/FASTAIVN_CATALOG.md
import { GATEWAY_URL, MUSE_API_KEY } from '../config/appConfig';
import type { AspectRatio, ShotDuration } from '../types/videoStudio';
import type { WorkflowTemplate } from '../types/workflow';
import type { ScriptMode } from './productService';
import pkg from '../../package.json';

export const APP_VERSION: string = (pkg as { version?: string }).version || '0.0.0';

/** 1 mẫu trong catalog.v1.json */
export interface CatalogEntry {
  /** Mã ổn định a-z0-9-, không đổi giữa các phiên bản */
  id: string;
  version: number;
  title: string;
  description?: string;
  /** Nhóm lọc (Thời trang, Mỹ phẩm, Gia đình...) */
  category?: string;
  icon?: string;
  tags?: string[];
  sortOrder?: number;
  isPremium?: boolean;
  /** Bản app tối thiểu để dùng mẫu (vd. "0.3.0") */
  minAppVersion?: string;
  thumbnailUrl?: string;
  previewUrl?: string;
  /** Video trend tham khảo (TikTok / YouTube) */
  trendUrl?: string;
  /** Sơ đồ flow-workflow (Sơ đồ khối) */
  graphUrl?: string;
  /** Cấu hình cho màn "Mẫu & danh sách dòng" (tùy chọn) */
  listTemplate?: Partial<
    Pick<
      WorkflowTemplate,
      'scriptMode' | 'scriptTemplateId' | 'extraNote' | 'sceneCount' | 'duration' | 'aspectRatio' | 'withDialogue' | 'faceless' | 'rotateProductImages' | 'chainEndFrame' | 'cameraMotion' | 'outfit' | 'setting'
    >
  >;
}

export interface Catalog {
  catalogVersion: 1;
  publishedAt?: string;
  publishedBy?: string;
  templates: CatalogEntry[];
}

export interface CatalogState {
  catalog: Catalog | null;
  /** online = vừa tải; cache = bản đệm (mất mạng hoặc còn mới); none = chưa có */
  source: 'online' | 'cache' | 'none';
  url: string;
  fetchedAt?: number;
  error?: string;
}

const call = async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${MUSE_API_KEY}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const res = await fetch(`${GATEWAY_URL}${path}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      msg = JSON.parse(text).error?.message || msg;
    } catch {
      /* giữ chữ */
    }
    if (res.status === 404 && path.startsWith('/studio')) msg = 'Gateway chưa có API catalog — khởi động lại gateway_server.py.';
    throw new Error(msg);
  }
  return JSON.parse(text) as T;
};

export const loadCatalog = (refresh = false) => call<CatalogState>(`/studio/catalog${refresh ? '?refresh=1' : ''}`);
export const getCatalogConfig = () => call<{ url: string; default: string }>('/studio/catalog/config');
export const setCatalogUrl = (url: string) => call<{ url: string; default: string }>('/studio/catalog/config', { method: 'PUT', body: JSON.stringify({ url }) });
export const loadRemoteGraph = (url: string) =>
  call<{ graph: unknown; source: string }>(`/studio/catalog/graph?url=${encodeURIComponent(url)}`).then((r) => r.graph);

/** So sánh phiên bản "1.2.3" */
export const versionAtLeast = (have: string, need?: string) => {
  if (!need) return true;
  const a = have.split('.').map((x) => parseInt(x, 10) || 0);
  const b = need.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return true;
};

/** Mẫu catalog → WorkflowTemplate để hiện trong lưới card và chạy ở "Mẫu & danh sách dòng". */
export const entryToTemplate = (e: CatalogEntry): WorkflowTemplate => {
  const lt = e.listTemplate || {};
  return {
    id: `remote-${e.id}`,
    name: e.title,
    icon: e.icon || '🌐',
    category: e.category || 'Khác',
    description: e.description || '',
    builtin: true,
    scriptMode: (lt.scriptMode as ScriptMode) || 'short_film',
    scriptTemplateId: lt.scriptTemplateId,
    extraNote: lt.extraNote || e.description || '',
    sceneCount: lt.sceneCount || 4,
    duration: (lt.duration || 10) as ShotDuration,
    aspectRatio: (lt.aspectRatio || '9:16') as AspectRatio,
    withDialogue: lt.withDialogue !== false,
    faceless: !!lt.faceless,
    rotateProductImages: !!lt.rotateProductImages,
    chainEndFrame: !!lt.chainEndFrame,
    cameraMotion: lt.cameraMotion || '',
    autoMerge: true,
    outfit: lt.outfit,
    setting: lt.setting,
    refMode: 'reference',
    realismLock: true,
    remote: {
      id: e.id,
      version: e.version,
      thumbnailUrl: e.thumbnailUrl,
      previewUrl: e.previewUrl,
      graphUrl: e.graphUrl,
      trendUrl: e.trendUrl,
      isPremium: e.isPremium,
    },
  };
};

/** Các mẫu catalog dùng được với bản app này (bỏ mẫu cần app mới hơn). */
export const catalogTemplates = (c: Catalog | null): { templates: WorkflowTemplate[]; needUpdate: number } => {
  if (!c) return { templates: [], needUpdate: 0 };
  const ok = c.templates.filter((e) => versionAtLeast(APP_VERSION, e.minAppVersion));
  return { templates: ok.map(entryToTemplate), needUpdate: c.templates.length - ok.length };
};
