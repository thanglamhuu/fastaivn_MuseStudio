import React, { useEffect, useState } from 'react';
import { AccountsPage } from './AccountsPage';
import { AISettings } from './AISettings';
import { MuseAccountsState } from '../hooks/useMuseAccounts';
import { StudioLibraryState } from '../hooks/useStudioLibrary';
import { StudioCharacter, StudioProduct, newLibraryId } from '../types/library';
import { EMOTION_OPTIONS, MATRIX_12_VOICES, resolveVoice } from '../data/voicePresets';
import { MuseVoiceSelect, VoiceBadge, VoiceSelect } from './VoicePicker';
import { fileToResizedDataUrl, urlToResizedDataUrl } from '../utils/image';
import { generatePortrait } from '../services/libraryService';
import { getStudioSettings, openProjectFolder } from '../services/museBatchService';
import { GATEWAY_URL } from '../config/appConfig';
import { LinkProduct, isProductLink, loginShop, readProductFromLink } from '../services/productFromLink';
import { isolateProductUnit } from '../services/productIsolate';
import {
  MaintenanceConfig,
  MaintenanceState,
  backupNow,
  cleanMedia,
  fmtBytes,
  getMaintenance,
  updateMaintenance,
} from '../services/maintenanceService';

type Section = 'accounts' | 'characters' | 'products' | 'voices' | 'ai' | 'general';

const field =
  'w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500';

const readImages = async (files: FileList | null) =>
  files ? Promise.all(Array.from(files).map((f) => fileToResizedDataUrl(f))) : [];

// ---------------------------------------------------------------------------
// Thẻ 9:16 dùng chung cho nhân vật và sản phẩm
// ---------------------------------------------------------------------------
const PortraitCard: React.FC<{
  image?: string;
  title: string;
  subtitle?: React.ReactNode;
  active: boolean;
  onClick: () => void;
}> = ({ image, title, subtitle, active, onClick }) => (
  <button
    onClick={onClick}
    className={`text-left rounded-xl overflow-hidden border bg-slate-950 transition ${
      active ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-slate-800 hover:border-slate-600'
    }`}
  >
    <div className="aspect-[9/16] bg-slate-900 flex items-center justify-center overflow-hidden">
      {image ? (
        <img src={image} alt={title} className="w-full h-full object-cover" />
      ) : (
        <span className="text-3xl text-slate-700">?</span>
      )}
    </div>
    <div className="p-2 space-y-1">
      <p className="text-xs font-semibold text-slate-100 truncate">{title || 'Chưa đặt tên'}</p>
      {subtitle}
    </div>
  </button>
);

