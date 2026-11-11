// Bộ dựng prompt "Direct Reference-to-Video" — học từ các prompt HND Muse AI gửi lên muse.ai
// cho ra clip đồng nhất nhân vật + trang phục (thamK/ldnh/PromtClipNuMacAoThamChieuTot.md):
//
//  1. Ảnh chỉ là THAM CHIẾU (không làm khung mở đầu) → cảnh được dựng theo lời mô tả, không bị
//     kéo về nền xám của ảnh chân dung.
//  2. BẢNG ÁNH XẠ ẢNH ở đầu prompt: "Ảnh #N = ai / cái gì + mô tả + khóa gì", đúng thứ tự gửi.
//  3. Lời cảnh nhắc lại "Ảnh #1", "Ảnh #2" thay vì chỉ "the character".
//  4. Khối KHÓA ĐỒNG NHẤT nhắc lại ở CUỐI prompt (model nhớ phần cuối tốt hơn).
//  5. Khóa BỐI CẢNH cố định dùng y nguyên cho mọi cảnh → các cảnh song song khớp nhau khi ghép.
//  6. Khóa KHỚP MIỆNG khi cảnh có thoại; khóa CHÂN THẬT chống "màu nhựa AI".
//  7. Không chèn lại khối khóa nếu prompt đã có sẵn (prompt nhập từ HND đã kèm).
//
// Khác HND: bảng ánh xạ lấy từ chính nhân vật / trang phục / sản phẩm được gửi đi, nên không bị
// lệch kiểu "Image 1: FATHER (@BoGiaDinh)" trong khi cảnh viết về @ModelCatwalkNu.

export type RefRole = 'character' | 'outfit' | 'product' | 'scene' | 'keyframe';

export interface RefImageInfo {
  role: RefRole;
  /** Tên gọi: tên nhân vật (dùng làm @tag), tên sản phẩm */
  name?: string;
  /** Mô tả ngoại hình / trang phục / sản phẩm */
  description?: string;
}

export interface ReferencePromptInput {
  /** Ảnh theo ĐÚNG thứ tự gửi cho muse.ai */
  images: RefImageInfo[];
  scenePrompt: string;
  /** Bối cảnh cố định cho mọi cảnh */
  setting?: string;
  cameraMotion?: string;
  /** [Voice Profile ...] / [DIALOGUE VOICES ...] */
  voiceInfo?: string;
  /** Khóa chân thật chống màu AI (mặc định bật) */
  realism?: boolean;
}

const clip = (s = '', n = 420) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n).replace(/[\s,;.]+\S*$/, '')}…` : t;
};
/** Giữ nguyên tên (kể cả dấu cách) để khớp đúng "@Tên" mà cảnh dùng và characterInPrompt nhận ra. */
const tagOf = (name = '') => name.trim().replace(/^@/, '');

const LOCKS: Record<RefRole, string> = {
  character: 'khóa 100% gương mặt, kiểu tóc, làn da, vóc dáng & giọng nói',
  outfit: 'mặc đúng 100% phom dáng, màu sắc & chất liệu vải',
  product: 'giữ đúng 100% hình dáng, màu sắc, logo & bao bì — tuyệt đối không thay bằng sản phẩm khác',
  scene: 'giữ đúng 100% bối cảnh, bố cục không gian, đồ vật & ánh sáng — mọi cảnh diễn ra tại đây',
  keyframe: 'cảnh bắt đầu đúng từ khung hình này, nối liền mạch với cảnh trước',
};

const labelOf = (img: RefImageInfo) => {
  switch (img.role) {
    case 'character':
      return img.name ? `NHÂN VẬT @${tagOf(img.name)}` : 'NHÂN VẬT';
    case 'outfit':
      return 'TRANG PHỤC';
    case 'product':
      return img.name ? `SẢN PHẨM ${clip(img.name, 80)}` : 'SẢN PHẨM';
    case 'scene':
      return 'BỐI CẢNH';
    case 'keyframe':
      return 'KHUNG MỞ ĐẦU';
  }
};

/** Nội dung "Ảnh #N = ..." cho khối khóa đồng nhất ở cuối prompt. */
const consistencyOf = (img: RefImageInfo, n: number) => {
  const d = img.description ? ` (${clip(img.description, 260)})` : '';
  switch (img.role) {
    case 'character':
      return `Ảnh #${n} = gương mặt, kiểu tóc, làn da, vóc dáng & giọng nói nhân vật${img.name ? ` @${tagOf(img.name)}` : ''}${d}`;
    case 'outfit':
      return `Ảnh #${n} = form dáng, màu sắc & chất liệu trang phục${d}`;
    case 'product':
      return `Ảnh #${n} = đúng sản phẩm${img.name ? ` ${clip(img.name, 80)}` : ''}${d}`;
    case 'scene':
      return `Ảnh #${n} = bối cảnh / không gian cố định${d}`;
    default:
      return '';
  }
};

