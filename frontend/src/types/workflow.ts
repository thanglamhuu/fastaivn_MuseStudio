// Workflow làm clip: chọn 1 mẫu, mỗi dòng (sản phẩm + nhân vật + ghi chú) chạy qua
// 4 bước Sản phẩm → Kịch bản → Render cảnh → Ghép, ra 1 clip hoàn chỉnh.
import type { ScriptMode, ScriptScene, ScriptSource } from '../services/productService';
import type { AspectRatio, ShotDuration } from './videoStudio';

export interface WorkflowTemplate {
  id: string;
  name: string;
  icon: string;
  category: string;
  description: string;
  /** Mẫu có sẵn (nằm trong code; sửa thì lưu thành bản sửa đè riêng, khôi phục được) */
  builtin?: boolean;
  /** Mẫu có sẵn đang dùng bản đã sửa của người dùng (đánh dấu lúc hiển thị, không lưu) */
  customized?: boolean;
  scriptMode: ScriptMode;
  /** Mẫu kịch bản (khi scriptMode = 'template') */
  scriptTemplateId?: string;
  /** Hướng dẫn thêm gửi cho AI viết kịch bản */
  extraNote: string;
  sceneCount: number;
  duration: ShotDuration;
  aspectRatio: AspectRatio;
  withDialogue: boolean;
  /** Không lộ mặt: không gửi ảnh nhân vật, chỉ tay + sản phẩm */
  faceless: boolean;
  /** Xoay vòng ảnh sản phẩm qua từng cảnh (lookbook nhiều mẫu / nhiều màu) */
  rotateProductImages: boolean;
  /** Khung cuối cảnh trước làm khung đầu cảnh sau (chạy tuần tự) */
  chainEndFrame: boolean;
  cameraMotion: string;
  autoMerge: boolean;
  /** Tách cảnh nhiều người nói thành mỗi lượt thoại 1 shot (mỗi người đúng giọng của mình) */
  splitDialogue?: boolean;
  /** Nhân vật chưa có ảnh thì AI tự vẽ chân dung (lưu vào thư viện nhân vật) — mặc định bật */
  autoPortrait?: boolean;
  /**
   * Dàn nhân vật cố định của workflow (chọn từ thư viện hoặc tải ảnh lên ở khối 👤 Nhân vật).
   * Nhân vật đầu tiên là nhân vật chính khi dòng không chọn nhân vật. Trống = chỉ dùng nhân vật của dòng.
   */
  characterIds?: string[];
  /**
   * Trang phục cố định (khối 👗 Trang phục): ảnh tải lên, hoặc chỉ mô tả để AI tự tạo
   * ảnh trang phục 1 lần mỗi lượt chạy rồi gửi kèm mọi cảnh (như MV1 Muse AI).
   */
  outfit?: { image?: string; description: string };
  /**
   * Cách gửi ảnh cho muse-video:
   * - reference (mặc định): mọi ảnh chỉ là tham chiếu + bảng ánh xạ "Ảnh #N" (Direct Reference-to-Video, như MV1)
   * - firstframe: ảnh đầu (nhân vật) làm khung mở đầu video (cách cũ)
   */
  refMode?: 'reference' | 'firstframe';
  /** Mẫu phim / câu chuyện không bán sản phẩm: mở trong Sơ đồ khối thì KHÔNG tạo khối 📦 Sản phẩm */
  noProduct?: boolean;
  /** Bối cảnh cố định chèn vào mọi cảnh để các cảnh render song song vẫn khớp nhau */
  setting?: string;
  /**
   * Ảnh bối cảnh vẽ trước (node 🏭 Tạo bối cảnh khi mở trong Sơ đồ khối): id trong thư viện bối cảnh (data/backdropPresets),
   * mật độ sản phẩm bày trong bối cảnh — ảnh này khóa bối cảnh cho mọi cảnh.
   */
  backdrop?: { id: string; density?: 'none' | 'few' | 'full' | 'massive'; extras?: boolean };
  /**
   * Phong cách hình ảnh: '3d' = phim hoạt hình 3D kiểu Pixar / Disney (bỏ khóa chân thật, thêm khóa phong cách 3D vào mọi cảnh
   * và ảnh khung hình). Trống = người thật.
   */
  visualStyle?: '3d';
  /** Khóa chân thật chống "màu nhựa AI" (mặc định bật) */
  realismLock?: boolean;
  /** Prompt cảnh nhập tay: có thì bỏ qua AI viết kịch bản */
  manualScenes?: string[];
  /** Hậu kỳ clip cuối: nâng cạnh ngắn lên N px (0 = tắt) */
  postUpscale?: number;
  /** Hậu kỳ clip cuối: làm mờ vùng logo / watermark */
  postBlur?: { regions: { x: number; y: number; w: number; h: number }[]; mode: 'blur' | 'pixelate'; strength: number };
  /** Sơ đồ khối (trình chỉnh sơ đồ) đã tạo ra mẫu này */
  graph?: { nodes: unknown[]; edges: unknown[] };
  /** Mẫu chuyển từ app cũ MV1 Muse AI: id mẫu gốc, kiểu kịch bản, video trend tham khảo */
  hnd?: { templateId: string; templateStyle: string; videoUrl?: string };
  /** Id sơ đồ node dựng sẵn trong app (loadHndFlowTemplates) — nút 🧩 Sơ đồ mở đúng sơ đồ này */
  flowGraphId?: string;
  /**
   * Sơ đồ node (flow-workflow) nhúng sẵn trong mẫu — có khi mẫu đến từ bộ workflow (.musestudio.json).
   * Ưu tiên hơn flowGraphId / hnd nên mẫu chạy được cả ở máy chưa có mẫu gốc.
   */
  flowGraph?: unknown;
  /** Ảnh / video xem trước card mẫu (đường dẫn tương đối trong public/) */
  preview?: { img?: string; video?: string };
  /** Mẫu dùng chung tải từ catalog fastaivn.com (quản trị trên web) */
  remote?: { id: string; version: number; thumbnailUrl?: string; previewUrl?: string; graphUrl?: string; bundleUrl?: string; trendUrl?: string; isPremium?: boolean };
}

