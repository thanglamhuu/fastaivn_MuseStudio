// Thư viện giọng đọc "Matrix 12 Voices" điều chỉnh cho muse.ai.
//
// Bản gốc (Google Flow) dùng giọng nền TTS của Gemini (Kore, Fenrir, Aoede...). Muse không có
// các giọng đó: Muse có thư viện giọng riêng (GET /studio/voices, mã dạng "avocado_v2:..."),
// trong đó chỉ 6 giọng được huấn luyện cho tiếng Việt (4 nam, 2 nữ). Vì vậy mỗi hồ sơ dưới đây:
//   1. chọn một GIỌNG GỐC MUSE gần nhất (`museVoiceId`) -> Gateway đặt giọng này cho tài khoản
//      trước khi tạo video (driver HTTP) hoặc ghi vào prompt (driver trình duyệt);
//   2. giữ nguyên tốc độ / cao độ / chất âm của hồ sơ và gắn vào prompt dạng
//      [Voice Profile: ...] để Muse đọc đúng sắc thái.
// Nhiều hồ sơ nữ dùng chung 1 giọng gốc (Muse chỉ có 2 giọng nữ tiếng Việt); điểm khác nhau nằm
// ở chỉ dẫn sắc thái trong prompt. Nhân vật có thể chọn giọng gốc Muse khác trong Cài đặt.

export interface VoiceOption {
  id: string;
  category: 'podcast' | 'tiktok' | 'narrative';
  label: string;
  subLabel: string;
  gender: 'female' | 'male';
  region: string;
  /** Giọng gốc trong thư viện giọng của muse.ai */
  museVoiceId: string;
  museVoiceName: string;
  speed: number;
  pitch: string;
  acousticProfile: string;
  badgeColor: string;
  sampleSentence: string;
}

const MUSE_VI = {
  jetty: { id: 'avocado_v2:vd2_r8_rep5k_3491_v068_28k_g5k', name: 'Jetty tốt bụng' },
  zealous: { id: 'avocado_v2:vd2_r8_rep5k_3494_v068_28k_g5k', name: 'Zealous Harbor' },
  smoky: { id: 'avocado_v2:vd2_smoky_teacup', name: 'Cặp sách nghi ngờ (Smoky Teacup)' },
  mooring: { id: 'avocado_v2:vd2_r8_rep5k_3497_v068_28k_g5k', name: 'Tenacious Mooring' },
  rosette: { id: 'avocado_v2:vd2_r8_rep1k_a131_v068_28k_g5k', name: 'Rosette nồng nàn' },
  whistle: { id: 'avocado_v2:vd2_r8_rep5k_3492_v068_28k_g5k', name: 'Tiếng huýt sáo vui tươi' },
} as const;

const muse = (v: { id: string; name: string }) => ({ museVoiceId: v.id, museVoiceName: v.name });

