import { VideoGenConfig, ReferenceAsset } from '../types/videoStudio';
import { MuseConfig, PollOptions, createAndPollMuseVideo } from './museBatchService';

export const compileConsistencyPrompt = (config: VideoGenConfig): string => {
  const guards: string[] = [];

  if (config.lockIdentity) {
    guards.push(
      '[IDENTITY LOCK: Strictly preserve exact facial features, eye shape, hairstyle, and character proportions from the reference image]'
    );
  }
  if (config.lockOutfit) {
    guards.push(
      '[OUTFIT LOCK: Maintain 100% identical clothing, fabric texture, color, and collar/sleeve details without morphing]'
    );
  }
  if (config.lockProduct) {
    guards.push(
      '[PRODUCT LOCK: Keep object geometry rigid, zero warping, preserve exact shape, logo placement, and material surface]'
    );
  }

  const cameraInstruction = config.cameraMotion
    ? `[CAMERA: ${config.cameraMotion}, steady cinematic movement]`
    : '[CAMERA: Smooth controlled motion, photorealistic lighting]';

  return `${guards.join(' ')} ${cameraInstruction}. Action: ${config.prompt.trim()}. High visual fidelity, 4k resolution, temporal consistency.`;
};

export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result);
    };
    reader.onerror = (error) => reject(error);
  });
};

export const generateConsistentVideo = async (
  references: ReferenceAsset[],
  config: VideoGenConfig,
  gatewayUrl = 'http://127.0.0.1:18610',
  apiKey = 'm2a_secret_key',
  options: PollOptions = {}
): Promise<{ videoUrl: string }> => {
  const finalPrompt = compileConsistencyPrompt(config);
  const primaryImage = references.find((r) => r.type === 'character')?.base64 || references[0]?.base64;

  // Dùng chung bộ tạo + polling với chế độ hàng loạt: nó đọc đúng `result.url`
  // của muse2api, tải media nội bộ thành Blob URL và chờ theo timeout của Gateway.
  const museConfig: MuseConfig = {
    gatewayUrl,
    apiKey,
    aspectRatio: config.aspectRatio,
    duration: config.duration,
    concurrency: 1,
    useTwoStepKeyframe: false,
    chainEndFrame: false,
  };
  const videoUrl = await createAndPollMuseVideo(museConfig, finalPrompt, primaryImage, undefined, options);
  return { videoUrl };
};

export const uploadVideoToMuseAi = async (
  videoBlobOrUrl: string,
  title: string,
  museApiKey: string
): Promise<{ fid: string; embedUrl: string }> => {
  if (!museApiKey || museApiKey === 'YOUR_MUSE_AI_API_KEY') {
    return { fid: '', embedUrl: '' };
  }

  const response = await fetch('https://muse.ai/api/files/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Key: museApiKey,
    },
    body: JSON.stringify({
      url: videoBlobOrUrl,
      name: `${title}.mp4`,
      visibility: 'unlisted',
    }),
  });

  if (!response.ok) {
    return { fid: '', embedUrl: '' };
  }

  const result = await response.json();
  return {
    fid: result.fid,
    embedUrl: `https://muse.ai/embed/${result.fid}?links=0&logo=0&title=0`,
  };
};
