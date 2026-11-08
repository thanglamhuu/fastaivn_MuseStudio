/**
 * Nơi DUY NHẤT khai báo địa chỉ Gateway và API key phía frontend.
 * Giá trị mặc định phải khớp với studio_settings.py (phía Python).
 * Ghi đè bằng file frontend/.env: VITE_GATEWAY_URL=..., VITE_MUSE_API_KEY=...
 */
export const GATEWAY_URL = (import.meta.env.VITE_GATEWAY_URL || 'http://127.0.0.1:18610').replace(
  /\/$/,
  ''
);
export const MUSE_API_KEY = import.meta.env.VITE_MUSE_API_KEY || 'm2a_secret_key';