export const MATRIX_12_VOICES: VoiceOption[] = [
  // === NHÓM GIỌNG NAM (HIỂN THỊ TRƯỚC) ===
  {
    id: 'voice_02',
    category: 'podcast',
    label: '02. Nam Tri Kỷ',
    subLabel: 'Muse: Jetty tốt bụng | vi-VN (Bắc/Nam)',
    gender: 'male',
    region: 'vi-VN (Bắc/Nam)',
    ...muse(MUSE_VI.jetty),
    speed: 0.95,
    pitch: '-5%',
    acousticProfile: 'Warm baritone, empathetic pacing, intimate low-frequency resonance.',
    badgeColor: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
    sampleSentence: 'Hãy thở chậm lại một nhịp, lắng nghe chính mình sau một ngày dài mỏi mệt.',
  },
  {
    id: 'voice_05',
    category: 'podcast',
    label: '05. Nam Lãnh Đạo Hào Sảng',
    subLabel: 'Muse: Zealous Harbor | vi-VN (Bắc)',
    gender: 'male',
    region: 'vi-VN (Bắc)',
    ...muse(MUSE_VI.zealous),
    speed: 1.1,
    pitch: '-2%',
    acousticProfile: 'Commanding baritone, authoritative chest projection.',
    badgeColor: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
    sampleSentence: 'Kỷ luật và tầm nhìn là hai yếu tố duy nhất định hình nên một vị thuyền trưởng thực thụ.',
  },
  {
    id: 'voice_06',
    category: 'podcast',
    label: '06. Nam Trí Thức Điềm Đạm',
    subLabel: 'Muse: Smoky Teacup | vi-VN (Bắc)',
    gender: 'male',
    region: 'vi-VN (Bắc)',
    ...muse(MUSE_VI.smoky),
    speed: 1.0,
    pitch: '-4%',
    acousticProfile: 'Composed baritone, analytical, steady calm cadence.',
    badgeColor: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30',
    sampleSentence: 'Bản chất logic của mọi vấn đề luôn nằm ở những dữ kiện cốt lõi mà chúng ta thường bỏ qua.',
  },
  {
    id: 'voice_11',
    category: 'narrative',
    label: '11. Nam Kỳ Án & Bí Ẩn',
    subLabel: 'Muse: Tenacious Mooring | vi-VN (Bắc)',
    gender: 'male',
    region: 'vi-VN (Bắc)',
    ...muse(MUSE_VI.mooring),
    speed: 0.9,
    pitch: '-10%',
    acousticProfile: 'Ominous whispering low-register, deliberate suspense pauses.',
    badgeColor: 'bg-violet-900/40 text-violet-300 border-violet-500/30',
    sampleSentence: 'Trong màn đêm dày đặc, manh mối duy nhất bị chôn vùi dưới tầng hầm hoang phế.',
  },
  // === NHÓM GIỌNG NỮ (HIỂN THỊ SAU) ===
  {
    id: 'voice_01',
    category: 'podcast',
    label: '01. Nữ Trầm Bản Lĩnh',
    subLabel: 'Muse: Rosette nồng nàn | vi-VN (Bắc)',
    gender: 'female',
    region: 'vi-VN (Bắc)',
    ...muse(MUSE_VI.rosette),
    speed: 1.05,
    pitch: '-8%',
    acousticProfile: 'Deep chest resonance, assertive, cold-stable timbre.',
    badgeColor: 'bg-slate-500/10 text-slate-300 border-slate-500/30',
    sampleSentence: 'Bản lĩnh không nằm ở việc áp đặt, mà là sự tự chủ tĩnh lặng từ sâu bên trong.',
  },
  {
    id: 'voice_03',
    category: 'tiktok',
    label: '03. Nữ Tươi Sáng & Hóm Hỉnh',
    subLabel: 'Muse: Huýt sáo vui tươi | vi-VN (Nam)',
    gender: 'female',
    region: 'vi-VN (Nam)',
    ...muse(MUSE_VI.whistle),
    speed: 1.2,
    pitch: '+12%',
    acousticProfile: 'Bright, crisp treble, bouncy cadence.',
    badgeColor: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
    sampleSentence: 'Bí kíp này siêu đơn giản luôn, áp dụng liền là thấy kết quả bất ngờ liền nghen!',
  },
  {
    id: 'voice_04',
    category: 'podcast',
    label: '04. Nữ Chữa Lành & Tự Sự',
    subLabel: 'Muse: Rosette nồng nàn | vi-VN (Bắc nhẹ)',
    gender: 'female',
    region: 'vi-VN (Bắc nhẹ)',
    ...muse(MUSE_VI.rosette),
    speed: 0.95,
    pitch: '-3%',
    acousticProfile: 'Soft melodic low-register, airy delivery.',
    badgeColor: 'bg-teal-500/10 text-teal-300 border-teal-500/30',
    sampleSentence: 'Vết thương nào rồi cũng sẽ lành, chỉ cần bạn cho bản thân đủ thời gian và sự kiên nhẫn.',
  },
  {
    id: 'voice_07',
    category: 'podcast',
    label: '07. Nữ Trải Đời & Thực Tế',
    subLabel: 'Muse: Rosette nồng nàn | vi-VN (Bắc)',
    gender: 'female',
    region: 'vi-VN (Bắc)',
    ...muse(MUSE_VI.rosette),
    speed: 1.05,
    pitch: '-5%',
    acousticProfile: 'Husky chest voice, candid realism.',
    badgeColor: 'bg-orange-500/10 text-orange-300 border-orange-500/30',
    sampleSentence: 'Đừng mơ mộng viển vông, thực tế cuộc sống chỉ công nhận những gì bạn thật sự tạo ra.',
  },
  {
    id: 'voice_08',
    category: 'narrative',
    label: '08. Nữ Kể Chuyện & Tản Văn',
    subLabel: 'Muse: Rosette nồng nàn | vi-VN (Bắc)',
    gender: 'female',
    region: 'vi-VN (Bắc)',
    ...muse(MUSE_VI.rosette),
    speed: 0.9,
    pitch: '0%',
    acousticProfile: 'Poetic lyrical cadence, tranquil, soft airflow.',
    badgeColor: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
    sampleSentence: 'Cơn mưa chiều buông xuống như nhắc nhở về một miền ký ức đã ngủ yên từ rất lâu.',
  },
  {
    id: 'voice_09',
    category: 'tiktok',
    label: '09. Nữ Chốt Đơn Bùng Nổ',
    subLabel: 'Muse: Huýt sáo vui tươi | vi-VN (Nam/Bắc)',
    gender: 'female',
    region: 'vi-VN (Nam/Bắc)',
    ...muse(MUSE_VI.whistle),
    speed: 1.25,
    pitch: '+15%',
    acousticProfile: 'High tempo, punchy projection, sharp urgency.',
    badgeColor: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
    sampleSentence: 'Cơ hội duy nhất trong phiên hôm nay, nhấn ngay giỏ hàng trước khi hết sạch suất ưu đãi!',
  },
  {
    id: 'voice_10',
    category: 'tiktok',
    label: '10. Nữ Hóng Biến Xéo Xắt',
    subLabel: 'Muse: Huýt sáo vui tươi | vi-VN (Nam)',
    gender: 'female',
    region: 'vi-VN (Nam)',
    ...muse(MUSE_VI.whistle),
    speed: 1.2,
    pitch: '+10%',
    acousticProfile: 'Sarcastic inflection, vocal fry, rapid cadence.',
    badgeColor: 'bg-red-500/10 text-red-300 border-red-500/30',
    sampleSentence: 'Mấy bà nghĩ tự nhiên mà mọi chuyện trót lọt như vậy hả, drama đằng sau còn dài tập lắm nha!',
  },
  {
    id: 'voice_12',
    category: 'tiktok',
    label: '12. Nữ POV Kiêu Kỳ',
    subLabel: 'Muse: Rosette nồng nàn | vi-VN (Bắc)',
    gender: 'female',
    region: 'vi-VN (Bắc)',
    ...muse(MUSE_VI.rosette),
    speed: 1.05,
    pitch: '+5%',
    acousticProfile: 'Haughty superior drawl, detached elegance.',
    badgeColor: 'bg-cyan-900/40 text-cyan-300 border-cyan-500/30',
    sampleSentence: 'Muốn ngồi cùng bàn tiệc với tôi, trước hết hãy chứng minh bạn có đủ tiêu chuẩn tối thiểu.',
  },
];

