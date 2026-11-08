import { useEffect, useRef, useState } from 'react';
import { loadServerState, saveServerState } from '../services/museBatchService';

const PREFIX = 'museStudio.';
const SAVED_AT_SUFFIX = '.__savedAt';
const SERVER_SAVE_DELAY_MS = 800;

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
 * `server: true` lưu thêm một bản lên Gateway (data/studio/state/<key>.json): localStorage
 * chỉ chứa ~5MB nên ảnh tham chiếu lớn có thể ghi không được; khi đó (hoặc khi bản trên
 * Gateway mới hơn) giá trị được lấy lại từ Gateway ngay sau khi mở app.
 */
export const usePersistentState = <T,>(
  key: string,
  fallback: T,
  opts: {
    serialize?: (v: T) => unknown;
    merge?: (stored: T, fallback: T) => T;
    server?: boolean;
  } = {}
) => {
  const localSavedAt = useRef(loadPersisted<number>(key + SAVED_AT_SUFFIX, 0));
  const [value, setValue] = useState<T>(() => {
    const stored = loadPersisted<T | undefined>(key, undefined);
    if (stored === undefined) {
      localSavedAt.current = 0;
      return fallback;
    }
    return opts.merge ? opts.merge(stored, fallback) : stored;
  });

  const valueRef = useRef(value);
  valueRef.current = value;
  const serverReady = useRef(!opts.server);
  const skipNextSave = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const firstRun = useRef(true);

  const pushToServer = (savedAt: number) => {
    if (!opts.server || !serverReady.current) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const v = valueRef.current;
      saveServerState(key, opts.serialize ? opts.serialize(v) : v, savedAt).catch(() => {
        /* Gateway chưa chạy: vẫn còn bản trong localStorage, lần đổi sau sẽ lưu lại */
      });
    }, SERVER_SAVE_DELAY_MS);
  };

  // Lấy bản trên Gateway khi localStorage không có hoặc cũ hơn
  useEffect(() => {
    if (!opts.server) return;
    let cancelled = false;
    loadServerState<T>(key)
      .then((remote) => {
        if (cancelled) return;
        serverReady.current = true;
        if (remote && remote.value !== undefined && remote.savedAt > localSavedAt.current) {
          skipNextSave.current = true;
          localSavedAt.current = remote.savedAt;
          setValue(opts.merge ? opts.merge(remote.value, fallback) : remote.value);
        } else if (localSavedAt.current) {
          // Gateway chưa có bản này (hoặc cũ hơn): đẩy bản hiện tại lên
          pushToServer(localSavedAt.current);
        }
      })
      .catch(() => {
        serverReady.current = true;
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (firstRun.current) {
      // Lần render đầu chỉ là giá trị vừa đọc ra (hoặc fallback): không ghi lại, nếu không
      // fallback rỗng sẽ mang mốc thời gian mới hơn và che mất bản đầy đủ trên Gateway.
      firstRun.current = false;
      return;
    }
    const data = opts.serialize ? opts.serialize(value) : value;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      savePersisted(key, data);
      savePersisted(key + SAVED_AT_SUFFIX, localSavedAt.current);
      return;
    }
    const savedAt = Date.now();
    localSavedAt.current = savedAt;
    if (!savePersisted(key, data)) {
      // localStorage đầy: bỏ bản cũ để lần mở sau lấy bản mới từ Gateway thay vì bản cũ này
      try {
        localStorage.removeItem(PREFIX + key);
      } catch {
        /* ignore */
      }
    }
    savePersisted(key + SAVED_AT_SUFFIX, savedAt);
    pushToServer(savedAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return [value, setValue] as const;
};
