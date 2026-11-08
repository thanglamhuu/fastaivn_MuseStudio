// frontend/src/services/museBatchService.ts
import { AspectRatio, ShotDuration } from '../types/videoStudio';

export interface MuseConfig {
  gatewayUrl: string;
  apiKey: string;
  aspectRatio: AspectRatio;
  duration: ShotDuration;
  concurrency: 1 | 2 | 4;
  useTwoStepKeyframe: boolean;
  chainEndFrame: boolean; // Tự động lấy frame cuối cảnh trước làm frame đầu cảnh sau
}

export interface ReferenceImage {
  id: string;
  role: 'character' | 'outfit' | 'product';
  dataUrl: string;
  name: string;
}

export interface BatchSceneItem {
  id: string;
  index: number;
  rawPrompt: string;
  status: 'idle' | 'queued' | 'generating_keyframe' | 'rendering_video' | 'completed' | 'failed';
  keyframeUrl?: string;
  videoTaskId?: string;
  videoUrl?: string;
  progress?: number;
  error?: string;
}

/**
 * 1. Bóc tách chuỗi Cookie thô copy từ F12 Network của muse.ai
 */
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

/**
 * 2. Nạp danh sách Cookie của người dùng vào Local Gateway (qua Vite Proxy)
 */
export const importMuseCookieAccount = async (
  config: MuseConfig,
  rawCookieText: string
): Promise<{ importedCount: number }> => {
  const lines = rawCookieText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let importedCount = 0;
  const baseUrl = config.gatewayUrl ? config.gatewayUrl.replace(/\/$/, '') : '';

  for (let i = 0; i < lines.length; i++) {
    const parsed = parseMuseCookieString(lines[i], `muse_acc_${i + 1}`);
    const res = await fetch(`${baseUrl}/admin/accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(parsed),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Lỗi nạp tài khoản ${parsed.label}: ${errText}`);
    }
    importedCount++;
  }

  return { importedCount };
};

/**
 * 3. Kiểm tra trạng thái danh sách tài khoản Cookie đang có trong Gateway
 */
export const fetchMuseAccountsStatus = async (config: MuseConfig) => {
  const baseUrl = config.gatewayUrl ? config.gatewayUrl.replace(/\/$/, '') : '';
  const res = await fetch(`${baseUrl}/admin/accounts`, {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
  });
  if (!res.ok) throw new Error('Không kết nối được với Local Gateway (kiểm tra lại Python Gateway Server)');
  return res.json();
};

/**
 * 4. Bộ khóa Prompt (Identity + Outfit + Product Lock)
 */
export const buildLockedPrompt = (userPrompt: string, refs: ReferenceImage[]): string => {
  const locks: string[] = [];
  if (refs.some((r) => r.role === 'character')) {
    locks.push('[IDENTITY LOCK: Keep exact facial features, bone structure, skin tone, and hair from character reference]');
  }
  if (refs.some((r) => r.role === 'outfit')) {
    locks.push('[OUTFIT LOCK: Maintain 100% identical clothing design, color palette, and fabric texture]');
  }
  if (refs.some((r) => r.role === 'product')) {
    locks.push('[PRODUCT LOCK: Zero warping, preserve exact product geometry, proportions, and surface details]');
  }
  return `${locks.join(' ')} ${userPrompt.trim()}`;
};

/**
 * 5. Tạo ảnh Keyframe kết hợp Nhân vật + Trang phục + Sản phẩm qua muse-image
 */
export const generateMuseKeyframe = async (
  config: MuseConfig,
  prompt: string,
  refs: ReferenceImage[]
): Promise<string> => {
  const baseUrl = config.gatewayUrl ? config.gatewayUrl.replace(/\/$/, '') : '';
  const res = await fetch(`${baseUrl}/v1/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: 'muse-image',
      prompt: buildLockedPrompt(prompt, refs),
      size: config.aspectRatio,
      image: refs.slice(0, 4).map((r) => r.dataUrl),
      // Lấy base64 thay vì URL: URL media của Gateway là 127.0.0.1, khi gửi lại làm
      // first-frame cho /v1/videos sẽ bị lớp chặn SSRF của muse2api từ chối.
      response_format: 'b64_json',
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Lỗi tạo Keyframe: ${errText}`);
  }
  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json || data.result?.b64_json;
  if (typeof b64 === 'string' && b64) {
    return b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
  }

  const rawUrl: string | undefined = data.data?.[0]?.url || data.url || data.result?.url;
  if (!rawUrl) throw new Error('Không tìm thấy dữ liệu ảnh Keyframe trả về.');
  if (rawUrl.startsWith('data:')) return rawUrl;
  // Phòng hờ Gateway vẫn trả URL: tải về và chuyển thành data URL.
  const absoluteUrl = rawUrl.startsWith('/') ? `${baseUrl}${rawUrl}` : rawUrl;
  return fetchAsDataUrl(absoluteUrl);
};

