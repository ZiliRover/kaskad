/**
 * Turns synced catalog data + curation into ModelSpecs the UI and worker share.
 * Node inputs and parameter controls are derived here, so adding a model is a
 * curation entry plus `npm run models:sync` — no UI code.
 */
import catalog from "./catalog.json";
import { CURATED } from "./curation";
import type {
  CapabilityDescriptor, CatalogEntry, MediaKind, ModelSpec, ParamSpec, ParamValue, PortSpec,
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

const PROMPT_PORT: PortSpec = { key: "prompt", dtype: "text", label: "Промт", max: 1 };

function videoSpec(e: CatalogEntry): Pick<ModelSpec, "inputs" | "params"> {
  const inputs: PortSpec[] = [PROMPT_PORT];
  if (e.frameImages?.includes("first_frame")) inputs.push({ key: "first_frame", dtype: "image", label: "Первый кадр", max: 1 });
  if (e.frameImages?.includes("last_frame")) inputs.push({ key: "last_frame", dtype: "image", label: "Последний кадр", max: 1 });

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
  if (e.audio) params.push({ key: "generate_audio", label: "Звук", type: "boolean", default: true });
  if (e.seed) params.push({ key: "seed", label: "Seed", type: "seed" });
  return { inputs, params };
}

function imageSpec(e: CatalogEntry): Pick<ModelSpec, "inputs" | "params"> {
  const s: Record<string, CapabilityDescriptor> = e.supported ?? {};
  const inputs: PortSpec[] = [PROMPT_PORT];
  const refMax = s.input_references?.max ?? 0;
  if (refMax > 0) inputs.push({ key: "references", dtype: "image", label: refMax > 1 ? "Референсы" : "Референс", max: refMax });

  const params: ParamSpec[] = [];
  const ar = s.aspect_ratio?.values ?? [];
  if (ar.length) params.push({ key: "aspect_ratio", label: "Формат кадра", type: "enum", options: opts(ar), default: pick(ar, "16:9", "1:1") });
  const res = s.resolution?.values ?? [];
  if (res.length) params.push({ key: "resolution", label: "Разрешение", type: "enum", options: opts(res), default: pick(res, "1K", "2K") });
  const q = s.quality?.values ?? [];
  if (q.length) params.push({ key: "quality", label: "Качество", type: "enum", options: opts(q, QUALITY_LABELS), default: pick(q, "medium", "high") });
  const bg = s.background?.values ?? [];
  if (bg.includes("transparent")) params.push({ key: "background", label: "Фон", type: "enum", options: opts(bg, BACKGROUND_LABELS), default: "auto" });
  if (s.seed) params.push({ key: "seed", label: "Seed", type: "seed" });
  return { inputs, params };
}

function textSpec(e: CatalogEntry): Pick<ModelSpec, "inputs" | "params"> {
  const inputs: PortSpec[] = [PROMPT_PORT];
  if (e.inputModalities?.includes("image")) inputs.push({ key: "images", dtype: "image", label: "Картинки", max: 4 });
  const params: ParamSpec[] = [{
    key: "system", label: "Инструкция", type: "text", default: "",
    placeholder: "Например: «Перепиши как промт для видео, на английском»",
  }];
  return { inputs, params };
}

export const MODELS: ModelSpec[] = CURATED.flatMap((c) => {
  const e = ENTRIES.find((x) => x.id === c.id);
  if (!e) return []; // not synced yet (or delisted): hide instead of offering a broken model
  const shape = e.kind === "video" ? videoSpec(e) : e.kind === "image" ? imageSpec(e) : textSpec(e);
  return [{ id: c.id, kind: c.kind, name: c.name, vendor: c.vendor, blurb: c.blurb, pricing: e.pricing, ...shape }];
});

const BY_ID = new Map(MODELS.map((m) => [m.id, m]));

export function getModel(id: string): ModelSpec | undefined {
  return BY_ID.get(id);
}

export function modelsOfKind(kind: MediaKind): ModelSpec[] {
  return MODELS.filter((m) => m.kind === kind);
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
