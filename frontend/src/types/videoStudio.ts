export type AspectRatio = '9:16' | '16:9' | '1:1' | '4:3' | '3:4';
export type ShotDuration = 2 | 4 | 6 | 8 | 10;

export interface ReferenceAsset {
  id: string;
  file: File;
  previewUrl: string;
  base64: string;
  type: 'character' | 'outfit' | 'product';
}

export interface VideoGenConfig {
  prompt: string;
  negativePrompt?: string;
  aspectRatio: AspectRatio;
  duration: ShotDuration;
  lockIdentity: boolean;
  lockOutfit: boolean;
  lockProduct: boolean;
  cameraMotion: string;
}

export interface VideoJob {
  id: string;
  status: 'queued' | 'processing' | 'uploading_muse' | 'completed' | 'failed';
  progress: number;
  promptUsed: string;
  rawVideoUrl?: string;
  museVideoId?: string;
  museEmbedUrl?: string;
  error?: string;
  createdAt: number;
}
