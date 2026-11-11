// Bộ workflow (.musestudio.json): xuất / nhập nhiều mẫu "Mẫu & danh sách dòng" + sơ đồ Sơ đồ khối cùng lúc,
// kèm nhân vật / sản phẩm (Cài đặt) mà chúng dùng và MỌI ảnh nhúng sẵn (data URL) — sang máy mới hoặc tải từ
// fastaivn.com về là chạy được ngay, không phụ thuộc Gateway / ổ đĩa máy cũ.
import { GATEWAY_URL, MUSE_API_KEY } from '../config/appConfig';
import type { StudioCharacter, StudioProduct } from '../types/library';
import { newLibraryId } from '../types/library';
import type { WorkflowTemplate } from '../types/workflow';
import type { FlowNode, FlowWorkflow } from './nodeFlow/definitions';
import { parseFlowJson } from './nodeFlow/flowIO';
import { APP_VERSION } from './templateCatalog';

export const BUNDLE_KIND = 'musestudio-workflow-bundle';

export interface WorkflowBundle {
  kind: typeof BUNDLE_KIND;
  bundleVersion: 1;
  name: string;
  description?: string;
  exportedAt: string;
  appVersion: string;
  /** Mẫu "Mẫu & danh sách dòng" (mẫu tự lưu) */
  templates: WorkflowTemplate[];
  /** Sơ đồ Sơ đồ khối (đã bỏ trạng thái chạy) */
  flows: FlowWorkflow[];
  /** Nhân vật / sản phẩm trong Cài đặt mà mẫu / sơ đồ dùng */
  characters: StudioCharacter[];
  products: StudioProduct[];
}

/** Khóa dữ liệu lượt chạy — không mang sang máy khác */
const RUN_KEYS = ['runStatus', 'error', 'results', 'progress', 'startedAt', 'finishedAt', 'taskId', 'accountId', 'previewUrl', 'prompts', 'keyframe', 'rerun'];

const isData = (v: string) => v.startsWith('data:');
/** Ảnh nằm trên Gateway / máy này (không mở được ở máy khác) → phải nhúng. */
const isLocal = (v: string) => /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(v) || v.startsWith('/v1/') || v.startsWith('/studio/');
/** Ảnh đi kèm app (workflow-thumbs/…, đường dẫn tương đối) — app bản cũ có thể chưa có → nhúng khi xuất ảnh của node sơ đồ */
const isAppAsset = (v: string) => /^(\.\/)?[\w.-]+\/[^:?#]+\.(jpe?g|png|webp|gif)$/i.test(v);

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => fail(r.error);
    r.readAsDataURL(b);
  });

