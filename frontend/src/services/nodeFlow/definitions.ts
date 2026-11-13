// Sơ đồ Node kiểu MV1 Muse AI ("flow-workflow"): định nghĩa 12 loại node, cổng nối định kiểu,
// cấu hình của từng node và kiểm tra sơ đồ. Cùng schema với file export của MV1 nên nhập / xuất qua
// lại được (MV1 → MuseStudio và ngược lại).
//
// Cổng: tên cổng bắt đầu bằng loại dữ liệu — text-*, image-*, video-*. Chỉ nối được 2 cổng cùng loại.
// Mỗi cổng vào chỉ nhận 1 dây, trừ image-in của Generate Image / Generate Video / Gemini Script / Tạo thumbnail
// (nhận nhiều ảnh tham chiếu) và mọi cổng của Result.
import { THUMB_CONTENT_TYPES } from './thumbnailPrompt';
import { BACKDROP_DENSITY, BACKDROP_OPTIONS } from '../../data/backdropPresets';

export type NodeType =
  | 'prompt'
  | 'upload-image'
  | 'gemini-script'
  | 'generate-image'
  | 'outfit-swap'
  | 'backdrop'
  | 'thumbnail'
  | 'generate-video'
  | 'upscale-image'
  | 'upscale-video'
  | 'merge-video'
  | 'extract-endframe'
  | 'remove-image-logo'
  | 'remove-video-logo'
  | 'result';

export type PortKind = 'text' | 'image' | 'video';
export type RunStatus = 'idle' | 'queued' | 'running' | 'done' | 'error' | 'skipped';

export interface NodeResult {
  kind: PortKind;
  /** text: nội dung; image/video: URL media của Gateway hoặc data URL */
  value: string;
  /** Đường dẫn file đã xuất ra thư mục dự án (nếu có) */
  path?: string;
  /** Ảnh tham chiếu: khóa gì (1 ảnh có thể khóa nhiều thứ, vd. nhân vật + trang phục + bối cảnh) */
  roles?: RefLock[];
  /** Tên nhân vật / sản phẩm của ảnh tham chiếu */
  name?: string;
  /** Mô tả dùng cho bảng ánh xạ "Ảnh #N" */
  desc?: string;
  /** Mô tả do AI nhìn ảnh viết lại (khóa ƯU TIÊN ẢNH) */
  ai?: string;
}

/** Các thứ 1 ảnh tham chiếu có thể khóa */
export type RefLock = 'character' | 'outfit' | 'product' | 'scene';
export const REF_LOCKS: { id: RefLock; label: string; icon: string }[] = [
  { id: 'character', label: 'Khóa nhân vật', icon: '👤' },
  { id: 'outfit', label: 'Khóa trang phục', icon: '👗' },
  { id: 'product', label: 'Khóa sản phẩm', icon: '📦' },
  { id: 'scene', label: 'Khóa bối cảnh', icon: '🏞️' },
];
/** Khóa của node Upload Image (tương thích workflow cũ / MV1 chỉ có 1 refRole) */
export const locksOf = (d: FlowNodeData): RefLock[] =>
  d.refRoles?.length ? d.refRoles : [(d.refRole || 'character') as RefLock];

