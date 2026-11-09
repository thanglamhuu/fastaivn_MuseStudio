/** Nhân vật định nghĩa sẵn trong Cài đặt: ảnh khóa khuôn mặt + giọng đọc cố định. */
export interface StudioCharacter {
  id: string;
  /** Tên gọi trong prompt. Cảnh có nhắc tên này (hoặc @tên) sẽ dùng ảnh + giọng của nhân vật */
  name: string;
  /** Ngoại hình, tuổi, tính cách... (gắn vào prompt để giữ nhất quán) */
  description: string;
  /** Ảnh tham chiếu (data URL); ảnh đầu tiên là ảnh chính gửi cho muse.ai */
  images: string[];
  /** Ảnh trang phục cố định của nhân vật (tùy chọn) */
  outfitImage?: string;
  /** Hồ sơ giọng Matrix 12 ("voice_02"...) */
  voicePresetId: string;
  /** Giọng gốc Muse khác thay cho giọng gốc của hồ sơ (tùy chọn) */
  museVoiceOverride?: string;
  /** Cảm xúc mặc định khi đọc thoại */
  emotion: string;
  createdAt: number;
}

/** Sản phẩm lưu trong thư viện để dùng lại cho nhiều lô video. */
export interface StudioProduct {
  id: string;
  name: string;
  price: string;
  url: string;
  description: string;
  /** Ngoại hình sản phẩm, gắn vào mọi prompt video để muse.ai không đổi sang sản phẩm khác */
  visual: string;
  /** Ảnh sản phẩm (data URL); ảnh đầu tiên là ảnh chính */
  images: string[];
  createdAt: number;
}

export const newLibraryId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Nhân vật được nhắc trong prompt (theo @tên hoặc tên), ưu tiên tên xuất hiện sớm nhất. */
export const characterInPrompt = (
  prompt: string,
  characters: StudioCharacter[]
): StudioCharacter | undefined => {
  const text = prompt.toLowerCase();
  let best: { c: StudioCharacter; pos: number } | undefined;
  for (const c of characters) {
    const name = c.name.trim().toLowerCase();
    if (!name) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Không dùng \b vì tiếng Việt có dấu; coi chữ/số liền kề là cùng một từ
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])@?${escaped}(?![\\p{L}\\p{N}])`, 'u');
    const m = re.exec(text);
    if (m && (!best || m.index < best.pos)) best = { c, pos: m.index };
  }
  return best?.c;
};
