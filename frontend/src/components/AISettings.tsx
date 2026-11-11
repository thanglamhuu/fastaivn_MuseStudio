import React, { useEffect, useState } from 'react';
import { AIConfig, getAIConfig, saveAIConfig, testAIProvider } from '../services/museBatchService';

const field =
  'w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500';

/** Cài đặt ➔ Trợ lý AI: Gemini API key (xoay vòng nhiều key) hoặc endpoint tương thích OpenAI. */
export const AISettings: React.FC = () => {
  const [cfg, setCfg] = useState<AIConfig | null>(null);
  const [keysText, setKeysText] = useState('');
  const [form, setForm] = useState({ gemini_model: '', openai_base_url: '', openai_api_key: '', openai_model: '' });
  const [prefer, setPrefer] = useState<AIConfig['prefer']>('auto');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [results, setResults] = useState<{ index: number; key?: string; ok: boolean; detail: string }[]>([]);

  const apply = (c: AIConfig) => {
    setCfg(c);
    setKeysText(c.gemini_keys.join('\n'));
    setPrefer(c.prefer);
    setForm({
      gemini_model: c.gemini_model,
      openai_base_url: c.openai_base_url,
      openai_api_key: c.openai_api_key,
      openai_model: c.openai_model,
    });
  };

  useEffect(() => {
    getAIConfig().then(apply).catch((e) => setNote(`❌ ${e.message}`));
  }, []);

  const save = async () => {
    setBusy('save');
    try {
      apply(await saveAIConfig({ prefer, gemini_keys_text: keysText, ...form }));
      setNote('✅ Đã lưu cấu hình AI.');
    } catch (e: any) {
      setNote(`❌ ${e.message}`);
    } finally {
      setBusy('');
    }
  };

  const test = async (provider: 'gemini' | 'openai') => {
    setBusy(provider);
    setResults([]);
    try {
      await save();
      setResults((await testAIProvider(provider)).results);
    } catch (e: any) {
      setNote(`❌ ${e.message}`);
    } finally {
      setBusy('');
    }
  };

  const keyCount = keysText.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2 text-xs text-slate-300">
        <p className="font-semibold text-slate-100">Trợ lý viết kịch bản dùng AI nào?</p>
        <p>
          Khi bấm “AI viết kịch bản”, app thử lần lượt <b>Gemini</b> rồi <b>endpoint OpenAI</b> (theo lựa chọn bên dưới).
          Chưa cấu hình hoặc cả hai đều lỗi thì tự quay về <b>muse-chat</b> (dùng tài khoản Muse, như trước đây). Dưới
          kịch bản luôn ghi rõ được tạo bởi nguồn nào.
        </p>
        <label className="block text-[11px] text-slate-400 pt-1">Ưu tiên</label>
        <select value={prefer} onChange={(e) => setPrefer(e.target.value as AIConfig['prefer'])} className={field}>
          <option value="auto">Tự động: Gemini → OpenAI → muse-chat</option>
          <option value="gemini">Gemini trước</option>
          <option value="openai">Endpoint OpenAI trước</option>
          <option value="muse">Chỉ dùng muse-chat</option>
        </select>
      </div>

      <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-indigo-300">Google Gemini API key (xoay vòng nhiều key)</h3>
          <span className="text-[11px] text-slate-400">{keyCount} key</span>
        </div>
        <details className="text-[11px] text-slate-400 bg-slate-900/60 rounded-lg p-2.5" open={!cfg?.gemini_key_count}>
          <summary className="cursor-pointer text-slate-200 font-semibold">Cách lấy Gemini API key (miễn phí)</summary>
          <ol className="list-decimal pl-5 mt-1.5 space-y-1">
            <li>
              Mở{' '}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-indigo-300 underline">
                aistudio.google.com/apikey
              </a>{' '}
              và đăng nhập tài khoản Google.
            </li>
            <li>Bấm <b>Create API key</b> (chọn hoặc tạo một Google Cloud project), rồi bấm sao chép key (dạng <code>AIza...</code>).</li>
            <li>Dán vào ô dưới, mỗi dòng 1 key. Có thể dùng key của nhiều tài khoản Google khác nhau.</li>
            <li>
              Bấm <b>Kiểm tra key</b>. Key hết hạn mức (lỗi 429) hoặc bị khóa thì app tự chuyển sang key kế tiếp, nên nhiều
              key giúp viết kịch bản không bị gián đoạn.
            </li>
          </ol>
          <p className="mt-1.5">
            Key được lưu trên máy này (<code>data/studio/ai_config.json</code> của Gateway) và chỉ hiển thị dạng che.
          </p>
        </details>
        <textarea
          rows={4}
          value={keysText}
          onChange={(e) => setKeysText(e.target.value)}
          placeholder={'AIzaSy... (key 1)\nAIzaSy... (key 2)'}
          className={`${field} font-mono`}
        />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Model Gemini</label>
            <input
              list="gemini-models"
              value={form.gemini_model}
              onChange={(e) => setForm({ ...form, gemini_model: e.target.value })}
              className={field}
            />
            <datalist id="gemini-models">
              <option value="gemini-3.5-flash" />
              <option value="gemini-3.8-flash" />
              <option value="gemini-3.5-flash-lite" />
              <option value="gemini-flash-latest" />
            </datalist>
          </div>
          <div className="flex items-end gap-2">
            <button
              onClick={() => test('gemini')}
              disabled={!!busy || keyCount === 0}
              className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 rounded-lg text-xs font-semibold"
            >
              {busy === 'gemini' ? 'Đang kiểm tra...' : '⚡ Lưu & kiểm tra key'}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-bold text-indigo-300">Endpoint tương thích OpenAI (tùy chọn)</h3>
        <p className="text-[11px] text-slate-400">
          Dùng được với OpenAI, OpenRouter, DeepSeek, Groq, LM Studio / Ollama chạy trên máy... Nhập Base URL (thường kết
          thúc bằng <code>/v1</code>), API key và tên model. Model nên hỗ trợ đọc ảnh để AI nhìn thấy sản phẩm thật.
        </p>
        <input
          value={form.openai_base_url}
          onChange={(e) => setForm({ ...form, openai_base_url: e.target.value })}
          placeholder="https://api.openai.com/v1"
          className={field}
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            value={form.openai_api_key}
            onChange={(e) => setForm({ ...form, openai_api_key: e.target.value })}
            placeholder="API key (sk-...)"
            className={`${field} font-mono`}
          />
          <input
            value={form.openai_model}
            onChange={(e) => setForm({ ...form, openai_model: e.target.value })}
            placeholder="Tên model, vd: gpt-4o-mini"
            className={field}
          />
        </div>
        <button
          onClick={() => test('openai')}
          disabled={!!busy || !form.openai_base_url || !form.openai_model}
          className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 rounded-lg text-xs font-semibold"
        >
          {busy === 'openai' ? 'Đang kiểm tra...' : '⚡ Lưu & kiểm tra endpoint'}
        </button>
      </div>

      {results.length > 0 && (
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1 text-xs">
          {results.map((r) => (
            <p key={r.index} className={r.ok ? 'text-emerald-300' : 'text-red-300'}>
              {r.ok ? '[SỐNG]' : '[LỖI]'} {r.key ? `Key #${r.index} ${r.key}` : 'Endpoint'} {r.detail && `— ${r.detail}`}
            </p>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={!!busy}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 rounded-lg text-xs font-bold"
        >
          💾 Lưu cấu hình AI
        </button>
        {note && <span className="text-xs text-slate-300">{note}</span>}
      </div>
    </div>
  );
};
