import React, { useState } from 'react';
import {
  AspectRatio,
  ShotDuration,
  ReferenceAsset,
  VideoGenConfig,
  VideoJob,
} from '../types/videoStudio';
import {
  fileToBase64,
  compileConsistencyPrompt,
  generateConsistentVideo,
  uploadVideoToMuseAi,
} from '../services/videoAiService';

export const CharacterVideoStudio: React.FC = () => {
  const [references, setReferences] = useState<ReferenceAsset[]>([]);

  const [config, setConfig] = useState<VideoGenConfig>({
    prompt: '',
    aspectRatio: '9:16',
    duration: 6,
    lockIdentity: true,
    lockOutfit: true,
    lockProduct: true,
    cameraMotion: 'Medium Close-up, Slow Push-in',
  });

  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleAddReference = async (
    e: React.ChangeEvent<HTMLInputElement>,
    type: 'character' | 'outfit' | 'product'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const base64 = await fileToBase64(file);
    const newAsset: ReferenceAsset = {
      id: `${type}_${Date.now()}`,
      file,
      previewUrl: URL.createObjectURL(file),
      base64,
      type,
    };

    setReferences((prev) => [...prev.filter((item) => item.type !== type), newAsset]);
  };

  const removeReference = (id: string) => {
    setReferences((prev) => prev.filter((item) => item.id !== id));
  };

  const handleGenerateVideo = async () => {
    if (references.length === 0) {
      alert('Vui lòng tải lên ít nhất 1 ảnh tham chiếu (Nhân vật hoặc Sản phẩm)!');
      return;
    }
    if (!config.prompt.trim()) {
      alert('Vui lòng nhập mô tả chuyển động (Prompt)!');
      return;
    }

    const jobId = `job_${Date.now()}`;
    const compiledPrompt = compileConsistencyPrompt(config);

    const newJob: VideoJob = {
      id: jobId,
      status: 'processing',
      progress: 20,
      promptUsed: compiledPrompt,
      createdAt: Date.now(),
    };

    setJobs((prev) => [newJob, ...prev]);
    setIsGenerating(true);

    try {
      const { videoUrl } = await generateConsistentVideo(references, config, undefined, undefined, {
        onProgress: (progress) =>
          setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, progress } : j))),
      });

      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, status: 'uploading_muse', progress: 80, rawVideoUrl: videoUrl } : j
        )
      );

      const museResult = await uploadVideoToMuseAi(
        videoUrl,
        `Shot_${jobId}`,
        'YOUR_MUSE_AI_API_KEY'
      );

      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? {
                ...j,
                status: 'completed',
                progress: 100,
                museVideoId: museResult.fid,
                museEmbedUrl: museResult.embedUrl,
              }
            : j
        )
      );
    } catch (err: any) {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, status: 'failed', error: err.message || 'Lỗi tạo video' } : j
        )
      );
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col gap-5">
        <div>
          <h2 className="text-lg font-bold text-white">1. Ảnh Tham Chiếu (Reference Lock)</h2>
          <p className="text-xs text-slate-400 mt-1">
            Tải ảnh rõ nét, đủ sáng để AI khóa chính xác khuôn mặt, quần áo và sản phẩm.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {(['character', 'outfit', 'product'] as const).map((type) => {
            const existing = references.find((r) => r.type === type);
            const labelMap = {
              character: 'Nhân vật (Mặt)',
              outfit: 'Trang phục',
              product: 'Sản phẩm',
            };

            return (
              <div
                key={type}
                className="relative border-2 border-dashed border-slate-700 rounded-xl p-2 flex flex-col items-center justify-center h-36 bg-slate-950/60 hover:border-indigo-500 transition"
              >
                {existing ? (
                  <>
                    <img
                      src={existing.previewUrl}
                      alt={type}
                      className="w-full h-full object-cover rounded-lg"
                    />
                    <button
                      onClick={() => removeReference(existing.id)}
                      className="absolute top-1 right-1 bg-red-600 text-white text-xs px-2 py-0.5 rounded-full"
                    >
                      ✕
                    </button>
                    <span className="absolute bottom-1 left-1 bg-black/70 text-[10px] px-2 py-0.5 rounded text-indigo-300 font-medium">
                      {labelMap[type]}
                    </span>
                  </>
                ) : (
                  <label className="cursor-pointer flex flex-col items-center justify-center w-full h-full text-center">
                    <span className="text-2xl mb-1">+</span>
                    <span className="text-xs font-medium text-slate-300">{labelMap[type]}</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleAddReference(e, type)}
                    />
                  </label>
                )}
              </div>
            );
          })}
        </div>

        <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
            Chế độ Khóa Nhất Quán (Identity & Asset Locks)
          </div>
          <div className="flex flex-wrap gap-3 pt-1">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={config.lockIdentity}
                onChange={(e) => setConfig({ ...config, lockIdentity: e.target.checked })}
                className="accent-indigo-500"
              />
              Khóa Khuôn Mặt (Identity Lock)
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={config.lockOutfit}
                onChange={(e) => setConfig({ ...config, lockOutfit: e.target.checked })}
                className="accent-indigo-500"
              />
              Khóa Trang Phục (Outfit Lock)
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={config.lockProduct}
                onChange={(e) => setConfig({ ...config, lockProduct: e.target.checked })}
                className="accent-indigo-500"
              />
              Chống Méo Sản Phẩm (Product Lock)
            </label>
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1.5">
            2. Mô tả Chuyển động & Bối cảnh (Action Prompt)
          </label>
          <textarea
            rows={4}
            value={config.prompt}
            onChange={(e) => setConfig({ ...config, prompt: e.target.value })}
            placeholder="Ví dụ: Nhân vật mỉm cười tự nhiên, tay phải cầm sản phẩm đưa nhẹ lên ngang ngực, ánh sáng studio ấm áp..."
            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Tỷ lệ khung hình</label>
            <select
              value={config.aspectRatio}
              onChange={(e) => setConfig({ ...config, aspectRatio: e.target.value as AspectRatio })}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs"
            >
              <option value="9:16">9:16 (Dọc - TikTok/Reels/Shorts)</option>
              <option value="16:9">16:9 (Ngang - YouTube/Phim)</option>
              <option value="1:1">1:1 (Vuông)</option>
              <option value="4:3">4:3</option>
              <option value="3:4">3:4</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Thời lượng Shot</label>
            <select
              value={config.duration}
              onChange={(e) =>
                setConfig({ ...config, duration: Number(e.target.value) as ShotDuration })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs"
            >
              <option value={2}>2 giây</option>
              <option value={4}>4 giây</option>
              <option value={6}>6 giây</option>
              <option value={8}>8 giây</option>
              <option value={10}>10 giây</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">
            Góc máy & Chuyển động (Giúp giữ nét sản phẩm)
          </label>
          <select
            value={config.cameraMotion}
            onChange={(e) => setConfig({ ...config, cameraMotion: e.target.value })}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs"
          >
            <option value="Medium Close-up, Static Tripod Shot">
              Trung cận cố định (Giữ sản phẩm nét nhất)
            </option>
            <option value="Close-up Shot, Slow Dolly In">
              Cận cảnh đẩy nhẹ vào (Tôn chi tiết sản phẩm/biểu cảm)
            </option>
            <option value="Medium Shot, Gentle Handheld Movement">
              Trung cảnh chuyển động tự nhiên (Hợp phim ngắn/Drama)
            </option>
          </select>
        </div>

        <button
          onClick={handleGenerateVideo}
          disabled={isGenerating}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 rounded-xl font-semibold text-sm transition shadow-lg shadow-indigo-600/20"
        >
          {isGenerating ? 'Đang xử lý tạo Video...' : '🚀 Tạo Video Nhất Quán'}
        </button>
      </div>

      <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col gap-4">
        <h2 className="text-lg font-bold text-white">Kết quả Render & Trình phát Muse.ai</h2>

        {jobs.length === 0 ? (
          <div className="flex-1 border border-dashed border-slate-800 rounded-xl flex items-center justify-center text-slate-500 text-sm p-12">
            Chưa có video nào. Hãy tải ảnh tham chiếu và nhấn "Tạo Video Nhất Quán".
          </div>
        ) : (
          <div className="space-y-4 overflow-y-auto max-h-[75vh] pr-1">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col gap-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-slate-400">ID: {job.id}</span>
                  <span
                    className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                      job.status === 'completed'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : job.status === 'failed'
                        ? 'bg-red-500/20 text-red-400'
                        : 'bg-amber-500/20 text-amber-400'
                    }`}
                  >
                    {job.status === 'processing' && 'Đang render AI...'}
                    {job.status === 'uploading_muse' && 'Đang đồng bộ lên Muse.ai...'}
                    {job.status === 'completed' && 'Hoàn tất'}
                    {job.status === 'failed' && 'Lỗi xử lý'}
                  </span>
                </div>

                <div className="text-[11px] bg-slate-900 p-2.5 rounded-lg text-slate-400 font-mono">
                  <strong className="text-indigo-400">Compiled Prompt:</strong> {job.promptUsed}
                </div>

                {job.status === 'completed' && (
                  <div className="mt-2 rounded-lg overflow-hidden bg-black aspect-video">
                    {job.museEmbedUrl ? (
                      <iframe
                        src={job.museEmbedUrl}
                        className="w-full h-full border-0"
                        allow="autoplay; fullscreen"
                        allowFullScreen
                        title={job.id}
                      />
                    ) : (
                      <video
                        src={job.rawVideoUrl}
                        controls
                        className="w-full h-full object-contain"
                      />
                    )}
                  </div>
                )}

                {job.error && <p className="text-xs text-red-400">{job.error}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
