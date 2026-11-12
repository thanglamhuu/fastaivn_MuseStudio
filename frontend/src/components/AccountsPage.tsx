import React, { useEffect, useRef, useState } from 'react';
import {
  LoginBatch,
  LoginJob,
  MuseVoice,
  cancelEmailLogin,
  getEmailLogin,
  startEmailLogin,
  StudioAccount,
  listMuseVoices,
  cancelBrowserLogin,
  checkMuseQuota,
  deleteMuseAccount,
  getBrowserLogin,
  importMuseCookieAccount,
  isAccountBlocked,
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
const EMAIL_BATCH_KEY = 'emailLoginBatch.v1';

const statusBadge = (acc: StudioAccount) => {
  // Bị khóa xét TRƯỚC "Đã tắt": tài khoản bị khóa được Gateway tự tắt, vẫn phải thấy rõ lý do
  if (isAccountBlocked(acc)) return { text: '⛔ Nghi bị khóa — đã tự tắt', cls: 'bg-red-600/30 text-red-300 font-semibold' };
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
        {acc.last_error && !isAccountBlocked(acc) && (
          <span className="text-red-400 truncate max-w-full" title={acc.last_error}>
            Lỗi gần nhất: {acc.last_error}
          </span>
        )}
      </div>

      {isAccountBlocked(acc) && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-[11px] text-red-200 space-y-0.5">
          <div className="font-semibold text-red-300">
            ⛔ Nghi tài khoản đã bị muse.ai khóa
            {acc.meta?.blocked_at ? ` (phát hiện ${timeAgo(acc.meta.blocked_at)})` : ''}
          </div>
          <div>
            Trang muse.ai của tài khoản này báo <i>"Muse is disconnected — We disconnected Muse to protect your information"</i>:
            vẫn đăng nhập được nhưng không còn ô chat, nên không tạo được ảnh / video. App đã <b>tự tắt</b> tài khoản này (không xoá)
            và ngừng giao việc.
          </div>
          <div className="text-red-300/80">
            Cách xử lý: đăng nhập muse.ai bằng trình duyệt để xem lại; nếu đúng bị khóa thì bấm "Submit a ticket" trên trang đó
            để xin mở lại, mở xong bấm "Đăng nhập" ở đây (đăng nhập được thì tài khoản tự bật lại); không dùng nữa thì bấm "Xoá".
          </div>
        </div>
      )}

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
  const { accounts, perAccountMax, perAccountDefault, error, refresh, usableCount, totalThreads, runningThreads } = state;
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

  // Đăng nhập bằng email + mã OTP đọc từ hộp thư (nhiều tài khoản, lần lượt)
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailText, setEmailText] = useState('');
  const [batch, setBatch] = useState<LoginBatch | null>(null);
  const batchActive = !!batch && !batch.finished;
  useEffect(() => {
    const saved = loadPersisted<string | null>(EMAIL_BATCH_KEY, null);
    if (saved) getEmailLogin(saved).then(setBatch).catch(() => savePersisted(EMAIL_BATCH_KEY, null));
  }, []);
  useEffect(() => {
    if (!batchActive || !batch) return;
    const t = window.setInterval(async () => {
      try {
        const b = await getEmailLogin(batch.id);
        setBatch(b);
        if (b.succeeded !== batch.succeeded) refresh();
        if (b.finished) {
          savePersisted(EMAIL_BATCH_KEY, null);
          refresh();
        }
      } catch {
        setBatch(null);
        savePersisted(EMAIL_BATCH_KEY, null);
      }
    }, 2000);
    return () => window.clearInterval(t);
  }, [batchActive, batch?.id, batch?.succeeded, refresh]);
  const beginEmailLogin = async () => {
    setLoginError('');
    try {
      const b = await startEmailLogin(emailText);
      setBatch(b);
      savePersisted(EMAIL_BATCH_KEY, b.id);
      setEmailOpen(false);
    } catch (err: any) {
      setLoginError(err.message);
    }
  };

  const jobActive = !!loginJob && ['starting', 'waiting', 'verifying'].includes(loginJob.status);
  const loginActive = jobActive || batchActive;

  // Theo dõi phiên đăng nhập đang mở (kể cả sau khi tải lại trang)
  useEffect(() => {
    const saved = loadPersisted<string | null>(LOGIN_JOB_KEY, null);
    if (saved) getBrowserLogin(saved).then(setLoginJob).catch(() => savePersisted(LOGIN_JOB_KEY, null));
  }, []);

  useEffect(() => {
    if (!jobActive || !loginJob) return;
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
  }, [jobActive, loginJob?.id, refresh]);

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
            onClick={() => setEmailOpen((v) => !v)}
            disabled={loginActive}
            className="px-3 py-1.5 bg-sky-700 hover:bg-sky-600 disabled:bg-slate-700 rounded-lg text-xs font-semibold"
            title="Dán email | link hộp thư — app tự gõ email, tự lấy mã OTP trong thư mới nhất"
          >
            ✉ Đăng nhập bằng email (OTP)
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

      {accounts.some(isAccountBlocked) && (
        <div className="rounded-xl border border-red-800 bg-red-950/40 p-3 text-xs text-red-200">
          <div className="font-semibold text-red-300">
            ⛔ {accounts.filter(isAccountBlocked).length} tài khoản nghi bị muse.ai khóa — đã tự tắt, không xoá:
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-red-200/90">
            {accounts
              .filter(isAccountBlocked)
              .map((a) => a.label || a.id)
              .join(' · ')}
          </div>
          <div className="mt-1 text-[11px] text-red-300/80">
            muse.ai báo "Muse is disconnected" cho các tài khoản này. Xem hướng dẫn ở từng tài khoản bên dưới.
          </div>
        </div>
      )}

      {/* Tổng quan */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Tài khoản dùng được', value: `${usableCount}/${accounts.length}` },
          { label: 'Tổng luồng tạo video', value: totalThreads },
          { label: 'Đang chạy', value: `${runningThreads} luồng` },
          { label: 'Luồng mỗi tài khoản', value: `${perAccountDefault} (tối đa ${perAccountMax})` },
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

      {emailOpen && !batchActive && (
        <div className="bg-slate-900 border border-sky-900 rounded-xl p-4 space-y-2">
          <p className="text-[11px] text-slate-400">
            Mỗi tài khoản 1 dòng: <code>email | link hộp thư</code>. App mở Chrome lần lượt từng tài khoản, tự gõ email,
            vào link hộp thư lấy <b>mã OTP trong thư mới nhất</b> (chỉ nhận thư đến sau khi bấm gửi mã) rồi gõ mã. Thiếu
            link thì dùng <code>https://generator.email/&lt;email&gt;</code>. Link hộp thư chung không chứa email (vd.{' '}
            <code>http://mail.monteam.net:8025</code>) cũng được: app lấy email ở đầu dòng để tra mã trên trang đó. Email trùng tài khoản đã có → đăng nhập lại
            cho tài khoản đó. Bước nào không tự làm được thì hoàn tất bằng tay trong cửa sổ Chrome.
          </p>
          <textarea
            rows={4}
            value={emailText}
            onChange={(e) => setEmailText(e.target.value)}
            placeholder={'ten1@dishow.net | https://generator.email/ten1@dishow.net\nabc123@monteam.net|http://mail.monteam.net:8025'}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs font-mono focus:outline-none focus:border-sky-500"
          />
          <button
            onClick={beginEmailLogin}
            disabled={!emailText.trim() || loginActive}
            className="px-4 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 rounded-lg text-xs font-semibold"
          >
            Đăng nhập các tài khoản
          </button>
        </div>
      )}

      {batch && (
        <div className={`rounded-xl border p-3.5 space-y-2 ${batchActive ? 'border-sky-700 bg-sky-950/30' : 'border-slate-700 bg-slate-900'}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-white">
              {batchActive ? '✉ Đang đăng nhập bằng email' : '✉ Đăng nhập bằng email xong'} — {batch.succeeded}/{batch.jobs.length} thành công
              {batch.failed ? `, ${batch.failed} lỗi / hủy` : ''}
            </div>
            {batchActive ? (
              <button
                onClick={() => cancelEmailLogin(batch.id).then(() => getEmailLogin(batch.id).then(setBatch))}
                className="px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded-lg text-xs font-semibold"
              >
                Hủy tất cả
              </button>
            ) : (
              <button onClick={() => setBatch(null)} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs">
                Đóng
              </button>
            )}
          </div>
          <div className="space-y-1">
            {batch.jobs.map((j) => (
              <div key={j.id} className="text-xs flex gap-2">
                <span className="w-4 shrink-0">
                  {j.status === 'succeeded' ? '✅' : j.status === 'failed' ? '❌' : j.status === 'cancelled' ? '⏹' : '⏳'}
                </span>
                <span className="font-mono text-slate-300 shrink-0">{j.email || j.label}</span>
                <span className="text-slate-400 truncate">{j.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

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
