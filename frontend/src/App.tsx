import React, { useState } from 'react';
import { MuseBatchStudio } from './components/MuseBatchStudio';
import { CharacterVideoStudio } from './components/CharacterVideoStudio';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'batch' | 'single'>('batch');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Thanh điều hướng Header */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur px-6 py-3 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center font-black text-white shadow-lg shadow-indigo-600/30">
            M
          </div>
          <div>
            <h1 className="text-base font-bold text-white leading-tight">
              Muse.ai Video Batch Studio
            </h1>
            <p className="text-[11px] text-slate-400">
              Hệ thống tạo Video AI hàng loạt • Khóa Nhân Vật, Trang Phục & Sản Phẩm
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveTab('batch')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === 'batch'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            🚀 Chạy Hàng Loạt (Cookie Muse.ai)
          </button>
          <button
            onClick={() => setActiveTab('single')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === 'single'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            🎬 Studio Đơn Cảnh & Muse Player
          </button>
        </div>
      </header>

      {/* Nội dung chính */}
      <main className="flex-1">
        {activeTab === 'batch' ? <MuseBatchStudio /> : <CharacterVideoStudio />}
      </main>
    </div>
  );
};

export default App;
