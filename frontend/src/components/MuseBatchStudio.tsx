import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BatchSceneItem,
  DEFAULT_MUSE_CONFIG,
  MergedVideo,
  MuseConfig,
  MuseTaskStoppedError,
  MuseVoice,
  ReferenceImage,
  buildLockedPrompt,
  createAndPollMuseVideo,
  exportVideo,
  generateMuseKeyframe,
  getStudioSettings,
  listMuseVoices,
  mergeVideos,
  openProjectFolder,
  orderedReferenceRoles,
  pollMuseVideoTask,
} from '../services/museBatchService';
import { EMPTY_PRODUCT, ProductInfo } from '../services/productService';
import { ProductScriptPanel } from './ProductScriptPanel';
import { usePersistentState } from '../hooks/usePersistentState';
import { extractLastFrameAsDataUrl } from '../utils/videoFrameExtractor';
import { downloadAll, downloadFile } from '../utils/download';
import { VideoHistory } from './VideoHistory';
import { MuseAccountsState } from '../hooks/useMuseAccounts';

const DEFAULT_PROMPTS =
  'Nhân vật mỉm cười tự nhiên trước ống kính, tay nâng sản phẩm lên ngang ngực, ánh sáng studio ấm áp\nNhân vật xoay nhẹ góc nghiêng 45 độ, chỉ tay vào chi tiết trên sản phẩm, chuyển động mượt mà\nCận cảnh sản phẩm trên tay nhân vật, camera đẩy nhẹ vào, giữ nguyên trang phục và khuôn mặt';

const CAMERA_OPTIONS = [
  { value: '', label: 'Không ép góc máy' },
  { value: 'Medium Close-up, Static Tripod Shot', label: 'Trung cận cố định (giữ sản phẩm nét nhất)' },
  { value: 'Close-up Shot, Slow Dolly In', label: 'Cận cảnh đẩy nhẹ vào (chi tiết / biểu cảm)' },
  { value: 'Medium Shot, Gentle Handheld Movement', label: 'Trung cảnh chuyển động tự nhiên (drama)' },
];

const ACTIVE_STATUSES: BatchSceneItem['status'][] = ['queued', 'generating_keyframe', 'rendering_video'];
const STOPPED_MESSAGE = '⏹ Đã dừng và hủy task trên Gateway';

/** 75 -> "1:15", 3725 -> "1:02:05" */
const formatDuration = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

interface BatchTiming {
  startedAt: number | null;
  finishedAt: number | null;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Bỏ ảnh keyframe (data URL nặng) trước khi lưu danh sách cảnh vào localStorage. */
const serializeScenes = (scenes: BatchSceneItem[]) => scenes.map(({ keyframeUrl, ...rest }) => rest);

export const MuseBatchStudio: React.FC<{
  accountsState: MuseAccountsState;
  onManageAccounts: () => void;
}> = ({ accountsState, onManageAccounts }) => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { accounts, usableCount, totalThreads, runningThreads } = accountsState;

  // --- Trạng thái được lưu lại qua các lần tải trang ---
  const [config, setConfig] = usePersistentState<MuseConfig>('config.v1', DEFAULT_MUSE_CONFIG, {
    merge: (stored, fallback) => ({ ...fallback, ...stored }),
  });
  // `server: true`: lưu thêm một bản trên Gateway, vì ảnh tham chiếu lớn có thể vượt ~5MB localStorage
  const [batchPromptText, setBatchPromptText] = usePersistentState('prompts.v1', DEFAULT_PROMPTS, {
    server: true,
  });
  const [references, setReferences] = usePersistentState<ReferenceImage[]>('references.v1', [], {
    server: true,
  });
  const [scenes, setScenes] = usePersistentState<BatchSceneItem[]>('scenes.v1', [], {
    serialize: serializeScenes,
    server: true,
  });
  const [product, setProduct] = usePersistentState<ProductInfo>('product.v1', EMPTY_PRODUCT, {
    merge: (stored, fallback) => ({ ...fallback, ...stored }),
    server: true,
  });
  const [merged, setMerged] = usePersistentState<MergedVideo | null>('merged.v1', null);
  // Đọc danh sách cảnh mới nhất bên trong các luồng đang chạy (nối End-frame cần cảnh liền trước)
  const scenesRef = useRef(scenes);
  scenesRef.current = scenes;
  const configRef = useRef(config);
  configRef.current = config;
  const [voices, setVoices] = useState<MuseVoice[]>([]);
  const [outputDir, setOutputDir] = useState('');
  const [ffmpegOk, setFfmpegOk] = useState(true);
  const [mergeState, setMergeState] = useState('');
  // Đọc sản phẩm mới nhất bên trong các luồng đang chạy
  const productRef = useRef(product);
  productRef.current = product;

