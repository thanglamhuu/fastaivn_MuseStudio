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
