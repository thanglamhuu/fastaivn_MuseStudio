// Bộ chạy Workflow làm clip: mỗi dòng đi qua 4 bước Sản phẩm → Kịch bản → Render cảnh → Ghép.
// Mỗi bước lưu kết quả vào dòng, nên "Chạy tiếp" bắt đầu lại đúng ở bước lỗi
// (bước Render cảnh chỉ làm lại các cảnh chưa xong, cảnh đang render dở thì chờ tiếp task cũ).
import {
  DEFAULT_MUSE_CONFIG,
  ImageRole,
  MuseConfig,
  MuseTaskStoppedError,
  ReferenceImage,
  buildLockedPrompt,
  createAndPollMuseVideo,
  exportVideo,
  mergeVideos,
  orderedReferenceRoles,
  pollMuseVideoTask,
} from './museBatchService';
import {
  EMPTY_PRODUCT,
  ProductInfo,
  generateScript,
  scrapeProductLink,
  sceneToPromptLine,
  urlToDataUrl,
} from './productService';
import { SCRIPT_TEMPLATES } from '../data/scriptTemplates';
import { buildVoiceInfo, resolveVoice } from '../data/voicePresets';
import { StudioCharacter, StudioProduct, characterInPrompt, newLibraryId } from '../types/library';
import type {
  WorkflowRow,
  WorkflowSceneState,
  WorkflowStepId,
  WorkflowStepState,
  WorkflowTemplate,
} from '../types/workflow';
import { WORKFLOW_STEPS } from '../types/workflow';
import { extractLastFrameAsDataUrl } from '../utils/videoFrameExtractor';

export const STOPPED = '⏹ Đã dừng theo yêu cầu';