const has = (text: string, ...markers: string[]) => markers.some((m) => text.toLowerCase().includes(m.toLowerCase()));

/** Cảnh có lời thoại trong ngoặc kép → cần khóa khớp miệng. */
const hasQuotedDialogue = (text: string) => /["“”«»][^"“”«»]{4,}["“”«»]/.test(text);

export const buildReferencePrompt = (input: ReferencePromptInput): string => {
  const scene = input.scenePrompt.trim();
  const imgs = input.images;
  const head: string[] = [];
  const tail: string[] = [];

  // 1. Bảng ánh xạ ảnh (bỏ qua nếu prompt đã tự mang bảng)
  if (imgs.length && !has(scene, 'BẢNG ÁNH XẠ', 'ATTACHMENT ROLES')) {
    const summary = imgs.map((img, i) => `Image ${i + 1}: ${labelOf(img)}`).join('; ');
    const lines = imgs.map((img, i) => {
      const d = img.description ? `: ${clip(img.description)}` : '';
      return `- Ảnh #${i + 1} (Image ${i + 1} — ${labelOf(img)})${d} (${LOCKS[img.role]}).`;
    });
    head.push(`[BẢNG ÁNH XẠ ẢNH THAM CHIẾU ĐÍNH KÈM / ATTACHMENT ROLES (${summary})]:\n${lines.join('\n')}`);
  }
  if (input.cameraMotion) head.push(`[CAMERA: ${input.cameraMotion}, chuyển động máy mượt kiểu điện ảnh]`);
  if (input.voiceInfo) head.push(input.voiceInfo);

  // 2. Khóa đồng nhất nhắc lại ở cuối
  const consistency = imgs.map((img, i) => consistencyOf(img, i + 1)).filter(Boolean);
  if (consistency.length && !has(scene, 'Khóa đồng nhất', 'Ánh xạ đồng nhất')) {
    tail.push(`[Khóa đồng nhất xuyên suốt cảnh: ${consistency.join('; ')}]`);
  }
  if (input.setting?.trim() && !has(scene, 'KHÓA BỐI CẢNH')) {
    tail.push(`[KHÓA BỐI CẢNH CỐ ĐỊNH XUYÊN SUỐT: ${clip(input.setting, 400)} — cố định 100% xuyên suốt mọi cảnh]`);
  }
  const speaker = imgs.find((i) => i.role === 'character');
  if (hasQuotedDialogue(scene) && !speaker && imgs.some((i) => i.role !== 'keyframe') && !has(scene, 'KHÓA KHỚP MIỆNG', '[THOẠI VOICE-OVER')) {
    // Cảnh không có nhân vật (POV chỉ thấy tay, cận sản phẩm): khóa khớp miệng làm model vẽ thêm mặt / môi người
    tail.push('[THOẠI VOICE-OVER: câu trong ngoặc kép là giọng đọc ngoài khung hình, KHÔNG hiện mặt / miệng người nói, chỉ thấy tay và sản phẩm]');
  } else if (hasQuotedDialogue(scene) && !has(scene, 'KHÓA KHỚP MIỆNG')) {
    const who = speaker?.name ? `@${tagOf(speaker.name)} (Ảnh #${imgs.indexOf(speaker) + 1})` : 'nhân vật đang nói';
    tail.push(
      `[KHÓA KHỚP MIỆNG (LIP-SYNC): ${who} nói đúng câu thoại trong ngoặc kép, cử động môi khớp chính xác từng âm tiết tiếng Việt, ` +
        'giọng tự nhiên, ngắt nghỉ lấy hơi như người thật; ngoài nhịp thoại thì khép môi mỉm cười tự nhiên, không nhép môi thừa.]'
    );
  }
  if (input.realism !== false && !has(scene, 'CHỐNG MÀU AI')) {
    tail.push(
      '[KHÓA CHÂN THẬT CHỐNG MÀU AI: quay như camera iPhone 16 Pro Max / Sony FX3 4K thực tế, kết cấu da thật, ánh sáng vật lý chân thực, ' +
        'KHÔNG ám màu nhựa AI, KHÔNG làm mịn giả tạo]'
    );
  }

  return [head.join('\n'), scene, tail.join(' ')].filter(Boolean).join('\n');
};