/** Dải ảnh 9:16 có nút thêm / xóa / đặt làm ảnh chính. */
const ImageStrip: React.FC<{
  images: string[];
  onChange: (images: string[]) => void;
  label: string;
  fit?: 'cover' | 'contain';
}> = ({ images, onChange, label, fit = 'cover' }) => (
  <div>
    <p className="text-[11px] text-slate-400 mb-1">{label}</p>
    <div className="grid grid-cols-4 gap-2">
      {images.map((img, i) => (
        <div key={i} className="relative group aspect-[9/16] rounded-lg overflow-hidden border border-slate-800 bg-slate-900">
          <img src={img} alt="" className={`w-full h-full ${fit === 'cover' ? 'object-cover' : 'object-contain'}`} />
          {i === 0 && (
            <span className="absolute top-1 left-1 bg-indigo-600 text-[9px] px-1 rounded">Ảnh chính</span>
          )}
          <div className="absolute inset-x-0 bottom-0 p-1 flex gap-1 opacity-0 group-hover:opacity-100 transition bg-black/60">
            {i > 0 && (
              <button
                onClick={() => onChange([img, ...images.filter((_, j) => j !== i)])}
                className="flex-1 text-[9px] bg-indigo-600 rounded py-0.5"
              >
                Đặt chính
              </button>
            )}
            <button
              onClick={() => onChange(images.filter((_, j) => j !== i))}
              className="flex-1 text-[9px] bg-red-600 rounded py-0.5"
            >
              Xóa
            </button>
          </div>
        </div>
      ))}
      <label className="aspect-[9/16] rounded-lg border border-dashed border-slate-700 hover:border-indigo-500 flex flex-col items-center justify-center cursor-pointer text-slate-400 text-[11px]">
        <span className="text-lg">+</span>
        Thêm ảnh
        <input
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={async (e) => {
            const added = await readImages(e.target.files);
            e.target.value = '';
            onChange([...images, ...added]);
          }}
        />
      </label>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Nhân vật
// ---------------------------------------------------------------------------
const emptyCharacter = (): StudioCharacter => ({
  id: newLibraryId('char'),
  name: '',
  description: '',
  images: [],
  voicePresetId: 'voice_03',
  emotion: 'Natural',
  createdAt: Date.now(),
});

const CharactersSection: React.FC<{ lib: StudioLibraryState }> = ({ lib }) => {
  const { characters, setCharacters, museVoices, museVoiceNames } = lib;
  const [selectedId, setSelectedId] = useState<string | null>(characters[0]?.id ?? null);
  const selected = characters.find((c) => c.id === selectedId);

  const update = (patch: Partial<StudioCharacter>) =>
    setCharacters((prev) => prev.map((c) => (c.id === selectedId ? { ...c, ...patch } : c)));

  const add = () => {
    const c = emptyCharacter();
    setCharacters((prev) => [...prev, c]);
    setSelectedId(c.id);
  };

  const remove = () => {
    if (!selected || !confirm(`Xóa nhân vật "${selected.name || 'chưa đặt tên'}"?`)) return;
    setCharacters((prev) => prev.filter((c) => c.id !== selected.id));
    setSelectedId(null);
  };

  const nameTaken =
    !!selected?.name.trim() &&
    characters.some((c) => c.id !== selected.id && c.name.trim().toLowerCase() === selected.name.trim().toLowerCase());
  const voice = selected ? resolveVoice(selected.voicePresetId, selected.museVoiceOverride, museVoiceNames) : {};

  // AI tạo chân dung: các ảnh gợi ý (URL trên Gateway, đã nằm trong Thư viện media)
  const [portraits, setPortraits] = useState<string[]>([]);
  const [portraitStyle, setPortraitStyle] = useState('');
  const [portraitBusy, setPortraitBusy] = useState(false);
  useEffect(() => setPortraits([]), [selectedId]);

  const makePortraits = async () => {
    if (!selected) return;
    if (selected.description.trim().length < 3) return alert('Nhập mô tả ngoại hình trước để AI vẽ đúng nhân vật.');
    setPortraitBusy(true);
    try {
      const res = await generatePortrait({
        name: selected.name,
        description: selected.description,
        style: portraitStyle,
        n: 2,
        // Đã có ảnh mặt: tạo thêm ảnh mới giữ đúng người đó
        reference: selected.images[0],
      });
      setPortraits(res.data.map((d) => d.url));
    } catch (err: any) {
      alert(`Không tạo được chân dung: ${err.message}`);
    } finally {
      setPortraitBusy(false);
    }
  };

  const pickPortrait = async (url: string) => {
    try {
      const dataUrl = await urlToResizedDataUrl(url);
      update({ images: [...(selected?.images ?? []), dataUrl] });
      setPortraits((p) => p.filter((u) => u !== url));
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
      <div className="xl:col-span-7 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-400">
            Prompt nhắc tên nhân vật (hoặc <code>@tên</code>) thì cảnh đó tự gửi ảnh và dùng giọng của nhân vật.
          </p>
          <button onClick={add} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-xs font-semibold">
            + Thêm nhân vật
          </button>
        </div>
        {characters.length === 0 ? (
          <div className="border border-dashed border-slate-800 rounded-xl p-10 text-center text-sm text-slate-500">
            Chưa có nhân vật. Bấm “+ Thêm nhân vật”.
          </div>
        ) : (
          <div className="grid grid-cols-3 md:grid-cols-4 2xl:grid-cols-5 gap-3">
            {characters.map((c) => (
              <PortraitCard
                key={c.id}
                image={c.images[0]}
                title={c.name}
                active={c.id === selectedId}
                onClick={() => setSelectedId(c.id)}
                subtitle={<VoiceBadge voice={resolveVoice(c.voicePresetId, c.museVoiceOverride, museVoiceNames)} compact />}
              />
            ))}
          </div>
        )}
      </div>

      <div className="xl:col-span-5">
        {selected ? (
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3 sticky top-20">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-indigo-300">Nhân vật</h3>
              <button onClick={remove} className="text-xs text-red-400 hover:text-red-300">
                Xóa nhân vật
              </button>
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Tên gọi (dùng trong prompt)</label>
              <input
                value={selected.name}
                onChange={(e) => update({ name: e.target.value })}
                placeholder="VD: Lan, Mẹ, Bé Na"
                className={field}
              />
              {nameTaken && <p className="text-[11px] text-amber-400 mt-1">Tên này đã có nhân vật khác dùng.</p>}
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Ngoại hình & tính cách</label>
              <textarea
                rows={3}
                value={selected.description}
                onChange={(e) => update({ description: e.target.value })}
                placeholder="VD: nữ 25 tuổi, tóc đen dài ngang vai, da sáng, nói chuyện vui vẻ"
                className={field}
              />
            </div>
            <ImageStrip
              label="Ảnh khóa khuôn mặt (ảnh chính gửi cho muse.ai)"
              images={selected.images}
              onChange={(images) => update({ images })}
            />
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold text-slate-200">🎨 AI tạo chân dung</span>
                <input
                  value={portraitStyle}
                  onChange={(e) => setPortraitStyle(e.target.value)}
                  placeholder="Phong cách thêm (tùy chọn): áo dài trắng, ánh sáng hoàng hôn..."
                  className={`${field} flex-1 min-w-[160px]`}
                />
                <button
                  onClick={makePortraits}
                  disabled={portraitBusy}
                  className="px-3 py-1.5 bg-fuchsia-600 hover:bg-fuchsia-500 rounded-lg text-[11px] font-semibold disabled:opacity-50"
                >
                  {portraitBusy ? '⏳ Đang vẽ (~1 phút)...' : selected.images.length ? 'Tạo thêm góc mới' : 'Tạo từ mô tả'}
                </button>
              </div>
              <p className="text-[10px] text-slate-500">
                {selected.images.length
                  ? 'Dùng ảnh chính hiện có làm mẫu để giữ đúng khuôn mặt.'
                  : 'Chưa có ảnh: AI vẽ chân dung theo mô tả ngoại hình, chọn ảnh ưng ý để khóa mặt.'}{' '}
                Ảnh tạo ra cũng được lưu trong Thư viện media.
              </p>
              {portraits.length > 0 && (
                <div className="grid grid-cols-4 gap-2">
                  {portraits.map((url) => (
                    <button
                      key={url}
                      onClick={() => pickPortrait(url)}
                      className="relative aspect-[9/16] rounded-lg overflow-hidden border border-fuchsia-500/60 group"
                      title="Dùng ảnh này để khóa mặt"
                    >
                      <img src={url} alt="" className="w-full h-full object-cover" />
                      <span className="absolute inset-x-0 bottom-0 bg-fuchsia-600/90 text-[10px] py-0.5 opacity-0 group-hover:opacity-100">
                        ✓ Dùng ảnh này
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <ImageStrip
              label="Trang phục cố định (tùy chọn)"
              images={selected.outfitImage ? [selected.outfitImage] : []}
              onChange={(imgs) => update({ outfitImage: imgs[imgs.length - 1] })}
              fit="contain"
            />

            <div className="border-t border-slate-800 pt-3 space-y-2">
              <h4 className="text-xs font-bold text-slate-200">🎙 Giọng đọc cố định</h4>
              <VoiceSelect value={selected.voicePresetId} onChange={(voicePresetId) => update({ voicePresetId })} />
              <VoiceBadge voice={voice} />
              {voice.preset && (
                <p className="text-[11px] text-slate-400 italic">“{voice.preset.sampleSentence}”</p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Cảm xúc mặc định</label>
                  <select
                    value={selected.emotion}
                    onChange={(e) => update({ emotion: e.target.value })}
                    className={field}
                  >
                    {EMOTION_OPTIONS.map((e) => (
                      <option key={e}>{e}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Giọng gốc Muse (tùy chọn)</label>
                  <MuseVoiceSelect
                    voices={museVoices}
                    value={selected.museVoiceOverride || ''}
                    onChange={(id) => update({ museVoiceOverride: id || undefined })}
                    emptyLabel={`Theo hồ sơ (${voice.preset?.museVoiceName || '—'})`}
                  />
                </div>
              </div>
              <p className="text-[10px] text-slate-500">
                Mọi cảnh của nhân vật này dùng cùng giọng gốc Muse và cùng chỉ dẫn [Voice Profile] trong prompt,
                nên giọng không bị đổi giữa các cảnh.
              </p>
            </div>
          </div>
        ) : (
          <div className="border border-dashed border-slate-800 rounded-xl p-10 text-center text-sm text-slate-500">
            Chọn một nhân vật để sửa.
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sản phẩm
// ---------------------------------------------------------------------------
const emptyProduct = (): StudioProduct => ({
  id: newLibraryId('prd'),
  name: '',
  price: '',
  url: '',
  description: '',
  visual: '',
  images: [],
  createdAt: Date.now(),
});

/** Số ảnh tối đa lấy từ trang sản phẩm khi thêm ở Cài đặt */
const LINK_MAX_IMAGES = 6;

/** Gộp thông tin đọc từ link vào sản phẩm: ô trống thì điền, overwrite = ghi đè; ảnh mới thêm sau ảnh cũ (bỏ trùng, tối đa 8). */
const applyLinkProduct = (p: StudioProduct, r: LinkProduct, overwrite: boolean): StudioProduct => {
  const pick = (cur: string, next: string) => (next && (overwrite || !cur.trim()) ? next : cur);
  const images = [...p.images, ...r.images.filter((x) => !p.images.includes(x))].slice(0, 8);
  return {
    ...p,
    name: pick(p.name, r.name),
    url: r.url || p.url,
    description: pick(p.description, r.description),
    visual: pick(p.visual, r.visual),
    images,
  };
};

const ProductsSection: React.FC<{ lib: StudioLibraryState }> = ({ lib }) => {
  const { products, setProducts } = lib;
  const [selectedId, setSelectedId] = useState<string | null>(products[0]?.id ?? null);
  const selected = products.find((p) => p.id === selectedId);
  // Đọc link Shopee / TikTok Shop (dùng chung cho "Thêm từ link" và "Lấy thông tin" của sản phẩm đang sửa)
  const [newLink, setNewLink] = useState('');
  const [linkBusy, setLinkBusy] = useState<'' | 'new' | 'fill'>('');
  const [linkNote, setLinkNote] = useState('');
  const [needsLogin, setNeedsLogin] = useState<'' | 'shopee' | 'tiktok'>('');
  const readLink = async (link: string, mode: 'new' | 'fill') => {
    if (!isProductLink(link)) return setLinkNote('Dán link sản phẩm Shopee / TikTok Shop (bắt đầu bằng https://).');
    setLinkBusy(mode);
    setNeedsLogin('');
    try {
      const r = await readProductFromLink(link, { onStatus: setLinkNote, maxImages: LINK_MAX_IMAGES });
      if (r.needsLogin) setNeedsLogin(r.needsLogin);
      const tail = `${r.images.length} ảnh${r.warning ? ` · ⚠️ ${r.warning}` : ''}`;
      if (mode === 'fill' && selected) {
        const filled = [selected.name, selected.description, selected.visual].some((x) => x.trim());
        const overwrite =
          filled && confirm(`Ghi đè tên / giá / mô tả / ngoại hình đang có của "${selected.name || 'sản phẩm'}" bằng thông tin từ link?\n\nOK = ghi đè · Hủy = chỉ điền ô còn trống (ảnh mới luôn được thêm vào sau ảnh cũ)`);
        const id = selected.id;
        setProducts((prev) => prev.map((p) => (p.id === id ? applyLinkProduct(p, r, overwrite) : p)));
        setLinkNote(`✅ Đã cập nhật "${r.name}" từ link (${tail}).`);
      } else {
        // Đã có sản phẩm cùng link → cập nhật sản phẩm đó thay vì thêm trùng
        const old = products.find((p) => p.url && (p.url === r.url || p.url === link.trim()));
        if (old) {
          setProducts((prev) => prev.map((p) => (p.id === old.id ? applyLinkProduct(p, r, true) : p)));
          setSelectedId(old.id);
          setLinkNote(`✅ Sản phẩm "${old.name}" đã có trong thư viện — đã cập nhật lại từ link (${tail}).`);
        } else {
          const item = applyLinkProduct(emptyProduct(), r, true);
          setProducts((prev) => [...prev, item]);
          setSelectedId(item.id);
          setLinkNote(`✅ Đã thêm "${r.name}" vào thư viện (${tail}). Xem lại ảnh / mô tả ở khung bên phải.`);
        }
        setNewLink('');
      }
    } catch (err: any) {
      if (err?.needsLogin) setNeedsLogin(err.needsLogin);
      setLinkNote(`${err?.needsLogin ? '⚠️' : '❌'} ${err.message}`);
    } finally {
      setLinkBusy('');
    }
  };
  // ✂️ Tách 1 sản phẩm rõ nhất khỏi ảnh chính (ảnh ghép nhiều mẫu / có người mẫu) → đặt làm ảnh chính
  const [isolating, setIsolating] = useState(false);
  const [isolateNote, setIsolateNote] = useState('');
  useEffect(() => setIsolateNote(''), [selectedId]);
  const isolateMain = async () => {
    if (!selected?.images[0] || isolating) return;
    const id = selected.id;
    const main = selected.images[0];
    setIsolating(true);
    setIsolateNote('AI đang tìm 1 sản phẩm rõ nhất trong ảnh chính…');
    try {
      const r = await isolateProductUnit(main);
      if (r.dataUrl === main) {
        setIsolateNote('Ảnh chính chỉ có 1 sản phẩm và đã đủ lớn — không cần tách.');
        return;
      }
      setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, images: [r.dataUrl, ...p.images].slice(0, 8) } : p)));
      setIsolateNote(
        `✅ Ảnh chính có ${r.count} sản phẩm — đã tách "${r.label || '1 sản phẩm'}" làm ảnh chính mới. Nên sửa ô Ngoại hình cho đúng màu / mẫu này.`
      );
    } catch (err: any) {
      setIsolateNote(`❌ ${err.message}`);
    } finally {
      setIsolating(false);
    }
  };
  const login = async () => {
    if (!needsLogin) return;
    try {
      await loginShop(needsLogin, () => setNeedsLogin(''));
      setLinkNote(`Đăng nhập ${needsLogin === 'shopee' ? 'Shopee' : 'TikTok'} trong cửa sổ Chrome vừa mở, xong thì ĐÓNG cửa sổ đó rồi lấy thông tin lại.`);
    } catch (err: any) {
      setLinkNote(`❌ ${err.message}`);
    }
  };
  const update = (patch: Partial<StudioProduct>) =>
    setProducts((prev) => prev.map((p) => (p.id === selectedId ? { ...p, ...patch } : p)));
  const add = () => {
    const p = emptyProduct();
    setProducts((prev) => [...prev, p]);
    setSelectedId(p.id);
  };
  const remove = () => {
    if (!selected || !confirm(`Xóa sản phẩm "${selected.name || 'chưa đặt tên'}"?`)) return;
    setProducts((prev) => prev.filter((p) => p.id !== selected.id));
    setSelectedId(null);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
      <div className="xl:col-span-7 space-y-3">
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={newLink}
              onChange={(e) => setNewLink(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !linkBusy && newLink.trim() && readLink(newLink, 'new')}
              placeholder="🔗 Dán link Shopee / TikTok Shop để thêm sản phẩm (tự lấy tên, giá, mô tả, ảnh)"
              className={`${field} flex-1 min-w-[220px]`}
            />
            <button
              onClick={() => readLink(newLink, 'new')}
              disabled={!!linkBusy || !newLink.trim()}
              className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:bg-slate-700 rounded-lg text-xs font-semibold text-white"
            >
              {linkBusy === 'new' ? 'Đang đọc…' : '＋ Thêm từ link'}
            </button>
            <button onClick={add} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-xs font-semibold">
              + Thêm thủ công
            </button>
          </div>
          {needsLogin && (
            <button onClick={login} className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-[11px] text-white">
              🔑 Đăng nhập {needsLogin === 'shopee' ? 'Shopee' : 'TikTok'} để đọc đủ thông tin
            </button>
          )}
          <p className="text-[11px] text-slate-400">
            {linkNote ||
              `Gateway mở trang sản phẩm bằng Chrome (15-40 giây), AI rút tên ngắn, điểm nổi bật, ngoại hình; tải tối đa ${LINK_MAX_IMAGES} ảnh. KHÔNG lấy giá (giá đổi sau khi đăng video dễ vi phạm chính sách). Trang đòi captcha thì kéo captcha trong cửa sổ Chrome vừa mở.`}
          </p>
        </div>
        {products.length === 0 ? (
          <div className="border border-dashed border-slate-800 rounded-xl p-10 text-center text-sm text-slate-500">
            Chưa có sản phẩm trong thư viện.
          </div>
        ) : (
          <div className="grid grid-cols-3 md:grid-cols-4 2xl:grid-cols-5 gap-3">
            {products.map((p) => (
              <PortraitCard
                key={p.id}
                image={p.images[0]}
                title={p.name}
                active={p.id === selectedId}
                onClick={() => setSelectedId(p.id)}
                subtitle={p.price ? <span className="text-[10px] text-emerald-300">{p.price}</span> : undefined}
              />
            ))}
          </div>
        )}
      </div>
      <div className="xl:col-span-5">
        {selected ? (
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3 sticky top-20">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-indigo-300">Sản phẩm</h3>
              <button onClick={remove} className="text-xs text-red-400 hover:text-red-300">
                Xóa sản phẩm
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <input
                value={selected.name}
                onChange={(e) => update({ name: e.target.value })}
                placeholder="Tên sản phẩm"
                className={`${field} col-span-2`}
              />
              <input
                value={selected.price}
                onChange={(e) => update({ price: e.target.value })}
                placeholder="Giá (ghi nhớ riêng)"
                title="Chỉ để bạn ghi nhớ — KHÔNG đưa vào kịch bản / prompt video"
                className={field}
              />
            </div>
            <div className="flex gap-2">
              <input
                value={selected.url}
                onChange={(e) => update({ url: e.target.value })}
                placeholder="Link sản phẩm Shopee / TikTok Shop (tùy chọn)"
                className={`${field} flex-1`}
              />
              <button
                onClick={() => readLink(selected.url, 'fill')}
                disabled={!!linkBusy || !isProductLink(selected.url)}
                title="Đọc trang sản phẩm: điền tên, giá, mô tả, ngoại hình và thêm ảnh"
                className="shrink-0 px-3 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:bg-slate-700 rounded-lg text-xs font-semibold text-white"
              >
                {linkBusy === 'fill' ? 'Đang đọc…' : '🔗 Lấy thông tin'}
              </button>
            </div>
            <textarea
              rows={3}
              value={selected.description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="Mô tả, chất liệu, công dụng, điểm nổi bật..."
              className={field}
            />
            <textarea
              rows={2}
              value={selected.visual}
              onChange={(e) => update({ visual: e.target.value })}
              placeholder="Ngoại hình sản phẩm: màu, hình dáng, logo... (gắn vào mọi prompt video)"
              className={field}
            />
            <ImageStrip
              label="Ảnh sản phẩm (ảnh ĐẦU TIÊN là ảnh chính gửi cho muse.ai)"
              images={selected.images}
              onChange={(images) => update({ images })}
              fit="contain"
            />
            {selected.images.length > 0 && (
              <div className="space-y-1">
                <button
                  onClick={isolateMain}
                  disabled={isolating}
                  title="Ảnh chính xếp nhiều mẫu / nhiều màu hoặc có người mẫu đứng cạnh làm muse.ai vẽ lệch sản phẩm. AI tìm 1 sản phẩm rõ nhất trong ảnh chính, cắt riêng, phóng to và đặt làm ảnh chính (ảnh cũ vẫn giữ phía sau)."
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-[11px] text-slate-200"
                >
                  {isolating ? '✂️ Đang tách…' : '✂️ Ảnh chính có nhiều mẫu / có người? Tách 1 sản phẩm rõ nhất làm ảnh chính'}
                </button>
                {isolateNote && <p className="text-[10px] text-slate-400">{isolateNote}</p>}
                <p className="text-[10px] text-slate-500">
                  Sản phẩm trong video không giống ảnh? Để ảnh chính là ảnh RÕ 1 sản phẩm (nền trơn, không người, không chữ), sửa ô Ngoại hình cho
                  đúng 1 màu / 1 mẫu đó, rồi chạy lại cảnh bị lệch.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="border border-dashed border-slate-800 rounded-xl p-10 text-center text-sm text-slate-500">
            Chọn một sản phẩm để sửa.
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Giọng đọc
// ---------------------------------------------------------------------------
const VoicesSection: React.FC<{ lib: StudioLibraryState }> = ({ lib }) => {
  const viCount = lib.museVoices.filter((v) => v.group === 'vi_native').length;
  return (
    <div className="space-y-4">
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs text-slate-300 space-y-1.5">
        <p className="font-semibold text-slate-100">Muse hỗ trợ giọng đọc thế nào?</p>
        <p>
          • muse.ai có thư viện giọng riêng ({lib.museVoices.length || 40} giọng, trong đó {viCount || 6} giọng huấn
          luyện cho tiếng Việt: 4 nam, 2 nữ). Giọng được đặt theo <b>tài khoản</b> trước khi tạo video.
        </p>
        <p>
          • 12 hồ sơ Matrix bên dưới = 1 giọng gốc Muse + chỉ dẫn tốc độ / cao độ / chất âm gắn vào prompt dạng{' '}
          <code>[Voice Profile: ...]</code>. Nhiều hồ sơ nữ dùng chung giọng gốc nên khác nhau chủ yếu ở sắc thái.
        </p>
        <p>
          • Trộn nhiều giọng trong một lô: Muse đặt giọng theo tài khoản, nên nếu 1 tài khoản chạy nhiều luồng cùng
          lúc với giọng khác nhau thì giọng có thể bị lẫn. Khi trộn giọng nên để 1 luồng / tài khoản.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
        {MATRIX_12_VOICES.map((v) => (
          <div key={v.id} className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${v.badgeColor}`}>{v.label}</span>
              <span className="text-[10px] text-slate-500">
                {v.gender === 'male' ? 'Nam' : 'Nữ'} · {v.category}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">{v.subLabel}</p>
            <p className="text-[11px] text-slate-300">
              Tốc độ {v.speed} · Cao độ {v.pitch} · {v.acousticProfile}
            </p>
            <p className="text-[11px] text-slate-500 italic">“{v.sampleSentence}”</p>
          </div>
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sao lưu tự động + dọn data/media
// ---------------------------------------------------------------------------
const MaintenancePanel: React.FC = () => {
  const [st, setSt] = useState<MaintenanceState | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const load = () => getMaintenance().then(setSt).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    setNote('');
    try {
      setNote(await fn());
    } catch (e: any) {
      setNote(`❌ ${e.message}`);
    } finally {
      setBusy('');
      load();
    }
  };
  const set = (patch: Partial<MaintenanceConfig>) => run('cfg', async () => (setSt(await updateMaintenance(patch)), '✅ Đã lưu cài đặt'));
  const when = (t?: number) => (t ? new Date(t * 1000).toLocaleString('vi-VN') : 'chưa có');
  if (error) return <p className="text-xs text-red-400">{error}</p>;
  if (!st) return <p className="text-xs text-slate-500">Đang đọc cài đặt sao lưu…</p>;
  const c = st.config;
  const days = c.media_keep_days || 14;
  return (
    <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3 text-xs">
      <p className="font-semibold text-slate-100">💾 Sao lưu & dọn dữ liệu</p>

      <div className="space-y-1.5">
        <label className="flex items-center gap-2 text-slate-200">
          <input type="checkbox" checked={c.backup_enabled} onChange={(e) => set({ backup_enabled: e.target.checked })} />
          Tự sao lưu mỗi giờ (chỉ khi có thay đổi): nhân vật / sản phẩm / sơ đồ (<code>data/studio/state</code>), tài khoản
          (<code>accounts.json</code>), cài đặt AI (<code>ai_config.json</code>)
        </label>
        <div className="flex flex-wrap items-center gap-2 text-slate-400">
          <span>Giữ</span>
          <input
            type="number"
            min={0}
            className="w-16 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-slate-200"
            value={c.backup_keep_days}
            onChange={(e) => set({ backup_keep_days: Math.max(0, Number(e.target.value) || 0) })}
          />
          <span>ngày (0 = giữ hết) · Lần gần nhất: {when(st.last_backup_at)}</span>
          <button
            disabled={!!busy}
            onClick={() =>
              run('backup', async () => {
                const r = await backupNow();
                return r.ok ? `✅ Đã sao lưu ${r.files} file (${fmtBytes(r.bytes || 0)}) → ${r.dir}` : `⚠️ ${r.skipped}`;
              })
            }
            className="ml-auto px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-white"
          >
            {busy === 'backup' ? 'Đang sao lưu…' : 'Sao lưu ngay'}
          </button>
        </div>
        <p className="text-[11px] text-slate-500 break-all">
          Thư mục: <code>{st.backup_dir}</code>\yyyyMMdd\HH\data\… (giữ nguyên đường dẫn trong data). Khôi phục: chép các file trong
          một mốc sao lưu đè vào thư mục data rồi khởi động lại app.
        </p>
        {st.backups.length > 0 && (
          <p className="text-[11px] text-slate-500">
            Gần đây: {st.backups.slice(0, 5).map((b) => `${b.name} (${b.files} file, ${fmtBytes(b.bytes)})`).join(' · ')}
          </p>
        )}
      </div>

      <div className="space-y-1.5 border-t border-slate-800 pt-3">
        <p className="text-slate-200">
          Thư mục media (<code>data/media</code>): <b>{st.media.files}</b> file, <b>{fmtBytes(st.media.bytes)}</b>
          {st.media.oldest ? ` · cũ nhất ${new Date(st.media.oldest * 1000).toLocaleDateString('vi-VN')}` : ''}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-slate-400">
          <label className="flex items-center gap-1.5 text-slate-200">
            <input type="checkbox" checked={c.media_auto} onChange={(e) => set({ media_auto: e.target.checked })} />
            Tự xoá mỗi ngày file cũ hơn
          </label>
          <input
            type="number"
            min={0}
            className="w-16 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-slate-200"
            value={c.media_keep_days}
            onChange={(e) => set({ media_keep_days: Math.max(0, Number(e.target.value) || 0) })}
          />
          <span>ngày</span>
          <button
            disabled={!!busy}
            onClick={() =>
              run('preview', async () => {
                const r = await cleanMedia(days, true);
                return `Xem trước: sẽ xoá ${r.files} file (${fmtBytes(r.bytes)}) cũ hơn ${r.days} ngày · giữ ${r.kept_in_use} file cũ vì đang dùng`;
              })
            }
            className="ml-auto px-2.5 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-lg"
          >
            Xem trước
          </button>
          <button
            disabled={!!busy || st.media_clean_preview.files === 0}
            onClick={() =>
              window.confirm(
                `Xoá ${st.media_clean_preview.files} file (${fmtBytes(st.media_clean_preview.bytes)}) trong data/media cũ hơn ${days} ngày?\n` +
                  'File đang dùng trong sơ đồ / dự án được giữ lại. Bản đã xuất ra thư mục video không bị ảnh hưởng.'
              ) &&
              run('clean', async () => {
                const r = await cleanMedia(days, false);
                return `✅ Đã xoá ${r.files} file (${fmtBytes(r.bytes)}) · giữ ${r.kept_in_use} file đang dùng`;
              })
            }
            className="px-2.5 py-1 bg-red-700 hover:bg-red-600 disabled:opacity-50 rounded-lg text-white"
          >
            {busy === 'clean' ? 'Đang dọn…' : `Dọn ngay (${st.media_clean_preview.files} file · ${fmtBytes(st.media_clean_preview.bytes)})`}
          </button>
        </div>
        <p className="text-[11px] text-slate-500">
          Không xoá file đang được dùng trong sơ đồ khối / cảnh / sản phẩm. Video đã xuất ra thư mục lưu video không bị ảnh hưởng (đây
          là bản trung gian trên Gateway). Lần dọn gần nhất: {when(st.last_media_clean_at)}
          {st.last_media_clean ? ` (${st.last_media_clean.files} file, ${fmtBytes(st.last_media_clean.bytes)})` : ''}.
        </p>
      </div>
      {note && <p className="text-[11px] text-slate-300">{note}</p>}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Chung
// ---------------------------------------------------------------------------
const GeneralSection: React.FC = () => {
  const [info, setInfo] = useState<{ output_dir: string; ffmpeg: string | null } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    getStudioSettings().then(setInfo).catch((e) => setError(e.message));
  }, []);
  return (
    <div className="space-y-3 max-w-2xl">
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2 text-xs">
        <p className="font-semibold text-slate-100">Nơi lưu video</p>
        <div className="flex gap-2">
          <input readOnly value={info?.output_dir || ''} className={field} />
          <button
            onClick={() => openProjectFolder().catch((e) => alert(e.message))}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg whitespace-nowrap"
          >
            📂 Mở
          </button>
        </div>
        <p className="text-[11px] text-slate-500">
          Đổi bằng biến môi trường <code>MUSE2API_STUDIO_OUTPUT_DIR</code> rồi khởi động lại Gateway.
        </p>
      </div>
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-1 text-xs">
        <p className="font-semibold text-slate-100">FFmpeg (ghép video)</p>
        <p className={info?.ffmpeg ? 'text-emerald-300' : 'text-amber-300'}>
          {info ? info.ffmpeg || 'Chưa tìm thấy — cài FFmpeg (winget install Gyan.FFmpeg) hoặc đặt MUSE2API_FFMPEG_PATH' : '...'}
        </p>
      </div>
      <MaintenancePanel />
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-1 text-xs">
        <p className="font-semibold text-slate-100">Gateway</p>
        <p className="text-slate-300">{GATEWAY_URL}</p>
        <p className="text-[11px] text-slate-500">
          Chạy không cần Chrome (thử nghiệm): đặt <code>MUSE2API_DRIVER=http</code> trước khi khởi động Gateway.
        </p>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Trang Cài đặt
// ---------------------------------------------------------------------------
export const SettingsPage: React.FC<{ accountsState: MuseAccountsState; library: StudioLibraryState }> = ({
  accountsState,
  library,
}) => {
  const [section, setSection] = useState<Section>('accounts');
  const items: { id: Section; label: string; badge?: string }[] = [
    { id: 'accounts', label: '👥 Tài khoản Muse', badge: `${accountsState.usableCount}/${accountsState.accounts.length}` },
    { id: 'characters', label: '🧑 Nhân vật', badge: String(library.characters.length) },
    { id: 'products', label: '📦 Sản phẩm', badge: String(library.products.length) },
    { id: 'voices', label: '🎙 Giọng đọc', badge: '12' },
    { id: 'ai', label: '🤖 Trợ lý AI' },
    { id: 'general', label: '⚙️ Chung' },
  ];
  return (
    <div className="p-6 grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-6">
      <nav className="space-y-1 lg:sticky lg:top-20 self-start">
        {items.map((it) => (
          <button
            key={it.id}
            onClick={() => setSection(it.id)}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition ${
              section === it.id ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            {it.label}
            {it.badge && <span className="px-1.5 rounded bg-black/30 text-[10px]">{it.badge}</span>}
          </button>
        ))}
      </nav>
      <section className="min-w-0">
        {/* Trang tài khoản luôn được mount để phiên đăng nhập Chrome không mất khi đổi mục */}
        <div className={section === 'accounts' ? '' : 'hidden'}>
          <AccountsPage state={accountsState} />
        </div>
        {section === 'characters' && <CharactersSection lib={library} />}
        {section === 'products' && <ProductsSection lib={library} />}
        {section === 'voices' && <VoicesSection lib={library} />}
        {section === 'ai' && <AISettings />}
        {section === 'general' && <GeneralSection />}
      </section>
    </div>
  );
};