/** Tải một ảnh (thường là media nội bộ của Gateway) và chuyển thành data URL. */
const fetchAsDataUrl = async (url: string): Promise<string> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Không tải được ảnh Keyframe (${res.status})`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Không đọc được ảnh Keyframe'));
    reader.readAsDataURL(blob);
  });
};

/**
 * Hủy một task đang chạy trên Gateway (POST /admin/tasks/{id}/cancel).
 * Admin key mặc định trùng api_key khi chưa cấu hình MUSE2API_ADMIN_KEY.
 */
export const cancelMuseTask = async (config: MuseConfig, taskId: string): Promise<boolean> => {
  const baseUrl = config.gatewayUrl ? config.gatewayUrl.replace(/\/$/, '') : '';
  try {
    const res = await fetch(`${baseUrl}/admin/tasks/${encodeURIComponent(taskId)}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
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

/**
 * Hàm phụ trợ: Quét mọi cấu trúc JSON trả về từ muse2api để lấy URL hoặc base64 video
 */
const extractVideoUrlFromPayload = (payload: any): string | null => {
  if (!payload) return null;
  if (typeof payload === 'string') {
    if (
      payload.startsWith('http') ||
      payload.startsWith('data:video') ||
      payload.startsWith('/v1/') ||
      payload.startsWith('/files/')
    ) {
      return payload;
    }
    return null;
  }

  // Kiểm tra các trường phổ biến nhất
  const directCandidates = [
    payload.video_url,
    payload.url,
    payload.content_url,
    payload.download_url,
    payload.file_url,
    payload.result?.video_url,
    payload.result?.url,
    payload.result?.content_url,
    payload.result?.download_url,
    typeof payload.result === 'string' ? payload.result : null,
    payload.output?.video_url,
    payload.output?.url,
    payload.video?.url,
    payload.data?.[0]?.video_url,
    payload.data?.[0]?.url,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  // Kiểm tra trường base64 nếu có
  const b64Candidate =
    payload.b64_json || payload.result?.b64_json || payload.data?.[0]?.b64_json;
  if (typeof b64Candidate === 'string' && b64Candidate.trim().length > 0) {
    return b64Candidate.startsWith('data:')
      ? b64Candidate
      : `data:video/mp4;base64,${b64Candidate}`;
  }

  // Quét đệ quy mọi chuỗi chứa .mp4 hoặc đường dẫn video
  const visited = new Set<any>();
  const deepScan = (obj: any): string | null => {
    if (!obj || typeof obj !== 'object' || visited.has(obj)) return null;
    visited.add(obj);
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') {
        const s = v.trim();
        if (
          s.includes('.mp4') ||
          s.startsWith('data:video/') ||
          s.includes('/v1/videos/') ||
          (k.toLowerCase().includes('url') && (s.startsWith('http') || s.startsWith('/')))
        ) {
          return s;
        }
      } else if (typeof v === 'object') {
        const found = deepScan(v);
        if (found) return found;
      }
    }
    return null;
  };

  return deepScan(payload);
};

/**
 * Hàm phụ trợ: Tải stream video từ Gateway có kèm Bearer Token và chuyển sang Blob URL
 */
const fetchGatewayVideoAsBlobUrl = async (
  endpointUrl: string,
  apiKey: string
): Promise<string | null> => {
  try {
    const res = await fetch(endpointUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const jsonData = await res.json();
      const nestedUrl = extractVideoUrlFromPayload(jsonData);
      if (nestedUrl && nestedUrl !== endpointUrl) {
        if (nestedUrl.startsWith('http') && !nestedUrl.includes('127.0.0.1') && !nestedUrl.includes('localhost')) {
          return nestedUrl;
        }
      }
      return null;
    }

    const blob = await res.blob();
    if (blob.size === 0) return null;
    const mp4Blob = blob.type.includes('video')
      ? blob
      : new Blob([blob], { type: 'video/mp4' });
    return URL.createObjectURL(mp4Blob);
  } catch {
    return null;
  }
};

/**
 * 6. Khởi tạo Task Video (muse-video) và Polling đến khi có file .MP4
 */