  const [timing, setTiming] = usePersistentState<BatchTiming>('batchTiming.v1', {
    startedAt: null,
    finishedAt: null,
  });
  const [now, setNow] = useState(Date.now());
  const [runningCount, setRunningCount] = useState(0);
  const [historyKey, setHistoryKey] = useState(0);
  const [downloadState, setDownloadState] = useState('');
  /** Dừng hẳn: hủy cả các task đang render trên Gateway */
  const stopSignalRef = useRef(false);
  /** Dừng mềm: không nhận cảnh mới, các cảnh đang render vẫn chạy nốt */
  const softStopRef = useRef(false);
  const [softStopping, setSoftStopping] = useState(false);
  const resumedRef = useRef(false);
  const autoMergedFor = useRef<number | null>(null);

  useEffect(() => {
    listMuseVoices().then(setVoices).catch(() => setVoices([]));
    getStudioSettings()
      .then((st) => {
        setOutputDir(st.output_dir);
        setFfmpegOk(!!st.ffmpeg);
      })
      .catch(() => undefined);
  }, []);

  const voiceGroups = useMemo(() => {
    const m = new Map<string, MuseVoice[]>();
    voices.forEach((v) => m.set(v.group_label, [...(m.get(v.group_label) || []), v]));
    return [...m.entries()];
  }, [voices]);

  const isBusy = runningCount > 0;
  /** Số luồng thực tế: tự động = tổng luồng của các tài khoản dùng được; nối End-frame = 1 */
  // Không vượt tổng luồng: Gateway chỉ chờ tài khoản rảnh 60s (pool_acquire_timeout) rồi báo lỗi,
  // trong khi 1 video mất vài phút, nên luồng dư sẽ thất bại thay vì xếp hàng.
  const threadsFor = (cfg: MuseConfig) => {
    if (cfg.chainEndFrame) return 1;
    const cap = Math.max(1, totalThreads);
    return cfg.concurrency === 0 ? cap : Math.min(cfg.concurrency, cap);
  };

