/**
 * What OpenRouter's catalogs can't tell us. Every video and image model from the
 * catalogs is offered automatically (`npm run models:sync`); this file adds:
 * - Russian names/blurbs for the models we feature (shown first, in this order)
 * - input capabilities the video catalog doesn't expose (reference assets, source video)
 * - models we hide (duplicates, or inputs we haven't wired correctly yet)
 */
import type { MediaKind } from "./types";

export interface Override {
  name?: string;
  blurb?: string;
  hidden?: true;
  /**
   * Reference assets via `input_references`. OpenRouter documents image refs for models whose
   * description says so; video/audio refs only for Seedance 2+. Max counts aren't published:
   * Seedance values follow BytePlus docs (9 images, 3 videos, 3 audio), others are conservative.
   */
  refs?: { image?: number; video?: number; audio?: number };
  /** edit/upscale models: take one existing video as input */
  sourceVideo?: true;
  /** the prompt can be omitted (e.g. plain upscale) */
  promptOptional?: true;
}

export const FEATURED: { id: string; kind: MediaKind }[] = [
  { id: "bytedance/seedance-2.0", kind: "video" },
  { id: "bytedance/seedance-2.0-fast", kind: "video" },
  { id: "bytedance/seedance-2.5", kind: "video" },
  { id: "google/veo-3.1", kind: "video" },
  { id: "google/veo-3.1-fast", kind: "video" },
  { id: "kwaivgi/kling-v3.0-pro", kind: "video" },
  { id: "minimax/hailuo-3", kind: "video" },
  { id: "alibaba/wan-3.0", kind: "video" },
  { id: "openai/sora-2-pro", kind: "video" },
  { id: "google/gemini-3-pro-image", kind: "image" },
  { id: "google/gemini-3.1-flash-image", kind: "image" },
  { id: "openai/gpt-image-2", kind: "image" },
  { id: "bytedance-seed/seedream-5-0-pro", kind: "image" },
  { id: "black-forest-labs/flux.2-pro", kind: "image" },
  { id: "qwen/qwen-image-3", kind: "image" },
  { id: "recraft/recraft-v4.1", kind: "image" },
  { id: "google/gemini-3.8-flash", kind: "text" },
  { id: "anthropic/claude-sonnet-5", kind: "text" },
  { id: "deepseek/deepseek-v4.1-flash", kind: "text" },
];

const SEEDANCE_REFS = { image: 9, video: 3, audio: 3 };

