/**
 * Công cụ trích xuất khung hình cuối cùng (End-frame) của Video trước
 * để làm ảnh tham chiếu đầu vào (Start-frame) cho Video tiếp theo (Multi-shot Drama)
 */
export const extractLastFrameAsDataUrl = (videoUrl: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.src = videoUrl;
    video.muted = true;

    video.onloadedmetadata = () => {
      video.currentTime = Math.max(0, video.duration - 0.1);
    };

    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Không thể khởi tạo Canvas 2D'));
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
      resolve(dataUrl);
    };

    video.onerror = () => reject(new Error('Không thể tải video để cắt frame cuối'));
  });
};