export interface FlowNodeData {
  label?: string;
  prompt?: string;
  // upload-image
  image?: string;
  fileName?: string;
  /** MV1: 1 vai trò; MuseStudio: dùng refRoles (tích nhiều khóa) */
  refRole?: 'character' | 'outfit' | 'product' | 'scene';
  refRoles?: RefLock[];
  /** Sản phẩm trong Cài đặt (khi tích Khóa sản phẩm) */
  productId?: string;
  /** Lookbook: dùng ảnh thứ N (0 = ảnh chính) của sản phẩm trong Cài đặt */
  productImageIndex?: number;
  /** Số lần tạo lại node ảnh / video (đổi prompt để Gateway không trả lại kết quả cũ trong bộ đệm) */
  rerun?: number;
  /** Node Prompt: link Shopee / TikTok Shop đã lấy thông tin + tên sản phẩm đã điền vào prompt (lưu ở thư viện) */
  shopeeUrl?: string;
  shopeeProductName?: string;
  /** Bối cảnh chọn từ thư viện (data/backdropPresets) — node Prompt chèn vào cuối, node Tạo bối cảnh vẽ ra */
  backdropId?: string;
  /** Node Tạo bối cảnh: mô tả tự nhập (khi backdropId = 'custom') */
  backdropCustom?: string;
  /** Node Tạo bối cảnh: mật độ sản phẩm bày trong bối cảnh */
  density?: string;
  /** Node Tạo bối cảnh: nhiều ảnh = nhiều góc của 1 nơi (angles) hay mỗi ảnh 1 bối cảnh khác cùng nhóm (mix) */
  variety?: string;
  /** Node Tạo bối cảnh: có người (công nhân / khách) mờ phía xa cho sống động */
  extras?: boolean;
  /** Ảnh cận mặt riêng (khóa nhân vật): ghép cạnh ảnh toàn thân thành 1 ảnh tham chiếu */
  faceImage?: string;
  /** Ảnh tải lên là character sheet 2×2 → tự cắt ô toàn thân + ô cận mặt */
  sheetCrop?: boolean;
  /** Nhân vật trong Cài đặt có ≥2 ảnh → ghép 2 ảnh đầu (mặc định bật) */
  composeFace?: boolean;
  /** AI nhìn ảnh mô tả lại cho khớp ảnh (mặc định bật) + cache mô tả theo ảnh */
  autoDescribe?: boolean;
  aiDescs?: Record<string, string>;
  /** Generate Video: thêm khóa "ưu tiên ảnh tham chiếu" cuối prompt (mặc định bật) */
  imagePriority?: boolean;
  /** Giữ cùng bối cảnh giữa các cảnh video (mặc định bật; false = cho phép đổi địa điểm) */
  lockSetting?: boolean;
  /** Tự chấm mặt ảnh khung hình mở đầu (QC), lệch thì tạo lại ảnh — mặc định bật */
  qcKeyframe?: boolean;
  /** Generate Video: tự đo giọng của clip, sai giới tính so với giọng người nói (Cài đặt ➔ Nhân vật) thì tạo lại cảnh (mặc định bật) */
  qcVoice?: boolean;
  /** Kết quả chấm điểm lượt chạy gần nhất (không xuất ra file sơ đồ) */
  qc?: { keyframe?: { name: string; best: number | null }[]; keyframeScore?: number; keyframeTries?: number };
  /** Generate Video: tạo ảnh khung hình trước (muse-image + tham chiếu) làm khung mở đầu (mặc định bật) */
  keyframeFirst?: boolean;
  /** Ảnh khung hình mở đầu đã tạo (để xem) */
  keyframe?: string;
  memberRole?: string;
  characterName?: string;
  characterTag?: string;
  sheetPrompt?: string;
  characterId?: string;
  // gemini-script
  outputCount?: number;
  sceneSeconds?: number;
  firstOutputIsCharacter?: boolean;
  // generate-image / generate-video
  imageMode?: 'text-to-image' | 'image-to-image';
  videoMode?: 'text-to-video' | 'image-to-video' | 'reference-to-video' | 'frame-to-frame';
  ratio?: string;
  duration?: number;
  count?: number;
  voice?: string;
  // merge-video
  portCount?: number;
  // upscale
  resolution?: string;
  // remove-logo
  spots?: string[];
  // batch (giữ từ MV1)
  batchRole?: string;
  batchLabel?: string;
  batchKey?: string;
  batchOrder?: number;
  // runtime
  runStatus?: RunStatus;
  error?: string;
  results?: NodeResult[];
  progress?: number;
  startedAt?: number;
  finishedAt?: number;
  [key: string]: unknown;
}

export interface FlowNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: FlowNodeData;
}

export interface FlowEdge {
  id: string;
  source: string;
  sourceHandle?: string | null;
  target: string;
  targetHandle?: string | null;
}

export interface FlowWorkflow {
  id: string;
  kind: 'flow-workflow';
  schemaVersion: 1;
  name: string;
  description: string;
  category?: string;
  /** Mẫu gốc (vd. hnd-women-outfit) */
  templateId?: string;
  videoUrl?: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  updatedAt?: number;
}

export interface FieldDef {
  key: keyof FlowNodeData & string;
  label: string;
  /** mention = textarea có gợi ý @nhân vật / @@sản phẩm; locks = tích nhiều khóa tham chiếu */
  type: 'text' | 'textarea' | 'mention' | 'number' | 'select' | 'checkbox' | 'spots' | 'locks' | 'productLink';
  options?: [string, string][];
  min?: number;
  max?: number;
  hint?: string;
  /** Chỉ hiện khi điều kiện đúng */
  when?: (d: FlowNodeData) => boolean;
}

export interface NodeDef {
  label: string;
  group: 'Input' | 'Generate' | 'Process' | 'Output';
  color: string;
  icon: string;
  /** Vai trò của node (hiện trong bảng chọn node + inspector) */
  role: string;
  fields: FieldDef[];
  defaults: FlowNodeData;
}

