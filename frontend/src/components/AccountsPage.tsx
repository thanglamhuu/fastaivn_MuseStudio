import React, { useEffect, useRef, useState } from 'react';
import {
  LoginJob,
  MuseVoice,
  StudioAccount,
  listMuseVoices,
  cancelBrowserLogin,
  checkMuseQuota,
  deleteMuseAccount,
  getBrowserLogin,
  importMuseCookieAccount,
  isAccountUsable,
  renewMuseAccount,
  resetMuseAccount,
  startBrowserLogin,
  updateStudioAccount,
} from '../services/museBatchService';
import { MuseAccountsState } from '../hooks/useMuseAccounts';
import { loadPersisted, savePersisted } from '../hooks/usePersistentState';
import { MATRIX_12_VOICES } from '../data/voicePresets';

const LOGIN_JOB_KEY = 'loginJob.v1';

const statusBadge = (acc: StudioAccount) => {
  if (!acc.enabled) return { text: 'Đã tắt', cls: 'bg-slate-700 text-slate-300' };
  if (acc.status === 'invalid') return { text: 'Cần đăng nhập lại', cls: 'bg-red-500/20 text-red-400' };
  if (acc.status === 'cooling') {
    const mins = Math.max(0, Math.ceil((acc.cooldown_until * 1000 - Date.now()) / 60000));
    return { text: mins > 0 ? `Tạm nghỉ ~${mins} phút` : 'Tạm nghỉ', cls: 'bg-amber-500/20 text-amber-400' };
  }
  if (acc.inflight > 0) return { text: `Đang chạy ${acc.inflight} luồng`, cls: 'bg-sky-500/20 text-sky-300' };
  return { text: 'Sẵn sàng', cls: 'bg-emerald-500/20 text-emerald-400' };
};