export interface RunnerDeps {
  getRow: (id: string) => WorkflowRow | undefined;
  patchRow: (id: string, fn: (row: WorkflowRow) => WorkflowRow) => void;
  library: () => {
    characters: StudioCharacter[];
    products: StudioProduct[];
    museVoiceNames: Record<string, string>;
  };
  addProduct: (p: StudioProduct) => void;
  updateProduct: (id: string, patch: Partial<StudioProduct>) => void;
  /** Số luồng render song song (tổng luồng của các tài khoản dùng được) */
  threads: () => number;
  shouldStop: () => boolean;
  /** Dừng sau bước Kịch bản để người dùng xem / sửa trước khi render */
  reviewScript: boolean;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const nowStamp = () => {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}`;
};

const isLink = (s?: string) => !!s && /^https?:\/\//i.test(s.trim());

/** Sản phẩm của dòng: trong thư viện, hoặc chỉ có tên (dòng nhập tên tự do, không có ảnh). */
export const rowProduct = (row: WorkflowRow, products: StudioProduct[]): StudioProduct | undefined => {
  const p = row.productId ? products.find((x) => x.id === row.productId) : undefined;
  if (p) return p;
  if (row.link && !isLink(row.link)) {
    return { id: '', name: row.link.trim(), price: '', url: '', description: '', visual: '', images: [], createdAt: 0 };
  }
  return undefined;
};

/** Bước đầu tiên chưa xong của dòng ("Chạy tiếp" bắt đầu ở đây). */
export const firstOpenStep = (row: WorkflowRow): WorkflowStepId | null =>
  WORKFLOW_STEPS.find((s) => !['done', 'skipped'].includes(row.steps[s.id].status))?.id ?? null;

/** Đặt lại các bước từ `from` trở đi (và dữ liệu của chúng) để chạy lại. */
export const resetFrom = (row: WorkflowRow, from: WorkflowStepId): WorkflowRow => {
  const idx = WORKFLOW_STEPS.findIndex((s) => s.id === from);
  const steps = { ...row.steps };
  WORKFLOW_STEPS.slice(idx).forEach((s) => (steps[s.id] = { status: 'pending' }));
  const next: WorkflowRow = { ...row, steps, merged: undefined };
  if (idx <= 1) {
    next.script = undefined;
    next.scenes = undefined;
  } else if (idx === 2) {
    next.scenes = row.scenes?.map((s) => ({ prompt: s.prompt, title: s.title, status: 'pending' as const }));
  }
  if (idx === 0 && row.link && isLink(row.link)) next.productId = undefined;
  return next;
};

export async function runWorkflowRow(rowId: string, tpl: WorkflowTemplate, deps: RunnerDeps): Promise<void> {
  const setStep = (id: WorkflowStepId, patch: Partial<WorkflowStepState>) =>
    deps.patchRow(rowId, (r) => ({ ...r, steps: { ...r.steps, [id]: { ...r.steps[id], ...patch } } }));
  const row = () => deps.getRow(rowId)!;

  for (const step of WORKFLOW_STEPS) {
    const st = row().steps[step.id].status;
    if (st === 'done' || st === 'skipped') continue;
    if (deps.shouldStop()) {
      setStep(step.id, { status: 'failed', error: STOPPED });
      return;
    }
    setStep(step.id, { status: 'running', error: undefined, startedAt: Date.now(), finishedAt: undefined });
    try {
      const result = await STEP_RUNNERS[step.id](rowId, tpl, deps);
      setStep(step.id, { status: result.status ?? 'done', detail: result.detail, finishedAt: Date.now() });
      if (result.status === 'review') return; // chờ người dùng duyệt kịch bản
    } catch (err: any) {
      const msg = err instanceof MuseTaskStoppedError || deps.shouldStop() ? STOPPED : err?.message || String(err);
      setStep(step.id, { status: 'failed', error: msg, finishedAt: Date.now() });
      return;
    }
  }
}

type StepResult = { detail?: string; status?: WorkflowStepState['status'] };

const STEP_RUNNERS: Record<
  WorkflowStepId,
  (rowId: string, tpl: WorkflowTemplate, deps: RunnerDeps) => Promise<StepResult>
> = {
  /** Sản phẩm: lấy từ thư viện, hoặc đọc link Shopee/TikTok rồi tự lưu vào thư viện. */
  product: async (rowId, _tpl, deps) => {
    const row = deps.getRow(rowId)!;
    const existing = rowProduct(row, deps.library().products);
    if (existing) {
      return { detail: existing.id ? existing.name : `${existing.name} (chỉ có tên, không có ảnh)` };
    }
    if (!isLink(row.link)) throw new Error('Dòng chưa có sản phẩm: chọn sản phẩm trong thư viện hoặc dán link.');
    const r = await scrapeProductLink(row.link!.trim());
    if (!r.title) {
      throw new Error(
        r.needs_login
          ? 'Trang yêu cầu đăng nhập / captcha: đăng nhập ở khối Sản phẩm của tab Tạo video rồi bấm Chạy tiếp.'
          : r.warning || 'Không đọc được thông tin sản phẩm từ link.'
      );
    }
    const images: string[] = [];
    for (const img of r.images.slice(0, 6)) {
      try {
        images.push(await urlToDataUrl(img.url));
      } catch {
        /* bỏ ảnh tải lỗi */
      }
    }
    const item: StudioProduct = {
      id: newLibraryId('prd'),
      name: r.title,
      price: r.price,
      url: r.url || row.link!.trim(),
      description: r.description,
      visual: '',
      images,
      createdAt: Date.now(),
    };
    deps.addProduct(item);
    deps.patchRow(rowId, (x) => ({ ...x, productId: item.id }));
    return { detail: `${item.name}${item.price ? ` · ${item.price}` : ''} · ${images.length} ảnh (đã lưu thư viện)` };
  },

  /** Kịch bản: Gemini / OpenAI / muse-chat viết theo kiểu kịch bản của mẫu. */
  script: async (rowId, tpl, deps) => {
    const row = deps.getRow(rowId)!;
    const lib = deps.library();
    const prod = rowProduct(row, lib.products);
    if (!prod) throw new Error('Chưa có sản phẩm.');
    const mainChar = lib.characters.find((c) => c.id === row.characterId);
    const product: ProductInfo = {
      ...EMPTY_PRODUCT,
      url: prod.url,
      name: prod.name,
      price: prod.price,
      description: prod.description,
      visual: prod.visual,
    };
    const template =
      SCRIPT_TEMPLATES.find((t) => t.id === tpl.scriptTemplateId) ?? SCRIPT_TEMPLATES[0];
    // Nhân vật chính lên đầu để AI ưu tiên dùng
    const chars = mainChar ? [mainChar, ...lib.characters.filter((c) => c.id !== mainChar.id)] : lib.characters;
    const notes = [
      tpl.extraNote,
      mainChar && !tpl.faceless ? `Nhân vật chính là ${mainChar.name}.` : '',
      row.note,
    ]
      .filter(Boolean)
      .join('\n');
    const script = await generateScript({
      product,
      template,
      mode: tpl.scriptMode,
      characters: tpl.faceless ? [] : chars.map((c) => ({ name: c.name, description: c.description })),
      sceneCount: tpl.sceneCount,
      secondsPerScene: tpl.duration,
      withDialogue: tpl.withDialogue,
      productImages: prod.images.slice(0, 3),
      extraNote: notes,
    });
    if (prod.id && !prod.visual && script.product?.visual) {
      deps.updateProduct(prod.id, { visual: script.product.visual });
    }
    const scenes: WorkflowSceneState[] = script.scenes.map((s) => ({
      prompt: sceneToPromptLine(s),
      title: s.title,
      status: 'pending',
    }));
    const stamp = nowStamp();
    deps.patchRow(rowId, (x) => ({
      ...x,
      script: { scenes: script.scenes, source: script.source },
      scenes,
      stamp,
      project: `Workflow - ${prod.name.slice(0, 60)}`,
    }));
    return {
      detail: `${scenes.length} cảnh`,
      status: deps.reviewScript ? 'review' : 'done',
    };
  },

  /** Render cảnh: song song theo số luồng (nối khung cuối thì tuần tự), tự lưu file từng cảnh. */
  scenes: async (rowId, tpl, deps) => {
    const scenes = deps.getRow(rowId)!.scenes ?? [];
    if (!scenes.length) throw new Error('Chưa có kịch bản.');
    const todo = scenes.map((s, i) => (s.status === 'done' ? -1 : i)).filter((i) => i >= 0);
    const threads = tpl.chainEndFrame ? 1 : Math.max(1, deps.threads());
    let next = 0;
    const worker = async () => {
      while (next < todo.length && !deps.shouldStop()) {
        const i = todo[next++];
        await renderOneScene(rowId, i, tpl, deps);
        // Nối khung cuối: cảnh lỗi thì các cảnh sau không còn khung đầu đúng, dừng lại
        if (tpl.chainEndFrame && deps.getRow(rowId)!.scenes![i].status !== 'done') return;
      }
    };
    await Promise.all(Array.from({ length: Math.min(threads, todo.length) }, worker));
    const after = deps.getRow(rowId)!.scenes ?? [];
    const done = after.filter((s) => s.status === 'done').length;
    if (deps.shouldStop() && done < after.length) throw new MuseTaskStoppedError();
    if (done < after.length) {
      throw new Error(`${after.length - done}/${after.length} cảnh lỗi — bấm Chạy tiếp để render lại các cảnh lỗi.`);
    }
    return { detail: `${done}/${after.length} cảnh` };
  },

  /** Ghép: nối các cảnh thành 1 clip bằng FFmpeg trong thư mục của dòng. */
  merge: async (rowId, tpl, deps) => {
    const row = deps.getRow(rowId)!;
    const urls = (row.scenes ?? []).map((s) => s.videoUrl).filter((u): u is string => !!u);
    if (!tpl.autoMerge) return { status: 'skipped', detail: 'Mẫu không bật tự ghép' };
    if (urls.length < 2) return { status: 'skipped', detail: 'Chỉ có 1 cảnh, không cần ghép' };
    const res = await mergeVideos(urls, row.project || 'Workflow', `${row.stamp || nowStamp()}_FULL`);
    deps.patchRow(rowId, (x) => ({ ...x, merged: { url: res.url, path: res.path } }));
    return { detail: res.path };
  },
};

async function renderOneScene(rowId: string, i: number, tpl: WorkflowTemplate, deps: RunnerDeps) {
  const setScene = (patch: Partial<WorkflowSceneState>) =>
    deps.patchRow(rowId, (r) => ({
      ...r,
      scenes: r.scenes?.map((s, j) => (j === i ? { ...s, ...patch } : s)),
    }));
  const row = deps.getRow(rowId)!;
  const scene = row.scenes![i];
  const lib = deps.library();
  const prod = rowProduct(row, lib.products);
  const mainChar = lib.characters.find((c) => c.id === row.characterId);
  const ch = characterInPrompt(scene.prompt, lib.characters) ?? mainChar;
  const voice =
    ch && (ch.voicePresetId || ch.museVoiceOverride)
      ? resolveVoice(ch.voicePresetId, ch.museVoiceOverride, lib.museVoiceNames)
      : {};

  // Ảnh tham chiếu: nhân vật (+ trang phục) trừ khi mẫu không lộ mặt; sản phẩm (xoay vòng nếu bật)
  const refs: ReferenceImage[] = [];
  if (!tpl.faceless && ch?.images[0]) {
    refs.push({ id: `char_${ch.id}`, role: 'character', dataUrl: ch.images[0], name: ch.name });
    if (ch.outfitImage && !tpl.rotateProductImages) {
      refs.push({ id: `outfit_${ch.id}`, role: 'outfit', dataUrl: ch.outfitImage, name: `${ch.name} outfit` });
    }
  }
  if (prod?.images.length) {
    const img = tpl.rotateProductImages ? prod.images[i % prod.images.length] : prod.images[0];
    refs.push({ id: `prd_${i}`, role: 'product', dataUrl: img, name: prod.name });
  }

  setScene({ status: 'running', error: undefined, progress: undefined });
  const pollOpts = {
    shouldStop: deps.shouldStop,
    onProgress: (progress: number) => setScene({ progress }),
    onAccount: (accountId: string) => setScene({ accountId }),
  };
  try {
    let videoUrl = '';
    // Cảnh đang render dở (vd. trang vừa tải lại): chờ tiếp task cũ thay vì tạo task mới
    if (scene.taskId && !scene.videoUrl && !scene.error) {
      try {
        videoUrl = await pollMuseVideoTask(scene.taskId, pollOpts);
      } catch (err) {
        if (err instanceof MuseTaskStoppedError) throw err;
      }
    }
    if (!videoUrl) {
      const roles = orderedReferenceRoles(refs);
      let items: { url: string; role: ImageRole }[] = roles.map((role) => ({
        url: refs.find((r) => r.role === role)!.dataUrl,
        role,
      }));
      const prev = i > 0 ? deps.getRow(rowId)!.scenes![i - 1] : undefined;
      if (tpl.chainEndFrame && prev?.videoUrl) {
        try {
          const frame = await extractLastFrameAsDataUrl(prev.videoUrl);
          items = [{ url: frame, role: 'keyframe' }, ...items];
        } catch {
          /* không cắt được khung cuối: dùng ảnh tham chiếu gốc */
        }
      }
      if (!items.length) {
        throw new Error('Cảnh không có ảnh nào: thêm ảnh cho sản phẩm hoặc chọn nhân vật có ảnh.');
      }
      items = items.slice(0, 4);
      const charTag = !tpl.faceless && ch?.description ? `[CHARACTER ${ch.name}: ${ch.description}]` : '';
      const voiceInfo = buildVoiceInfo(voice, { emotion: ch?.emotion, characterName: ch?.name });
      const prompt = buildLockedPrompt(
        [charTag, voiceInfo, scene.prompt].filter(Boolean).join(' '),
        refs,
        tpl.cameraMotion,
        { name: prod?.name, visual: prod?.visual },
        items.map((it) => it.role)
      );
      const cfg: MuseConfig = {
        ...DEFAULT_MUSE_CONFIG,
        aspectRatio: tpl.aspectRatio,
        duration: tpl.duration,
        voice: voice.museVoiceId || '',
      };
      videoUrl = await createAndPollMuseVideo(
        cfg,
        prompt,
        items[0].url,
        (taskId) => setScene({ taskId }),
        pollOpts,
        items.slice(1).map((it) => it.url)
      );
    }
    setScene({ status: 'done', videoUrl, progress: 100 });
    try {
      const r = deps.getRow(rowId)!;
      const res = await exportVideo(videoUrl, r.project || 'Workflow', `${r.stamp || nowStamp()}_Canh_${pad2(i + 1)}`);
      setScene({ exportedPath: res.path });
    } catch (err: any) {
      setScene({ error: `Video xong nhưng lưu file lỗi: ${err?.message || err}` });
    }
  } catch (err: any) {
    setScene({
      status: 'failed',
      taskId: undefined,
      error: err instanceof MuseTaskStoppedError ? STOPPED : err?.message || String(err),
    });
  }
}