  const updateScene = (id: string, patch: Partial<BatchSceneItem>) => {
    // Cập nhật ref ngay để luồng kế tiếp (nối End-frame) thấy cảnh trước đã xong mà không chờ render
    scenesRef.current = scenesRef.current.map((s) => (s.id === id ? { ...s, ...patch } : s));
    setScenes((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  /** Bọc một công việc chạy nền để đếm số cảnh đang chạy (điều khiển nút Dừng / Bắt đầu). */
  const track = async <T,>(job: () => Promise<T>): Promise<T> => {
    setRunningCount((n) => n + 1);
    try {
      return await job();
    } finally {
      setRunningCount((n) => n - 1);
    }
  };

  const markFailure = (sceneId: string, err: any) => {
    updateScene(sceneId, {
      finishedAt: Date.now(),
      status: 'failed',
      error: err instanceof MuseTaskStoppedError ? STOPPED_MESSAGE : err?.message || String(err),
    });
    setHistoryKey((k) => k + 1);
  };

  const pollOptions = (sceneId: string) => ({
    shouldStop: () => stopSignalRef.current,
    onProgress: (progress: number) => updateScene(sceneId, { progress }),
    onAccount: (accountId: string) => updateScene(sceneId, { accountId }),
  });

  const accountLabel = (id?: string) => {
    if (!id) return '';
    const acc = accounts.find((a) => a.id === id);
    return acc?.label || id;
  };

  // Đồng hồ: chạy lại mỗi giây khi lô đang chạy
  const hasActiveScene = scenes.some((s) => ACTIVE_STATUSES.includes(s.status));
  useEffect(() => {
    if (!isBusy && !hasActiveScene) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isBusy, hasActiveScene]);

  // Lô kết thúc khi không còn cảnh nào đang chạy / chờ
  useEffect(() => {
    if (timing.startedAt && !timing.finishedAt && !isBusy && !hasActiveScene) {
      setTiming((t) => ({ ...t, finishedAt: Date.now() }));
    }
  }, [isBusy, hasActiveScene, timing.startedAt, timing.finishedAt, setTiming]);

  /** Chạy lại cảnh lỗi sau khi lô đã xong: đồng hồ chạy tiếp từ mốc bắt đầu cũ */
  const reopenTiming = () =>
    setTiming((t) => (t.startedAt ? { ...t, finishedAt: null } : { startedAt: Date.now(), finishedAt: null }));

  /** Chép video của cảnh vào <thư mục xuất>/<dự án>/Canh_XX.mp4 (Gateway tự dọn data/media sau 14 ngày). */
  const exportScene = async (sceneId: string, videoUrl: string, index: number) => {
    try {
      const res = await exportVideo(videoUrl, configRef.current.projectName, `Canh_${pad2(index)}`);
      updateScene(sceneId, { exportedPath: res.path });
    } catch (err: any) {
      updateScene(sceneId, { error: `Video đã xong nhưng lưu file thất bại: ${err.message}` });
    }
  };

  /**
   * Chạy trọn 1 cảnh. Khi bật nối End-frame, frame mở đầu lấy từ video của cảnh LIỀN TRƯỚC
   * (theo số thứ tự) nếu cảnh đó đã xong. Trả về URL video, hoặc null nếu thất bại.
   */
  const processScene = async (
    scene: BatchSceneItem,
    cfg: MuseConfig,
    refs: ReferenceImage[]
  ): Promise<string | null> => {
    if (stopSignalRef.current) return null;
    const current = scenesRef.current.find((s) => s.id === scene.id) ?? scene;
    // Tạo lại một cảnh đã có video: giữ bản cũ trong lịch sử của cảnh
    const history = current.videoUrl
      ? [
          ...(current.history ?? []),
          { videoUrl: current.videoUrl, exportedPath: current.exportedPath, at: current.finishedAt ?? Date.now() },
        ].slice(-10)
      : current.history;
    updateScene(scene.id, {
      status: 'queued',
      error: undefined,
      progress: undefined,
      videoUrl: undefined,
      exportedPath: undefined,
      accountId: undefined,
      startedAt: Date.now(),
      finishedAt: undefined,
      history,
    });
    const prevScene = scenesRef.current.find((s) => s.index === scene.index - 1);
    const chainFromVideoUrl =
      cfg.chainEndFrame && prevScene?.status === 'completed' ? prevScene.videoUrl ?? null : null;

    try {
      // Ảnh gửi cho muse.ai theo thứ tự: nhân vật -> sản phẩm -> trang phục.
      // Ảnh đầu là frame mở đầu; các ảnh sau gửi kèm làm tham chiếu (trước đây chỉ gửi
      // ảnh nhân vật nên muse.ai không thấy sản phẩm thật và tự bịa ra sản phẩm khác).
      const roles = orderedReferenceRoles(refs);
      const urlOf = (role: ReferenceImage['role']) => refs.find((r) => r.role === role)!.dataUrl;
      let inputFrameUrl = urlOf(roles[0]);
      let imageRoles: (ReferenceImage['role'] | 'keyframe')[] = [...roles];
      let extraRefs = roles.slice(1).map(urlOf);

      let generatedFrame: string | null = null;
      if (cfg.chainEndFrame && chainFromVideoUrl) {
        try {
          generatedFrame = await extractLastFrameAsDataUrl(chainFromVideoUrl);
        } catch {
          // Fallback về ảnh tham chiếu gốc nếu không trích xuất được frame
        }
      } else if (cfg.useTwoStepKeyframe && refs.length > 1) {
        updateScene(scene.id, { status: 'generating_keyframe' });
        generatedFrame = await generateMuseKeyframe(cfg, scene.rawPrompt, refs);
        updateScene(scene.id, { keyframeUrl: generatedFrame });
      }
      if (generatedFrame) {
        // Frame mở đầu là ảnh ghép/frame cuối; vẫn gửi kèm ảnh gốc (tối đa 3) để giữ đúng chi tiết
        inputFrameUrl = generatedFrame;
        const keep = roles.slice(0, 3);
        imageRoles = ['keyframe', ...keep];
        extraRefs = keep.map(urlOf);
      }

      updateScene(scene.id, { status: 'rendering_video' });
      const prod = productRef.current;
      const lockedPrompt = buildLockedPrompt(
        scene.rawPrompt,
        refs,
        cfg.cameraMotion,
        { name: prod.name, visual: prod.visual },
        imageRoles
      );
      const videoUrl = await createAndPollMuseVideo(
        cfg,
        lockedPrompt,
        inputFrameUrl,
        (taskId) => updateScene(scene.id, { videoTaskId: taskId }),
        pollOptions(scene.id),
        extraRefs
      );

      updateScene(scene.id, { status: 'completed', videoUrl, progress: 100, finishedAt: Date.now() });
      setHistoryKey((k) => k + 1);
      if (cfg.autoExport) await exportScene(scene.id, videoUrl, scene.index);
      return videoUrl;
    } catch (err) {
      markFailure(scene.id, err);
      return null;
    }
  };

  // --- Khôi phục sau khi tải lại trang: tiếp tục chờ các task còn đang render ---
  useEffect(() => {
    if (resumedRef.current) return; // StrictMode gọi effect 2 lần trong dev
    resumedRef.current = true;

    scenes.forEach((scene) => {
      if (!ACTIVE_STATUSES.includes(scene.status)) return;
      if (!scene.videoTaskId) {
        // Đang chờ luồng / đang ghép keyframe khi trang bị tải lại: chưa có task trên Gateway
        updateScene(scene.id, { status: 'failed', error: 'Bị gián đoạn do tải lại trang — bấm "Chạy lại".' });
        return;
      }
      updateScene(scene.id, { status: 'rendering_video' });
      track(async () => {
        try {
          const videoUrl = await pollMuseVideoTask(scene.videoTaskId!, pollOptions(scene.id));
          updateScene(scene.id, { status: 'completed', videoUrl, progress: 100, finishedAt: Date.now() });
          setHistoryKey((k) => k + 1);
          if (configRef.current.autoExport) await exportScene(scene.id, videoUrl, scene.index);
        } catch (err) {
          markFailure(scene.id, err);
        }
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUploadReference = (e: React.ChangeEvent<HTMLInputElement>, role: ReferenceImage['role']) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // cho phép chọn lại cùng 1 file
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setReferences((prev) => [
        ...prev.filter((r) => r.role !== role),
        { id: `${role}_${Date.now()}`, role, dataUrl, name: file.name },
      ]);
    };
    reader.readAsDataURL(file);
  };

  const handleStartBatch = async () => {
    const lines = batchPromptText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length === 0) return alert('Vui lòng nhập ít nhất 1 dòng Prompt!');
    if (references.length === 0) return alert('Vui lòng tải lên ít nhất 1 ảnh tham chiếu (Nhân vật hoặc Sản phẩm)!');
    if (accountsState.loaded && usableCount === 0) {
      return alert('Chưa có tài khoản Muse nào dùng được. Vào "Dàn tài khoản Muse" để đăng nhập.');
    }

    stopSignalRef.current = false;
    softStopRef.current = false;
    setSoftStopping(false);
    setMerged(null);
    const cfg = config;
    const refs = references;
    const initialScenes: BatchSceneItem[] = lines.map((line, idx) => ({
      id: `scene_${Date.now()}_${idx}`,
      index: idx + 1,
      rawPrompt: line,
      status: 'queued',
    }));
    setScenes(initialScenes);
    scenesRef.current = initialScenes;
    setTiming({ startedAt: Date.now(), finishedAt: null });
    await runQueue(initialScenes, cfg, refs);
  };

  /** Chạy một danh sách cảnh theo thứ tự với số luồng hiện tại. */
  const runQueue = (list: BatchSceneItem[], cfg: MuseConfig, refs: ReferenceImage[]) =>
    track(async () => {
      // Nối End-frame cần cảnh trước xong mới chạy cảnh sau, nên ép 1 luồng và chạy theo thứ tự
      const queue = [...list].sort((a, b) => a.index - b.index);
      const workers = Array.from({ length: threadsFor(cfg) }, async () => {
        while (queue.length > 0 && !stopSignalRef.current && !softStopRef.current) {
          const nextScene = queue.shift();
          if (!nextScene) break;
          await processScene(nextScene, cfg, refs);
        }
      });
      await Promise.all(workers);

      if (stopSignalRef.current || softStopRef.current) {
        // Các cảnh chưa kịp chạy: đánh dấu rõ ràng thay vì treo ở "Đang chờ luồng"
        const left = new Set(queue.map((s) => s.id));
        setScenes((prev) =>
          prev.map((s) =>
            left.has(s.id) || (stopSignalRef.current && s.status === 'queued')
              ? { ...s, status: 'failed', error: '⏸ Đã dừng trước khi chạy' }
              : s
          )
        );
      }
      softStopRef.current = false;
      setSoftStopping(false);
    });

  const handleRetryScene = (scene: BatchSceneItem) => {
    if (references.length === 0) return alert('Cần ít nhất 1 ảnh tham chiếu để chạy lại!');
    stopSignalRef.current = false;
    softStopRef.current = false;
    reopenTiming();
    track(() => processScene(scene, config, references));
  };

  const failedScenes = scenes.filter((s) => s.status === 'failed');
  const completedScenes = scenes.filter((s) => s.status === 'completed' && s.videoUrl);

  const handleRetryAllFailed = () => {
    if (references.length === 0) return alert('Cần ít nhất 1 ảnh tham chiếu để chạy lại!');
    stopSignalRef.current = false;
    softStopRef.current = false;
    reopenTiming();
    // Khi nối End-frame, cảnh lỗi được chạy lại theo thứ tự và vẫn nối từ cảnh liền trước
    runQueue(failedScenes, config, references);
  };

  const handleMerge = async () => {
    const done = scenesRef.current
      .filter((s) => s.status === 'completed' && s.videoUrl)
      .sort((a, b) => a.index - b.index);
    if (done.length < 2) return alert('Cần ít nhất 2 cảnh đã xong để ghép.');
    setMergeState(`Đang ghép ${done.length} cảnh...`);
    try {
      const name = `${configRef.current.projectName || 'MuseStudio'}_full`;
      const res = await mergeVideos(
        done.map((s) => s.videoUrl!),
        configRef.current.projectName,
        name
      );
      setMerged({ url: res.url, path: res.path, at: Date.now(), sceneCount: done.length });
      setMergeState('');
    } catch (err: any) {
      setMergeState(`❌ Ghép thất bại: ${err.message}`);
    }
  };

  // Tự ghép khi cả lô xong hết (mỗi lô chỉ ghép 1 lần)
  useEffect(() => {
    if (!config.autoMerge || !ffmpegOk || !timing.finishedAt || !timing.startedAt) return;
    if (autoMergedFor.current === timing.finishedAt) return;
    if (scenes.length < 2 || !scenes.every((s) => s.status === 'completed' && s.videoUrl)) return;
    autoMergedFor.current = timing.finishedAt;
    void handleMerge();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timing.finishedAt, config.autoMerge, ffmpegOk]);

  const openFolder = () =>
    openProjectFolder(config.projectName).catch((err) => alert(`Không mở được thư mục: ${err.message}`));

  const handleDownloadAll = async () => {
    setDownloadState(`Đang tải 0/${completedScenes.length}...`);
    const failed = await downloadAll(
      completedScenes.map((s) => ({ url: s.videoUrl!, filename: `Muse_Shot_${s.index}.mp4` })),
      (done, total) => setDownloadState(`Đang tải ${done}/${total}...`)
    );
    setDownloadState(failed ? `Xong, ${failed} file lỗi` : `✅ Đã tải ${completedScenes.length} video`);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* CỘT TRÁI: BẢNG ĐIỀU KHIỂN */}
        {sidebarOpen && (
          <div className="lg:col-span-5 space-y-5 bg-slate-900 border border-slate-800 rounded-2xl p-5">
            {/* Khối 1: Tài khoản (quản lý chi tiết ở trang Dàn tài khoản) */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-indigo-400">1. Tài khoản Muse (xoay tua tự động)</h3>
                <p className={`text-xs mt-1 ${usableCount === 0 ? 'text-red-400' : 'text-slate-300'}`}>
                  {usableCount}/{accounts.length} tài khoản dùng được · tổng {totalThreads} luồng
                  {runningThreads > 0 ? ` · đang chạy ${runningThreads}` : ''}
                </p>
                {accountsState.error && <p className="text-xs text-red-400 mt-1">{accountsState.error}</p>}
              </div>
              <button
                onClick={onManageAccounts}
                className="px-3 py-1.5 bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 rounded-lg text-xs font-semibold"
              >
                {usableCount === 0 ? 'Đăng nhập tài khoản ➔' : 'Quản lý tài khoản ➔'}
              </button>
            </div>

            <ProductScriptPanel
              product={product}
              setProduct={setProduct}
              references={references}
              secondsPerScene={config.duration}
              onUseImage={(dataUrl, role, name) =>
                setReferences((prev) => [
                  ...prev.filter((r) => r.role !== role),
                  { id: `${role}_${Date.now()}`, role, dataUrl, name },
                ])
              }
              onApplyScenes={(lines) => setBatchPromptText(lines.join('\n'))}
            />

            {/* Khối 2: Ảnh tham chiếu */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-bold text-indigo-400">
                2. Ảnh Tham Chiếu Cố Định (Nhân Vật • Trang Phục • Sản Phẩm)
              </h3>

              <div className="grid grid-cols-3 gap-2.5">
                {(['character', 'outfit', 'product'] as const).map((role) => {
                  const found = references.find((r) => r.role === role);
                  const titleMap = { character: 'Nhân vật (Mặt)', outfit: 'Trang phục', product: 'Sản phẩm' };
                  return (
                    <div
                      key={role}
                      className="relative h-28 border border-dashed border-slate-700 rounded-lg bg-slate-900 flex items-center justify-center overflow-hidden hover:border-indigo-500 transition"
                    >
                      {found ? (
                        <>
                          <img src={found.dataUrl} alt={role} className="w-full h-full object-cover" />
                          <button
                            onClick={() => setReferences((prev) => prev.filter((r) => r.role !== role))}
                            className="absolute top-1 right-1 bg-red-600 text-white text-[10px] px-1.5 py-0.5 rounded"
                          >
                            ✕
                          </button>
                          <span className="absolute bottom-1 left-1 bg-black/75 text-[10px] px-1.5 py-0.5 rounded text-indigo-300">
                            {titleMap[role]}
                          </span>
                        </>
                      ) : (
                        <label className="cursor-pointer w-full h-full flex flex-col items-center justify-center text-center p-2">
                          <span className="text-lg">+</span>
                          <span className="text-[11px] text-slate-400">{titleMap[role]}</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => handleUploadReference(e, role)}
                          />
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="space-y-1.5 pt-1">
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.useTwoStepKeyframe}
                    onChange={(e) => setConfig({ ...config, useTwoStepKeyframe: e.target.checked })}
                    className="accent-indigo-500"
                  />
                  Chế độ 2 bước: Ghép Nhân vật + Trang phục + Sản phẩm thành Keyframe trước khi tạo Video
                </label>

                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.chainEndFrame}
                    onChange={(e) => setConfig({ ...config, chainEndFrame: e.target.checked })}
                    className="accent-indigo-500"
                  />
                  Nối tiếp End-Frame (Cắt frame cuối cảnh trước làm frame đầu cảnh sau, chạy 1 luồng)
                </label>
              </div>
            </div>

            {/* Khối 3: Danh sách Prompt */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-indigo-400">3. Danh sách Prompt Hàng Loạt (Mỗi dòng = 1 Video)</h3>
                <span className="text-xs text-slate-400">
                  {batchPromptText.split('\n').filter((l) => l.trim()).length} cảnh
                </span>
              </div>

              <textarea
                rows={5}
                value={batchPromptText}
                onChange={(e) => setBatchPromptText(e.target.value)}
                placeholder="Nhập mỗi cảnh trên 1 dòng..."
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
              />

              <div className="grid grid-cols-3 gap-2 pt-1">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Khung hình</label>
                  <select
                    value={config.aspectRatio}
                    onChange={(e) => setConfig({ ...config, aspectRatio: e.target.value as MuseConfig['aspectRatio'] })}
                    className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-xs"
                  >
                    <option value="9:16">9:16 (Dọc)</option>
                    <option value="16:9">16:9 (Ngang)</option>
                    <option value="1:1">1:1 (Vuông)</option>
                    <option value="4:3">4:3</option>
                    <option value="3:4">3:4</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Thời lượng</label>
                  <select
                    value={config.duration}
                    onChange={(e) =>
                      setConfig({ ...config, duration: Number(e.target.value) as MuseConfig['duration'] })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-xs"
                  >
                    {[2, 4, 6, 8, 10].map((d) => (
                      <option key={d} value={d}>
                        {d} giây
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Số luồng chạy</label>
                  <select
                    value={config.concurrency}
                    onChange={(e) =>
                      setConfig({ ...config, concurrency: Number(e.target.value) as MuseConfig['concurrency'] })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-xs"
                  >
                    <option value={0}>Tự động ({Math.max(1, totalThreads)} luồng)</option>
                    <option value={1}>1 luồng (Tuần tự)</option>
                    <option value={2}>2 luồng</option>
                    <option value={4}>4 luồng</option>
                    <option value={8}>8 luồng</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Góc máy (thêm vào mọi prompt)</label>
                <select
                  value={config.cameraMotion}
                  onChange={(e) => setConfig({ ...config, cameraMotion: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-xs"
                >
                  {CAMERA_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-500 mt-1">
                  Lưu ý: khung hình và thời lượng chỉ là gợi ý gửi kèm prompt, Muse.ai có thể không làm đúng tuyệt
                  đối.
                </p>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Giọng đọc Muse (dùng cho mọi cảnh)</label>
                <select
                  value={config.voice}
                  onChange={(e) => setConfig({ ...config, voice: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-xs"
                >
                  <option value="">Giữ giọng mặc định của tài khoản</option>
                  {voiceGroups.map(([group, list]) => (
                    <optgroup key={group} label={group}>
                      {list.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name} · {v.gender === 'female' ? 'Nữ' : v.gender === 'male' ? 'Nam' : v.gender}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <p className="text-[10px] text-slate-500 mt-1">
                  Khóa 1 giọng cho cả lô để cảnh sau không bị đổi giọng (nam ↔ nữ) so với cảnh trước.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[11px] text-slate-400">Tên dự án (thư mục lưu video)</label>
                <input
                  value={config.projectName}
                  onChange={(e) => setConfig({ ...config, projectName: e.target.value })}
                  placeholder="MuseStudio"
                  className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-xs"
                />
                {outputDir && (
                  <button onClick={openFolder} className="text-[10px] text-indigo-300 hover:underline break-all text-left">
                    📂 {outputDir}\{config.projectName || 'MuseStudio'}
                  </button>
                )}
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.autoExport}
                    onChange={(e) => setConfig({ ...config, autoExport: e.target.checked })}
                    className="accent-indigo-500"
                  />
                  Tự lưu mỗi video xong vào thư mục dự án
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.autoMerge}
                    disabled={!ffmpegOk}
                    onChange={(e) => setConfig({ ...config, autoMerge: e.target.checked })}
                    className="accent-indigo-500"
                  />
                  Xong cả lô thì tự ghép các cảnh thành 1 video
                  {!ffmpegOk && <span className="text-amber-400">(chưa tìm thấy FFmpeg)</span>}
                </label>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleStartBatch}
                  disabled={isBusy}
                  className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 rounded-xl font-bold text-xs transition"
                >
                  {isBusy ? `⏳ Đang chạy (${runningCount})...` : '🚀 Bắt đầu Tạo Hàng Loạt'}
                </button>
                {isBusy && (
                  <>
                    <button
                      onClick={() => {
                        softStopRef.current = true;
                        setSoftStopping(true);
                      }}
                      disabled={softStopping}
                      title="Không nhận cảnh mới; các cảnh đang render vẫn chạy nốt"
                      className="px-3 py-3 bg-slate-700 hover:bg-slate-600 disabled:opacity-60 rounded-xl font-bold text-xs"
                    >
                      {softStopping ? 'Đang chờ cảnh dở...' : '⏸ Dừng sau cảnh đang chạy'}
                    </button>
                    <button
                      onClick={() => {
                        // Vòng polling thấy cờ này trong <0.5s, gọi hủy task trên Gateway rồi thoát
                        stopSignalRef.current = true;
                      }}
                      title="Hủy luôn các cảnh muse.ai đang render"
                      className="px-3 py-3 bg-red-600 hover:bg-red-500 rounded-xl font-bold text-xs"
                    >
                      ⏹ Dừng hẳn
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* CỘT PHẢI: TIẾN TRÌNH LÔ HIỆN TẠI */}
        <div
          className={`${sidebarOpen ? 'lg:col-span-7' : 'lg:col-span-12'} bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs text-slate-300"
              >
                {sidebarOpen ? '◀ Ẩn cấu hình' : '▶ Hiện cấu hình'}
              </button>
              <h2 className="text-base font-bold text-white">
                Lô hiện tại ({completedScenes.length}/{scenes.length} hoàn tất)
              </h2>
              {timing.startedAt && (
                <span
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold ${
                    timing.finishedAt ? 'bg-emerald-500/15 text-emerald-300' : 'bg-sky-500/15 text-sky-300'
                  }`}
                  title={`Bắt đầu lúc ${new Date(timing.startedAt).toLocaleTimeString()}${
                    timing.finishedAt ? ` · xong lúc ${new Date(timing.finishedAt).toLocaleTimeString()}` : ''
                  }`}
                >
                  ⏱ {formatDuration((timing.finishedAt ?? now) - timing.startedAt)}
                  {timing.finishedAt ? ' · xong' : ''}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {failedScenes.length > 0 && (
                <button
                  onClick={handleRetryAllFailed}
                  disabled={isBusy}
                  className="px-2.5 py-1 bg-amber-600/80 hover:bg-amber-500 disabled:bg-slate-700 rounded-lg text-xs font-semibold"
                >
                  ↻ Chạy lại {failedScenes.length} cảnh lỗi
                </button>
              )}
              <button
                onClick={handleDownloadAll}
                disabled={completedScenes.length === 0 || downloadState.startsWith('Đang')}
                className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 rounded-lg text-xs font-semibold"
              >
                ⬇ Tải tất cả ({completedScenes.length})
              </button>
              <button
                onClick={handleMerge}
                disabled={completedScenes.length < 2 || !ffmpegOk || mergeState.startsWith('Đang')}
                title={ffmpegOk ? 'Ghép các cảnh đã xong (theo thứ tự) thành 1 video' : 'Chưa tìm thấy FFmpeg'}
                className="px-2.5 py-1 bg-fuchsia-700 hover:bg-fuchsia-600 disabled:bg-slate-700 rounded-lg text-xs font-semibold"
              >
                🎞 Ghép {completedScenes.length} cảnh
              </button>
              <button
                onClick={openFolder}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs text-slate-300"
              >
                📂 Thư mục
              </button>
              {scenes.length > 0 && !isBusy && (
                <button
                  onClick={() => {
                    setScenes([]);
                    setTiming({ startedAt: null, finishedAt: null });
                  }}
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs text-slate-300"
                >
                  Xóa danh sách
                </button>
              )}
            </div>
          </div>
          {downloadState && <p className="text-xs text-slate-300 mb-3">{downloadState}</p>}
          {mergeState && <p className="text-xs text-slate-300 mb-3">{mergeState}</p>}
          {merged && (
            <div className="mb-4 bg-fuchsia-950/40 border border-fuchsia-800 rounded-xl p-3 flex flex-col md:flex-row gap-3">
              <video src={merged.url} controls className="w-full md:w-64 h-40 bg-black rounded-lg object-contain" />
              <div className="text-xs space-y-1">
                <p className="font-bold text-fuchsia-200">🎞 Video hoàn chỉnh ({merged.sceneCount} cảnh)</p>
                <p className="text-slate-300 break-all">{merged.path}</p>
                <p className="text-slate-500">{new Date(merged.at).toLocaleString('vi-VN')}</p>
              </div>
            </div>
          )}

          {scenes.length === 0 ? (
            <div className="flex-1 border border-dashed border-slate-800 rounded-xl flex items-center justify-center text-slate-500 text-sm p-12 text-center">
              Hãy nạp Cookie Muse.ai, tải lên ảnh Nhân vật / Sản phẩm và nhấn "Bắt đầu Tạo Hàng Loạt".
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto max-h-[80vh] pr-1">
              {scenes.map((scene) => (
                <div
                  key={scene.id}
                  className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between gap-3"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-indigo-400">Cảnh #{scene.index}</span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                        {scene.status === 'queued' && '⏸ Đang chờ luồng'}
                        {scene.status === 'generating_keyframe' && '🎨 Đang ghép Keyframe...'}
                        {scene.status === 'rendering_video' &&
                          `🎬 Đang tạo Video Muse...${scene.progress ? ` ${scene.progress}%` : ''}`}
                        {scene.status === 'completed' && '✅ Hoàn tất'}
                        {scene.status === 'failed' && '❌ Thất bại'}
                      </span>
                    </div>
                    {ACTIVE_STATUSES.includes(scene.status) ? (
                      <p className="text-xs text-slate-300 line-clamp-2">{scene.rawPrompt}</p>
                    ) : (
                      <textarea
                        rows={2}
                        value={scene.rawPrompt}
                        onChange={(e) => updateScene(scene.id, { rawPrompt: e.target.value })}
                        title="Sửa prompt rồi bấm Chạy lại / Tạo lại cho riêng cảnh này"
                        className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg p-1.5 text-xs text-slate-200 focus:outline-none"
                      />
                    )}
                    {(scene.accountId || scene.startedAt) && (
                      <div className="flex flex-wrap gap-x-3 text-[11px] text-slate-500">
                        {scene.accountId && <span>👤 {accountLabel(scene.accountId)}</span>}
                        {scene.startedAt && scene.status !== 'queued' && (
                          <span>⏱ {formatDuration((scene.finishedAt ?? now) - scene.startedAt)}</span>
                        )}
                      </div>
                    )}
                  </div>

                  {scene.videoUrl ? (
                    <div className="space-y-2">
                      <video src={scene.videoUrl} controls className="w-full h-48 bg-black rounded-lg object-contain" />
                      <button
                        onClick={() =>
                          downloadFile(scene.videoUrl!, `Muse_Shot_${scene.index}.mp4`).catch((e) => alert(e.message))
                        }
                        className="w-full py-1.5 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 rounded-lg text-xs font-medium"
                      >
                        ⬇ Tải Video Cảnh #{scene.index}
                      </button>
                    </div>
                  ) : (
                    <div className="h-48 bg-slate-900/60 border border-dashed border-slate-800 rounded-lg flex flex-col items-center justify-center gap-2 text-xs text-slate-500 p-4 text-center">
                      {scene.keyframeUrl && !scene.error && (
                        <img src={scene.keyframeUrl} alt="keyframe" className="h-28 object-contain rounded" />
                      )}
                      {scene.error ? (
                        <span className="text-red-400 line-clamp-4">{scene.error}</span>
                      ) : (
                        'Video sẽ hiển thị tại đây ngay khi Muse.ai render xong'
                      )}
                    </div>
                  )}

                  {scene.exportedPath && (
                    <p className="text-[10px] text-slate-500 break-all" title="Đã lưu vào thư mục dự án">
                      💾 {scene.exportedPath}
                    </p>
                  )}
                  {scene.status === 'completed' && scene.videoUrl && !scene.exportedPath && (
                    <button
                      onClick={() => exportScene(scene.id, scene.videoUrl!, scene.index)}
                      className="w-full py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[11px]"
                    >
                      💾 Lưu vào thư mục dự án
                    </button>
                  )}
                  {(scene.history?.length ?? 0) > 0 && (
                    <details className="text-[11px] text-slate-400">
                      <summary className="cursor-pointer">Bản tạo trước ({scene.history!.length})</summary>
                      <div className="flex flex-wrap gap-2 mt-1.5">
                        {scene.history!
                          .slice()
                          .reverse()
                          .map((h) => (
                            <div key={h.at} className="space-y-0.5">
                              <video src={h.videoUrl} controls className="w-32 h-20 bg-black rounded object-contain" />
                              <div className="text-[10px]">{new Date(h.at).toLocaleString('vi-VN')}</div>
                            </div>
                          ))}
                      </div>
                    </details>
                  )}
                  {scene.status === 'failed' && (
                    <button
                      onClick={() => handleRetryScene(scene)}
                      className="w-full py-1.5 bg-amber-600/20 hover:bg-amber-600/40 text-amber-300 rounded-lg text-xs font-medium"
                    >
                      ↻ Chạy lại cảnh #{scene.index}
                    </button>
                  )}
                  {scene.status === 'completed' && (
                    <button
                      onClick={() => handleRetryScene(scene)}
                      disabled={isBusy && config.chainEndFrame}
                      title="Tạo lại cảnh này (bản cũ được giữ trong 'Bản tạo trước')"
                      className="w-full py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded-lg text-[11px]"
                    >
                      ↻ Tạo lại cảnh #{scene.index}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <VideoHistory refreshKey={historyKey} />
    </div>
  );
};
