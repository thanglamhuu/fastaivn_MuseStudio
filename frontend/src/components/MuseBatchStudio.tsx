import React, { useState, useRef } from 'react';
import {
  MuseConfig,
  ReferenceImage,
  BatchSceneItem,
  importMuseCookieAccount,
  buildLockedPrompt,
  generateMuseKeyframe,
  createAndPollMuseVideo,
  MuseTaskStoppedError,
} from '../services/museBatchService';
import { extractLastFrameAsDataUrl } from '../utils/videoFrameExtractor';

export const MuseBatchStudio: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [config, setConfig] = useState<MuseConfig>({
    gatewayUrl: 'http://127.0.0.1:18610',
    apiKey: 'm2a_secret_key',
    aspectRatio: '9:16',
    duration: 8,
    concurrency: 2,
    useTwoStepKeyframe: false,
    chainEndFrame: false,
  });

  const [cookieInput, setCookieInput] = useState('');
  const [cookieStatus, setCookieStatus] = useState<string>('');
  const [isImportingCookie, setIsImportingCookie] = useState(false);

  const [references, setReferences] = useState<ReferenceImage[]>([]);

  const [batchPromptText, setBatchPromptText] = useState(
    'Nhân vật mỉm cười tự nhiên trước ống kính, tay nâng sản phẩm lên ngang ngực, ánh sáng studio ấm áp\nNhân vật xoay nhẹ góc nghiêng 45 độ, chỉ tay vào chi tiết trên sản phẩm, chuyển động mượt mà\nCận cảnh sản phẩm trên tay nhân vật, camera đẩy nhẹ vào, giữ nguyên trang phục và khuôn mặt'
  );
  const [scenes, setScenes] = useState<BatchSceneItem[]>([]);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const stopSignalRef = useRef(false);

  const handleImportCookies = async () => {
    if (!cookieInput.trim()) {
      alert('Vui lòng dán chuỗi Cookie lấy từ muse.ai (chứa hatch_sess=...)!');
      return;
    }
    setIsImportingCookie(true);
    setCookieStatus('Đang kiểm tra và nạp Cookie vào bể tài khoản...');
    try {
      const { importedCount } = await importMuseCookieAccount(config, cookieInput);
      setCookieStatus(`✅ Đã nạp thành công ${importedCount} tài khoản Muse.ai!`);
    } catch (err: any) {
      setCookieStatus(`❌ Lỗi: ${err.message}`);
    } finally {
      setIsImportingCookie(false);
    }
  };

  const handleUploadReference = (
    e: React.ChangeEvent<HTMLInputElement>,
    role: 'character' | 'outfit' | 'product'
  ) => {
    const file = e.target.files?.[0];
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

    if (lines.length === 0) {
      alert('Vui lòng nhập ít nhất 1 dòng Prompt!');
      return;
    }
    if (references.length === 0) {
      alert('Vui lòng tải lên ít nhất 1 ảnh tham chiếu (Nhân vật hoặc Sản phẩm)!');
      return;
    }

    stopSignalRef.current = false;
    setIsBatchRunning(true);

    const initialScenes: BatchSceneItem[] = lines.map((line, idx) => ({
      id: `scene_${Date.now()}_${idx}`,
      index: idx + 1,
      rawPrompt: line,
      status: 'queued',
    }));
    setScenes(initialScenes);

    let lastCompletedVideoUrl: string | null = null;

    const processSingleScene = async (scene: BatchSceneItem) => {
      if (stopSignalRef.current) return;

      try {
        let inputFrameUrl =
          references.find((r) => r.role === 'character')?.dataUrl || references[0].dataUrl;

        // Nếu bật nối tiếp End-frame từ cảnh trước (khi chạy 1 luồng tuần tự)
        if (config.chainEndFrame && lastCompletedVideoUrl && config.concurrency === 1) {
          try {
            inputFrameUrl = await extractLastFrameAsDataUrl(lastCompletedVideoUrl);
          } catch {
            // Fallback về ảnh tham chiếu gốc nếu không trích xuất được frame
          }
        } else if (config.useTwoStepKeyframe && references.length > 1) {
          setScenes((prev) =>
            prev.map((s) => (s.id === scene.id ? { ...s, status: 'generating_keyframe' } : s))
          );
          inputFrameUrl = await generateMuseKeyframe(config, scene.rawPrompt, references);
          setScenes((prev) =>
            prev.map((s) => (s.id === scene.id ? { ...s, keyframeUrl: inputFrameUrl } : s))
          );
        }

        setScenes((prev) =>
          prev.map((s) => (s.id === scene.id ? { ...s, status: 'rendering_video' } : s))
        );

        const lockedPrompt = buildLockedPrompt(scene.rawPrompt, references);
        const finalVideoUrl = await createAndPollMuseVideo(
          config,
          lockedPrompt,
          inputFrameUrl,
          (taskId) => {
            setScenes((prev) =>
              prev.map((s) => (s.id === scene.id ? { ...s, videoTaskId: taskId } : s))
            );
          },
          {
            shouldStop: () => stopSignalRef.current,
            onProgress: (progress) =>
              setScenes((prev) =>
                prev.map((s) => (s.id === scene.id ? { ...s, progress } : s))
              ),
          }
        );

        lastCompletedVideoUrl = finalVideoUrl;

        setScenes((prev) =>
          prev.map((s) =>
            s.id === scene.id ? { ...s, status: 'completed', videoUrl: finalVideoUrl } : s
          )
        );
      } catch (err: any) {
        const message =
          err instanceof MuseTaskStoppedError ? '⏹ Đã dừng và hủy task trên Gateway' : err.message;
        setScenes((prev) =>
          prev.map((s) => (s.id === scene.id ? { ...s, status: 'failed', error: message } : s))
        );
      }
    };

    const queue = [...initialScenes];
    const effectiveConcurrency = config.chainEndFrame ? 1 : config.concurrency;
    const workers = Array.from({ length: effectiveConcurrency }, async () => {
      while (queue.length > 0 && !stopSignalRef.current) {
        const nextScene = queue.shift();
        if (nextScene) {
          await processSingleScene(nextScene);
        }
      }
    });

    await Promise.all(workers);

    // Các cảnh chưa kịp chạy khi bấm Dừng: đánh dấu rõ ràng thay vì treo ở "Đang chờ luồng"
    if (stopSignalRef.current) {
      setScenes((prev) =>
        prev.map((s) =>
          s.status === 'queued' ? { ...s, status: 'failed', error: '⏹ Đã dừng trước khi chạy' } : s
        )
      );
    }
    setIsBatchRunning(false);
  };

  return (
    <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* CỘT TRÁI: BẢNG ĐIỀU KHIỂN */}
      {sidebarOpen && (
        <div className="lg:col-span-5 space-y-5 bg-slate-900 border border-slate-800 rounded-2xl p-5">
          {/* Khối 1: Dán Cookie Muse.ai */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-indigo-400">
                1. Kết nối Cookie Muse.ai (Đa Tài Khoản)
              </h3>
              <span className="text-[11px] text-slate-400">F12 Network ➔ Copy Cookie</span>
            </div>

            <textarea
              rows={3}
              value={cookieInput}
              onChange={(e) => setCookieInput(e.target.value)}
              placeholder="Dán chuỗi cookie từ muse.ai vào đây (Mỗi tài khoản 1 dòng). Ví dụ: hatch_sess=eyJ...; hatch_vml=...; hatch_native_auth_device=..."
              className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
            />

            <div className="flex items-center justify-between gap-2">
              <button
                onClick={handleImportCookies}
                disabled={isImportingCookie}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 rounded-lg text-xs font-semibold transition"
              >
                {isImportingCookie ? 'Đang nạp...' : '🔑 Nạp Cookie vào Tool'}
              </button>
              {cookieStatus && (
                <span className="text-xs text-slate-300 truncate">{cookieStatus}</span>
              )}
            </div>
          </div>

          {/* Khối 2: Tải Ảnh Tham Chiếu */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-indigo-400">
              2. Ảnh Tham Chiếu Cố Định (Nhân Vật • Trang Phục • Sản Phẩm)
            </h3>

            <div className="grid grid-cols-3 gap-2.5">
              {(['character', 'outfit', 'product'] as const).map((role) => {
                const found = references.find((r) => r.role === role);
                const titleMap = {
                  character: 'Nhân vật (Mặt)',
                  outfit: 'Trang phục',
                  product: 'Sản phẩm',
                };
                return (
                  <div
                    key={role}
                    className="relative h-28 border border-dashed border-slate-700 rounded-lg bg-slate-900 flex items-center justify-center overflow-hidden hover:border-indigo-500 transition"
                  >
                    {found ? (
                      <>
                        <img src={found.dataUrl} alt={role} className="w-full h-full object-cover" />
                        <button
                          onClick={() =>
                            setReferences((prev) => prev.filter((r) => r.role !== role))
                          }
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
                Nối tiếp End-Frame (Cắt frame cuối cảnh trước làm frame đầu cảnh sau)
              </label>
            </div>
          </div>

          {/* Khối 3: Danh sách Prompt chạy hàng loạt */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-indigo-400">
                3. Danh sách Prompt Hàng Loạt (Mỗi dòng = 1 Video)
              </h3>
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
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      aspectRatio: e.target.value as MuseConfig['aspectRatio'],
                    })
                  }
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
                    setConfig({
                      ...config,
                      duration: Number(e.target.value) as MuseConfig['duration'],
                    })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-xs"
                >
                  <option value={2}>2 giây</option>
                  <option value={4}>4 giây</option>
                  <option value={6}>6 giây</option>
                  <option value={8}>8 giây</option>
                  <option value={10}>10 giây</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Số luồng chạy</label>
                <select
                  value={config.concurrency}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      concurrency: Number(e.target.value) as MuseConfig['concurrency'],
                    })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-xs"
                >
                  <option value={1}>1 luồng (Tuần tự)</option>
                  <option value={2}>2 luồng song song</option>
                  <option value={4}>4 luồng song song</option>
                </select>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={handleStartBatch}
                disabled={isBatchRunning}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 rounded-xl font-bold text-xs transition"
              >
                {isBatchRunning ? '⏳ Đang chạy hàng loạt...' : '🚀 Bắt đầu Tạo Hàng Loạt'}
              </button>
              {isBatchRunning && (
                <button
                  onClick={() => {
                    // Vòng polling sẽ thấy cờ này trong <0.5s, gọi hủy task trên Gateway rồi thoát
                    stopSignalRef.current = true;
                  }}
                  className="px-4 py-3 bg-red-600 hover:bg-red-500 rounded-xl font-bold text-xs"
                >
                  Dừng
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CỘT PHẢI: MÀN HÌNH HIỂN THỊ VIDEO */}
      <div
        className={`${
          sidebarOpen ? 'lg:col-span-7' : 'lg:col-span-12'
        } bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col`}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs text-slate-300"
            >
              {sidebarOpen ? '◀ Ẩn cấu hình' : '▶ Hiện cấu hình'}
            </button>
            <h2 className="text-base font-bold text-white">
              Tiến trình Render Hàng Loạt ({scenes.filter((s) => s.status === 'completed').length}/
              {scenes.length} hoàn tất)
            </h2>
          </div>
        </div>

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
                  <p className="text-xs text-slate-300 line-clamp-2">{scene.rawPrompt}</p>
                </div>

                {scene.videoUrl ? (
                  <div className="space-y-2">
                    <video
                      src={scene.videoUrl}
                      controls
                      className="w-full h-48 bg-black rounded-lg object-contain"
                    />
                    <a
                      href={scene.videoUrl}
                      download={`Muse_Shot_${scene.index}.mp4`}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-center py-1.5 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 rounded-lg text-xs font-medium"
                    >
                      ⬇ Tải Video Cảnh #{scene.index}
                    </a>
                  </div>
                ) : (
                  <div className="h-48 bg-slate-900/60 border border-dashed border-slate-800 rounded-lg flex items-center justify-center text-xs text-slate-500 p-4 text-center">
                    {scene.error ? (
                      <span className="text-red-400">{scene.error}</span>
                    ) : (
                      'Video sẽ hiển thị tại đây ngay khi Muse.ai render xong'
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