/** Đếm ngược tới mốc `untilSec` (giây unix): "05:12:09" hoặc "2 ngày 03:00:00". */
const countdown = (untilSec: number) => {
  const s = Math.max(0, Math.floor(untilSec - Date.now() / 1000));
  const d = Math.floor(s / 86400);
  const hms = [Math.floor((s % 86400) / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
  return d > 0 ? `${d} ngày ${hms}` : hms;
};

const timeAgo = (ts?: number) => {
  if (!ts) return '';
  const mins = Math.round((Date.now() / 1000 - ts) / 60);
  if (mins < 1) return 'vừa xong';
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} giờ trước` : `${Math.round(hours / 24)} ngày trước`;
};

// ---------------------------------------------------------------------------
// Một dòng tài khoản
// ---------------------------------------------------------------------------

const AccountRow: React.FC<{
  acc: StudioAccount;
  perAccountMax: number;
  loginBusy: boolean;
  voices: MuseVoice[];
  onLogin: (acc: StudioAccount) => void;
  onChanged: () => void;
}> = ({ acc, perAccountMax, loginBusy, voices, onLogin, onChanged }) => {
  const [label, setLabel] = useState(acc.label);
  const [cookieOpen, setCookieOpen] = useState(false);
  const [cookieText, setCookieText] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => setLabel(acc.label), [acc.label]);

  const run = async (name: string, action: () => Promise<string | void>) => {
    setBusy(name);
    setNote('');
    try {
      const msg = await action();
      if (msg) setNote(msg);
    } catch (err: any) {
      setNote(`❌ ${err.message}`);
    } finally {
      setBusy('');
      onChanged();
    }
  };

  const badge = statusBadge(acc);
  const quota = acc.meta?.quota;
  const usedPct = typeof quota?.weekly_used_pct === 'number' ? quota.weekly_used_pct : null;

  return (
    <div className={`bg-slate-950 border rounded-xl p-3.5 space-y-2.5 ${acc.enabled ? 'border-slate-800' : 'border-slate-800 opacity-60'}`}>
      <div className="flex flex-wrap items-center gap-2.5">
        {/* Bật / tắt */}
        <button
          onClick={() => run('toggle', () => updateStudioAccount(acc.id, { enabled: !acc.enabled }).then(() => {}))}
          className={`w-10 h-5 rounded-full relative transition ${acc.enabled ? 'bg-emerald-500' : 'bg-slate-600'}`}
          title={acc.enabled ? 'Đang bật — bấm để tắt' : 'Đang tắt — bấm để bật'}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${acc.enabled ? 'left-5' : 'left-0.5'}`} />
        </button>

        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => label !== acc.label && run('label', () => updateStudioAccount(acc.id, { label }).then(() => {}))}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="w-40 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-indigo-500"
          placeholder="Tên tài khoản"
        />

        <span className={`px-2 py-0.5 rounded-full text-[11px] ${badge.cls}`}>{badge.text}</span>
        {Object.entries(acc.blocked || {}).map(([kind, b]) => (
          <span
            key={kind}
            className={`px-2 py-0.5 rounded-full text-[11px] ${
              b.reason === 'region' ? 'bg-red-500/20 text-red-300' : 'bg-orange-500/20 text-orange-300'
            }`}
            title={
              b.reason === 'region'
                ? 'muse.ai không cho tài khoản này tạo video ở khu vực hiện tại; vẫn tạo ảnh được.'
                : 'Đã chạm giới hạn tạo video; tool tự chuyển video sang tài khoản khác.'
            }
          >
            {b.reason === 'region' ? '🚫 Chặn' : '⏳ Giới hạn'} {kind === 'video' ? 'video' : kind} ·{' '}
            {countdown(b.until)}
          </span>
        ))}
        {acc.quota_exhausted && (
          <span className="px-2 py-0.5 rounded-full text-[11px] bg-red-500/20 text-red-300">Hết hạn mức tuần</span>
        )}

        {/* Hạn mức */}
        <div className="flex items-center gap-1.5 min-w-[130px]" title={quota?.error || quota?.plan || ''}>
          {usedPct !== null ? (
            <>
              <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full ${usedPct >= 90 ? 'bg-red-500' : usedPct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                  style={{ width: `${Math.min(100, usedPct)}%` }}
                />
              </div>
              <span className="text-[11px] text-slate-400">
                {usedPct}%{quota?.resets_at ? ` · đặt lại ${quota.resets_at}` : ''}
              </span>
            </>
          ) : (
            <span className="text-[11px] text-slate-500">{quota?.error ? 'Không đọc được hạn mức' : 'Chưa xem hạn mức'}</span>
          )}
        </div>

        <select
          value={acc.max_concurrency}
          onChange={(e) =>
            run('threads', () => updateStudioAccount(acc.id, { max_concurrency: Number(e.target.value) }).then(() => {}))
          }
          className="bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-1 text-xs"
          title="Số video tài khoản này được tạo cùng lúc"
        >
          {Array.from({ length: perAccountMax }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n} luồng
            </option>
          ))}
        </select>

        <select
          value={String(acc.meta.dedicated_voice || '')}
          onChange={(e) =>
            run('voice', () => updateStudioAccount(acc.id, { dedicated_voice: e.target.value }).then(() => {}))
          }
          className="bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-1 text-xs max-w-[190px]"
          title="Giọng dành riêng: tài khoản chỉ nhận cảnh dùng đúng giọng này (muse.ai đặt giọng theo tài khoản)"
        >
          <option value="">🎙 Giọng: dùng chung</option>
          <optgroup label="Giọng gốc của 12 hồ sơ">
            {[...new Map(MATRIX_12_VOICES.map((v) => [v.museVoiceId, v])).values()].map((v) => (
              <option key={v.museVoiceId} value={v.museVoiceId}>
                🎙 {v.museVoiceName} ({v.gender === 'male' ? 'Nam' : 'Nữ'})
              </option>
            ))}
          </optgroup>
          <optgroup label="Giọng khác của muse.ai">
            {voices
              .filter((v) => !MATRIX_12_VOICES.some((m) => m.museVoiceId === v.id))
              .map((v) => (
                <option key={v.id} value={v.id}>
                  🎙 {v.name} · {v.group_label}
                </option>
              ))}
          </optgroup>
        </select>

        <div className="flex flex-wrap gap-1.5 ml-auto">
          <button
            disabled={loginBusy}
            onClick={() => onLogin(acc)}
            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 rounded-lg text-xs font-semibold"
            title="Mở Chrome để đăng nhập lại tài khoản này, cookie được lấy tự động"
          >
            Đăng nhập
          </button>
          <button
            onClick={() => setCookieOpen((v) => !v)}
            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs"
          >
            Cookie
          </button>
          <button
            disabled={!!busy}
            onClick={() =>
              run('renew', async () => {
                const r = await renewMuseAccount(acc.id);
                return r.ok ? '✅ Phiên còn hiệu lực' : `❌ ${r.error || 'Phiên không hợp lệ'}`;
              })
            }
            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-lg text-xs"
          >
            {busy === 'renew' ? 'Đang kiểm tra...' : 'Kiểm tra phiên'}
          </button>
          <button
            disabled={!!busy || !isAccountUsable(acc)}
            onClick={() =>
              run('quota', async () => {
                const q = await checkMuseQuota(acc.id);
                return q.error ? `❌ ${q.error}` : `✅ Đã dùng ${q.weekly_used_pct ?? '?'}% hạn mức tuần`;
              })
            }
            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-lg text-xs"
          >
            {busy === 'quota' ? 'Đang đọc...' : 'Hạn mức'}
          </button>
          {(acc.status === 'cooling' || acc.last_error) && acc.status !== 'invalid' && (
            <button
              disabled={!!busy}
              onClick={() => run('reset', () => resetMuseAccount(acc.id))}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs"
              title="Bỏ trạng thái tạm nghỉ để dùng lại ngay"
            >
              Đặt lại
            </button>
          )}
          <button
            disabled={!!busy}
            onClick={() =>
              window.confirm(`Xóa tài khoản "${acc.label || acc.id}" khỏi Gateway?`) &&
              run('delete', () => deleteMuseAccount(acc.id))
            }
            className="px-2.5 py-1 text-red-300 hover:bg-red-600/30 rounded-lg text-xs"
          >
            Xoá
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span>
          ✅ {acc.success_count} thành công · ❌ {acc.fail_count} lỗi
        </span>
        {acc.last_used_at > 0 && <span>Dùng lần cuối {timeAgo(acc.last_used_at)}</span>}
        {acc.meta?.logged_in_at && <span>Đăng nhập {timeAgo(acc.meta.logged_in_at)}</span>}
        {acc.last_error && (
          <span className="text-red-400 truncate max-w-full" title={acc.last_error}>
            Lỗi gần nhất: {acc.last_error}
          </span>
        )}
      </div>

      {cookieOpen && (
        <div className="space-y-2">
          <textarea
            rows={2}
            value={cookieText}
            onChange={(e) => setCookieText(e.target.value)}
            placeholder="Dán dòng cookie: hatch_sess=...; hatch_native_auth_device=..."
            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs font-mono focus:outline-none focus:border-indigo-500"
          />
          <button
            disabled={!!busy || !cookieText.trim()}
            onClick={() =>
              run('cookie', async () => {
                await updateStudioAccount(acc.id, { cookies: cookieText });
                setCookieText('');
                setCookieOpen(false);
                return '✅ Đã cập nhật cookie';
              })
            }
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 rounded-lg text-xs font-semibold"
          >
            Lưu cookie
          </button>
        </div>
      )}

      {note && <p className="text-xs text-slate-300">{note}</p>}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Trang Dàn tài khoản