export const RATIOS: [string, string][] = [
  ['9:16', '9:16 (dọc)'],
  ['16:9', '16:9 (ngang)'],
  ['1:1', '1:1 (vuông)'],
];

export const LOGO_SPOTS: { id: string; label: string; region: { x: number; y: number; w: number; h: number } }[] = [
  { id: 'tl', label: 'Trên trái', region: { x: 0.02, y: 0.02, w: 0.34, h: 0.08 } },
  { id: 'tr', label: 'Trên phải', region: { x: 0.64, y: 0.02, w: 0.34, h: 0.08 } },
  { id: 'bl', label: 'Dưới trái', region: { x: 0.02, y: 0.9, w: 0.34, h: 0.08 } },
  { id: 'br', label: 'Dưới phải', region: { x: 0.64, y: 0.9, w: 0.34, h: 0.08 } },
];

/** Vai trong gia đình (trường memberRole của sơ đồ MV1) — đã ẩn khỏi giao diện vì không bước chạy nào dùng; giữ để đọc / xuất sơ đồ cũ */
export const MEMBER_ROLES: [string, string][] = [
  ['custom', '✍️ Tự nhập'],
  ['father', '👨 Bố'],
  ['mother', '👩 Mẹ'],
  ['son', '👦 Con trai'],
  ['child', '👧 Con gái'],
  ['baby_boy', '👶 Em trai út'],
  ['baby', '👶 Em gái út'],
  ['grandfather', '👴 Ông'],
  ['grandmother', '👵 Bà'],
  ['teacher', '👩‍🏫 Thầy / cô giáo'],
];