export type WorkflowStepId = 'product' | 'script' | 'scenes' | 'merge' | 'post';
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'review';

export interface WorkflowStepState {
  status: StepStatus;
  error?: string;
  detail?: string;
  startedAt?: number;
  finishedAt?: number;
}

export interface WorkflowSceneState {
  prompt: string;
  title?: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  taskId?: string;
  videoUrl?: string;
  exportedPath?: string;
  progress?: number;
  error?: string;
  accountId?: string;
}

export interface WorkflowRow {
  id: string;
  /** Sản phẩm trong thư viện (bước Sản phẩm tự điền khi đọc từ link) */
  productId?: string;
  /** Link Shopee / TikTok Shop, hoặc tên sản phẩm tự do khi không có trong thư viện */
  link?: string;
  characterId?: string;
  note?: string;
  /** Bản chụp mẫu workflow lúc chạy (chạy tiếp vẫn đúng mẫu dù đã đổi mẫu khác) */
  template?: WorkflowTemplate;
  steps: Record<WorkflowStepId, WorkflowStepState>;
  script?: { scenes: ScriptScene[]; source?: ScriptSource };
  scenes?: WorkflowSceneState[];
  merged?: { url: string; path: string };
  /** Clip sau hậu kỳ (nâng độ phân giải / làm mờ logo) */
  final?: { url: string; path: string };
  /** Ảnh trang phục AI tự tạo cho lượt chạy này (khi khối Trang phục chỉ có mô tả) */
  outfitImage?: string;
  /** Thư mục (tên dự án) chứa file của dòng này */
  project?: string;
  /** Mốc thời gian lần chạy, dùng đặt tên file không trùng */
  stamp?: string;
}

export const WORKFLOW_STEPS: { id: WorkflowStepId; label: string; icon: string }[] = [
  { id: 'product', label: 'Sản phẩm', icon: '🛒' },
  { id: 'script', label: 'Kịch bản', icon: '✍️' },
  { id: 'scenes', label: 'Render cảnh', icon: '🎬' },
  { id: 'merge', label: 'Ghép clip', icon: '🎞' },
  { id: 'post', label: 'Hậu kỳ', icon: '🛠' },
];

export const freshSteps = (): WorkflowRow['steps'] => ({
  product: { status: 'pending' },
  script: { status: 'pending' },
  scenes: { status: 'pending' },
  merge: { status: 'pending' },
  post: { status: 'pending' },
});

/** Dòng lưu từ bản cũ (chưa có bước Hậu kỳ): bổ sung bước còn thiếu. */
export const normalizeRow = (row: WorkflowRow): WorkflowRow => ({ ...row, steps: { ...freshSteps(), ...row.steps } });