const inlineImage = async (v: unknown, warn: (m: string) => void, appAssets = false): Promise<unknown> => {
  if (typeof v !== 'string' || !v || isData(v)) return v;
  const asset = appAssets && isAppAsset(v);
  if (!asset && !isLocal(v)) return v;
  try {
    const url = asset ? new URL(v, window.location.href).href : v.startsWith('/') ? `${GATEWAY_URL}${v}` : v;
    const res = await fetch(url, asset ? {} : { headers: { Authorization: `Bearer ${MUSE_API_KEY}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await blobToDataUrl(await res.blob());
  } catch (err: any) {
    warn(`Không nhúng được ảnh ${v.slice(0, 80)} (${err?.message || err}) — máy khác sẽ thiếu ảnh này.`);
    return v;
  }
};

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

const norm = (s: string) => s.trim().toLowerCase();

/** Node của sơ đồ nhúng trong mẫu (tpl.flowGraph) */
const graphNodes = (t: WorkflowTemplate): FlowNode[] => {
  const nodes = (t.flowGraph as { nodes?: unknown } | undefined)?.nodes;
  return Array.isArray(nodes) ? (nodes as FlowNode[]) : [];
};

/** Bỏ dữ liệu lượt chạy + nhúng ảnh (Gateway và ảnh đi kèm app) của các node sơ đồ */
const cleanNodes = async (nodes: FlowNode[], warn: (m: string) => void) => {
  for (const n of nodes) {
    if (!n.data) continue;
    RUN_KEYS.forEach((k) => delete (n.data as Record<string, unknown>)[k]);
    for (const k of ['image', 'faceImage'] as const) if (n.data[k]) (n.data as any)[k] = await inlineImage(n.data[k], warn, true);
  }
};

/** Tên chưa dùng: "Tên", "Tên (nhập)", "Tên (nhập 2)"… — ghi nhận vào taken */
const uniqueName = (base: string, taken: Set<string>) => {
  let name = base;
  for (let k = 1; taken.has(norm(name)); k++) name = `${base} (nhập${k > 1 ? ` ${k}` : ''})`;
  taken.add(norm(name));
  return name;
};

/** Nhân vật / sản phẩm mà mẫu + sơ đồ dùng (theo id đã chọn hoặc @tên / @@tên trong prompt) */
export const referencedLibrary = (
  templates: WorkflowTemplate[],
  flows: FlowWorkflow[],
  characters: StudioCharacter[],
  products: StudioProduct[]
) => {
  const cIds = new Set<string>();
  const pIds = new Set<string>();
  let text = '';
  templates.forEach((t) => {
    t.characterIds?.forEach((id) => cIds.add(id));
    text += `\n${t.extraNote || ''}\n${(t.manualScenes || []).join('\n')}`;
  });
  const nodes = [...flows.flatMap((w) => w.nodes), ...templates.flatMap(graphNodes)];
  nodes.forEach((n) => {
    if (!n.data) return;
    if (n.data.characterId) cIds.add(String(n.data.characterId));
    if (n.data.productId) pIds.add(String(n.data.productId));
    text += `\n${n.data.prompt || ''}`;
  });
  // @tên nhân vật / @@tên sản phẩm (tên có thể nhiều chữ: "@@Quạt mini Jisulife")
  const low = text.toLowerCase();
  const mentioned = (prefix: string, name: string) => {
    const n = norm(name).replace(/^@+/, '');
    if (!n) return false;
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^@])${prefix}${esc}(?![\\p{L}\\p{N}])`, 'u').test(low);
  };
  characters.forEach((c) => mentioned('@', c.name) && cIds.add(c.id));
  products.forEach((p) => mentioned('@@', p.name) && pIds.add(p.id));
  return { characters: characters.filter((c) => cIds.has(c.id)), products: products.filter((p) => pIds.has(p.id)) };
};

/** Đóng gói bộ workflow. Ảnh trên Gateway / máy này được nhúng thành data URL. */
export const buildBundle = async (opts: {
  name: string;
  description?: string;
  templates: WorkflowTemplate[];
  /** Mẫu có sẵn của app (8 MuseStudio + 13 MV1 + FastAIVN + catalog): nhúng sơ đồ node (flowGraph), giữ id gốc */
  builtinTemplates?: WorkflowTemplate[];
  flows: FlowWorkflow[];
  characters: StudioCharacter[];
  products: StudioProduct[];
  includeLibrary: boolean;
  onProgress?: (msg: string) => void;
}): Promise<{ bundle: WorkflowBundle; warnings: string[] }> => {
  const warnings: string[] = [];
  const warn = (m: string) => warnings.push(m);
  const templates = clone(opts.templates).map((t) => ({ ...t, builtin: false }));
  if (opts.builtinTemplates?.length) {
    // import động: fromTemplate.ts cũng import file này
    const { templateToFlow } = await import('./nodeFlow/fromTemplate');
    let i = 0;
    for (const src of opts.builtinTemplates) {
      opts.onProgress?.(`Dựng sơ đồ mẫu có sẵn ${++i}/${opts.builtinTemplates.length}: ${src.name}`);
      const t = { ...clone(src), builtin: false };
      try {
        const g = clone((await templateToFlow(src)).workflow);
        delete g.updatedAt;
        t.flowGraph = g;
      } catch (err: any) {
        warn(`Không dựng được sơ đồ mẫu "${src.name}" (${err?.message || err}) — xuất mẫu không kèm sơ đồ.`);
      }
      templates.push(t);
    }
  }
  opts.onProgress?.('Nhúng ảnh…');
  for (const t of templates) {
    if (t.outfit?.image) t.outfit.image = String(await inlineImage(t.outfit.image, warn));
    await cleanNodes(graphNodes(t), warn);
  }
  const flows = clone(opts.flows);
  for (const w of flows) {
    delete w.updatedAt;
    await cleanNodes(w.nodes, warn);
  }
  const lib = opts.includeLibrary ? referencedLibrary(templates, flows, opts.characters, opts.products) : { characters: [], products: [] };
  const characters = clone(lib.characters);
  for (const c of characters) {
    c.images = (await Promise.all(c.images.map((i) => inlineImage(i, warn)))) as string[];
    if (c.outfitImage) c.outfitImage = String(await inlineImage(c.outfitImage, warn));
  }
  const products = clone(lib.products);
  for (const p of products) p.images = (await Promise.all(p.images.map((i) => inlineImage(i, warn)))) as string[];
  if (!opts.includeLibrary) {
    const n = referencedLibrary(templates, flows, opts.characters, opts.products);
    if (n.characters.length || n.products.length)
      warn(`Không kèm ${n.characters.length} nhân vật / ${n.products.length} sản phẩm đang được dùng — máy khác phải tự chọn lại trong Cài đặt.`);
  }
  return {
    bundle: {
      kind: BUNDLE_KIND,
      bundleVersion: 1,
      name: opts.name,
      description: opts.description,
      exportedAt: new Date().toISOString(),
      appVersion: APP_VERSION,
      templates,
      flows,
      characters,
      products,
    },
    warnings,
  };
};

/**
 * Đọc file / JSON tải về thành bộ workflow. Nhận: bộ .musestudio.json, 1 sơ đồ flow-workflow (MuseStudio / MV1 export),
 * gói mẫu fastaivn-template, hoặc mảng mẫu "Mẫu & danh sách dòng".
 */
export const parseBundle = (raw: unknown, fallbackName = 'Bộ nhập'): WorkflowBundle => {
  const r = raw as any;
  const empty = (name: string): WorkflowBundle => ({
    kind: BUNDLE_KIND,
    bundleVersion: 1,
    name,
    exportedAt: '',
    appVersion: '',
    templates: [],
    flows: [],
    characters: [],
    products: [],
  });
  if (r?.kind === BUNDLE_KIND) {
    if (Number(r.bundleVersion) > 1) throw new Error(`Bộ workflow bản ${r.bundleVersion} mới hơn app — hãy cập nhật MuseStudio.`);
    return {
      ...empty(String(r.name || fallbackName)),
      ...r,
      templates: Array.isArray(r.templates) ? r.templates : [],
      flows: Array.isArray(r.flows) ? r.flows : [],
      characters: Array.isArray(r.characters) ? r.characters : [],
      products: Array.isArray(r.products) ? r.products : [],
    };
  }
  if (Array.isArray(r) && r.every((t) => t && typeof t === 'object' && 'scriptMode' in t)) return { ...empty(fallbackName), templates: r };
  // 1 sơ đồ (flow-workflow / MV1 export / gói fastaivn-template)
  const g = r?.graph && Array.isArray(r.graph.nodes) ? r.graph : r;
  if (g && Array.isArray(g.nodes) && Array.isArray(g.edges)) {
    const b = empty(String(r.entry?.title || r.title || g.name || fallbackName));
    b.flows = [{ ...g, name: String(r.entry?.title || r.title || g.name || fallbackName), description: String(r.entry?.description || g.description || '') }];
    return b;
  }
  throw new Error('File không phải bộ workflow MuseStudio (.musestudio.json), sơ đồ flow-workflow hay danh sách mẫu.');
};

export interface ImportPlan {
  templates: WorkflowTemplate[];
  /** Theo thứ tự bundle.templates: tên sẽ nhập, hoặc null = mẫu có sẵn ở máy này (bỏ qua) */
  templateTargets: (string | null)[];
  flows: FlowWorkflow[];
  /** Nhân vật / sản phẩm thêm mới vào Cài đặt */
  newCharacters: StudioCharacter[];
  newProducts: StudioProduct[];
  /** Trùng tên với cái đã có → dùng cái có sẵn */
  reusedCharacters: string[];
  reusedProducts: string[];
  notes: string[];
}

/**
 * Chuẩn bị nhập: cấp id mới cho mẫu / sơ đồ (không đè cái đang có), nhân vật / sản phẩm trùng tên dùng cái có sẵn,
 * còn lại thêm mới; nối lại characterId / productId / characterIds theo id mới.
 */
export const planImport = (
  b: WorkflowBundle,
  existing: {
    templates: WorkflowTemplate[];
    /** Mẫu có sẵn của app ở máy nhận — mẫu trong bộ trùng id thì bỏ qua (đã có) */
    builtinTemplates?: WorkflowTemplate[];
    flows: FlowWorkflow[];
    characters: StudioCharacter[];
    products: StudioProduct[];
  }
): ImportPlan => {
  const notes: string[] = [];
  const cMap = new Map<string, string>();
  const pMap = new Map<string, string>();
  const newCharacters: StudioCharacter[] = [];
  const newProducts: StudioProduct[] = [];
  const reusedCharacters: string[] = [];
  const reusedProducts: string[] = [];
  b.characters.forEach((c) => {
    const same = existing.characters.find((x) => norm(x.name) === norm(c.name));
    if (same) {
      cMap.set(c.id, same.id);
      reusedCharacters.push(c.name);
    } else {
      const id = newLibraryId('char');
      cMap.set(c.id, id);
      newCharacters.push({ ...clone(c), id, createdAt: Date.now() });
    }
  });
  b.products.forEach((p) => {
    const same = existing.products.find((x) => norm(x.name) === norm(p.name));
    if (same) {
      pMap.set(p.id, same.id);
      reusedProducts.push(p.name);
    } else {
      const id = newLibraryId('prod');
      pMap.set(p.id, id);
      newProducts.push({ ...clone(p), id, createdAt: Date.now() });
    }
  });
  /** Nối lại characterId / productId của node theo id mới; id không có ở máy nhận thì bỏ chọn */
  const remapNodes = (owner: string, nodes: FlowNode[]) =>
    nodes.forEach((n) => {
      if (!n.data) return;
      if (n.data.characterId) {
        const id = cMap.get(String(n.data.characterId));
        if (id) n.data.characterId = id;
        else if (!existing.characters.some((c) => c.id === n.data.characterId)) {
          notes.push(`${owner}: "${n.data.batchLabel || 'Upload Image'}" chọn nhân vật không có trong bộ — chọn lại trong Cài đặt.`);
          delete n.data.characterId;
        }
      }
      if (n.data.productId) {
        const id = pMap.get(String(n.data.productId));
        if (id) n.data.productId = id;
        else if (!existing.products.some((p) => p.id === n.data.productId)) {
          notes.push(`${owner}: "${n.data.batchLabel || 'Upload Image'}" chọn sản phẩm không có trong bộ — chọn lại trong Cài đặt.`);
          delete n.data.productId;
        }
      }
    });
  const builtinIds = new Set((existing.builtinTemplates || []).map((t) => t.id));
  const takenT = new Set([...existing.templates, ...(existing.builtinTemplates || [])].map((t) => norm(t.name)));
  const templates: WorkflowTemplate[] = [];
  const templateTargets = b.templates.map((t) => {
    if (builtinIds.has(t.id)) return null;
    const name = uniqueName(t.name, takenT);
    const nt = {
      ...clone(t),
      id: `wf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      name,
      builtin: false,
      characterIds: t.characterIds?.map((id) => cMap.get(id)).filter((x): x is string => !!x),
    } as WorkflowTemplate;
    remapNodes(name, graphNodes(nt));
    templates.push(nt);
    return name;
  });
  const takenF = new Set(existing.flows.map((w) => norm(w.name)));
  const flows = b.flows.map((src) => {
    const r = parseFlowJson(src, src.name);
    r.notes.forEach((n) => notes.push(`${src.name}: ${n}`));
    const w = r.workflow;
    w.templateId = src.templateId;
    w.category = src.category;
    w.videoUrl = src.videoUrl;
    w.name = uniqueName(w.name, takenF);
    remapNodes(w.name, w.nodes);
    return w;
  });
  return { templates, templateTargets, flows, newCharacters, newProducts, reusedCharacters, reusedProducts, notes };
};

/** Tải bộ workflow từ link (fastaivn.com, Firebase, Google Drive public…) qua Gateway (không vướng CORS, file lớn). */
export const fetchBundleFromUrl = async (url: string): Promise<unknown> => {
  const res = await fetch(`${GATEWAY_URL}/studio/catalog/bundle?url=${encodeURIComponent(url)}`, {
    headers: { Authorization: `Bearer ${MUSE_API_KEY}` },
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      msg = JSON.parse(text).error?.message || JSON.parse(text).detail || msg;
    } catch {
      /* giữ chữ */
    }
    if (res.status === 404 && /Not Found/i.test(text)) msg = 'Gateway chưa có API tải bộ workflow — khởi động lại Gateway.';
    throw new Error(msg);
  }
  return JSON.parse(text).bundle;
};

export const bundleFileName = (name: string) =>
  `${name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'bo-workflow'}.musestudio.json`;

export const bundleSummary = (b: WorkflowBundle) =>
  `${b.templates.length} mẫu · ${b.flows.length} sơ đồ · ${b.characters.length} nhân vật · ${b.products.length} sản phẩm`;
