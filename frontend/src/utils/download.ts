/**
 * Tải file về máy. Tải qua fetch -> Blob vì thuộc tính `download` của thẻ <a>
 * bị trình duyệt bỏ qua khi URL khác origin (dev: 5173 gọi Gateway 18610).
 */
export const downloadFile = async (url: string, filename: string): Promise<void> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Không tải được ${filename} (HTTP ${res.status})`);
  const blobUrl = URL.createObjectURL(await res.blob());
  try {
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Để trình duyệt kịp bắt đầu lưu trước khi thu hồi URL
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
  }
};

/** Tải lần lượt nhiều file (cách nhau một chút để trình duyệt không chặn). Trả về số file lỗi. */
export const downloadAll = async (
  items: { url: string; filename: string }[],
  onProgress?: (done: number, total: number) => void
): Promise<number> => {
  let failed = 0;
  for (let i = 0; i < items.length; i++) {
    try {
      await downloadFile(items[i].url, items[i].filename);
    } catch {
      failed++;
    }
    onProgress?.(i + 1, items.length);
    await new Promise((r) => setTimeout(r, 400));
  }
  return failed;
};
