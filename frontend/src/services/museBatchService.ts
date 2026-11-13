// frontend/src/services/museBatchService.ts
// Toàn bộ lời gọi tới Local Gateway (muse2api). Địa chỉ + API key lấy từ config/appConfig.ts.
import { GATEWAY_URL, MUSE_API_KEY } from '../config/appConfig';
import { AspectRatio, ShotDuration } from '../types/videoStudio';

export interface MuseConfig {
  aspectRatio: AspectRatio;
  duration: ShotDuration;
  /** 0 = tự động theo tổng luồng của các tài khoản dùng được */
  concurrency: 0 | 1 | 2 | 4 | 8;
  useTwoStepKeyframe: boolean;
  chainEndFrame: boolean; // Tự động lấy frame cuối cảnh trước làm frame đầu cảnh sau
  cameraMotion: string; // '' = không ép góc máy
  /**
   * Giọng mặc định cho cảnh không gắn nhân vật trong thư viện: id hồ sơ Matrix ("voice_03")
   * hoặc mã giọng gốc Muse ("avocado_v2:..."); '' = giọng mặc định của tài khoản.
   */
  voice: string;
  /** Nhân vật chính (thư viện) — dùng khi prompt của cảnh không nhắc nhân vật nào */
  characterId: string;
  /** Sản phẩm đang dùng (thư viện) */
  productId: string;
  /**
   * Cách ghép ảnh tham chiếu cho từng cảnh:
   *  shared    = mọi cảnh dùng chung bộ ảnh nhân vật / trang phục / sản phẩm
   *  group     = kho ảnh chia nhóm, cảnh 1 dùng nhóm 1, cảnh 2 dùng nhóm 2...
   *  firstLast = kho ảnh theo thứ tự, cảnh i đi từ ảnh i (khung đầu) tới ảnh i+1 (khung cuối)
   *  rotate    = khóa người mẫu, xoay vòng sản phẩm / trang phục trong kho ảnh qua từng cảnh
   */
  refMode: 'shared' | 'group' | 'firstLast' | 'rotate';
  /** Số ảnh mỗi nhóm (chế độ group) */
  groupSize: number;
  /** Vai trò của ảnh được xoay vòng (chế độ rotate) */
  rotateRole: 'product' | 'outfit';
  /** Tên dự án = tên thư mục con trong thư mục xuất file */
  projectName: string;
  /** Tự chép mỗi video xong vào thư mục dự án */
  autoExport: boolean;
  /** Xong cả lô thì tự ghép các cảnh thành 1 video */
  autoMerge: boolean;
  /** Bối cảnh từ thư viện (data/backdropPresets): '' = không ép bối cảnh */
  backdropId: string;
  /** Xoay vòng bối cảnh: mỗi dòng (mỗi clip) 1 bối cảnh khác trong các nhóm đã tích */
  backdropRotate: boolean;
  /** Nhóm bối cảnh tham gia xoay vòng (trống = nhóm của bối cảnh đang chọn / mọi nhóm) */
  backdropGroups: string[];
}

export const DEFAULT_MUSE_CONFIG: MuseConfig = {
  aspectRatio: '9:16',
  duration: 8,
  concurrency: 0,
  useTwoStepKeyframe: false,
  chainEndFrame: false,
  cameraMotion: '',
  voice: '',
  characterId: '',
  productId: '',
  refMode: 'shared',
  groupSize: 2,
  rotateRole: 'product',
  projectName: 'MuseStudio',
  autoExport: true,
  autoMerge: false,
  backdropId: '',
  backdropRotate: false,
  backdropGroups: [],
};

export interface ReferenceImage {
  id: string;
  role: 'character' | 'outfit' | 'product';
  dataUrl: string;
  name: string;
}

export type SceneStatus =
  | 'idle'
  | 'queued'
  | 'generating_keyframe'
  | 'rendering_video'
  | 'completed'
  | 'failed';

