import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { GatewayTask, listGatewayTasks, stripPromptLocks } from '../services/museBatchService';
import { downloadAll, downloadFile } from '../utils/download';

const PAGE_SIZE = 12;

const fileNameOf = (task: GatewayTask) => {
  const d = new Date(task.created_at * 1000);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(
    d.getHours()
  ).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
  return `Muse_${stamp}_${task.id.slice(-6)}.mp4`;
};

/**
 * Lịch sử video đã tạo, đọc từ GET /admin/tasks của Gateway.
 * Vì Gateway lưu task vào tasks.json nên lịch sử còn nguyên sau khi tải lại trang / mở lại app.
 */
export const VideoHistory: React.FC<{ refreshKey?: number }> = ({ refreshKey }) => {
  const [tasks, setTasks] = useState<GatewayTask[]>([]);
  const [error, setError] = useState('');
  const [showFailed, setShowFailed] = useState(false);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [downloadState, setDownloadState] = useState('');

  const refresh = useCallback(async () => {
    try {
      const all = await listGatewayTasks(500);
      setTasks(all.filter((t) => t.kind === 'video'));
      setError('');
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  const hasRunning = tasks.some((t) => t.status === 'queued' || t.status === 'running');

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  useEffect(() => {
    const timer = setInterval(refresh, hasRunning ? 5_000 : 30_000);
    return () => clearInterval(timer);
  }, [refresh, hasRunning]);

  const succeeded = useMemo(() => tasks.filter((t) => t.status === 'succeeded' && t.result?.url), [tasks]);
  const shown = useMemo(
    () =>
      tasks.filter(
        (t) =>
          (t.status === 'succeeded' && t.result?.url) ||
          t.status === 'queued' ||
          t.status === 'running' ||
          (showFailed && (t.status === 'failed' || t.status === 'cancelled'))
      ),
    [tasks, showFailed]
  );

  const handleDownloadAll = async () => {
    if (succeeded.length === 0) return;
    setDownloadState(`Đang tải 0/${succeeded.length}...`);
    const failed = await downloadAll(
      succeeded.map((t) => ({ url: t.result!.url!, filename: fileNameOf(t) })),
      (done, total) => setDownloadState(`Đang tải ${done}/${total}...`)
    );
    setDownloadState(
      failed ? `Xong, ${failed} file lỗi (có thể đã bị dọn khỏi Gateway)` : `✅ Đã tải ${succeeded.length} video`
    );
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-white">
          Lịch sử video ({succeeded.length} thành công{hasRunning ? ', đang có task chạy' : ''})
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={showFailed}
              onChange={(e) => setShowFailed(e.target.checked)}
              className="accent-indigo-500"
            />
            Hiện cả task lỗi
          </label>
          <button onClick={refresh} className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs text-slate-300">
            ⟳ Làm mới
          </button>
          <button
            onClick={handleDownloadAll}
            disabled={succeeded.length === 0 || downloadState.startsWith('Đang')}
            className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 rounded-lg text-xs font-semibold"
          >
            ⬇ Tải tất cả ({succeeded.length})
          </button>
        </div>
      </div>

      {downloadState && <p className="text-xs text-slate-300">{downloadState}</p>}
      {error && <p className="text-xs text-red-400">❌ {error}</p>}

      {shown.length === 0 ? (
        <p className="text-sm text-slate-500">Chưa có video nào trong lịch sử của Gateway.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {shown.slice(0, visible).map((task) => (
              <div key={task.id} className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>{new Date(task.created_at * 1000).toLocaleString()}</span>
                  <span>
                    {task.request.size} • {task.request.duration ? `${task.request.duration}s` : '?'}
                  </span>
                </div>
                <p className="text-xs text-slate-300 line-clamp-2" title={task.request.prompt}>
                  {stripPromptLocks(task.request.prompt || '')}
                </p>
                {task.status === 'succeeded' && task.result?.url ? (
                  <>
                    <video
                      src={task.result.url}
                      controls
                      preload="metadata"
                      className="w-full h-44 bg-black rounded-lg object-contain"
                    />
                    <button
                      onClick={() => downloadFile(task.result!.url!, fileNameOf(task)).catch((e) => alert(e.message))}
                      className="py-1.5 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 rounded-lg text-xs font-medium"
                    >
                      ⬇ Tải video
                    </button>
                  </>
                ) : task.status === 'queued' || task.status === 'running' ? (
                  <div className="h-44 bg-slate-900/60 border border-dashed border-slate-800 rounded-lg flex items-center justify-center text-xs text-amber-400">
                    🎬 Đang render... {task.progress ? `${task.progress}%` : ''}
                  </div>
                ) : (
                  <p className="text-xs text-red-400">
                    {task.status === 'cancelled' ? 'Đã hủy' : task.error?.message || 'Thất bại'}
                  </p>
                )}
              </div>
            ))}
          </div>
          {visible < shown.length && (
            <button
              onClick={() => setVisible((v) => v + PAGE_SIZE)}
              className="self-center px-4 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs text-slate-300"
            >
              Xem thêm ({shown.length - visible})
            </button>
          )}
        </>
      )}
    </div>
  );
};