export const NODE_DEFS: Record<NodeType, NodeDef> = {
  prompt: {
    label: 'Prompt',
    group: 'Input',
    color: '#0284c7',
    icon: '✏️',
    role: 'Đoạn văn bản cố định (prompt cảnh, yêu cầu cho AI). Xuất ra cổng text-out.',
    fields: [
      { key: 'shopeeUrl', label: '🛒 Link Shopee / TikTok Shop (tự lấy thông tin sản phẩm)', type: 'productLink' },
      { key: 'prompt', label: 'Prompt', type: 'mention', hint: 'Gõ @ chọn nhân vật, @@ chọn sản phẩm trong Cài đặt — ảnh + mô tả của chúng tự gửi kèm khi render' },
      {
        key: 'backdropId',
        label: '🏭 Bối cảnh từ thư viện (chèn vào cuối prompt)',
        type: 'select',
        options: [['', '— Không chọn —'], ...BACKDROP_OPTIONS],
      },
    ],
    defaults: { prompt: '' },
  },
  'upload-image': {
    label: 'Upload Image',
    group: 'Input',
    color: '#ea580c',
    icon: '🖼️',
    role:
      'Ảnh tham chiếu khóa Nhân vật / Trang phục / Sản phẩm / Bối cảnh (tích được nhiều khóa cùng lúc). Tích Khóa nhân vật / ' +
      'sản phẩm thì chọn được nhân vật / sản phẩm trong Cài đặt (dùng ảnh + mô tả của nó). Ảnh tự gửi kèm mọi node Generate phía sau ' +
      '(Reference-to-Video). Không có ảnh = AI tự tạo ảnh từ "Mô tả khóa tham chiếu" lúc chạy.',
    fields: [
      { key: 'refRoles', label: 'Khóa tham chiếu (tích nhiều)', type: 'locks' },
      { key: 'characterName', label: 'Tên nhân vật (@tag)', type: 'text', when: (d) => locksOf(d).includes('character') && !d.characterId },
      { key: 'prompt', label: 'Mô tả khóa tham chiếu', type: 'mention', hint: 'Dùng cho bảng ánh xạ ảnh + để AI tự tạo ảnh khi để trống' },
      {
        key: 'sheetCrop',
        label: '✂️ Ảnh tải lên là character sheet 2×2 → tự cắt toàn thân + cận mặt (mặt to, giống hơn)',
        type: 'checkbox',
        when: (d) => locksOf(d).includes('character') && !d.characterId,
      },
      { key: 'autoDescribe', label: '🔍 AI nhìn ảnh mô tả lại cho khớp ảnh (tăng độ giống)', type: 'checkbox' },
    ],
    defaults: { refRoles: ['character'], characterName: '', prompt: '', autoDescribe: true },
  },
  'gemini-script': {
    label: 'Gemini Script',
    group: 'Generate',
    color: '#0d9488',
    icon: '🧠',
    role:
      'AI (Gemini / OpenAI, dự phòng muse-chat) viết N đoạn prompt cảnh theo khung kịch tính, mỗi đoạn ra 1 cổng ' +
      'text-out-i. Nhận text-in (ý tưởng) + image-in (ảnh tham chiếu để AI nhìn).',
    fields: [
      { key: 'prompt', label: 'Yêu cầu / ý tưởng', type: 'mention' },
      { key: 'outputCount', label: 'Số đoạn (số cổng ra)', type: 'number', min: 1, max: 12 },
      { key: 'sceneSeconds', label: 'Giây mỗi cảnh', type: 'number', min: 2, max: 10 },
      { key: 'firstOutputIsCharacter', label: 'Đoạn 1 là prompt ảnh nhân vật gốc', type: 'checkbox' },
    ],
    defaults: { prompt: '', outputCount: 3, sceneSeconds: 10, firstOutputIsCharacter: false },
  },
  'generate-image': {
    label: 'Generate Image (Muse)',
    group: 'Generate',
    color: '#06b6d4',
    icon: '🎨',
    role: 'Tạo ảnh bằng muse-image. Image→Image: gửi kèm ảnh nối vào image-in và ảnh tham chiếu phía trước.',
    fields: [
      {
        key: 'imageMode',
        label: 'Chế độ',
        type: 'select',
        options: [
          ['text-to-image', 'Text → Image'],
          ['image-to-image', 'Image → Image'],
        ],
      },
      { key: 'ratio', label: 'Tỉ lệ', type: 'select', options: RATIOS },
      { key: 'count', label: 'Số ảnh', type: 'number', min: 1, max: 4 },
      { key: 'prompt', label: 'Prompt (khi không nối text-in)', type: 'mention' },
    ],
    defaults: { imageMode: 'text-to-image', ratio: '9:16', count: 1, prompt: '' },
  },
  'outfit-swap': {
    label: 'Ghép trang phục',
    group: 'Generate',
    color: '#d946ef',
    icon: '👗',
    role:
      'Cho NHÂN VẬT mặc BỘ TRANG PHỤC: nối Upload Image nhân vật vào cổng 👤 nhân vật, Upload Image bộ quần áo vào cổng 👕 trang phục ' +
      '(ảnh có người mẫu mặc cũng được — chỉ lấy quần áo). Ra 1 ảnh nhân vật mặc đồ; nối ảnh này vào Generate Video thì nó khóa cả ' +
      'nhân vật lẫn trang phục. Tự chấm mặt so với ảnh nhân vật, lệch thì tạo lại.',
    fields: [
      {
        key: 'background',
        label: 'Bối cảnh',
        type: 'select',
        options: [
          ['studio', 'Nền studio trơn (ảnh tham chiếu sạch)'],
          ['keep', 'Giữ bối cảnh ảnh nhân vật'],
          ['prompt', 'Theo mô tả bên dưới'],
        ],
      },
      { key: 'ratio', label: 'Tỉ lệ', type: 'select', options: RATIOS },
      { key: 'count', label: 'Số ảnh', type: 'number', min: 1, max: 4 },
      { key: 'prompt', label: 'Mô tả thêm (tư thế, bối cảnh…) — khi không nối text-in', type: 'mention' },
      { key: 'qcKeyframe', label: '😀 Tự chấm mặt so với ảnh nhân vật, lệch thì tạo lại (tối đa 2 lần)', type: 'checkbox' },
    ],
    defaults: { background: 'studio', ratio: '9:16', count: 1, prompt: '', qcKeyframe: true },
  },
  backdrop: {
    label: 'Tạo bối cảnh',
    group: 'Generate',
    color: '#0d9488',
    icon: '🏭',
    role:
      'Vẽ ẢNH BỐI CẢNH KHÔNG NGƯỜI (kho, xưởng, cửa hàng lớn, sạp chợ…) từ thư viện bối cảnh, có thể bày CHÍNH sản phẩm nối vào ' +
      'image-in xếp đầy kệ / quầy / nguyên kho. Ảnh ra khóa BỐI CẢNH: nối vào Generate Image / Generate Video thì mọi cảnh render ' +
      'song song vẫn đúng một nơi. Nhiều ảnh: nhiều góc của cùng 1 nơi, hoặc mỗi ảnh 1 bối cảnh khác cùng nhóm (cho nhiều video).',
    fields: [
      { key: 'backdropId', label: 'Bối cảnh', type: 'select', options: [...BACKDROP_OPTIONS, ['custom', '✍️ Tự mô tả bối cảnh']] },
      { key: 'backdropCustom', label: 'Mô tả bối cảnh', type: 'textarea', when: (d) => d.backdropId === 'custom' },
      { key: 'density', label: 'Sản phẩm trong bối cảnh', type: 'select', options: BACKDROP_DENSITY },
      {
        key: 'variety',
        label: 'Nhiều ảnh thì',
        type: 'select',
        options: [
          ['angles', 'Cùng 1 nơi, mỗi ảnh 1 góc / 1 khu (các cảnh của 1 video)'],
          ['mix', 'Mỗi ảnh 1 bối cảnh khác trong cùng nhóm (nhiều video)'],
        ],
      },
      { key: 'extras', label: '👷 Có người mờ phía xa (công nhân / khách) cho sống động', type: 'checkbox' },
      { key: 'ratio', label: 'Tỉ lệ', type: 'select', options: RATIOS },
      { key: 'count', label: 'Số ảnh', type: 'number', min: 1, max: 6 },
      { key: 'prompt', label: 'Mô tả thêm (khi không nối text-in)', type: 'mention' },
    ],
    defaults: { backdropId: 'kho-tong', density: 'full', variety: 'angles', extras: false, ratio: '9:16', count: 1, prompt: '' },
  },
  thumbnail: {
    label: 'Tạo thumbnail',
    group: 'Generate',
    color: '#f59e0b',
    icon: '🖼',
    role:
      'Ảnh bìa (thumbnail) cho TikTok / YouTube Shorts / Facebook Reels theo phong cách FastAIVN: viral, chữ lớn đậm đúng dấu tiếng Việt, ' +
      'giữ nhân vật + sản phẩm như ảnh gốc. Nguồn: ảnh nối vào image-in (khung hình, ảnh ghép trang phục…) hoặc khung trích từ video ' +
      'nối vào video-in; tự kèm ảnh nhân vật / sản phẩm của các Upload Image phía trước để giữ đúng mặt + sản phẩm. Để trống tiêu đề + ' +
      'nối kịch bản vào text-in thì AI tự viết tiêu đề.',
    fields: [
      { key: 'title', label: 'Tiêu đề chính (TITLE) — viết đúng từng chữ', type: 'text' },
      { key: 'subtitle', label: 'Subtitle', type: 'text' },
      {
        key: 'ratio',
        label: 'Tỉ lệ',
        type: 'select',
        options: [
          ['9:16', '9:16 (TikTok / Shorts / Reels)'],
          ['16:9', '16:9 (YouTube ngang / Facebook)'],
          ['1:1', '1:1 (vuông)'],
        ],
      },
      { key: 'contentType', label: 'Kiểu nội dung', type: 'select', options: THUMB_CONTENT_TYPES },
      {
        key: 'textPlacement',
        label: 'Vị trí chữ',
        type: 'select',
        options: [
          ['auto', 'Tự chọn theo bố cục'],
          ['bottom-third', 'Nội dung nằm 1/3 dưới'],
        ],
      },
      { key: 'autoText', label: '✍️ Để trống tiêu đề thì AI tự viết title + subtitle từ kịch bản nối vào text-in', type: 'checkbox' },
      { key: 'frameTime', label: 'Lấy khung hình ở giây thứ (khi nối video-in)', type: 'number', min: 0, max: 60 },
      { key: 'count', label: 'Số ảnh', type: 'number', min: 1, max: 4 },
      { key: 'prompt', label: 'Yêu cầu thêm (màu, hiệu ứng, bố cục…)', type: 'mention' },
    ],
    defaults: { title: '', subtitle: '', ratio: '9:16', contentType: 'auto', textPlacement: 'auto', autoText: true, frameTime: 3, count: 1, prompt: '' },
  },
  'generate-video': {
    label: 'Generate Video (Muse)',
    group: 'Generate',
    color: '#10b981',
    icon: '🎬',
    role:
      'Tạo video bằng muse-video. Text→Video: chỉ prompt. Image→Video: ảnh đầu làm khung mở đầu. ' +
      'Reference→Video (như MV1): mọi ảnh là tham chiếu + bảng ánh xạ "Ảnh #N". Frame→Frame: image-in-start làm khung đầu.',
    fields: [
      {
        key: 'videoMode',
        label: 'Chế độ',
        type: 'select',
        options: [
          ['text-to-video', 'Text to Video'],
          ['image-to-video', 'Image to Video'],
          ['reference-to-video', 'Reference to Video'],
          ['frame-to-frame', 'Frame to Frame'],
        ],
      },
      { key: 'ratio', label: 'Tỉ lệ', type: 'select', options: RATIOS },
      {
        key: 'duration',
        label: 'Thời lượng (giây)',
        type: 'select',
        options: [
          ['4', '4s'],
          ['6', '6s'],
          ['8', '8s'],
          ['10', '10s'],
        ],
      },
      { key: 'prompt', label: 'Prompt (khi không nối text-in)', type: 'mention' },
      { key: 'imagePriority', label: '🔒 Khóa "ưu tiên ảnh tham chiếu" cuối prompt (chữ khác ảnh thì theo ảnh)', type: 'checkbox' },
      { key: 'lockSetting', label: '🏠 Giữ cùng bối cảnh với các cảnh khác (không tự nhảy địa điểm)', type: 'checkbox' },
      {
        key: 'qcKeyframe',
        label: '😀 Tự chấm mặt ảnh khung hình, lệch thì tạo lại ảnh (tối đa 2 lần) trước khi tạo video',
        type: 'checkbox',
        when: (d) => d.keyframeFirst !== false && (d.videoMode || 'text-to-video') !== 'text-to-video',
      },
      {
        key: 'qcVoice',
        label: '🎙 Tự kiểm giọng: người nói là nam / nữ mà clip đọc sai giới tính thì tạo lại cảnh (tối đa 2 lần)',
        type: 'checkbox',
      },
      {
        key: 'keyframeFirst',
        label: '🖼 Tạo ảnh khung hình trước rồi mới tạo video (mặt giống hơn nhiều, thêm ~1 phút / cảnh)',
        type: 'checkbox',
        when: (d) => (d.videoMode || 'text-to-video') !== 'text-to-video',
      },
    ],
    defaults: { videoMode: 'reference-to-video', ratio: '9:16', duration: 10, prompt: '', imagePriority: true, keyframeFirst: true, lockSetting: true, qcKeyframe: true, qcVoice: true },
  },
  'upscale-image': {
    label: 'Upscale Image (2K/4K)',
    group: 'Process',
    color: '#0891b2',
    icon: '⬆️',
    role: 'Nâng độ phân giải ảnh (FFmpeg lanczos + làm nét).',
    fields: [{ key: 'resolution', label: 'Độ phân giải', type: 'select', options: [['2K', '2K'], ['4K', '4K']] }],
    defaults: { resolution: '2K' },
  },
  'upscale-video': {
    label: 'Upscale Video',
    group: 'Process',
    color: '#0f9f9a',
    icon: '⬆️',
    role: 'Nâng độ phân giải video (cạnh ngắn 1080 / 2160).',
    fields: [{ key: 'resolution', label: 'Độ phân giải', type: 'select', options: [['1080P', '1080P'], ['4K', '4K']] }],
    defaults: { resolution: '1080P' },
  },
  'merge-video': {
    label: 'Merge Video',
    group: 'Process',
    color: '#d97706',
    icon: '🎞️',
    role: 'Ghép video theo thứ tự cổng video-in-0, video-in-1… bằng FFmpeg.',
    fields: [{ key: 'portCount', label: 'Số cổng video', type: 'number', min: 2, max: 20 }],
    defaults: { portCount: 2 },
  },
  'extract-endframe': {
    label: 'Trích frame cuối',
    group: 'Process',
    color: '#f59e0b',
    icon: '🖼️',
    role: 'Cắt khung hình cuối của video thành ảnh — nối vào cảnh sau để quay liền mạch.',
    fields: [],
    defaults: {},
  },
  'remove-image-logo': {
    label: 'Xóa logo ảnh',
    group: 'Process',
    color: '#dc2626',
    icon: '🫥',
    role: 'Làm mờ vùng logo / watermark ở góc ảnh.',
    fields: [{ key: 'spots', label: 'Vùng làm mờ', type: 'spots' }],
    defaults: { spots: ['br'] },
  },
  'remove-video-logo': {
    label: 'Xóa logo video',
    group: 'Process',
    color: '#dc2626',
    icon: '🫥',
    role: 'Làm mờ vùng logo / watermark ở góc video.',
    fields: [{ key: 'spots', label: 'Vùng làm mờ', type: 'spots' }],
    defaults: { spots: ['br'] },
  },
  result: {
    label: 'Result / Output',
    group: 'Output',
    color: '#059669',
    icon: '📂',
    role: 'Thu kết quả cuối; video / ảnh được chép vào thư mục dự án (Downloads\\MuseStudio\\<tên workflow>).',
    fields: [],
    defaults: {},
  },
};