export interface BatchSceneItem {
  id: string;
  index: number;
  rawPrompt: string;
  /** Bối cảnh áp cho cảnh này ở lượt chạy gần nhất (thư viện bối cảnh / ảnh riêng) */
  backdropName?: string;
  status: SceneStatus;
  keyframeUrl?: string;
  videoTaskId?: string;
  /** URL media của Gateway (http://127.0.0.1:18610/v1/media/...), còn dùng được sau khi tải lại trang. */
  videoUrl?: string;
  progress?: number;
  error?: string;
  /** Tài khoản muse đang/đã render cảnh này (Gateway báo về) */
  accountId?: string;
  /** Thời điểm bắt đầu / kết thúc cảnh (ms) để hiện thời gian chạy */
  startedAt?: number;
  finishedAt?: number;
  /** File đã chép vào thư mục dự án (không bị Gateway dọn sau 14 ngày) */
  exportedPath?: string;
  /** Các bản tạo trước của cảnh này (mới nhất ở cuối) khi bấm "Tạo lại" */
  history?: { videoUrl: string; exportedPath?: string; at: number }[];
}

/** Video ghép từ các cảnh đã xong */
export interface MergedVideo {
  url: string;
  path: string;
  at: number;
  sceneCount: number;
}

/** Dạng task trả về từ GET /admin/tasks (muse2api services/tasks.py). */
export interface GatewayTask {
  id: string;
  kind: 'video' | 'image' | string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress: number;
  created_at: number;
  updated_at: number;
  request: { model?: string; prompt?: string; size?: string; duration?: number; has_first_frame?: boolean };
  result: { url?: string; mime?: string; width?: number; height?: number } | null;
  error: { message?: string; code?: string } | null;
}

/** Dạng tài khoản trả về từ GET /admin/accounts (cookie đã bị che). */
export interface GatewayAccount {
  id: string;
  label: string;
  enabled: boolean;
  status: 'active' | 'cooling' | 'invalid';
  cookies: Record<string, string>;
  created_at: number;
  last_used_at: number;
  cooldown_until: number;
  last_error: string | null;
  success_count: number;
  fail_count: number;
}

// ---------------------------------------------------------------------------
// Hạ tầng gọi Gateway
// ---------------------------------------------------------------------------

export const gatewayFetch = (path: string, init: RequestInit = {}): Promise<Response> => {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${MUSE_API_KEY}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${GATEWAY_URL}${path}`, { ...init, headers });
};

export const readError = async (res: Response): Promise<string> => {
  const text = await res.text().catch(() => '');
  try {
    const data = JSON.parse(text);
    return data.error?.message || data.detail || text || res.statusText;
  } catch {
    return text || res.statusText;
  }
};

/** Chuẩn hóa URL media: đường dẫn tương đối của Gateway thành URL tuyệt đối. */
const absoluteGatewayUrl = (url: string) => (url.startsWith('/') ? `${GATEWAY_URL}${url}` : url);

// ---------------------------------------------------------------------------
// Tài khoản cookie
// ---------------------------------------------------------------------------

/** Bóc tách chuỗi Cookie thô copy từ F12 Network của muse.ai ("nhãn | cookie" hoặc chỉ cookie). */
export const parseMuseCookieString = (rawLine: string, defaultLabel: string) => {
  let label = defaultLabel;
  let cookiePart = rawLine.trim();

  if (cookiePart.includes('|')) {
    const parts = cookiePart.split('|');
    label = parts[0].trim() || defaultLabel;
    cookiePart = parts.slice(1).join('|').trim();
  }

  cookiePart = cookiePart.replace(/^cookie:\s*/i, '');

  const cookies: Record<string, string> = {};
  cookiePart.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx > -1) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      if (key && val) cookies[key] = val;
    }
  });

  if (!cookies['hatch_sess']) {
    throw new Error(`Dòng cookie "${label}" thiếu biến bắt buộc 'hatch_sess'! Hãy copy từ tab Network F12.`);
  }

  return { label, cookies };
};

/** Nạp danh sách Cookie (mỗi dòng 1 tài khoản) vào bể tài khoản của Gateway. */
export const importMuseCookieAccount = async (rawCookieText: string): Promise<{ importedCount: number }> => {
  const lines = rawCookieText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  // Nhãn mặc định có ngày giờ để các lần nạp khác nhau không trùng tên "muse_acc_1"
  const now = new Date();
  const stamp = `${String(now.getDate()).padStart(2, '0')}${String(now.getMonth() + 1).padStart(2, '0')}_${String(
    now.getHours()
  ).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;

  let importedCount = 0;
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseMuseCookieString(lines[i], `muse_${stamp}_${i + 1}`);
    const res = await gatewayFetch('/admin/accounts', {
      method: 'POST',
      body: JSON.stringify(parsed),
    });
    if (!res.ok) throw new Error(`Lỗi nạp tài khoản ${parsed.label}: ${await readError(res)}`);
    importedCount++;
  }
  return { importedCount };
};

