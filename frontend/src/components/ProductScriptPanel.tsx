import React, { useEffect, useState } from 'react';
import { ReferenceImage } from '../services/museBatchService';
import {
  EMPTY_PRODUCT,
  GeneratedScript,
  ProductInfo,
  generateScript,
  describeScriptSource,
  SCRIPT_MODES,
  ScriptMode,
  getScrapeStatus,
  getShopLoginState,
  openShopLogin,
  sceneToPromptLine,
  scrapeProductLink,
  urlToDataUrl,
} from '../services/productService';
import { SCRIPT_TEMPLATES, TEMPLATE_GROUPS } from '../data/scriptTemplates';
import { usePersistentState } from '../hooks/usePersistentState';

const TOTAL_DURATIONS = [10, 20, 30, 40, 60];

/**
 * Khối "Sản phẩm & Kịch bản":
 *  A. Đọc link Shopee / TikTok (hoặc tự nhập) -> tên, giá, mô tả, ảnh sản phẩm
 *  B. Chọn mẫu kịch bản -> AI (muse-chat, có nhìn ảnh sản phẩm) viết kịch bản chia cảnh
 *     -> đổ vào danh sách prompt hàng loạt.
 */
export const ProductScriptPanel: React.FC<{
  product: ProductInfo;
  setProduct: React.Dispatch<React.SetStateAction<ProductInfo>>;
  references: ReferenceImage[];
  onUseImage: (dataUrl: string, role: ReferenceImage['role'], name: string) => void;
  secondsPerScene: number;
  onApplyScenes: (lines: string[]) => void;
  /** Nhân vật trong thư viện (Cài đặt) để kịch bản dùng đúng tên */
  characters?: { name: string; description: string; voice?: string }[];
  /** Tên nhân vật chính đang chọn (khối 2) — kịch bản dùng người này làm người dẫn */
  mainCharacter?: string;
}> = ({ product, setProduct, references, onUseImage, secondsPerScene, onApplyScenes, characters = [], mainCharacter }) => {
  const [scriptMode, setScriptMode] = usePersistentState<ScriptMode>('script.mode.v1', 'template');
  const [link, setLink] = useState(product.url);
  const [scraping, setScraping] = useState(false);
  const [scrapeNote, setScrapeNote] = useState('');
  const [waitingUser, setWaitingUser] = useState(false);
  const [needsLogin, setNeedsLogin] = useState<'' | 'shopee' | 'tiktok'>('');
  const [loginOpen, setLoginOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const [templateId, setTemplateId] = usePersistentState('script.template.v1', SCRIPT_TEMPLATES[0].id);
  const [totalSeconds, setTotalSeconds] = usePersistentState('script.total.v1', 30);
  const [withDialogue, setWithDialogue] = usePersistentState('script.dialogue.v1', true);
  const [extraNote, setExtraNote] = usePersistentState('script.note.v1', '');
  const [script, setScript] = usePersistentState<GeneratedScript | null>('script.last.v1', null);
  const [writing, setWriting] = useState(false);
  const [scriptNote, setScriptNote] = useState('');

  const template = SCRIPT_TEMPLATES.find((t) => t.id === templateId) || SCRIPT_TEMPLATES[0];
  const sceneCount = Math.max(1, Math.ceil(totalSeconds / Math.max(1, secondsPerScene)));
  const productRef = references.find((r) => r.role === 'product');

  // Theo dõi cửa sổ đăng nhập Shopee/TikTok: khi người dùng đóng nó thì tự đọc lại link
  useEffect(() => {
    if (!loginOpen) return;
    const timer = setInterval(async () => {
      try {
        const { open } = await getShopLoginState();
        if (!open) {
          setLoginOpen(false);
          setNeedsLogin('');
          handleScrape();
        }
      } catch {
        setLoginOpen(false);
      }
    }, 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loginOpen]);

  const handleScrape = async () => {
    if (!link.trim()) return setScrapeNote('Dán link sản phẩm Shopee / TikTok Shop trước.');
    setScraping(true);
    setScrapeNote('Đang mở trang sản phẩm (15-40 giây)...');
    // Hiện tiến trình từ Gateway, đặc biệt khi Shopee/TikTok bắt kéo captcha hoặc đăng nhập
    const statusTimer = window.setInterval(async () => {
      try {
        const st = await getScrapeStatus();
        if (st.busy && st.message) {
          setScrapeNote(st.message);
          setWaitingUser(st.waiting_user);
        }
      } catch {
        /* Gateway cũ chưa có /status: bỏ qua */
      }
    }, 1500);
    try {
      const r = await scrapeProductLink(link.trim());
      setNeedsLogin(r.needs_login && r.site ? r.site : '');
      if (r.images.length === 0 && !r.title) {
        setScrapeNote(`⚠️ ${r.warning || 'Không đọc được trang.'}`);
        return;
      }
      setProduct((prev) => ({
        ...prev,
        url: r.url,
        name: r.needs_login ? prev.name : r.title || prev.name,
        price: r.price || prev.price,
        brand: r.brand || prev.brand,
        description: r.description || prev.description,
        pageText: r.text,
        images: r.images.map((i) => i.url),
        visual: '',
      }));
      setScrapeNote(
        r.warning ? `⚠️ ${r.warning}` : `✅ Đọc được ${r.images.length} ảnh. Bấm "Dùng làm ảnh SP" trên ảnh đúng nhất.`
      );
      // Chưa có ảnh sản phẩm tham chiếu thì tự lấy ảnh đầu tiên
      if (!productRef && r.images[0]) {
        onUseImage(await urlToDataUrl(r.images[0].url), 'product', r.title || 'product');
      }
    } catch (err: any) {
      setScrapeNote(`❌ ${err.message}`);
    } finally {
      window.clearInterval(statusTimer);
      setWaitingUser(false);
      setScraping(false);
    }
  };

  const handleShopLogin = async () => {
    if (!needsLogin) return;
    try {
      await openShopLogin(needsLogin);
      setLoginOpen(true);
      setScrapeNote(
        `Đăng nhập ${needsLogin === 'shopee' ? 'Shopee' : 'TikTok'} trong cửa sổ Chrome vừa mở, xong thì ĐÓNG cửa sổ đó — app sẽ tự đọc lại link.`
      );
    } catch (err: any) {
      setScrapeNote(`❌ ${err.message}`);
    }
  };

  const useImage = async (url: string, role: ReferenceImage['role']) => {
    try {
      onUseImage(await urlToDataUrl(url), role, product.name || role);
    } catch (err: any) {
      setScrapeNote(`❌ ${err.message}`);
    }
  };

  const handleWriteScript = async () => {
    const noProduct = !product.name.trim() && !productRef && product.images.length === 0;
    if (noProduct && scriptMode !== 'short_film') {
      return setScriptNote('Cần tên sản phẩm hoặc ảnh sản phẩm để AI viết đúng kịch bản.');
    }
    if (noProduct && !extraNote.trim()) {
      return setScriptNote('Phim ngắn không có sản phẩm: nhập ý tưởng câu chuyện vào ô "Yêu cầu thêm".');
    }
    setWriting(true);
    setScriptNote('AI đang xem ảnh sản phẩm và viết kịch bản (30-90 giây)...');
    try {
      const images: string[] = [];
      if (productRef) images.push(productRef.dataUrl);
      for (const url of product.images.slice(0, 2)) {
        if (images.length >= 2) break;
        try {
          images.push(await urlToDataUrl(url));
        } catch {
          /* bỏ qua ảnh lỗi */
        }
      }
      const result = await generateScript({
        product,
        template,
        mode: scriptMode,
        characters,
        mainCharacter,
        sceneCount,
        secondsPerScene,
        withDialogue: withDialogue && true,
        productImages: images,
        extraNote,
      });
      setScript(result);
      setProduct((prev) => ({
        ...prev,
        name: prev.name || result.product.name || '',
        // Ô ngoại hình đang trống / quá ngắn thì lấy bản AI vừa tả kỹ; người dùng đã tự viết dài thì giữ
        visual: (prev.visual || '').trim().length >= 60 ? prev.visual : result.product.visual || prev.visual,
      }));
      onApplyScenes(result.scenes.map(sceneToPromptLine));
      setScriptNote(
        `✅ Đã viết ${result.scenes.length} cảnh và đưa vào danh sách prompt bên dưới. Nguồn: ${describeScriptSource(result.source)}`
      );
    } catch (err: any) {
      setScriptNote(`❌ ${err.message}`);
    } finally {
      setWriting(false);
    }
  };

  const field = 'w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-indigo-500';

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-indigo-400">3. Sản phẩm & Kịch bản</h3>
        {(product.name || product.images.length > 0) && (
          <button
            onClick={() => {
              setProduct(EMPTY_PRODUCT);
              setLink('');
              setScript(null);
              setScrapeNote('');
              setScriptNote('');
            }}
            className="text-[11px] text-slate-400 hover:text-red-300"
          >
            Xóa sản phẩm
          </button>
        )}
      </div>

      {/* A. Link sản phẩm */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !scraping && handleScrape()}
            placeholder="Dán link Shopee (s.shopee.vn/...), TikTok Shop (vt.tiktok.com/...) hoặc trang bán hàng"
            className={field}
          />
          <button
            onClick={handleScrape}
            disabled={scraping || loginOpen}
            className="shrink-0 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 rounded-lg text-xs font-semibold"
          >
            {scraping ? 'Đang đọc...' : '🔍 Phân tích'}
          </button>
        </div>
        {needsLogin && (
          <button
            onClick={handleShopLogin}
            disabled={loginOpen}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 rounded-lg text-xs font-semibold"
          >
            {loginOpen ? 'Đang chờ bạn đăng nhập...' : `🔑 Đăng nhập ${needsLogin === 'shopee' ? 'Shopee' : 'TikTok'} (1 lần)`}
          </button>
        )}
        {scrapeNote && (
          <p
            className={
              waitingUser
                ? 'text-xs font-semibold text-amber-300 bg-amber-500/10 border border-amber-600/40 rounded-lg p-2'
                : 'text-[11px] text-slate-300'
            }
          >
            {waitingUser ? '👉 ' : ''}
            {scrapeNote}
          </p>
        )}
      </div>

      {/* Thông tin sản phẩm (Tự nhập SP = sửa trực tiếp các ô này) */}
      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <input
            value={product.name}
            onChange={(e) => setProduct({ ...product, name: e.target.value })}
            placeholder="Tên sản phẩm (tự nhập nếu không có link)"
            className={`${field} col-span-2`}
          />
          <input
            value={product.price}
            onChange={(e) => setProduct({ ...product, price: e.target.value })}
            placeholder="Giá"
            className={field}
          />
        </div>
        <button onClick={() => setShowDetails((v) => !v)} className="text-[11px] text-slate-400 hover:text-white">
          {showDetails ? '▾' : '▸'} Mô tả & đặc điểm sản phẩm
        </button>
        {showDetails && (
          <div className="space-y-2">
            <textarea
              rows={3}
              value={product.description}
              onChange={(e) => setProduct({ ...product, description: e.target.value })}
              placeholder="Mô tả, chất liệu, công dụng, điểm nổi bật..."
              className={field}
            />
            <input
              value={product.visual}
              onChange={(e) => setProduct({ ...product, visual: e.target.value })}
              placeholder="Ngoại hình sản phẩm (AI tự điền khi viết kịch bản) — gắn vào mọi prompt video"
              className={field}
            />
          </div>
        )}

        {product.images.length > 0 && (
          <div className="grid grid-cols-4 gap-2 max-h-56 overflow-y-auto pr-1">
            {product.images.map((url) => (
              <div key={url} className="relative group rounded-lg overflow-hidden border border-slate-800 bg-slate-900">
                <img src={url} alt="" className="w-full aspect-[9/16] object-contain bg-slate-950" loading="lazy" />
                <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition flex flex-col items-center justify-center gap-1">
                  <button onClick={() => useImage(url, 'product')} className="px-1.5 py-0.5 bg-indigo-600 rounded text-[10px]">
                    Dùng làm ảnh SP
                  </button>
                  <button onClick={() => useImage(url, 'outfit')} className="px-1.5 py-0.5 bg-slate-700 rounded text-[10px]">
                    Dùng làm trang phục
                  </button>
                  <button onClick={() => useImage(url, 'character')} className="px-1.5 py-0.5 bg-slate-700 rounded text-[10px]">
                    Dùng làm nhân vật
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* B. Kịch bản */}
      <div className="space-y-2 border-t border-slate-800 pt-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <label className="block text-[11px] text-slate-400 mb-1">Kiểu kịch bản</label>
            <select value={scriptMode} onChange={(e) => setScriptMode(e.target.value as ScriptMode)} className={field}>
              {SCRIPT_MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-slate-500 mt-1">{SCRIPT_MODES.find((m) => m.id === scriptMode)?.hint}</p>
          </div>
          <div className={`col-span-2 ${scriptMode === 'template' ? '' : 'hidden'}`}>
            <label className="block text-[11px] text-slate-400 mb-1">Mẫu kịch bản ({SCRIPT_TEMPLATES.length} mẫu)</label>
            <select value={template.id} onChange={(e) => setTemplateId(e.target.value)} className={field}>
              {TEMPLATE_GROUPS.map((g) => (
                <optgroup key={g} label={g}>
                  {SCRIPT_TEMPLATES.filter((t) => t.group === g).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="text-[10px] text-slate-500 mt-1">{template.guide}</p>
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Tổng thời lượng</label>
            <select value={totalSeconds} onChange={(e) => setTotalSeconds(Number(e.target.value))} className={field}>
              {TOTAL_DURATIONS.map((s) => (
                <option key={s} value={s}>
                  {s} giây → {Math.ceil(s / Math.max(1, secondsPerScene))} cảnh × {secondsPerScene}s
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Lời thoại</label>
            <select
              value={withDialogue ? 'yes' : 'no'}
              onChange={(e) => setWithDialogue(e.target.value === 'yes')}
              className={field}
            >
              <option value="yes">Có lời thoại tiếng Việt</option>
              <option value="no">Không thoại (nhạc nền / ASMR)</option>
            </select>
          </div>
        </div>
        <input
          value={extraNote}
          onChange={(e) => setExtraNote(e.target.value)}
          placeholder="Yêu cầu thêm (tùy chọn): bối cảnh, giọng điệu, ưu đãi, đối tượng khách..."
          className={field}
        />
        <button
          onClick={handleWriteScript}
          disabled={writing}
          className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 rounded-lg text-xs font-bold"
        >
          {writing ? '✍️ AI đang viết kịch bản...' : `✍️ AI viết kịch bản ${sceneCount} cảnh theo sản phẩm`}
        </button>
        {scriptNote && <p className="text-[11px] text-slate-300">{scriptNote}</p>}

        {script?.source && (
          <p className="text-[10px] text-slate-500">
            🤖 Kịch bản tạo bởi: <span className="text-slate-300">{describeScriptSource(script.source)}</span>
          </p>
        )}
        {script && script.scenes.length > 0 && (
          <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
            {script.scenes.map((s, i) => (
              <div key={i} className="bg-slate-900 border border-slate-800 rounded-lg p-2 text-[11px]">
                <div className="font-semibold text-indigo-300">
                  Cảnh {i + 1}
                  {s.title ? `: ${s.title.replace(/^cảnh\s*\d+\s*[-:–]\s*/i, '')}` : ''}
                </div>
                {s.voiceover && <div className="text-emerald-300 mt-0.5">🎙 “{s.voiceover}”</div>}
                <div className="text-slate-400 mt-0.5">{s.prompt}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