export const NODE_GROUPS: NodeDef['group'][] = ['Input', 'Generate', 'Process', 'Output'];

export const portKind = (handle?: string | null): PortKind | '' => {
  const h = String(handle || '').toLowerCase();
  return h.startsWith('text-') ? 'text' : h.startsWith('image-') ? 'image' : h.startsWith('video-') ? 'video' : '';
};

export const PORT_COLOR: Record<PortKind, string> = { text: '#38bdf8', image: '#fb923c', video: '#34d399' };

/** Nhãn dễ đọc cho cổng có tên riêng (còn lại hiện tên cổng) */
export const PORT_LABEL: Record<string, string> = {
  'image-in-character': '👤 nhân vật',
  'image-in-outfit': '👕 trang phục',
  'image-in-start': 'ảnh đầu',
  'image-in-end': 'ảnh cuối',
};

/** Cổng vào / ra của node (phụ thuộc cấu hình: chế độ, số cổng...). */
export const nodePorts = (node: Pick<FlowNode, 'type' | 'data'>): { inputs: string[]; outputs: string[] } => {
  const d = node.data || {};
  switch (node.type) {
    case 'prompt':
      return { inputs: [], outputs: ['text-out'] };
    case 'upload-image':
      return { inputs: [], outputs: ['image-out'] };
    case 'gemini-script':
      return {
        inputs: ['text-in', 'image-in'],
        outputs: Array.from({ length: Math.max(1, Number(d.outputCount) || 1) }, (_, i) => `text-out-${i}`),
      };
    case 'generate-image':
      return { inputs: d.imageMode === 'image-to-image' ? ['text-in', 'image-in'] : ['text-in'], outputs: ['image-out'] };
    case 'outfit-swap':
      return { inputs: ['image-in-character', 'image-in-outfit', 'text-in'], outputs: ['image-out'] };
    case 'thumbnail':
      return { inputs: ['image-in', 'video-in', 'text-in'], outputs: ['image-out'] };
    case 'backdrop':
      return { inputs: ['image-in', 'text-in'], outputs: ['image-out'] };
    case 'generate-video': {
      const m = d.videoMode || 'text-to-video';
      const inputs =
        m === 'text-to-video' ? ['text-in'] : m === 'frame-to-frame' ? ['text-in', 'image-in-start', 'image-in-end', 'image-in'] : ['text-in', 'image-in'];
      return { inputs, outputs: ['video-out'] };
    }
    case 'upscale-image':
    case 'remove-image-logo':
      return { inputs: ['image-in'], outputs: ['image-out'] };
    case 'upscale-video':
    case 'remove-video-logo':
      return { inputs: ['video-in'], outputs: ['video-out'] };
    case 'extract-endframe':
      return { inputs: ['video-in'], outputs: ['image-out'] };
    case 'merge-video':
      return { inputs: Array.from({ length: Math.max(2, Number(d.portCount) || 2) }, (_, i) => `video-in-${i}`), outputs: ['video-out'] };
    case 'result':
      return { inputs: ['text-in', 'image-in', 'video-in'], outputs: [] };
  }
};

