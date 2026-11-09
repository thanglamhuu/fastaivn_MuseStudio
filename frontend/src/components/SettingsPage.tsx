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

const ProductsSection: React.FC<{ lib: StudioLibraryState }> = ({ lib }) => {
  const { products, setProducts } = lib;
  const [selectedId, setSelectedId] = useState<string | null>(products[0]?.id ?? null);
  const selected = products.find((p) => p.id === selectedId);
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
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-400">
            Sản phẩm đọc từ link Shopee/TikTok ở màn hình tạo video có thể bấm “Lưu vào thư viện”.
          </p>
          <button onClick={add} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-xs font-semibold">
            + Thêm sản phẩm
          </button>
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
              <input value={selected.price} onChange={(e) => update({ price: e.target.value })} placeholder="Giá" className={field} />
            </div>
            <input value={selected.url} onChange={(e) => update({ url: e.target.value })} placeholder="Link sản phẩm (tùy chọn)" className={field} />
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
              label="Ảnh sản phẩm (ảnh chính gửi cho muse.ai)"
              images={selected.images}
              onChange={(images) => update({ images })}
              fit="contain"
            />
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