// ---------------------------------------------------------------------------
// API riêng của MuseStudio (studio_api.py): đăng nhập bằng trình duyệt, luồng theo tài khoản
// ---------------------------------------------------------------------------

export interface AccountQuota {
  checked_at?: number;
  plan?: string | null;
  weekly_used_pct?: number | null;
  resets_at?: string | null;
  extra_left?: string | number | null;
  found?: boolean;
  error?: string;
}

export interface StudioAccount extends GatewayAccount {
  max_concurrency: number;
  inflight: number;
  /** Loại media đang bị chặn: { video: { until: giây unix, reason: 'limit' | 'region' } } */
  blocked?: Record<string, { until: number; reason: string | null }>;
  /** Hạn mức tuần đã dùng hết (theo lần kiểm tra gần nhất) */
  quota_exhausted?: boolean;
  meta: { quota?: AccountQuota; renewed_at?: number; logged_in_at?: number; blocked_at?: number; [k: string]: unknown };
}

export interface StudioAccountsResponse {
  data: StudioAccount[];
  max_concurrency_per_account: number;
  /** Số luồng của tài khoản chưa đặt riêng (tài khoản mới) — Gateway cũ không có trường này */
  default_concurrency_per_account?: number;
}

export interface LoginJob {
  id: string;
  account_id: string | null;
  label: string;
  status: 'starting' | 'waiting' | 'verifying' | 'succeeded' | 'failed' | 'cancelled';
  message: string;
  result_account_id: string | null;
  /** Đăng nhập tự động bằng email + mã OTP từ hộp thư ('' = người dùng tự đăng nhập) */
  email?: string;
}

export interface LoginBatch {
  id: string;
  finished: boolean;
  succeeded: number;
  failed: number;
  jobs: LoginJob[];
}

/**
 * Đăng nhập nhiều tài khoản bằng email: mỗi dòng `email | link hộp thư` (vd. https://generator.email/<email>,
 * thiếu link thì dùng generator.email). Gateway mở Chrome lần lượt, tự gõ email, lấy mã OTP trong thư mới nhất.
 */
export const startEmailLogin = async (text: string): Promise<LoginBatch> => {
  const res = await gatewayFetch('/studio/login/email', { method: 'POST', body: JSON.stringify({ text }) });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
};

export const getEmailLogin = async (batchId: string): Promise<LoginBatch> => {
  const res = await gatewayFetch(`/studio/login/batch/${encodeURIComponent(batchId)}`);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
};

export const cancelEmailLogin = async (batchId: string): Promise<void> => {
  await gatewayFetch(`/studio/login/batch/${encodeURIComponent(batchId)}/cancel`, { method: 'POST' });
};

/**
 * Nghi tài khoản bị muse.ai khóa: Gateway thấy trang "Muse is disconnected — We disconnected Muse to protect your
 * information" (đăng nhập vẫn được, /api/session vẫn báo phiên hợp lệ, nhưng không còn ô chat).
 */
export const isAccountBlocked = (a: GatewayAccount & { meta?: { blocked_at?: number } }) =>
  !!a.meta?.blocked_at || /muse is disconnected|we disconnected muse|bị muse\.ai khóa/i.test(a.last_error || '');