export const acceptsMultiple = (type: NodeType, handle: string) =>
  type === 'result' ||
  (handle === 'image-in' && ['generate-image', 'generate-video', 'gemini-script', 'thumbnail', 'backdrop'].includes(type)) ||
  (handle === 'video-in' && type === 'thumbnail') ||
  (handle === 'text-in' && type === 'thumbnail');

let seq = 0;
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const makeNode = (type: NodeType, x: number, y: number): FlowNode => ({
  id: newId('node'),
  type,
  position: { x, y },
  data: JSON.parse(JSON.stringify(NODE_DEFS[type].defaults)),
});

export const emptyWorkflow = (name = 'Workflow mới'): FlowWorkflow => ({
  id: newId('wf'),
  kind: 'flow-workflow',
  schemaVersion: 1,
  name,
  description: '',
  nodes: [],
  edges: [],
  updatedAt: Date.now(),
});

/** Kiểm tra nối dây giữa 2 cổng (dùng khi kéo dây trên sơ đồ). */
export const connectionError = (
  wf: Pick<FlowWorkflow, 'nodes' | 'edges'>,
  c: { source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }
): string => {
  if (c.source === c.target) return 'Không nối node vào chính nó.';
  const s = wf.nodes.find((n) => n.id === c.source);
  const t = wf.nodes.find((n) => n.id === c.target);
  if (!s || !t) return 'Node không tồn tại.';
  const sk = portKind(c.sourceHandle);
  const tk = portKind(c.targetHandle);
  if (!sk || sk !== tk) return `Không nối được ${c.sourceHandle} → ${c.targetHandle} (khác loại dữ liệu).`;
  if (!nodePorts(s).outputs.includes(String(c.sourceHandle))) return `Cổng ra ${c.sourceHandle} không còn.`;
  if (!nodePorts(t).inputs.includes(String(c.targetHandle))) return `Cổng vào ${c.targetHandle} không còn.`;
  const dup = wf.edges.some(
    (e) => e.source === c.source && e.sourceHandle === c.sourceHandle && e.target === c.target && e.targetHandle === c.targetHandle
  );
  if (dup) return 'Dây này đã có.';
  if (!acceptsMultiple(t.type, String(c.targetHandle)) && wf.edges.some((e) => e.target === c.target && e.targetHandle === c.targetHandle)) {
    return `Cổng ${c.targetHandle} chỉ nhận 1 dây.`;
  }
  return '';
};

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  order: string[];
}

