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

const enumParam = (key: string, label: string, def: string, options: [string, string][]): ParamSpec =>
  ({ key, label, type: "enum", default: def, options: options.map(([value, l]) => ({ value, label: l })) });
const ASPECT_PARAM = enumParam("aspect", "Формат", "9:16", [["9:16", "9:16"], ["3:4", "3:4"], ["4:5", "4:5"], ["1:1", "1:1"], ["16:9", "16:9"]]);
const FILL_PARAM = enumParam("fill", "Лишнее место", "crop", [["crop", "Обрезать края"], ["blur", "Размытый фон"]]);
const CAPTION_PARAMS: ParamSpec[] = [
  enumParam("position", "Где", "bottom", [["top", "Сверху"], ["center", "По центру"], ["bottom", "Снизу"]]),
  enumParam("size", "Размер", "m", [["s", "Мелкий"], ["m", "Средний"], ["l", "Крупный"]]),
  enumParam("look", "Стиль", "shadow", [["shadow", "Белый с тенью"], ["plate", "На плашке"]]),
];

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
  {
    id: "kaskad/trim", kind: "video", group: "tools", name: "Обрезка видео", vendor: "Каскад",
    blurb: "Кусок ролика: с какой секунды и сколько", featured: false, promptOptional: true,
    caps: { ...NO_CAPS, sourceVideo: true },
    inputs: [{ key: "video", dtype: "video", label: "Видео", max: 1, min: 1 }],
    params: [
      enumParam("start", "Начало", "0", [["0", "с 0 с"], ["0.5", "с 0,5 с"], ["1", "с 1 с"], ["2", "с 2 с"], ["3", "с 3 с"], ["5", "с 5 с"], ["8", "с 8 с"], ["10", "с 10 с"]]),
      enumParam("length", "Длительность", "all", [["all", "до конца"], ["1", "1 с"], ["2", "2 с"], ["3", "3 с"], ["4", "4 с"], ["5", "5 с"], ["8", "8 с"], ["10", "10 с"], ["15", "15 с"]]),
    ],
    pricing: { type: "free" },
  },
  {
    id: "kaskad/speed", kind: "video", group: "tools", name: "Скорость видео", vendor: "Каскад",
    blurb: "Замедлить или ускорить ролик, звук без искажений", featured: false, promptOptional: true,
    caps: { ...NO_CAPS, sourceVideo: true },
    inputs: [{ key: "video", dtype: "video", label: "Видео", max: 1, min: 1 }],
    params: [enumParam("factor", "Скорость", "0.75", [["0.5", "0,5× (вдвое медленнее)"], ["0.75", "0,75×"], ["1.25", "1,25×"], ["1.5", "1,5×"], ["2", "2× (вдвое быстрее)"]])],
    pricing: { type: "free" },
  },
  {
    id: "kaskad/add-audio", kind: "video", group: "tools", name: "Звук на видео", vendor: "Каскад",
    blurb: "Музыка или голос поверх ролика, по длине видео", featured: false, promptOptional: true,
    caps: { ...NO_CAPS, sourceVideo: true },
    inputs: [
      { key: "video", dtype: "video", label: "Видео", max: 1, min: 1 },
      { key: "audio", dtype: "audio", label: "Звук", max: 1, min: 1 },
    ],
    params: [enumParam("mode", "Исходный звук", "replace", [["replace", "Заменить"], ["mix", "Смешать с новым"]])],
    pricing: { type: "free" },
  },
  {
    id: "kaskad/reframe-video", kind: "video", group: "tools", name: "Формат кадра: видео", vendor: "Каскад",
    blurb: "9:16 для Reels, 3:4 и 1:1 для маркетплейсов", featured: false, promptOptional: true,
    caps: { ...NO_CAPS, sourceVideo: true },
    inputs: [{ key: "video", dtype: "video", label: "Видео", max: 1, min: 1 }],
    params: [ASPECT_PARAM, FILL_PARAM],
    pricing: { type: "free" },
  },
  {
    id: "kaskad/reframe-image", kind: "image", group: "tools", name: "Формат кадра: картинка", vendor: "Каскад",
    blurb: "Та же картинка в 9:16, 3:4, 1:1 или 16:9", featured: false, promptOptional: true,
    caps: NO_CAPS,
    inputs: [{ key: "image", dtype: "image", label: "Картинка", max: 1, min: 1 }],
    params: [ASPECT_PARAM, FILL_PARAM],
    pricing: { type: "free" },
  },
  {
    id: "kaskad/marketplace", kind: "image", group: "tools", name: "Под маркетплейс", vendor: "Каскад",
    blurb: "Приводит картинку к правилам WB или Ozon: 3:4, 900×1200, JPG", featured: false, promptOptional: true,
    caps: NO_CAPS,
    inputs: [{ key: "image", dtype: "image", label: "Картинка", max: 1, min: 1 }],
    params: [
      enumParam("market", "Площадка", "wb", [["wb", "Wildberries"], ["ozon", "Ozon"]]),
      enumParam("fill", "Если не 3:4", "blur", [["blur", "Дополнить размытым фоном"], ["crop", "Обрезать края"]]),
    ],
    pricing: { type: "free" },
  },
  {
    id: "kaskad/best-of", kind: "image", group: "tools", name: "Лучший вариант", vendor: "Каскад",
    blurb: "ИИ-арт-директор выбирает лучшую картинку, при нужде перегенерирует", featured: false, promptOptional: true,
    caps: NO_CAPS,
    inputs: [
      { key: "candidates", dtype: "image", label: "Варианты", max: 16, min: 1, hint: "все варианты и пакеты" },
      { key: "prompt", dtype: "text", label: "Критерии", max: 1, min: 0, hint: "что важно" },
    ],
    params: [
      enumParam("threshold", "Если лучший ниже", "off", [["off", "не перегенерировать"], ["6", "6 из 10"], ["7", "7 из 10"], ["8", "8 из 10"]]),
      enumParam("attempts", "Попыток перегенерации", "1", [["1", "1"], ["2", "2"], ["3", "3"]]),
    ],
    // one look by a vision model; each regeneration costs its image model on top
    pricing: { type: "flat", usd: 0.02 },
  },
  {
    id: "kaskad/timeline", kind: "video", group: "tools", name: "Монтаж", vendor: "Каскад",
    blurb: "Таймлайн: порядок, обрезка, затемнения и звук", featured: false, promptOptional: true,
    caps: { ...NO_CAPS, sourceVideo: true },
    inputs: [
      { key: "clips", dtype: "video", label: "Ролики", max: 50, min: 1, hint: "порядок меняется на таймлайне" },
      { key: "audio", dtype: "audio", label: "Звук", max: 1, min: 0, hint: "музыка или голос" },
    ],
    params: [
      enumParam("transition", "Переходы", "cut", [["cut", "Встык"], ["fade", "Через затемнение"]]),
      enumParam("mode", "Звук роликов", "replace", [["replace", "Заменить подключённым"], ["mix", "Смешать"]]),
    ],
    pricing: { type: "free" },
  },
  {
    id: "kaskad/subtitles", kind: "video", group: "tools", name: "Субтитры", vendor: "Каскад",
    blurb: "Распознаёт речь и вшивает субтитры, как в Reels", featured: false, promptOptional: true,
    caps: { ...NO_CAPS, sourceVideo: true },
    inputs: [
      { key: "video", dtype: "video", label: "Видео", max: 1, min: 1 },
      { key: "prompt", dtype: "text", label: "Текст", max: 1, min: 0, hint: "если речи нет" },
    ],
    params: [
      enumParam("look", "Стиль", "reels", [["reels", "Reels: слово подсвечивается"], ["classic", "Классика"]]),
      enumParam("position", "Где", "bottom", [["bottom", "Снизу"], ["center", "По центру"], ["top", "Сверху"]]),
      enumParam("size", "Размер", "m", [["s", "Мелкий"], ["m", "Средний"], ["l", "Крупный"]]),
    ],
    // speech recognition: about a hundredth of a cent per second of sound
    pricing: { type: "flat", usd: 0.001 },
  },
  {
    id: "kaskad/caption-image", kind: "image", group: "tools", name: "Текст на картинку", vendor: "Каскад",
    blurb: "Надпись поверх: заголовок, цена, преимущество", featured: false, promptOptional: false,
    caps: NO_CAPS,
    inputs: [
      { key: "image", dtype: "image", label: "Картинка", max: 1, min: 1 },
      { key: "prompt", dtype: "text", label: "Текст", max: 1, min: 1 },
    ],
    params: CAPTION_PARAMS,
    pricing: { type: "free" },
  },
  {
    id: "kaskad/caption-video", kind: "video", group: "tools", name: "Текст на видео", vendor: "Каскад",
    blurb: "Надпись поверх ролика на всю длину", featured: false, promptOptional: false,
    caps: { ...NO_CAPS, sourceVideo: true },
    inputs: [
      { key: "video", dtype: "video", label: "Видео", max: 1, min: 1 },
      { key: "prompt", dtype: "text", label: "Текст", max: 1, min: 1 },
    ],
    params: CAPTION_PARAMS,
    pricing: { type: "free" },
  },
];