export const findVoicePreset = (id?: string | null) =>
  id ? MATRIX_12_VOICES.find((v) => v.id === id) : undefined;

/** Giọng thật sự dùng cho 1 cảnh: hồ sơ Matrix (nếu có) + mã giọng Muse gửi lên Gateway. */
export interface ResolvedVoice {
  preset?: VoiceOption;
  /** Mã giọng Muse gửi kèm /v1/videos (Gateway đặt giọng cho tài khoản trước khi tạo) */
  museVoiceId?: string;
  /** Tên hiển thị khi không có hồ sơ Matrix (chọn thẳng giọng gốc Muse) */
  museVoiceName?: string;
}

/**
 * `value` là id hồ sơ Matrix ("voice_02") hoặc mã giọng gốc Muse ("avocado_v2:..."), ví dụ giá
 * trị cũ của ô Giọng đọc. `museOverride` = giọng gốc Muse khác do người dùng chọn cho nhân vật.
 */
export const resolveVoice = (
  value?: string | null,
  museOverride?: string | null,
  museNames: Record<string, string> = {}
): ResolvedVoice => {
  const preset = findVoicePreset(value);
  if (preset) {
    const id = museOverride || preset.museVoiceId;
    return { preset, museVoiceId: id, museVoiceName: museNames[id] || preset.museVoiceName };
  }
  const id = museOverride || value || undefined;
  return id ? { museVoiceId: id, museVoiceName: museNames[id] || id } : {};
};

/**
 * Chỉ thị âm thanh gắn vào prompt video (đặt TRƯỚC câu thoại tiếng Việt), theo mẫu
 * [Voice Profile: ...] của quy trình tích hợp 12 giọng.
 */
export const buildVoiceInfo = (
  voice: ResolvedVoice,
  opts: { emotion?: string; characterName?: string } = {}
): string => {
  const { preset } = voice;
  const who = opts.characterName ? ` | Character: ${opts.characterName}` : '';
  if (preset) {
    return (
      `[Voice Profile: ${preset.label} (${preset.subLabel}), Muse Voice: ${voice.museVoiceName || preset.museVoiceName}, ` +
      `Gender: ${preset.gender}, Speed: ${preset.speed}, Pitch: ${preset.pitch}, Acoustic: ${preset.acousticProfile}, ` +
      `Emotion: ${opts.emotion || 'Natural'}${who}. Keep exactly this same voice in every shot.]`
    );
  }
  if (voice.museVoiceId) {
    return `[Voice Profile: Muse Voice ${voice.museVoiceName || voice.museVoiceId}, Emotion: ${opts.emotion || 'Natural'}${who}. Keep exactly this same voice in every shot.]`;
  }
  return '';
};

export const EMOTION_OPTIONS = [
  'Natural',
  'Warm',
  'Cheerful',
  'Excited',
  'Calm',
  'Serious',
  'Sad',
  'Mysterious',
  'Sarcastic',
  'Confident',
];