/** Kiểm tra toàn sơ đồ (như validate_graph của MV1) + trả thứ tự chạy (topo). */
export const validateWorkflow = (wf: Pick<FlowWorkflow, 'nodes' | 'edges'>): ValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!wf.nodes.length) return { ok: false, errors: ['Sơ đồ chưa có node nào.'], warnings, order: [] };
  const ids = new Set<string>();
  wf.nodes.forEach((n) => {
    if (ids.has(n.id)) errors.push(`Trùng id node ${n.id}.`);
    ids.add(n.id);
    if (!NODE_DEFS[n.type]) errors.push(`Loại node không hỗ trợ: ${n.type}.`);
  });
  const indeg = new Map(wf.nodes.map((n) => [n.id, 0]));
  const out = new Map<string, string[]>(wf.nodes.map((n) => [n.id, []]));
  const used = new Set<string>();
  wf.edges.forEach((e) => {
    const s = wf.nodes.find((n) => n.id === e.source);
    const t = wf.nodes.find((n) => n.id === e.target);
    if (!s || !t) return errors.push('Có dây nối tới node không tồn tại.');
    const sk = portKind(e.sourceHandle);
    if (!sk || sk !== portKind(e.targetHandle)) errors.push(`Dây ${e.sourceHandle} → ${e.targetHandle} khác loại dữ liệu.`);
    if (!nodePorts(s).outputs.includes(String(e.sourceHandle))) errors.push(`${NODE_DEFS[s.type].label}: không có cổng ra ${e.sourceHandle}.`);
    if (!nodePorts(t).inputs.includes(String(e.targetHandle))) errors.push(`${NODE_DEFS[t.type].label}: không có cổng vào ${e.targetHandle}.`);
    const key = `${e.target}|${e.targetHandle}`;
    if (used.has(key) && !acceptsMultiple(t.type, String(e.targetHandle))) errors.push(`${NODE_DEFS[t.type].label}: cổng ${e.targetHandle} có nhiều hơn 1 dây.`);
    used.add(key);
    out.get(e.source)!.push(e.target);
    indeg.set(e.target, (indeg.get(e.target) || 0) + 1);
  });
  const queue = wf.nodes.filter((n) => !indeg.get(n.id)).map((n) => n.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    out.get(id)!.forEach((t) => {
      indeg.set(t, indeg.get(t)! - 1);
      if (indeg.get(t) === 0) queue.push(t);
    });
  }
  if (order.length !== wf.nodes.length) errors.push('Sơ đồ bị nối vòng.');
  const hasOutput = wf.nodes.some((n) => n.type === 'result') || wf.nodes.some((n) => n.type !== 'prompt' && n.type !== 'upload-image' && !out.get(n.id)!.length);
  if (!hasOutput) errors.push('Cần ít nhất 1 node Result / Output.');
  wf.nodes.forEach((n) => {
    const p = nodePorts(n);
    const connectedIn = wf.edges.some((e) => e.target === n.id);
    if (p.inputs.length && !connectedIn && !['generate-image', 'generate-video', 'gemini-script', 'thumbnail'].includes(n.type)) {
      warnings.push(`${n.data.batchLabel || NODE_DEFS[n.type].label}: chưa nối đầu vào.`);
    }
    if (n.type === 'merge-video') {
      const filled = wf.edges.filter((e) => e.target === n.id).length;
      if (filled < 2) warnings.push(`Merge Video: mới nối ${filled} video.`);
    }
  });
  return { ok: !errors.length, errors: [...new Set(errors)], warnings, order };
};

/** Các node phía sau (kể cả chính nó) — dùng cho "Chạy lại từ node này". */
export const downstreamOf = (wf: Pick<FlowWorkflow, 'edges'>, id: string): Set<string> => {
  const seen = new Set([id]);
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    wf.edges.filter((e) => e.source === cur).forEach((e) => {
      if (!seen.has(e.target)) {
        seen.add(e.target);
        stack.push(e.target);
      }
    });
  }
  return seen;
};