export const isAccountUsable = (a: GatewayAccount) => a.enabled && a.status !== 'invalid';

/** Tạo được video ngay lúc này: dùng được, không bị chặn video, chưa hết hạn mức tuần. */
export const isVideoReady = (a: StudioAccount) =>
  isAccountUsable(a) && !a.quota_exhausted && !((a.blocked?.video?.until ?? 0) * 1000 > Date.now());

export const listStudioAccounts = async (): Promise<StudioAccountsResponse> => {
  const res = await gatewayFetch('/studio/accounts');
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error('Gateway chưa có API /studio — hãy khởi động lại gateway_server.py (run_dev.bat).');
    }
    throw new Error(await readError(res));
  }
  return res.json();
};

export const updateStudioAccount = async (
  accountId: string,
  patch: { label?: string; enabled?: boolean; max_concurrency?: number; cookies?: string; dedicated_voice?: string }
): Promise<StudioAccount> => {
  const res = await gatewayFetch(`/studio/accounts/${encodeURIComponent(accountId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()).account;
};

/** Mở cửa sổ Chrome để đăng nhập. Có `accountId` = đăng nhập lại cho tài khoản đó. */
export const startBrowserLogin = async (opts: { accountId?: string; label?: string }): Promise<LoginJob> => {
  const res = await gatewayFetch('/studio/login', {
    method: 'POST',
    body: JSON.stringify({ account_id: opts.accountId ?? null, label: opts.label ?? '' }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
};

export const getBrowserLogin = async (jobId: string): Promise<LoginJob> => {
  const res = await gatewayFetch(`/studio/login/${encodeURIComponent(jobId)}`);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
};

export const cancelBrowserLogin = async (jobId: string): Promise<void> => {
  await gatewayFetch(`/studio/login/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
};

/**
 * Kiểm tra phiên: gọi /api/session của muse.ai để làm mới cookie. `checkPage` (nút bấm tay): mở thêm trang chat để phát hiện
 * tài khoản bị muse.ai khóa ("Muse is disconnected" — /api/session vẫn báo hợp lệ) → `blocked: true`, Gateway tự tắt tài khoản.
 */
export const renewMuseAccount = async (
  accountId: string,
  checkPage = false
): Promise<{ ok: boolean; error?: string; blocked?: boolean; page?: string }> => {
  const res = await gatewayFetch(
    `/admin/accounts/${encodeURIComponent(accountId)}/renew${checkPage ? '?check_page=true' : ''}`,
    { method: 'POST' }
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
};

/** Đọc hạn mức (Settings -> Usage) của tài khoản; mất vài chục giây. */
export const checkMuseQuota = async (accountId: string): Promise<AccountQuota> => {
  const res = await gatewayFetch(`/admin/accounts/${encodeURIComponent(accountId)}/quota?refresh=true`);
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()).quota;
};

export const listMuseAccounts = async (): Promise<GatewayAccount[]> => {
  const res = await gatewayFetch('/admin/accounts');
  if (!res.ok) throw new Error('Không kết nối được với Local Gateway (kiểm tra lại Python Gateway Server)');
  const data = await res.json();
  return data.data ?? [];
};

/** Đưa tài khoản đang "cooling"/"invalid" về "active" để thử lại. */
export const resetMuseAccount = async (accountId: string): Promise<void> => {
  const res = await gatewayFetch(`/admin/accounts/${encodeURIComponent(accountId)}/reset`, { method: 'POST' });
  if (!res.ok) throw new Error(await readError(res));
};

export const setMuseAccountEnabled = async (accountId: string, enabled: boolean): Promise<void> => {
  const res = await gatewayFetch(`/admin/accounts/${encodeURIComponent(accountId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error(await readError(res));
};

export const deleteMuseAccount = async (accountId: string): Promise<void> => {
  const res = await gatewayFetch(`/admin/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await readError(res));
};

// ---------------------------------------------------------------------------
// File, giọng đọc, trạng thái (studio_media.py)
// ---------------------------------------------------------------------------

export interface MuseVoice {
  id: string;
  name: string;
  gender: string;
  group: string;
  group_label: string;
}

const jsonOrThrow = async <T,>(res: Response): Promise<T> => {
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
};

export const getStudioSettings = () =>
  gatewayFetch('/studio/settings').then((r) => jsonOrThrow<{ output_dir: string; ffmpeg: string | null }>(r));

export const listMuseVoices = () =>
  gatewayFetch('/studio/voices').then((r) => jsonOrThrow<{ data: MuseVoice[] }>(r)).then((d) => d.data);

/** Chép video vào <thư mục xuất>/<dự án>/<filename>.mp4. Trả về đường dẫn file. */
export const exportVideo = (videoUrl: string, project: string, filename: string) =>
  gatewayFetch('/studio/export', {
    method: 'POST',
    body: JSON.stringify({ media: videoUrl, project, filename }),
  }).then((r) => jsonOrThrow<{ path: string; folder: string }>(r));

/** Ghép các video (theo thứ tự) thành 1 file bằng FFmpeg. */
export const mergeVideos = (videoUrls: string[], project: string, filename: string) =>
  gatewayFetch('/studio/merge', {
    method: 'POST',
    body: JSON.stringify({ media: videoUrls, project, filename }),
  })
    .then((r) => jsonOrThrow<{ path: string; folder: string; url: string }>(r))
    .then((d) => ({ ...d, url: absoluteGatewayUrl(d.url) }));

export const openProjectFolder = (project?: string) =>
  gatewayFetch('/studio/open-folder', { method: 'POST', body: JSON.stringify({ project }) }).then((r) =>
    jsonOrThrow<{ folder: string }>(r)
  );

export interface AIConfig {
  prefer: 'auto' | 'gemini' | 'openai' | 'muse';
  gemini_keys: string[];
  gemini_key_count: number;
  gemini_model: string;
  openai_base_url: string;
  openai_api_key: string;
  openai_model: string;
}

export const getAIConfig = () => gatewayFetch('/studio/ai/config').then((r) => jsonOrThrow<AIConfig>(r));

export const saveAIConfig = (patch: {
  prefer?: AIConfig['prefer'];
  gemini_keys_text?: string;
  gemini_model?: string;
  openai_base_url?: string;
  openai_api_key?: string;
  openai_model?: string;
}) =>
  gatewayFetch('/studio/ai/config', { method: 'PUT', body: JSON.stringify(patch) }).then((r) =>
    jsonOrThrow<AIConfig>(r)
  );

export const testAIProvider = (provider: 'gemini' | 'openai') =>
  gatewayFetch('/studio/ai/test', { method: 'POST', body: JSON.stringify({ provider }) }).then((r) =>
    jsonOrThrow<{ results: { index: number; key?: string; ok: boolean; detail: string }[] }>(r)
  );

export const loadServerState = async <T,>(key: string): Promise<{ savedAt: number; value: T } | null> => {
  const res = await gatewayFetch(`/studio/state/${encodeURIComponent(key)}`);
  if (res.status === 404) return null;
  return jsonOrThrow(res);
};

export const saveServerState = (key: string, value: unknown, savedAt: number) =>
  gatewayFetch(`/studio/state/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ savedAt, value }),
  }).then((r) => jsonOrThrow(r));

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

export const listGatewayTasks = async (limit = 200): Promise<GatewayTask[]> => {
  const res = await gatewayFetch(`/admin/tasks?limit=${limit}`);
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.data ?? [];
};

/** Hủy một task đang chạy trên Gateway (admin key mặc định trùng api key). */
export const cancelMuseTask = async (taskId: string): Promise<boolean> => {
  try {
    const res = await gatewayFetch(`/admin/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data.cancelled);
  } catch {
    return false;
  }
};

