// Đọc sản phẩm từ link Shopee / TikTok Shop: Gateway mở trang (Chrome thật) lấy tên, giá, mô tả, ảnh → AI rút tên ngắn,
// điểm nổi bật, ngoại hình → ảnh tải về dạng data URL (lưu được vào thư viện, gửi lại muse.ai không bị chặn SSRF).
// Dùng chung: node Prompt (Sơ đồ khối) và Cài đặt ➔ Sản phẩm.
import { getScrapeStatus, getShopLoginState, openShopLogin, scrapeProductLink, extractJsonObject } from './productService';
import { aiText } from './nodeFlow/runtime';
import { productIdeaInstruction, shortProductName } from './nodeFlow/shopeePrompt';
import { urlToResizedDataUrl } from '../utils/image';

export interface LinkProduct {
  url: string;
  name: string;
  title: string;
  price: string;
  brand: string;
  /** Mô tả gọn: điểm nổi bật (AI) + mô tả trang bán */
  description: string;
  /** Ngoại hình sản phẩm (AI nhìn ảnh) */
  visual: string;
  highlights: string[];
  idea: string;
  /** Ảnh sản phẩm (data URL, đã thu nhỏ cạnh dài ≤ 1280) */
  images: string[];
  warning: string;
  /** Trang đòi đăng nhập → nút 🔑 Đăng nhập */
  needsLogin: '' | 'shopee' | 'tiktok';
}

export const isProductLink = (s: string) => /^https?:\/\//i.test(s.trim());

/**
 * Đọc link sản phẩm. onStatus nhận thông báo tiến trình (Gateway báo đang chờ captcha / đăng nhập…).
 * Ném lỗi khi không đọc được gì (không tên, không ảnh).
 */
export const readProductFromLink = async (
  link: string,
  opts: { onStatus?: (m: string) => void; maxImages?: number; prompt?: string } = {}
): Promise<LinkProduct> => {
  const url = link.trim();
  if (!isProductLink(url)) throw new Error('Dán link sản phẩm Shopee / TikTok Shop (bắt đầu bằng https://).');
  const say = opts.onStatus || (() => undefined);
  say('Đang mở trang sản phẩm (15-40 giây)…');
  const timer = window.setInterval(async () => {
    try {
      const st = await getScrapeStatus();
      if (st.busy && st.message) say(st.message);
    } catch {
      /* Gateway cũ chưa có /status */
    }
  }, 1500);
  try {
    const r = await scrapeProductLink(url);
    const needsLogin = r.needs_login && r.site ? r.site : '';
    if (!r.title && !r.images.length) {
      const e: any = new Error(r.warning || 'Không đọc được trang sản phẩm.');
      e.needsLogin = needsLogin;
      throw e;
    }
    say('Đã đọc trang — AI đang rút tên, điểm nổi bật & ngoại hình…');
    let ai: any = {};
    let aiNote = '';
    try {
      const img = r.images[0] ? [await urlToResizedDataUrl(r.images[0].url, 1024)] : [];
      const res = await aiText(productIdeaInstruction(r.title, r.price, r.brand, r.description, r.text, opts.prompt || ''), img);
      ai = extractJsonObject(res.text) || {};
      if (!ai.short_name && !ai.visual) aiNote = 'AI không trả về thông tin sản phẩm — đã dùng tên / mô tả của trang';
    } catch (err: any) {
      // AI lỗi: vẫn dùng thông tin đọc được từ trang
      aiNote = `AI không rút được thông tin (${String(err?.message || err).slice(0, 80)}) — đã dùng tên / mô tả của trang`;
    }
    const name = String(ai.short_name || '').trim().slice(0, 60) || shortProductName(r.title) || 'Sản phẩm';
    const highlights: string[] = Array.isArray(ai.highlights) ? ai.highlights.map(String).slice(0, 5) : [];
    say(`Đang tải ảnh sản phẩm (${Math.min(r.images.length, opts.maxImages || 3)})…`);
    const images: string[] = [];
    for (const im of r.images.slice(0, opts.maxImages || 3)) {
      try {
        images.push(await urlToResizedDataUrl(im.url, 1280));
      } catch {
        /* bỏ ảnh lỗi */
      }
    }
    return {
      url: r.url || url,
      name,
      title: r.title,
      price: '',
      brand: r.brand || '',
      description: (highlights.length ? `${highlights.join('; ')}. ` : '') + (r.description || '').slice(0, 800),
      visual: String(ai.visual || ''),
      highlights,
      idea: String(ai.idea || ''),
      images,
      warning: [r.warning, aiNote].filter(Boolean).join(' · '),
      needsLogin,
    };
  } finally {
    window.clearInterval(timer);
  }
};

/** Mở cửa sổ Chrome đăng nhập Shopee / TikTok; gọi onClosed khi người dùng đóng cửa sổ đó. */
export const loginShop = async (site: 'shopee' | 'tiktok', onClosed: () => void) => {
  await openShopLogin(site);
  const t = window.setInterval(async () => {
    try {
      if (!(await getShopLoginState()).open) {
        window.clearInterval(t);
        onClosed();
      }
    } catch {
      window.clearInterval(t);
    }
  }, 2000);
};