// ---------------------------------------------------------------------------

export const AccountsPage: React.FC<{ state: MuseAccountsState }> = ({ state }) => {
  const { accounts, perAccountMax, error, refresh, usableCount, totalThreads, runningThreads } = state;
  const [loginJob, setLoginJob] = useState<LoginJob | null>(null);
  const [loginError, setLoginError] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkNote, setBulkNote] = useState('');
  const [checkingAll, setCheckingAll] = useState(false);
  const pollRef = useRef<number | null>(null);
  const [voices, setVoices] = useState<MuseVoice[]>([]);
  useEffect(() => {
    listMuseVoices().then(setVoices).catch(() => setVoices([]));
  }, []);

  const loginActive = !!loginJob && ['starting', 'waiting', 'verifying'].includes(loginJob.status);

  // Theo dõi phiên đăng nhập đang mở (kể cả sau khi tải lại trang)
  useEffect(() => {
    const saved = loadPersisted<string | null>(LOGIN_JOB_KEY, null);
    if (saved) getBrowserLogin(saved).then(setLoginJob).catch(() => savePersisted(LOGIN_JOB_KEY, null));
  }, []);

  useEffect(() => {
    if (!loginActive || !loginJob) return;
    pollRef.current = window.setInterval(async () => {
      try {
        const job = await getBrowserLogin(loginJob.id);
        setLoginJob(job);
        if (!['starting', 'waiting', 'verifying'].includes(job.status)) {
          savePersisted(LOGIN_JOB_KEY, null);
          refresh();
        }
      } catch {
        // Gateway khởi động lại thì job mất: dừng theo dõi
        setLoginJob(null);
        savePersisted(LOGIN_JOB_KEY, null);
      }
    }, 1500);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [loginActive, loginJob?.id, refresh]);

  const beginLogin = async (acc?: StudioAccount) => {
    setLoginError('');
    try {
      const label = acc ? acc.label : `Tài khoản ${accounts.length + 1}`;
      const job = await startBrowserLogin({ accountId: acc?.id, label });
      setLoginJob(job);
      savePersisted(LOGIN_JOB_KEY, job.id);
    } catch (err: any) {
      setLoginError(err.message);
    }
  };

  const handleBulkImport = async () => {
    setBulkNote('');
    try {
      const { importedCount } = await importMuseCookieAccount(bulkText);
      setBulkText('');
      setBulkOpen(false);
      setBulkNote(`✅ Đã thêm ${importedCount} tài khoản`);
    } catch (err: any) {
      setBulkNote(`❌ ${err.message}`);
    } finally {
      refresh();
    }
  };

  const handleCheckAll = async () => {
    setCheckingAll(true);
    const targets = accounts.filter((a) => a.enabled);
    let ok = 0;
    for (const acc of targets) {
      try {
        if ((await renewMuseAccount(acc.id)).ok) ok++;
      } catch {
        // tài khoản lỗi được đánh dấu bên Gateway
      }
    }
    setCheckingAll(false);
    setBulkNote(`Kiểm tra phiên: ${ok}/${targets.length} tài khoản còn đăng nhập`);
    refresh();
  };

  return (
    <div className="p-6 space-y-5 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">👥 Dàn tài khoản Muse</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Khi chạy hàng loạt, Gateway tự xoay tua: mỗi video được giao cho tài khoản rảnh lâu nhất, mỗi tài khoản
            chạy tối đa số luồng đã chọn.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleCheckAll}
            disabled={checkingAll || accounts.length === 0}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-lg text-xs"
          >
            {checkingAll ? 'Đang kiểm tra...' : 'Kiểm tra phiên tất cả'}
          </button>
          <button
            onClick={() => setBulkOpen((v) => !v)}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs"
          >
            + Thêm nhiều TK (cookie)
          </button>
          <button
            onClick={() => beginLogin()}
            disabled={loginActive}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 rounded-lg text-xs font-semibold"
          >
            + Thêm tài khoản (đăng nhập)
          </button>
        </div>
      </div>

      {/* Tổng quan */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Tài khoản dùng được', value: `${usableCount}/${accounts.length}` },
          { label: 'Tổng luồng tạo video', value: totalThreads },
          { label: 'Đang chạy', value: `${runningThreads} luồng` },
          { label: 'Tối đa mỗi tài khoản', value: `${perAccountMax} luồng` },
        ].map((s) => (
          <div key={s.label} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
            <div className="text-[11px] text-slate-400">{s.label}</div>
            <div className="text-lg font-bold text-white">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Phiên đăng nhập đang mở */}
      {loginJob && (
        <div
          className={`rounded-xl border p-3.5 flex flex-wrap items-center justify-between gap-3 ${
            loginJob.status === 'succeeded'
              ? 'border-emerald-700 bg-emerald-950/40'
              : loginJob.status === 'failed'
              ? 'border-red-800 bg-red-950/40'
              : 'border-indigo-700 bg-indigo-950/40'
          }`}
        >
          <div className="text-sm">
            <div className="font-semibold text-white">
              {loginActive ? '🌐 Đang chờ đăng nhập' : loginJob.status === 'succeeded' ? '✅ Đăng nhập xong' : 'Đăng nhập kết thúc'}
              {loginJob.label ? ` — ${loginJob.label}` : ''}
            </div>
            <div className="text-xs text-slate-300 mt-0.5">{loginJob.message}</div>
            {loginActive && (
              <div className="text-[11px] text-slate-400 mt-1">
                Đăng nhập trong cửa sổ Chrome vừa mở. Khi xong, app tự lấy cookie và đóng cửa sổ đó.
              </div>
            )}
          </div>
          {loginActive ? (
            <button
              onClick={() => cancelBrowserLogin(loginJob.id).then(() => getBrowserLogin(loginJob.id).then(setLoginJob))}
              className="px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded-lg text-xs font-semibold"
            >
              Hủy
            </button>
          ) : (
            <button onClick={() => setLoginJob(null)} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs">
              Đóng
            </button>
          )}
        </div>
      )}
      {loginError && <p className="text-xs text-red-400">❌ {loginError}</p>}

      {bulkOpen && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
          <p className="text-[11px] text-slate-400">
            F12 ➔ Network ➔ request tới muse.ai ➔ copy dòng <code>cookie:</code>. Mỗi tài khoản 1 dòng, có thể đặt tên
            dạng <code>tên | cookie</code>.
          </p>
          <textarea
            rows={4}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={'TK chính | hatch_sess=...; hatch_native_auth_device=...\nTK phụ | hatch_sess=...; ...'}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs font-mono focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={handleBulkImport}
            disabled={!bulkText.trim()}
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 rounded-lg text-xs font-semibold"
          >
            Thêm các tài khoản
          </button>
        </div>
      )}
      {bulkNote && <p className="text-xs text-slate-300">{bulkNote}</p>}
      {error && <p className="text-xs text-red-400">❌ {error}</p>}

      <div className="space-y-3">
        {accounts.length === 0 && !error ? (
          <div className="border border-dashed border-slate-800 rounded-xl p-10 text-center text-sm text-slate-500">
            Chưa có tài khoản nào. Bấm "+ Thêm tài khoản (đăng nhập)" để mở Chrome và đăng nhập muse.ai.
          </div>
        ) : (
          [...accounts]
            .sort((a, b) => a.created_at - b.created_at)
            .map((acc) => (
              <AccountRow
                key={acc.id}
                acc={acc}
                perAccountMax={perAccountMax}
                loginBusy={loginActive}
                voices={voices}
                onLogin={beginLogin}
                onChanged={refresh}
              />
            ))
        )}
      </div>
    </div>
  );
};
