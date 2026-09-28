/**
 * Turns the synced catalog + curation into ModelSpecs shared by the UI and the worker.
 * Node inputs, parameter controls, palette groups and capability icons are all derived
 * here, so a new OpenRouter model appears after `npm run models:sync` with no UI code.
 */
import catalog from "./catalog.json";
import { FEATURED, OVERRIDES } from "./curation";
import type {
  CapabilityDescriptor, CatalogEntry, MediaKind, ModelCaps, ModelGroup, ModelSpec, ParamSpec, ParamValue, PortSpec,
} from "./types";

const ENTRIES = (catalog as { models: CatalogEntry[] }).models;

const QUALITY_LABELS: Record<string, string> = {
  auto: "Авто", low: "Низкое", medium: "Среднее", high: "Высокое", xhigh: "Очень высокое", max: "Максимальное",
};
const BACKGROUND_LABELS: Record<string, string> = { auto: "Авто", transparent: "Прозрачный", opaque: "Непрозрачный" };

const opts = (values: string[], labels?: Record<string, string>) =>
  values.map((v) => ({ value: v, label: labels?.[v] ?? (v === "auto" ? "Авто" : v) }));

const pick = (values: string[], ...preferred: string[]) =>
  preferred.find((p) => values.includes(p)) ?? values.find((v) => v !== "auto") ?? values[0];

const PROMPT_PORT: PortSpec = { key: "prompt", dtype: "text", label: "Промт", max: 1, min: 0 };

type Shape = Pick<ModelSpec, "inputs" | "params" | "group" | "caps">;

const NO_CAPS: ModelCaps = {
  frames: false, refs: false, mediaRefs: false, audio: false, variants: 1, vector: false, sourceVideo: false,
};

function videoShape(e: CatalogEntry): Shape {
  const o = OVERRIDES[e.id] ?? {};
  const inputs: PortSpec[] = [PROMPT_PORT];
  if (o.sourceVideo) inputs.push({ key: "source", dtype: "video", label: "Исходное видео", max: 1, min: 1 });
  const frames = e.frameImages ?? [];
  if (frames.includes("first_frame")) inputs.push({ key: "first_frame", dtype: "image", label: "Первый кадр", max: 1, min: 0 });
  if (frames.includes("last_frame")) inputs.push({ key: "last_frame", dtype: "image", label: "Последний кадр", max: 1, min: 0 });
  if (o.refs?.image) inputs.push({ key: "references", dtype: "image", label: "Референсы", max: o.refs.image, min: 0, hint: "персонаж, стиль" });
  if (o.refs?.video) inputs.push({ key: "ref_videos", dtype: "video", label: "Видео-референсы", max: o.refs.video, min: 0, hint: "движение, камера" });
  if (o.refs?.audio) inputs.push({ key: "ref_audio", dtype: "audio", label: "Аудио-референсы", max: o.refs.audio, min: 0, hint: "голос, музыка" });

  const params: ParamSpec[] = [];
  const res = e.resolutions ?? [];
  if (res.length) params.push({ key: "resolution", label: "Разрешение", type: "enum", options: opts(res), default: pick(res, "720p", "768p", "1080p") });
  const ar = e.aspectRatios ?? [];
  if (ar.length) params.push({ key: "aspect_ratio", label: "Формат кадра", type: "enum", options: opts(ar), default: pick(ar, "16:9") });
  const dur = (e.durations ?? []).map(String);
  if (dur.length) {
    params.push({
      key: "duration", label: "Длительность", type: "enum",
      options: dur.map((d) => ({ value: d, label: `${d} сек` })), default: pick(dur, "5", "6", "4"),
    });
  }
  if (e.upscaleFactor) {
    const steps: string[] = [];
    for (let f = e.upscaleFactor.min; f <= e.upscaleFactor.max + 1e-9; f += 0.5) steps.push(String(f));
    params.push({
      key: "upscale_factor", label: "Увеличение", type: "enum",
      options: steps.map((s) => ({ value: s, label: `×${s.replace(".", ",")}` })), default: pick(steps, "2"),
    });
  }
  if (e.creativity?.length) {
    params.push({
      key: "creativity", label: "Режим", type: "enum",
      options: [{ value: "0", label: "Точный" }, { value: "1", label: "Творческий" }], default: "0",
    });
  }
  if (e.audio) params.push({ key: "generate_audio", label: "Звук", type: "boolean", default: true });
  if (e.seed) params.push({ key: "seed", label: "Seed", type: "seed" });

  return {
    inputs, params,
    group: o.sourceVideo ? "video-edit" : "video",
    caps: {
      ...NO_CAPS,
      frames: frames.length > 0,
      refs: !!o.refs?.image,
      mediaRefs: !!(o.refs?.video || o.refs?.audio),
      audio: !!e.audio,
      sourceVideo: !!o.sourceVideo,
    },
  };
}

