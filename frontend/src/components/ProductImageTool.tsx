// Hộp công cụ ẢNH SẢN PHẨM: kéo khung để cắt (hoặc AI tự khoanh 1 sản phẩm) → nâng nét → AI phân tích mô tả chi tiết.
// Kết quả (ảnh sản phẩm đơn, rõ + mô tả chi tiết) trả về cho nơi gọi: khối Upload Image, Cài đặt ➔ Sản phẩm, Tạo video hàng loạt.
import React, { useEffect, useRef, useState } from 'react';
import { CropBox, cropProductImage, describeProductDetailed, upscaleProductImage } from '../services/productImageTool';
import { locateProductUnit } from '../services/productIsolate';

interface Props {
  image: string;
  /** Tên sản phẩm (giúp AI gọi đúng tên khi mô tả) */
  name?: string;
  /** Mô tả hiện có (hiện sẵn trong ô để sửa) */
  description?: string;
  onApply: (r: { image: string; description: string }) => void;
  onClose: () => void;
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));

export const ProductImageTool: React.FC<Props> = ({ image, name, description, onApply, onClose }) => {
  const [cur, setCur] = useState(image);
  const [desc, setDesc] = useState(description || '');
  const [box, setBox] = useState<CropBox | null>(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('Kéo chuột trên ảnh để khoanh vùng sản phẩm cần giữ, hoặc bấm "AI tự khoanh".');
  const [size, setSize] = useState({ w: 0, h: 0 });
  const imgRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const at = (e: React.PointerEvent) => {
    const r = imgRef.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  };
  const down = (e: React.PointerEvent) => {
    if (busy) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = at(e);
    setBox(null);
  };
  const move = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const p = at(e);
    const s = drag.current;
    setBox({ x0: Math.min(s.x, p.x), y0: Math.min(s.y, p.y), x1: Math.max(s.x, p.x), y1: Math.max(s.y, p.y) });
  };
  const up = () => {
    drag.current = null;
    setBox((b) => (b && (b.x1 - b.x0 < 0.04 || b.y1 - b.y0 < 0.04) ? null : b));
  };

  const run = async (what: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(what);
    try {
      await fn();
    } catch (err: any) {
      setNote(`❌ ${err?.message || err}`);
    } finally {
      setBusy('');
    }
  };
  const autoBox = () =>
    run('box', async () => {
      setNote('AI đang tìm 1 sản phẩm rõ nhất trong ảnh…');
      const r = await locateProductUnit(cur);
      if (r.whole) {
        setBox(null);
        setNote('Ảnh chỉ có 1 sản phẩm và đã chiếm gần hết khung — không cần cắt. Có thể bấm Nâng nét.');
        return;
      }
      setBox(r.box);
      setNote(`AI đếm được ${r.count} sản phẩm, đã khoanh "${r.label || '1 sản phẩm'}". Kéo lại khung nếu chưa vừa rồi bấm Cắt theo khung.`);
    });
  const crop = () =>
    run('crop', async () => {
      if (!box) return;
      setNote('Đang cắt và nâng nét vùng đã khoanh…');
      const r = await cropProductImage(cur, box);
      setCur(r.image);
      setBox(null);
      setNote(`✅ Đã cắt${r.upscaled ? ' và nâng nét (cạnh ngắn 1440 px)' : ''}. Tiếp theo bấm AI phân tích chi tiết.`);
    });
  const upscale = () =>
    run('up', async () => {
      const short = Math.min(size.w, size.h);
      if (short >= 1440) {
        setNote('Ảnh đã đủ lớn (cạnh ngắn ≥ 1440 px) — không cần nâng nét.');
        return;
      }
      setNote('Đang nâng nét (phóng cạnh ngắn lên 1440 px + làm nét)…');
      setCur(await upscaleProductImage(cur, 1440));
      setBox(null);
      setNote('✅ Đã nâng nét.');
    });
  const analyze = () =>
    run('desc', async () => {
      setNote('AI đang phân tích chi tiết sản phẩm trong ảnh…');
      const t = await describeProductDetailed(cur, name);
      if (!t) throw new Error('AI không trả về mô tả.');
      setDesc(t);
      setNote('✅ Đã có mô tả chi tiết — đọc lại, sửa chỗ AI tả sai rồi bấm Dùng ảnh + mô tả này.');
    });

  const btn = 'px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-[11px] text-slate-100 border border-white/10';
  return (
    <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-auto p-4 space-y-3" data-testid="product-image-tool">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-100">🛠 Ảnh sản phẩm đơn, chi tiết — cắt · nâng nét · AI mô tả</h3>
          <button className="text-slate-400 hover:text-white text-sm" onClick={onClose} disabled={!!busy}>
            ✕
          </button>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="bg-slate-950 rounded-xl p-2 flex items-center justify-center">
              <div className="relative inline-block select-none touch-none cursor-crosshair" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
                <img
                  ref={imgRef}
                  src={cur}
                  draggable={false}
                  onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                  className="max-h-[52vh] max-w-full rounded block"
                />
                {box && (
                  <div
                    className="absolute border-2 border-rose-500 bg-rose-500/10 pointer-events-none"
                    style={{ left: `${box.x0 * 100}%`, top: `${box.y0 * 100}%`, width: `${(box.x1 - box.x0) * 100}%`, height: `${(box.y1 - box.y0) * 100}%` }}
                  />
                )}
              </div>
            </div>
            <p className="text-[10px] text-slate-500">
              Ảnh hiện tại: {size.w} × {size.h} px{cur !== image ? ' (đã chỉnh)' : ' (ảnh gốc)'}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button className={btn} onClick={autoBox} disabled={!!busy}>
                {busy === 'box' ? '🤖 Đang tìm…' : '🤖 AI tự khoanh 1 sản phẩm'}
              </button>
              <button className={btn} onClick={crop} disabled={!!busy || !box}>
                {busy === 'crop' ? '✂️ Đang cắt…' : '✂️ Cắt theo khung'}
              </button>
              <button className={btn} onClick={upscale} disabled={!!busy}>
                {busy === 'up' ? '⬆️ Đang nâng nét…' : '⬆️ Nâng nét (1440 px)'}
              </button>
              <button
                className={btn}
                onClick={() => {
                  setCur(image);
                  setBox(null);
                  setNote('Đã trở về ảnh gốc.');
                }}
                disabled={!!busy || cur === image}
              >
                ↩ Ảnh gốc
              </button>
            </div>
          </div>
          <div className="space-y-2 flex flex-col">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-300">Mô tả chi tiết sản phẩm (gửi kèm mọi cảnh để giữ đúng sản phẩm)</span>
              <button className={`${btn} bg-teal-700 hover:bg-teal-600`} onClick={analyze} disabled={!!busy}>
                {busy === 'desc' ? '🔍 Đang phân tích…' : '🔍 AI phân tích chi tiết'}
              </button>
            </div>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={12}
              placeholder="Bấm AI phân tích chi tiết: AI nhìn ảnh rồi tả hình dáng, màu từng phần, chất liệu, chi tiết nhận diện, logo / chữ in trên sản phẩm. Bạn sửa lại chỗ sai trước khi dùng."
              className="flex-1 w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-slate-100 leading-relaxed"
            />
            <p className="text-[10px] text-slate-500">
              Thứ tự nên làm: khoanh / cắt 1 sản phẩm → nâng nét → AI phân tích. Ảnh tham chiếu tốt nhất là ảnh RÕ 1 sản phẩm, nền trơn, không người,
              không chữ quảng cáo. Không ghi giá vào mô tả.
            </p>
          </div>
        </div>
        <p className="text-[11px] text-slate-400 min-h-[1.2em]">{note}</p>
        <div className="flex justify-end gap-2">
          <button className={btn} onClick={onClose} disabled={!!busy}>
            Hủy
          </button>
          <button
            className="px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-xs font-semibold text-white"
            onClick={() => onApply({ image: cur, description: desc.trim() })}
            disabled={!!busy || (cur === image && desc.trim() === (description || '').trim())}
          >
            ✅ Dùng ảnh + mô tả này
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProductImageTool;