export class MuseTaskStoppedError extends Error {
  constructor() {
    super('Đã dừng theo yêu cầu người dùng');
    this.name = 'MuseTaskStoppedError';
  }
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const LOCK_TAGS = {
  character:
    '[IDENTITY LOCK: Keep exact facial features, bone structure, skin tone, and hair from character reference]',
  outfit: '[OUTFIT LOCK: Maintain 100% identical clothing design, color palette, and fabric texture]',
  product: '[PRODUCT LOCK: Zero warping, preserve exact product geometry, proportions, and surface details]',
} as const;

/** Bộ khóa Prompt (Identity + Outfit + Product Lock) và góc máy tùy chọn. */
export interface ProductContext {
  name?: string;
  visual?: string;
}

/** Vai trò của từng ảnh gửi kèm 1 cảnh (thứ tự = thứ tự ảnh trong tin nhắn gửi muse.ai). */
export type ImageRole = ReferenceImage['role'] | 'keyframe' | 'endframe' | 'shotref' | 'scene';

const ROLE_LABEL: Record<ReferenceImage['role'], string> = {
  character: 'the character (face, hair, body)',
  outfit: 'the outfit the character wears',
  product: 'the exact product being sold',
};

/** Thứ tự ảnh gửi cho muse.ai: ảnh frame đầu (nếu là ảnh tham chiếu) rồi tới các ảnh còn lại. */
export const orderedReferenceRoles = (refs: ReferenceImage[]): ReferenceImage['role'][] =>
  (['character', 'product', 'outfit'] as const).filter((role) => refs.some((r) => r.role === role));

/**
 * Bộ khóa Prompt: nói rõ từng ảnh đính kèm là gì, khóa nhân vật/trang phục/sản phẩm,
 * gắn tên + ngoại hình sản phẩm thật để muse.ai không tự đổi sang sản phẩm khác.
 * `imageRoles` = vai trò của từng ảnh theo đúng thứ tự gửi đi (ảnh 1, ảnh 2...).
 */
export const buildLockedPrompt = (
  userPrompt: string,
  refs: ReferenceImage[],
  cameraMotion = '',
  product: ProductContext = {},
  imageRoles: ImageRole[] = [],
  /** Thẻ khóa bối cảnh (backdropTag) — đặt trước prompt của người dùng */
  backdrop = ''
): string => {
  const parts: string[] = [];
  if (imageRoles.length > 0) {
    const desc = imageRoles
      .map((role, i) =>
        role === 'keyframe'
          ? `image ${i + 1} = the opening frame of this shot`
          : role === 'endframe'
            ? `image ${i + 1} = the closing frame: the shot must end exactly on this image`
            : role === 'shotref'
              ? `image ${i + 1} = a reference for this shot (follow its outfit, product and look)`
              : role === 'scene'
                ? `image ${i + 1} = the BACKGROUND LOCATION: the shot takes place in exactly this place (same room, shelves, lighting); do not copy any person from it`
                : `image ${i + 1} = ${ROLE_LABEL[role]}`
      )
      .join('; ');
    parts.push(`[ATTACHED IMAGES: ${desc}]`);
  }
  (['character', 'outfit', 'product'] as const).forEach((role) => {
    if (refs.some((r) => r.role === role)) parts.push(LOCK_TAGS[role]);
  });
  if (product.name || product.visual) {
    const what = [product.name, product.visual].filter(Boolean).join(' — ');
    parts.push(
      `[PRODUCT: ${what}. The product in the video must be exactly this item as shown in the product image; never replace it with a different product.]`
    );
  }
  if (cameraMotion) parts.push(`[CAMERA: ${cameraMotion}, steady cinematic movement]`);
  if (backdrop) parts.push(backdrop);
  parts.push(userPrompt.trim());
  return parts.join(' ');
};

/** Bỏ các thẻ [..] ở đầu prompt đã khóa để hiển thị lại prompt gốc của người dùng. */
export const stripPromptLocks = (prompt: string): string =>
  prompt.replace(/^(\s*\[[^\]]*\])+\s*/, '').trim();