/**
 * Speech (OpenRouter /audio/speech). Not in the synced catalogs yet, so curated here;
 * all verified live with Russian text. Billed per character.
 */
const TEXT_IN: PortSpec = { key: "prompt", dtype: "text", label: "Текст", max: 1, min: 1, hint: "что сказать" };
const SPEECH: ModelSpec[] = [
  {
    id: "minimax/speech-2.8-turbo", kind: "audio", group: "audio", name: "MiniMax Speech 2.8", vendor: "MiniMax",
    blurb: "Живая русская озвучка, 8 голосов", featured: true, promptOptional: false,
    caps: NO_CAPS, inputs: [TEXT_IN],
    params: [enumParam("voice", "Голос", "Russian_ReliableMan", [
      ["Russian_ReliableMan", "Надёжный (муж.)"], ["Russian_AttractiveGuy", "Обаятельный (муж.)"],
      ["Russian_HandsomeChildhoodFriend", "Друг детства (муж.)"], ["Russian_Bad-temperedBoy", "Вспыльчивый (муж.)"],
      ["Russian_BrightHeroine", "Яркая (жен.)"], ["Russian_AmbitiousWoman", "Уверенная (жен.)"],
      ["Russian_CrazyQueen", "Эксцентричная (жен.)"], ["Russian_PessimisticGirl", "Меланхоличная (жен.)"],
    ])],
    pricing: { type: "chars", usdPerChar: 0.00006 },
  },
  {
    id: "x-ai/grok-voice-tts-1.0", kind: "audio", group: "audio", name: "Grok Voice", vendor: "xAI",
    blurb: "Недорогая озвучка, 20+ языков", featured: true, promptOptional: false,
    caps: NO_CAPS, inputs: [TEXT_IN],
    params: [enumParam("voice", "Голос", "eve", [
      ["eve", "Eve (жен.)"], ["ara", "Ara (жен.)"], ["rex", "Rex (муж.)"], ["leo", "Leo (муж.)"], ["sal", "Sal (нейтр.)"],
    ])],
    pricing: { type: "chars", usdPerChar: 0.000015 },
  },
  {
    id: "google/lyria-3-clip-preview", kind: "audio", group: "audio", name: "Lyria 3", vendor: "Google",
    blurb: "Музыка по описанию: трек на 30 секунд", featured: true, promptOptional: false,
    caps: NO_CAPS, inputs: [{ key: "prompt", dtype: "text", label: "Описание музыки", max: 1, min: 1, hint: "жанр, настроение, темп" }],
    params: [], pricing: { type: "flat", usd: 0.04 },
  },
  {
    id: "google/lyria-3-pro-preview", kind: "audio", group: "audio", name: "Lyria 3 Pro", vendor: "Google",
    blurb: "Полноценная песня по описанию", featured: false, promptOptional: false,
    caps: NO_CAPS, inputs: [{ key: "prompt", dtype: "text", label: "Описание музыки", max: 1, min: 1, hint: "жанр, настроение, слова" }],
    params: [], pricing: { type: "flat", usd: 0.08 },
  },
  {
    id: "fish-audio/s2.1-pro", kind: "audio", group: "audio", name: "Голос по образцу", vendor: "Fish Audio",
    blurb: "Говорит голосом из твоей записи: 10–30 секунд чистой речи", featured: true, promptOptional: false,
    caps: NO_CAPS,
    inputs: [TEXT_IN, { key: "voice_sample", dtype: "audio", label: "Образец голоса", max: 1, min: 1, hint: "10–30 с речи" }],
    params: [],
    pricing: { type: "chars", usdPerChar: 0.000015 },
  },
];

