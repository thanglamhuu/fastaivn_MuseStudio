import { useEffect, useState } from 'react';

const PREFIX = 'museStudio.';

/** Đọc giá trị đã lưu trong localStorage; trả về fallback nếu không có hoặc lỗi. */
export const loadPersisted = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
};

/** Ghi vào localStorage. Trả false nếu không ghi được (ví dụ vượt dung lượng ~5MB). */
export const savePersisted = (key: string, value: unknown): boolean => {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

/**
 * useState có lưu vào localStorage. `serialize` cho phép bỏ bớt dữ liệu nặng trước khi lưu.
 * `merge` dùng để bổ sung trường mới vào dữ liệu cũ đã lưu (khi thêm cấu hình mới).
 */
export const usePersistentState = <T,>(
  key: string,
  fallback: T,
  opts: { serialize?: (v: T) => unknown; merge?: (stored: T, fallback: T) => T } = {}
) => {
  const [value, setValue] = useState<T>(() => {
    const stored = loadPersisted<T | undefined>(key, undefined);
    if (stored === undefined) return fallback;
    return opts.merge ? opts.merge(stored, fallback) : stored;
  });

  useEffect(() => {
    savePersisted(key, opts.serialize ? opts.serialize(value) : value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value]);

  return [value, setValue] as const;
};