// ---------------------------------------------------------------------------
// Tạo ảnh Keyframe & Video
// ---------------------------------------------------------------------------

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Không đọc được dữ liệu ảnh'));
    reader.readAsDataURL(blob);
  });

/** Tạo ảnh Keyframe kết hợp Nhân vật + Trang phục + Sản phẩm qua muse-image. Trả về data URL. */
export const generateMuseKeyframe = async (
  config: MuseConfig,
  prompt: string,
  refs: ReferenceImage[],
  /** Bối cảnh: thẻ khóa (chữ) + ảnh bối cảnh gửi kèm sau các ảnh tham chiếu */
  backdrop: { tag?: string; image?: string } = {}
): Promise<string> => {
  const res = await gatewayFetch('/v1/images/generations', {
    method: 'POST',
    body: JSON.stringify({
      model: 'muse-image',
      prompt:
        buildLockedPrompt(prompt, refs, '', {}, [], backdrop.tag || '') +
        (backdrop.image ? ' [The LAST attached image is the BACKGROUND LOCATION: place the scene in exactly this place; do not copy any person from it.]' : ''),
      size: config.aspectRatio,
      image: [...refs.slice(0, backdrop.image ? 3 : 4).map((r) => r.dataUrl), ...(backdrop.image ? [backdrop.image] : [])],
      // Lấy base64 thay vì URL: URL media của Gateway là 127.0.0.1, khi gửi lại làm
      // first-frame cho /v1/videos sẽ bị lớp chặn SSRF của muse2api từ chối.
      response_format: 'b64_json',
    }),
  });

  if (!res.ok) throw new Error(`Lỗi tạo Keyframe: ${await readError(res)}`);
  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json || data.result?.b64_json;
  if (typeof b64 === 'string' && b64) {
    return b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
  }

  const rawUrl: string | undefined = data.data?.[0]?.url || data.url || data.result?.url;
  if (!rawUrl) throw new Error('Không tìm thấy dữ liệu ảnh Keyframe trả về.');
  if (rawUrl.startsWith('data:')) return rawUrl;
  // Phòng hờ Gateway vẫn trả URL: tải về và chuyển thành data URL.
  const imgRes = await fetch(absoluteGatewayUrl(rawUrl));
  if (!imgRes.ok) throw new Error(`Không tải được ảnh Keyframe (${imgRes.status})`);
  return blobToDataUrl(await imgRes.blob());
};

