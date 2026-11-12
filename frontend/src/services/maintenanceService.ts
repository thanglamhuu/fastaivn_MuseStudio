// Sao lưu tự động dữ liệu + dọn data/media (Gateway: studio_maintenance.py).
import { gatewayFetch, readError } from './museBatchService';

export interface MaintenanceConfig {
  backup_enabled: boolean;
  backup_keep_days: number;
  media_auto: boolean;
  media_keep_days: number;
}

export interface MaintenanceState {
  config: MaintenanceConfig;
  backup_dir: string;
  last_backup_at?: number;
  backups: { name: string; dir: string; files: number; bytes: number }[];
  media: { files: number; bytes: number; oldest: number };
  media_clean_preview: { files: number; bytes: number; kept_in_use: number };
  last_media_clean_at?: number;
  last_media_clean?: { files: number; bytes: number; days: number };
}

const call = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const res = await gatewayFetch(`/studio/maintenance${path}`, init);
  if (!res.ok) {
    if (res.status === 404) throw new Error('Gateway chưa có API sao lưu — khởi động lại Gateway (run_dev.bat).');
    throw new Error(await readError(res));
  }
  return res.json();
};

export const getMaintenance = () => call<MaintenanceState>('');

export const updateMaintenance = (patch: Partial<MaintenanceConfig>) =>
  call<MaintenanceState>('', { method: 'PUT', body: JSON.stringify(patch) });

export const backupNow = () =>
  call<{ ok: boolean; dir?: string; files?: number; bytes?: number; skipped?: string }>('/backup', { method: 'POST' });

export const cleanMedia = (days: number, dryRun: boolean) =>
  call<{ dry_run: boolean; days: number; files: number; bytes: number; kept_in_use: number }>('/media/clean', {
    method: 'POST',
    body: JSON.stringify({ days, dry_run: dryRun }),
  });

export const fmtBytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${Math.round(n / 1e6)} MB`);
