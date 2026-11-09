import React, { useEffect, useState } from 'react';
import { MuseBatchStudio } from './components/MuseBatchStudio';
import { SettingsPage } from './components/SettingsPage';
import { WorkflowStudio } from './components/WorkflowStudio';
import { useStudioLibrary } from './hooks/useStudioLibrary';
import { GATEWAY_URL } from './config/appConfig';
import { useMuseAccounts } from './hooks/useMuseAccounts';

const useGatewayHealth = () => {
  const [state, setState] = useState<'checking' | 'ok' | 'down'>('checking');
  useEffect(() => {
    const check = () =>
      fetch(`${GATEWAY_URL}/healthz`)
        .then((r) => setState(r.ok ? 'ok' : 'down'))
        .catch(() => setState('down'));
    check();
    const timer = setInterval(check, 15_000);
    return () => clearInterval(timer);
  }, []);
  return state;
};

type Tab = 'batch' | 'workflow' | 'settings';

export const App: React.FC = () => {
  const health = useGatewayHealth();
  const accountsState = useMuseAccounts();
  const library = useStudioLibrary();
  const [tab, setTab] = useState<Tab>('batch');

  const tabBtn = (id: Tab, label: React.ReactNode) => (
    <button
      onClick={() => setTab(id)}
      className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
        tab === id ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur px-6 py-3 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center font-black text-white shadow-lg shadow-indigo-600/30">
            M
          </div>
          <div>
            <h1 className="text-base font-bold text-white leading-tight">Muse.ai Video Batch Studio</h1>
            <p className="text-[11px] text-slate-400">
              Hệ thống tạo Video AI hàng loạt • Khóa Nhân Vật, Trang Phục & Sản Phẩm
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800">
          {tabBtn('batch', '🚀 Tạo video hàng loạt')}
          {tabBtn('workflow', '🧩 Workflow làm clip')}
          {tabBtn(
            'settings',
            <>
              ⚙️ Cài đặt{' '}
              <span className="ml-1 px-1.5 rounded bg-slate-800 text-[10px]">
                {accountsState.usableCount}/{accountsState.accounts.length}
              </span>
            </>
          )}
        </div>

        <span
          className={`text-xs px-2.5 py-1 rounded-full ${
            health === 'ok'
              ? 'bg-emerald-500/20 text-emerald-400'
              : health === 'down'
              ? 'bg-red-500/20 text-red-400'
              : 'bg-slate-800 text-slate-400'
          }`}
          title={GATEWAY_URL}
        >
          {health === 'ok' ? '● Gateway đang chạy' : health === 'down' ? '● Mất kết nối Gateway' : '● Đang kiểm tra...'}
        </span>
      </header>

      {/* Giữ cả 2 trang luôn được mount để lô đang chạy / phiên đăng nhập không mất khi đổi tab */}
      <main className="flex-1">
        <div className={tab === 'batch' ? '' : 'hidden'}>
          <MuseBatchStudio
            accountsState={accountsState}
            library={library}
            onManageAccounts={() => setTab('settings')}
          />
        </div>
        <div className={tab === 'workflow' ? '' : 'hidden'}>
          <WorkflowStudio
            accountsState={accountsState}
            library={library}
            onOpenSettings={() => setTab('settings')}
          />
        </div>
        <div className={tab === 'settings' ? '' : 'hidden'}>
          <SettingsPage accountsState={accountsState} library={library} />
        </div>
      </main>
    </div>
  );
};

export default App;