function imageShape(e: CatalogEntry): Shape {
  const s: Record<string, CapabilityDescriptor> = e.supported ?? {};
  const inputs: PortSpec[] = [PROMPT_PORT];
  const refMax = s.input_references?.max ?? 0;
  const refMin = s.input_references?.min ?? 0;
  if (refMax > 0) {
    inputs.push({
      key: "references", dtype: "image", label: refMax > 1 ? "Референсы" : "Референс", max: refMax, min: refMin,
      hint: refMin > 0 ? "обязательно" : undefined,
    });
  }

  const params: ParamSpec[] = [];
  const ar = s.aspect_ratio?.values ?? [];
  if (ar.length) params.push({ key: "aspect_ratio", label: "Формат кадра", type: "enum", options: opts(ar), default: pick(ar, "16:9", "1:1") });
  const res = s.resolution?.values ?? [];
  if (res.length) params.push({ key: "resolution", label: "Разрешение", type: "enum", options: opts(res), default: pick(res, "1K", "2K") });
  const q = s.quality?.values ?? [];
  if (q.length) params.push({ key: "quality", label: "Качество", type: "enum", options: opts(q, QUALITY_LABELS), default: pick(q, "medium", "high") });
  const bg = s.background?.values ?? [];
  if (bg.includes("transparent")) params.push({ key: "background", label: "Фон", type: "enum", options: opts(bg, BACKGROUND_LABELS), default: "auto" });
  const nMax = Math.min(4, s.n?.max ?? 1);
  if (nMax > 1) {
    const ns = Array.from({ length: nMax }, (_, i) => String(i + 1));
    params.push({ key: "n", label: "Вариантов", type: "enum", options: opts(ns), default: "1" });
  }
  if (s.seed) params.push({ key: "seed", label: "Seed", type: "seed" });

  const formats = s.output_format?.values ?? [];
  const vector = formats.length > 0 && formats.every((f) => f === "svg");
  return {
    inputs, params,
    group: refMin > 0 ? "image-style" : vector ? "image-vector" : "image",
    caps: { ...NO_CAPS, refs: refMax > 0, variants: nMax, vector },
  };
}

function textShape(e: CatalogEntry): Shape {
  const inputs: PortSpec[] = [PROMPT_PORT];
  const sees = e.inputModalities?.includes("image");
  if (sees) inputs.push({ key: "images", dtype: "image", label: "Картинки", max: 4, min: 0, hint: "описать, разобрать" });
  const params: ParamSpec[] = [{
    key: "system", label: "Инструкция", type: "text", default: "",
    placeholder: "Например: «Перепиши как промт для видео, на английском»",
  }];
  return { inputs, params, group: "text", caps: { ...NO_CAPS, refs: !!sees } };
}

/** "ByteDance: Seedance 2.0" → vendor "ByteDance", name "Seedance 2.0" */
function splitName(raw: string): { vendor: string; name: string } {
  const i = raw.indexOf(": ");
  return i > 0 ? { vendor: raw.slice(0, i), name: raw.slice(i + 2) } : { vendor: "", name: raw };
}

