import { useCallback, useEffect, useMemo, useState } from 'react';
import { StudioAccount, isAccountUsable, isVideoReady, listStudioAccounts } from '../services/museBatchService';

const REFRESH_MS = 10_000;

/** Danh sách tài khoản trên Gateway, dùng chung cho trang Dàn tài khoản và màn hình chạy hàng loạt. */
export const useMuseAccounts = () => {
  const [accounts, setAccounts] = useState<StudioAccount[]>([]);
  const [perAccountMax, setPerAccountMax] = useState(4);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await listStudioAccounts();
      setAccounts(res.data);
      setPerAccountMax(res.max_concurrency_per_account);
      setError('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const summary = useMemo(() => {
    const usable = accounts.filter(isAccountUsable);
    // Tài khoản đang bị chặn video / hết hạn mức tuần không nhận video mới; nếu mọi tài khoản
    // đều vậy thì Gateway vẫn thử lại tất cả, nên khi đó tính theo toàn bộ tài khoản dùng được.
    const ready = accounts.filter(isVideoReady);
    const threadPool = ready.length ? ready : usable;
    return {
      usableCount: usable.length,
      videoReadyCount: ready.length,
      // Tổng luồng = tổng số luồng riêng của các tài khoản tạo được video
      totalThreads: threadPool.reduce((sum, a) => sum + a.max_concurrency, 0),
      runningThreads: accounts.reduce((sum, a) => sum + a.inflight, 0),
    };
  }, [accounts]);

  return { accounts, perAccountMax, error, loaded, refresh, ...summary };
};

export type MuseAccountsState = ReturnType<typeof useMuseAccounts>;
