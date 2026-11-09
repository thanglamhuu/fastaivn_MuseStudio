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
  /** Mẫu có sẵn (không xóa / sửa đè được, chỉ lưu thành bản mới) */
  builtin?: boolean;
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
}

export type WorkflowStepId = 'product' | 'script' | 'scenes' | 'merge';
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
];

export const freshSteps = (): WorkflowRow['steps'] => ({
  product: { status: 'pending' },
  script: { status: 'pending' },
  scenes: { status: 'pending' },
  merge: { status: 'pending' },
});