export interface PollOptions {
  /** Trả true để dừng: task trên Gateway sẽ bị hủy và hàm ném MuseTaskStoppedError. */
  shouldStop?: () => boolean;
  /** Tiến độ 0-100 do Gateway báo về. */
  onProgress?: (progress: number) => void;
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

export const createAndPollMuseVideo = async (
  config: MuseConfig,
  prompt: string,
  firstFrameDataUrl: string,
  onTaskIdCreated?: (taskId: string) => void,
  options: PollOptions = {}
): Promise<string> => {
  const { shouldStop, onProgress } = options;
  const baseUrl = config.gatewayUrl ? config.gatewayUrl.replace(/\/$/, '') : '';
  if (shouldStop?.()) throw new MuseTaskStoppedError();
  const createRes = await fetch(`${baseUrl}/v1/videos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: 'muse-video',
      prompt,
      size: config.aspectRatio,
      duration: config.duration,
      image: firstFrameDataUrl,
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Không thể tạo task video: ${err}`);
  }

  const taskData = await createRes.json();
  const taskId = taskData.id || taskData.task_id;
  if (onTaskIdCreated && taskId) onTaskIdCreated(taskId);

  // Trường hợp trả về trực tiếp kết quả ngay trong lệnh POST
  const immediateUrl = extractVideoUrlFromPayload(taskData);
  if (immediateUrl && !taskId) {
    return immediateUrl;
  }

  if (!taskId) {
    throw new Error(`Gateway không trả về task id. Payload: ${JSON.stringify(taskData)}`);
  }

  const stopAndCancel = async (): Promise<never> => {
    await cancelMuseTask(config, taskId);
    throw new MuseTaskStoppedError();
  };

  const deadline = Date.now() + POLL_SAFETY_DEADLINE_MS;
  let consecutive404 = 0;
  while (Date.now() < deadline) {
    await sleepUnlessStopped(POLL_INTERVAL_MS, shouldStop);
    if (shouldStop?.()) await stopAndCancel();

    let pollRes: Response;
    try {
      pollRes = await fetch(`${baseUrl}/v1/videos/${taskId}`, {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
        },
      });
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
    const currentStatus = (statusData.status || statusData.state || '').toLowerCase();
    if (typeof statusData.progress === 'number') onProgress?.(statusData.progress);

    if (
      currentStatus === 'completed' ||
      currentStatus === 'succeeded' ||
      currentStatus === 'success' ||
      currentStatus === 'done'
    ) {
      console.log('[Muse2API] Task hoàn tất, dữ liệu trả về:', statusData);

      // Bước A: Thử bóc tách URL trực tiếp từ payload JSON của task
      const extractedUrl = extractVideoUrlFromPayload(statusData);
      if (extractedUrl) {
        // Nếu là đường dẫn nội bộ của Gateway (/v1/...), tải qua Bearer Token thành Blob URL
        if (
          extractedUrl.startsWith('/') ||
          extractedUrl.includes('127.0.0.1') ||
          extractedUrl.includes('localhost')
        ) {
          const normalizedEndpoint = extractedUrl.startsWith('/')
            ? `${baseUrl}${extractedUrl}`
            : extractedUrl;
          const blobUrl = await fetchGatewayVideoAsBlobUrl(normalizedEndpoint, config.apiKey);
          if (blobUrl) return blobUrl;
        }
        return extractedUrl;
      }

      // Bước B: Chuẩn OpenAI Video API trên muse2api trả file MP4 tại /v1/videos/{taskId}/content
      const contentEndpoint = `${baseUrl}/v1/videos/${taskId}/content`;
      const contentBlobUrl = await fetchGatewayVideoAsBlobUrl(contentEndpoint, config.apiKey);
      if (contentBlobUrl) {
        return contentBlobUrl;
      }

      throw new Error(
        `Task hoàn tất nhưng không lấy được stream video. Payload: ${JSON.stringify(statusData)}`
      );
    }

    if (currentStatus === 'cancelled') {
      throw shouldStop?.() ? new MuseTaskStoppedError() : new Error('Task đã bị hủy trên Gateway.');
    }

    if (currentStatus === 'failed' || currentStatus === 'error') {
      const errMsg =
        statusData.error?.message ||
        (typeof statusData.error === 'string' ? statusData.error : null) ||
        statusData.message ||
        'Muse AI báo lỗi trong lúc render video.';
      throw new Error(errMsg);
    }
  }

  await cancelMuseTask(config, taskId);
  throw new Error('Quá thời gian chờ (Timeout) khi render video trên Muse.ai');
};