export const OVERRIDES: Record<string, Override> = {
  // ---- video
  "bytedance/seedance-2.0": { name: "Seedance 2.0", blurb: "Консистентность персонажей, референсы, до 4K", refs: SEEDANCE_REFS },
  "bytedance/seedance-2.0-fast": { name: "Seedance 2.0 Fast", blurb: "Быстрее и дешевле, до 720p", refs: SEEDANCE_REFS },
  "bytedance/seedance-2.0-mini": { name: "Seedance 2.0 Mini", blurb: "Самый дешёвый Seedance с референсами", refs: SEEDANCE_REFS },
  "bytedance/seedance-2.5": { name: "Seedance 2.5", blurb: "Длинные ролики до 30 секунд, референсы", refs: SEEDANCE_REFS },
  "bytedance/seedance-1-5-pro": { name: "Seedance 1.5 Pro", blurb: "Видео и звук одним проходом" },
  "google/veo-3.1": { name: "Veo 3.1", blurb: "Кинематографичное качество со звуком" },
  "google/veo-3.1-fast": { name: "Veo 3.1 Fast", blurb: "Veo подешевле для черновиков" },
  "google/veo-3.1-lite": { name: "Veo 3.1 Lite", blurb: "Самый доступный Veo" },
  "kwaivgi/kling-v3.0-pro": { name: "Kling 3.0 Pro", blurb: "Точная физика и движение" },
  "kwaivgi/kling-v3.0-std": { name: "Kling 3.0 Standard", blurb: "Kling подешевле" },
  "kwaivgi/kling-video-o1": { name: "Kling O1", blurb: "Кинематографичные сцены" },
  "minimax/hailuo-3": { name: "Hailuo 3", blurb: "Выразительная динамика, 2K", refs: { image: 3 } },
  "minimax/hailuo-3-max": { name: "Hailuo 3 Max", blurb: "Быстрый Hailuo" },
  "minimax/hailuo-2.3": { name: "Hailuo 2.3", blurb: "1080p, 6 или 10 секунд" },
  "alibaba/wan-3.0": { name: "Wan 3.0", blurb: "Доступная цена за секунду, до 30 секунд", refs: { image: 3 } },
  "alibaba/wan-3.0-prime": { name: "Wan 3.0 Prime", blurb: "Быстрый режим Wan 3.0" },
  "alibaba/wan-2.7": { name: "Wan 2.7", blurb: "Стиль и содержание по референсам", refs: { image: 3 } },
  "alibaba/wan-2.6": { name: "Wan 2.6" },
  "alibaba/happyhorse-1.1": { name: "HappyHorse 1.1", refs: { image: 3 } },
  "alibaba/happyhorse-1.0": { name: "HappyHorse 1.0", refs: { image: 3 } },
  "x-ai/grok-imagine-video": { name: "Grok Imagine Video", refs: { image: 3 } },
  "x-ai/grok-imagine-video-1.5": { name: "Grok Imagine Video 1.5" },
  "openai/sora-2-pro": { name: "Sora 2 Pro", blurb: "Только из текста, до 20 секунд" },
  "runway/gen-4.5": { name: "Runway Gen-4.5", blurb: "Кинематографичное движение" },
  "black-forest-labs/flux-3-video": { name: "FLUX.3 Video", blurb: "Ключевые кадры в начале и конце" },
  "runway/aleph-2": { name: "Runway Aleph 2", blurb: "Правка готового видео текстом", sourceVideo: true },
  "black-forest-labs/flux-video-edit": { name: "FLUX Video Edit", blurb: "Добавить, убрать или заменить объект в видео", sourceVideo: true },
  "black-forest-labs/flux-video-upscale": {
    name: "FLUX Video Upscale", blurb: "Увеличение разрешения видео в 1,5 до 3 раз", sourceVideo: true, promptOptional: true,
  },
  // talking-head avatar: needs a voice/script contract we haven't wired yet
  "heygen/avatar-iv": { hidden: true },

  // ---- image
  "google/gemini-3-pro-image": { name: "Nano Banana Pro", blurb: "Лучшая работа с референсами и текстом на картинке" },
  "google/gemini-3.1-flash-image": { name: "Nano Banana 2", blurb: "Быстрая и недорогая, до 4K" },
  "google/gemini-3.1-flash-lite-image": { name: "Nano Banana 2 Lite", blurb: "Самая дешёвая Nano Banana" },
  "google/gemini-2.5-flash-image": { name: "Nano Banana", blurb: "Первая Nano Banana" },
  "openai/gpt-image-2": { name: "GPT Image 2", blurb: "Точное следование промту" },
  "bytedance-seed/seedream-5-0-pro": { name: "Seedream 5.0 Pro", blurb: "Фотореализм, до 14 референсов" },
  "bytedance-seed/seedream-5-0-lite": { name: "Seedream 5.0 Lite", blurb: "До 4 вариантов за раз" },
  "black-forest-labs/flux.2-pro": { name: "FLUX.2 Pro", blurb: "Детализация и стиль" },
  "qwen/qwen-image-3": { name: "Qwen Image 3", blurb: "Недорогая универсальная модель" },
  "recraft/recraft-v4.1": { name: "Recraft V4.1", blurb: "Иллюстрации и дизайн" },
  // preview aliases of released models
  "google/gemini-3-pro-image-preview": { hidden: true },
  "google/gemini-3.1-flash-image-preview": { hidden: true },

  // ---- text
  "google/gemini-3.8-flash": { name: "Gemini 3.8 Flash", blurb: "Быстрая, понимает картинки" },
  "anthropic/claude-sonnet-5": { name: "Claude Sonnet 5", blurb: "Лучшая для сценариев и раскадровок" },
  "deepseek/deepseek-v4.1-flash": { name: "DeepSeek V4.1 Flash", blurb: "Почти бесплатная" },
};

/** Text models aren't auto-listed (hundreds exist): only these are offered. */
export const TEXT_MODELS = FEATURED.filter((f) => f.kind === "text").map((f) => f.id);
