import type { AspectRatio } from '../types/videoStudio';

/**
 * Đọc ảnh người dùng chọn, thu nhỏ để cạnh dài tối đa `maxSide` px và nén JPEG.
 * Giữ thư viện nhân vật / sản phẩm nhẹ (ảnh điện thoại 4000px nặng vài MB mỗi tấm).
 */
export const fileToResizedDataUrl = (file: File, maxSide = 1280, quality = 0.9): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Không đọc được ${file.name}`));
    reader.onload = () => {
      const src = reader.result as string;
      const img = new Image();
      img.onerror = () => resolve(src); // định dạng lạ: giữ nguyên
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        if (scale === 1 && file.size < 600_000) return resolve(src);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(src);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });

/** Lớp Tailwind giữ đúng tỉ lệ khung cho thumbnail / video (mặc định 9:16). */
export const aspectClass = (ratio?: AspectRatio | string) => {
  switch (ratio) {
    case '16:9':
      return 'aspect-video';
    case '1:1':
      return 'aspect-square';
    case '4:3':
      return 'aspect-[4/3]';
    case '3:4':
      return 'aspect-[3/4]';
    default:
      return 'aspect-[9/16]';
  }
};

/** Lưới thẻ cảnh: khung dọc thì xếp nhiều cột hơn để thẻ không quá cao. */
export const sceneGridClass = (ratio?: AspectRatio | string) =>
  ratio === '16:9' || ratio === '4:3'
    ? 'grid grid-cols-1 md:grid-cols-2 gap-4'
    : 'grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-4 gap-3';

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Không đọc được ảnh'));
    img.src = src;
  });

type Part = { img: HTMLImageElement; sx: number; sy: number; sw: number; sh: number };

/** Xếp các phần ảnh cạnh nhau, cùng chiều cao `height`, khoảng trắng 8px. */
const hstack = (parts: Part[], height = 900): string => {
  const widths = parts.map((p) => Math.round((p.sw / p.sh) * height));
  const canvas = document.createElement('canvas');
  canvas.width = widths.reduce((a, b) => a + b, 0) + 8 * (parts.length - 1);
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let x = 0;
  parts.forEach((p, i) => {
    ctx.drawImage(p.img, p.sx, p.sy, p.sw, p.sh, x, 0, widths[i], height);
    x += widths[i] + 8;
  });
  return canvas.toDataURL('image/jpeg', 0.9);
};

/**
 * Ảnh tham chiếu nhân vật "toàn thân | cận mặt" ghép thành 1 ảnh: muse.ai giữ mặt tốt hơn hẳn khi mặt to
 * (thí nghiệm mẫu Gia đình: tỉ lệ khung hình đúng người Bố 24% → 65%, Con 53% → 78%) mà vẫn thấy trang phục,
 * và chỉ tốn 1 suất ảnh tham chiếu (muse.ai nhận tối đa 4 ảnh / video).
 */
export const composeSideBySide = async (fullBody: string, face: string): Promise<string> => {
  const [a, b] = await Promise.all([loadImage(fullBody), loadImage(face)]);
  return hstack([
    { img: a, sx: 0, sy: 0, sw: a.width, sh: a.height },
    { img: b, sx: 0, sy: 0, sw: b.width, sh: b.height },
  ]);
};

/** Character sheet 2×2 (trước | nghiêng / sau | cận mặt — kiểu MV1): lấy ô trên-trái (toàn thân) + ô dưới-phải (cận mặt). */
export const cropCharacterSheet = async (sheet: string): Promise<string> => {
  const img = await loadImage(sheet);
  const w = img.width / 2;
  const h = img.height / 2;
  return hstack([
    { img, sx: 0, sy: 0, sw: w, sh: h },
    { img, sx: w, sy: h, sw: w, sh: h },
  ]);
};

/** Tải ảnh từ URL (vd. media của Gateway) rồi thu nhỏ thành data URL để lưu / gửi lại cho muse.ai. */
export const urlToResizedDataUrl = async (url: string, maxSide = 1280): Promise<string> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Không tải được ảnh (HTTP ${res.status})`);
  const blob = await res.blob();
  return fileToResizedDataUrl(new File([blob], 'image', { type: blob.type }), maxSide);
};

/**
 * Ảnh tham chiếu nhân vật quá nhỏ (vd. sheet 640×480 → mặt 320×240) làm Muse giữ mặt kém (đo được 6-40% khung đúng người);
 * phóng to lên `target` px cạnh dài (nội suy chất lượng cao, nhiều bước) trước khi gửi. Ảnh đủ lớn hoặc không đọc được: giữ nguyên.
 */
export const upscaleIfSmall = async (src: string, minSide = 1024, target = 1280): Promise<string> => {
  try {
    const img = await loadImage(src);
    const side = Math.max(img.width, img.height);
    if (!side || side >= minSide) return src;
    let cur: HTMLImageElement | HTMLCanvasElement = img;
    let w = img.width;
    let h = img.height;
    const k = target / side;
    // Phóng từng bước ≤ 2× cho nét hơn 1 lần phóng lớn
    for (let done = 1; done < k; ) {
      const step = Math.min(2, k / done);
      done *= step;
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * done);
      c.height = Math.round(img.height * done);
      const ctx = c.getContext('2d');
      if (!ctx) return src;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(cur, 0, 0, w, h, 0, 0, c.width, c.height);
      cur = c;
      w = c.width;
      h = c.height;
    }
    return (cur as HTMLCanvasElement).toDataURL('image/jpeg', 0.92);
  } catch {
    return src;
  }
};
