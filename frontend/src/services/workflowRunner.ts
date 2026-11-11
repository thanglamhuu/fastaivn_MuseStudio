// Bộ chạy Workflow làm clip: mỗi dòng đi qua các bước Sản phẩm → Kịch bản → Render cảnh → Ghép → Hậu kỳ.
// Dùng chung cho tab Workflow và trình chỉnh sơ đồ khối (sơ đồ được dịch thành WorkflowTemplate).
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
  generateMuseKeyframe,
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
import { WORKFLOW_STEPS, normalizeRow } from '../types/workflow';
import { extractLastFrameAsDataUrl } from '../utils/videoFrameExtractor';
import { multiVoiceInfo, splitDialogueLine } from '../utils/dialogue';
import { urlToResizedDataUrl } from '../utils/image';
import { blurRegions, generatePortrait, upscaleMedia } from './libraryService';
import { buildReferencePrompt } from './referencePrompt';

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
  updateCharacter: (id: string, patch: Partial<StudioCharacter>) => void;
  /** Số luồng render song song (tổng luồng của các tài khoản dùng được) */
  threads: () => number;
  shouldStop: () => boolean;
  /** Dừng sau bước Kịch bản để người dùng xem / sửa trước khi render */
  reviewScript: boolean;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const nowStamp = () => {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
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

/** Dàn nhân vật cố định của workflow (khối Nhân vật chọn thư viện / tải ảnh), bỏ nhân vật đã xóa. */
export const workflowCast = (tpl: WorkflowTemplate, characters: StudioCharacter[]): StudioCharacter[] =>
  tpl.faceless
    ? []
    : (tpl.characterIds ?? [])
        .map((id) => characters.find((c) => c.id === id))
        .filter((c): c is StudioCharacter => !!c);

/** Nhân vật chính: nhân vật chọn ở dòng, không có thì nhân vật đầu tiên của workflow. */
export const mainCharacterOf = (
  row: WorkflowRow,
  tpl: WorkflowTemplate,
  characters: StudioCharacter[]
): StudioCharacter | undefined =>
  characters.find((c) => c.id === row.characterId) ?? workflowCast(tpl, characters)[0];

/** Bước đầu tiên chưa xong của dòng ("Chạy tiếp" bắt đầu ở đây). */
export const firstOpenStep = (row: WorkflowRow): WorkflowStepId | null =>
  WORKFLOW_STEPS.find((s) => !['done', 'skipped'].includes(row.steps[s.id]?.status ?? 'pending'))?.id ?? null;

/** Đặt lại các bước từ `from` trở đi (và dữ liệu của chúng) để chạy lại. */
export const resetFrom = (row: WorkflowRow, from: WorkflowStepId): WorkflowRow => {
  const idx = WORKFLOW_STEPS.findIndex((s) => s.id === from);
  const steps = { ...row.steps };
  WORKFLOW_STEPS.slice(idx).forEach((s) => (steps[s.id] = { status: 'pending' }));
  const next: WorkflowRow = { ...row, steps, final: undefined };
  if (idx <= 3) next.merged = undefined;
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
  deps.patchRow(rowId, normalizeRow);

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
  product: async (rowId, tpl, deps) => {
    const row = deps.getRow(rowId)!;
    const existing = rowProduct(row, deps.library().products);
    if (existing) {
      return { detail: existing.id ? existing.name : `${existing.name} (chỉ có tên, không có ảnh)` };
    }
    if (!row.link && tpl.manualScenes?.length) return { status: 'skipped', detail: 'Không dùng sản phẩm' };
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
    const mainChar = mainCharacterOf(row, tpl, lib.characters);
    const stamp = nowStamp();
    const project = `Workflow - ${(prod?.name || mainChar?.name || 'Clip').slice(0, 60)}`;
    const finish = (lines: { prompt: string; title?: string }[], script?: WorkflowRow['script']): StepResult => {
      // Tách cảnh nhiều người nói: mỗi lượt thoại 1 shot với đúng giọng người nói
      const expanded = tpl.splitDialogue
        ? lines.flatMap((l) => {
            const parts = splitDialogueLine(l.prompt, lib.characters);
            return parts.map((prompt, k) => ({
              prompt,
              title: parts.length > 1 ? `${l.title || 'Cảnh'} · lượt ${k + 1}` : l.title,
            }));
          })
        : lines;
      const scenes: WorkflowSceneState[] = expanded.map((l) => ({ ...l, status: 'pending' }));
      deps.patchRow(rowId, (x) => ({ ...x, script, scenes, stamp, project }));
      return {
        detail: `${scenes.length} cảnh${scenes.length > lines.length ? ` (tách vai từ ${lines.length})` : ''}`,
        status: deps.reviewScript ? 'review' : 'done',
      };
    };
    // Prompt nhập tay (vd. từ sơ đồ khối): không cần AI viết
    if (tpl.manualScenes?.length) {
      const name = prod?.name || '';
      return finish(
        tpl.manualScenes
          .map((t) => t.trim())
          .filter(Boolean)
          .map((t, k) => ({ prompt: name ? t.split('{product}').join(name) : t, title: `Cảnh ${k + 1}` }))
      );
    }
    if (!prod) throw new Error('Chưa có sản phẩm.');
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
    // Workflow có dàn nhân vật cố định: AI chỉ viết với đúng dàn đó (+ nhân vật của dòng).
    // Không có thì đưa cả thư viện. Nhân vật chính luôn lên đầu để AI ưu tiên dùng.
    const cast = workflowCast(tpl, lib.characters);
    const pool = cast.length ? cast : lib.characters;
    const chars = mainChar ? [mainChar, ...pool.filter((c) => c.id !== mainChar.id)] : pool;
    const notes = [
      tpl.extraNote,
      mainChar && !tpl.faceless ? `Nhân vật chính là ${mainChar.name}.` : '',
      cast.length > 1 && !tpl.faceless ? `Dàn nhân vật: ${chars.map((c) => c.name).join(', ')}.` : '',
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
    return finish(
      script.scenes.map((s) => ({ prompt: sceneToPromptLine(s), title: s.title })),
      { scenes: script.scenes, source: script.source }
    );
  },

  /** Render cảnh: song song theo số luồng (nối khung cuối thì tuần tự), tự lưu file từng cảnh. */
  scenes: async (rowId, tpl, deps) => {
    const scenes = deps.getRow(rowId)!.scenes ?? [];
    if (!scenes.length) throw new Error('Chưa có kịch bản.');
    await ensurePortraits(rowId, tpl, deps);
    await ensureOutfit(rowId, tpl, deps);
    // Ảnh tham chiếu xong: thay dòng "AI đang vẽ / tạo ảnh..." bằng trạng thái render
    deps.patchRow(rowId, (r) => ({
      ...r,
      steps: { ...r.steps, scenes: { ...r.steps.scenes, detail: `🎬 Đang render ${scenes.filter((s) => s.status !== 'done').length} cảnh...` } },
    }));
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

  /** Hậu kỳ clip cuối (clip ghép, hoặc cảnh duy nhất): làm mờ logo rồi nâng độ phân giải. */
  post: async (rowId, tpl, deps) => {
    const row = deps.getRow(rowId)!;
    const blur = tpl.postBlur?.regions.length ? tpl.postBlur : null;
    const up = tpl.postUpscale || 0;
    if (!blur && !up) return { status: 'skipped', detail: 'Mẫu không có hậu kỳ' };
    const source = row.merged?.url || row.scenes?.find((s) => s.videoUrl)?.videoUrl;
    if (!source) throw new Error('Chưa có clip để hậu kỳ.');
    let url = source;
    const done: string[] = [];
    if (blur) {
      url = (await blurRegions(url, blur.regions, blur.mode, blur.strength)).url;
      done.push(`làm mờ ${blur.regions.length} vùng`);
    }
    if (up) {
      try {
        url = (await upscaleMedia(url, up)).url;
        done.push(`nâng ${up}px`);
      } catch (err: any) {
        // Clip đã đủ nét: bỏ qua bước nâng
        if (!/không cần nâng/.test(String(err?.message))) throw err;
      }
    }
    const res = await exportVideo(url, row.project || 'Workflow', `${row.stamp || nowStamp()}_FINAL`);
    deps.patchRow(rowId, (x) => ({ ...x, final: { url, path: res.path } }));
    return { detail: `${done.join(', ') || 'giữ nguyên'} → ${res.path}` };
  },
};

/**
 * Nhân vật trong dòng (nhân vật chính + nhân vật được nhắc trong cảnh) chưa có ảnh khóa mặt:
 * AI vẽ chân dung theo mô tả rồi lưu thẳng vào thư viện nhân vật.
 */
async function ensurePortraits(rowId: string, tpl: WorkflowTemplate, deps: RunnerDeps) {
  if (tpl.faceless || tpl.autoPortrait === false) return;
  const row = deps.getRow(rowId)!;
  const lib = deps.library();
  const wanted = new Map<string, StudioCharacter>();
  const main = mainCharacterOf(row, tpl, lib.characters);
  if (main) wanted.set(main.id, main);
  workflowCast(tpl, lib.characters).forEach((c) => wanted.set(c.id, c));
  (row.scenes ?? []).forEach((s) => {
    const c = characterInPrompt(s.prompt, lib.characters);
    if (c) wanted.set(c.id, c);
  });
  for (const c of wanted.values()) {
    if (c.images.length || c.description.trim().length < 3 || deps.shouldStop()) continue;
    deps.patchRow(rowId, (r) => ({
      ...r,
      steps: { ...r.steps, scenes: { ...r.steps.scenes, detail: `🎨 AI đang vẽ chân dung ${c.name}...` } },
    }));
    // Như MV1: chân dung mặc sẵn trang phục của workflow → Ảnh #1 và Ảnh #2 khóa cùng một bộ đồ
    const outfit = tpl.outfit?.description.trim();
    const res = await generatePortrait({
      name: c.name,
      description: c.description,
      n: 1,
      style: outfit ? `Mặc đúng bộ trang phục: ${outfit}`.slice(0, 300) : undefined,
    });
    const dataUrl = await urlToResizedDataUrl(res.data[0].url);
    deps.updateCharacter(c.id, { images: [dataUrl] });
  }
}

/** Prompt tạo ảnh trang phục đơn (ma-nơ-canh vô hình, không người) — theo cách MV1 Muse AI. */
export const outfitImagePrompt = (desc: string) =>
  'Single-frame 4K fashion wardrobe reference photo — ONE OUTFIT ONLY in ONE SINGLE UNDIVIDED FRAME ' +
  '(NO PEOPLE, NO FACES, NO COLLAGE, NO SPLIT-SCREEN, NO TEXT). Invisible ghost mannequin / lookbook display ' +
  `on a bright minimal studio background, full garment clearly visible: cut, color, fabric texture. Outfit: ${desc}`;

/**
 * Khối Trang phục chỉ có mô tả: AI tạo 1 ảnh trang phục cho lượt chạy (lưu vào dòng),
 * mọi cảnh dùng chung ảnh này để trang phục đồng nhất khi render song song.
 */
async function ensureOutfit(rowId: string, tpl: WorkflowTemplate, deps: RunnerDeps) {
  const o = tpl.outfit;
  if (!o || o.image || !o.description.trim() || deps.getRow(rowId)!.outfitImage || deps.shouldStop()) return;
  deps.patchRow(rowId, (r) => ({
    ...r,
    steps: { ...r.steps, scenes: { ...r.steps.scenes, detail: '👗 AI đang tạo ảnh trang phục...' } },
  }));
  const img = await generateMuseKeyframe(
    { ...DEFAULT_MUSE_CONFIG, aspectRatio: tpl.aspectRatio },
    outfitImagePrompt(o.description.trim()),
    []
  );
  deps.patchRow(rowId, (r) => ({ ...r, outfitImage: img }));
}

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
  const mainChar = mainCharacterOf(row, tpl, lib.characters);
  const ch = characterInPrompt(scene.prompt, lib.characters) ?? mainChar;
  const voice =
    ch && (ch.voicePresetId || ch.museVoiceOverride)
      ? resolveVoice(ch.voicePresetId, ch.museVoiceOverride, lib.museVoiceNames)
      : {};

  // Ảnh tham chiếu: nhân vật (+ trang phục) trừ khi mẫu không lộ mặt; sản phẩm (xoay vòng nếu bật)
  const refs: ReferenceImage[] = [];
  if (!tpl.faceless && ch?.images[0]) {
    refs.push({ id: `char_${ch.id}`, role: 'character', dataUrl: ch.images[0], name: ch.name });
  }
  // Trang phục của workflow (khối 👗) ưu tiên hơn trang phục riêng của nhân vật
  const wfOutfit = tpl.outfit?.image || (tpl.outfit ? row.outfitImage : undefined);
  if (wfOutfit) {
    refs.push({ id: 'outfit_wf', role: 'outfit', dataUrl: wfOutfit, name: 'outfit' });
  } else if (!tpl.faceless && ch?.images[0] && ch.outfitImage && !tpl.rotateProductImages) {
    refs.push({ id: `outfit_${ch.id}`, role: 'outfit', dataUrl: ch.outfitImage, name: `${ch.name} outfit` });
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
      const refMode = tpl.refMode ?? 'reference';
      const prev = i > 0 ? deps.getRow(rowId)!.scenes![i - 1] : undefined;
      let keyframe = '';
      if (tpl.chainEndFrame && prev?.videoUrl) {
        try {
          keyframe = await extractLastFrameAsDataUrl(prev.videoUrl);
        } catch {
          /* không cắt được khung cuối: dùng ảnh tham chiếu gốc */
        }
      }
      const voiceInfo = buildVoiceInfo(voice, { emotion: ch?.emotion, characterName: ch?.name });
      const dialogueVoices = multiVoiceInfo(scene.prompt, lib.characters, lib.museVoiceNames);
      let items: { url: string; role: ImageRole }[];
      let prompt: string;

      if (refMode === 'reference') {
        // Direct Reference-to-Video (như MV1): Nhân vật → Trang phục → Sản phẩm, đều là tham chiếu.
        // Chỉ khung nối từ cảnh trước mới làm khung mở đầu (gửi ở vị trí "image").
        const ordered = (['character', 'outfit', 'product'] as const)
          .map((role) => refs.find((r) => r.role === role))
          .filter((r): r is ReferenceImage => !!r);
        items = [
          ...(keyframe ? [{ url: keyframe, role: 'keyframe' as ImageRole }] : []),
          ...ordered.slice(0, 3).map((r) => ({ url: r.dataUrl, role: r.role as ImageRole })),
        ];
        const outfitDesc = tpl.outfit?.description || (ch?.outfitImage ? `trang phục cố định của ${ch.name}` : '');
        prompt = buildReferencePrompt({
          images: items.map((it) =>
            it.role === 'character'
              ? { role: 'character', name: ch?.name, description: ch?.description }
              : it.role === 'outfit'
                ? { role: 'outfit', description: outfitDesc }
                : it.role === 'product'
                  ? { role: 'product', name: prod?.name, description: prod?.visual || prod?.description }
                  : { role: 'keyframe' }
          ),
          scenePrompt: scene.prompt,
          setting: tpl.setting,
          cameraMotion: tpl.cameraMotion,
          voiceInfo: [voiceInfo, dialogueVoices].filter(Boolean).join(' '),
          realism: tpl.realismLock !== false,
        });
      } else {
        // Cách cũ: ảnh đầu (nhân vật) làm khung mở đầu video
        items = orderedReferenceRoles(refs).map((role) => ({ url: refs.find((r) => r.role === role)!.dataUrl, role }));
        if (keyframe) items = [{ url: keyframe, role: 'keyframe' }, ...items];
        if (!items.length) {
          throw new Error('Cảnh không có ảnh nào: thêm ảnh cho sản phẩm hoặc chọn nhân vật có ảnh.');
        }
        items = items.slice(0, 4);
        const charTag = !tpl.faceless && ch?.description ? `[CHARACTER ${ch.name}: ${ch.description}]` : '';
        prompt = buildLockedPrompt(
          [charTag, voiceInfo, dialogueVoices, scene.prompt].filter(Boolean).join(' '),
          refs,
          tpl.cameraMotion,
          { name: prod?.name, visual: prod?.visual },
          items.map((it) => it.role)
        );
      }
      // Reference mode không có khung nối: ảnh nào cũng là tham chiếu, không ép khung mở đầu
      const firstFrame = refMode === 'reference' ? (keyframe ? items[0].url : '') : items[0].url;
      const restRefs = (refMode === 'reference' && !keyframe ? items : items.slice(1)).map((it) => it.url);
      const cfg: MuseConfig = {
        ...DEFAULT_MUSE_CONFIG,
        aspectRatio: tpl.aspectRatio,
        duration: tpl.duration,
        voice: voice.museVoiceId || '',
      };
      videoUrl = await createAndPollMuseVideo(
        cfg,
        prompt,
        firstFrame,
        (taskId) => setScene({ taskId }),
        pollOpts,
        restRefs
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