export interface PollOptions {
  /** Trả true để dừng: task trên Gateway sẽ bị hủy và hàm ném MuseTaskStoppedError. */
  shouldStop?: () => boolean;
  /** Tiến độ 0-100 do Gateway báo về. */
  onProgress?: (progress: number) => void;
  /** Tài khoản muse mà Gateway giao task này cho */
  onAccount?: (accountId: string) => void;
}

const POLL_INTERVAL_MS = 5000;
// Gateway tự đánh dấu task thất bại sau video_timeout (mặc định 600s). Frontend chỉ là
// lưới an toàn nên chờ lâu hơn hẳn, tránh báo Timeout khi backend vẫn đang render.
const POLL_SAFETY_DEADLINE_MS = 20 * 60 * 1000;
const MAX_CONSECUTIVE_404 = 3;

/** Ngủ `ms` nhưng thức dậy sớm nếu người dùng bấm Dừng. */
const sleepUnlessStopped = async (ms: number, shouldStop?: () => boolean) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (shouldStop?.()) return;
    await new Promise((r) => setTimeout(r, Math.min(500, end - Date.now())));
  }
};

/** Khởi tạo task video (muse-video). Trả về task id. */
export const createMuseVideoTask = async (
  config: MuseConfig,
  prompt: string,
  firstFrameDataUrl: string,
  referenceImages: string[] = []
): Promise<string> => {
  const res = await gatewayFetch('/v1/videos', {
    method: 'POST',
    body: JSON.stringify({
      model: 'muse-video',
      prompt,
      size: config.aspectRatio,
      duration: config.duration,
      // Trống = Reference-to-Video: mọi ảnh chỉ là tham chiếu, không ép khung mở đầu
      image: firstFrameDataUrl || undefined,
      // Ảnh tham chiếu gửi kèm cùng tin nhắn: muse.ai nhận tối đa 4 ảnh / tin nhắn
      // (có khung mở đầu thì còn 3 chỗ cho tham chiếu)
      reference_images: referenceImages.slice(0, firstFrameDataUrl ? 3 : 4),
      // Một giọng cố định cho cả lô để các cảnh không bị đổi giọng
      voice: config.voice || undefined,
    }),
  });
  if (!res.ok) throw new Error(`Không thể tạo task video: ${await readError(res)}`);
  const taskData = await res.json();
  const taskId = taskData.id || taskData.task_id;
  if (!taskId) throw new Error(`Gateway không trả về task id. Payload: ${JSON.stringify(taskData)}`);
  return taskId;
};