/** Audio models that compose music (chat with audio output) rather than read text aloud. */
export const MUSIC_MODELS = new Set(["google/lyria-3-clip-preview", "google/lyria-3-pro-preview"]);

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
  .concat(SPEECH, TOOLS);

const BY_ID = new Map(MODELS.map((m) => [m.id, m]));

export function getModel(id: string): ModelSpec | undefined {
  return BY_ID.get(id);
}

export function modelsOfKind(kind: MediaKind): ModelSpec[] {
  return MODELS.filter((m) => m.kind === kind);
}

/** "google/gemini-3-pro-image" -> "google" */
export const vendorOf = (modelId: string) => modelId.split("/")[0].toLowerCase();

/** Vendors that refuse requests from the server's region (BLOCKED_VENDORS), e.g. Google from Russia. */
export const isBlocked = (modelId: string, blocked: readonly string[]) => blocked.includes(vendorOf(modelId));

/** Default model for a freshly added node of a kind, skipping vendors blocked for this server. */
export function defaultModel(kind: MediaKind, blocked: readonly string[] = []): ModelSpec {
  const usable = modelsOfKind(kind).filter((m) => !isBlocked(m.id, blocked));
  return usable.find((m) => m.group === kind) ?? usable[0] ?? modelsOfKind(kind)[0];
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