/**
 * Our own tools, executed by the worker with ffmpeg. They make long videos possible:
 * last frame of clip A -> first frame of clip B -> join A and B.
 */
export const TOOL_PREFIX = "kaskad/";
const TOOLS: ModelSpec[] = [
  {
    id: "kaskad/last-frame", kind: "image", group: "tools", name: "Кадр из видео", vendor: "Каскад",
    blurb: "Последний кадр ролика: первый кадр следующей сцены", featured: false, promptOptional: true,
    caps: { ...NO_CAPS, sourceVideo: true },
    inputs: [{ key: "video", dtype: "video", label: "Видео", max: 1, min: 1 }],
    params: [{
      key: "which", label: "Какой кадр", type: "enum", default: "last",
      options: [{ value: "last", label: "Последний" }, { value: "first", label: "Первый" }],
    }],
    pricing: { type: "free" },
  },
  {
    id: "kaskad/concat", kind: "video", group: "tools", name: "Склейка видео", vendor: "Каскад",
    blurb: "Соединяет ролики в один, в порядке подключения", featured: false, promptOptional: true,
    caps: { ...NO_CAPS, sourceVideo: true },
    inputs: [{ key: "clips", dtype: "video", label: "Ролики", max: 8, min: 2, hint: "по порядку подключения" }],
    params: [],
    pricing: { type: "free" },
  },
];

const FEATURED_RANK = new Map(FEATURED.map((f, i) => [f.id, i]));

export const MODELS: ModelSpec[] = ENTRIES
  .map((e): ModelSpec => {
    const o = OVERRIDES[e.id] ?? {};
    const shape = e.kind === "video" ? videoShape(e) : e.kind === "image" ? imageShape(e) : textShape(e);
    const auto = splitName(e.name);
    return {
      id: e.id,
      kind: e.kind,
      name: o.name ?? auto.name,
      vendor: auto.vendor,
      blurb: o.blurb ?? "",
      featured: FEATURED_RANK.has(e.id),
      promptOptional: !!o.promptOptional,
      pricing: e.pricing,
      ...shape,
    };
  })
  // featured first in curated order, then the rest by vendor and name
  .sort((a, b) => {
    const ra = FEATURED_RANK.get(a.id) ?? 1e6, rb = FEATURED_RANK.get(b.id) ?? 1e6;
    if (ra !== rb) return ra - rb;
    return `${a.vendor} ${a.name}`.localeCompare(`${b.vendor} ${b.name}`, "ru");
  })
  .concat(TOOLS);

const BY_ID = new Map(MODELS.map((m) => [m.id, m]));

export function getModel(id: string): ModelSpec | undefined {
  return BY_ID.get(id);
}

export function modelsOfKind(kind: MediaKind): ModelSpec[] {
  return MODELS.filter((m) => m.kind === kind);
}

/** Default model for a freshly added node of a kind. */
export function defaultModel(kind: MediaKind): ModelSpec {
  return modelsOfKind(kind).find((m) => m.group === kind) ?? modelsOfKind(kind)[0];
}

export function defaultParams(spec: ModelSpec): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const p of spec.params) {
    if (p.type === "seed") out[p.key] = "";
    else out[p.key] = p.default;
  }
  return out;
}

/** Keep values the new model supports, fill the rest with its defaults. */
export function reconcileParams(spec: ModelSpec, current: Record<string, ParamValue>): Record<string, ParamValue> {
  const out = defaultParams(spec);
  for (const p of spec.params) {
    const v = current[p.key];
    if (v === undefined) continue;
    if (p.type === "enum" && !p.options.some((o) => o.value === String(v))) continue;
    if (p.type === "boolean" && typeof v !== "boolean") continue;
    out[p.key] = v;
  }
  return out;
}