/**
 * Chờ một task video tới khi xong. Trả về URL media của Gateway.
 * Dùng được cả cho task vừa tạo lẫn task đang chạy dở trước khi tải lại trang.
 */
export const pollMuseVideoTask = async (taskId: string, options: PollOptions = {}): Promise<string> => {
  const { shouldStop, onProgress, onAccount } = options;
  let lastAccount = '';
  const stopAndCancel = async (): Promise<never> => {
    await cancelMuseTask(taskId);
    throw new MuseTaskStoppedError();
  };

  const deadline = Date.now() + POLL_SAFETY_DEADLINE_MS;
  let consecutive404 = 0;
  let first = true;
  while (Date.now() < deadline) {
    if (!first) await sleepUnlessStopped(POLL_INTERVAL_MS, shouldStop);
    first = false;
    if (shouldStop?.()) await stopAndCancel();

    let pollRes: Response;
    try {
      pollRes = await gatewayFetch(`/v1/videos/${encodeURIComponent(taskId)}`);
    } catch {
      continue; // Gateway tạm thời không phản hồi, thử lại vòng sau
    }

    if (pollRes.status === 404) {
      // Task biến mất (ví dụ Gateway khởi động lại) thì không chờ mãi
      if (++consecutive404 >= MAX_CONSECUTIVE_404) {
        throw new Error(`Gateway không còn task ${taskId} (có thể server đã khởi động lại).`);
      }
      continue;
    }
    consecutive404 = 0;
    if (!pollRes.ok) continue;

    const statusData = await pollRes.json();
    const status = String(statusData.status || '').toLowerCase();
    if (typeof statusData.progress === 'number') onProgress?.(statusData.progress);
    if (statusData.account_id && statusData.account_id !== lastAccount) {
      lastAccount = statusData.account_id;
      onAccount?.(lastAccount);
    }

    if (status === 'succeeded' || status === 'completed') {
      const url: string | undefined = statusData.result?.url;
      if (!url) throw new Error(`Task hoàn tất nhưng không có URL video. Payload: ${JSON.stringify(statusData)}`);
      return absoluteGatewayUrl(url);
    }
    if (status === 'cancelled') {
      throw shouldStop?.() ? new MuseTaskStoppedError() : new Error('Task đã bị hủy trên Gateway.');
    }
    if (status === 'failed' || status === 'error') {
      throw new Error(
        statusData.error?.message ||
          (typeof statusData.error === 'string' ? statusData.error : null) ||
          'Muse AI báo lỗi trong lúc render video.'
      );
    }
  }

  await cancelMuseTask(taskId);
  throw new Error('Quá thời gian chờ (Timeout) khi render video trên Muse.ai');
};

/** Tạo task video rồi chờ tới khi có file .MP4. */
export const createAndPollMuseVideo = async (
  config: MuseConfig,
  prompt: string,
  firstFrameDataUrl: string,
  onTaskIdCreated?: (taskId: string) => void,
  options: PollOptions = {},
  referenceImages: string[] = []
): Promise<string> => {
  if (options.shouldStop?.()) throw new MuseTaskStoppedError();
  const taskId = await createMuseVideoTask(config, prompt, firstFrameDataUrl, referenceImages);
  onTaskIdCreated?.(taskId);
  return pollMuseVideoTask(taskId, options);
};
