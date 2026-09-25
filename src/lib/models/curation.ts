/**
 * Hand-picked models shown in the product, in display order.
 * Everything technical (params, limits, prices) is synced from OpenRouter
 * by `npm run models:sync`; this file only decides WHAT we offer and HOW we name it.
 */
import type { MediaKind } from "./types";

export interface CuratedModel {
  id: string;         // OpenRouter slug
  kind: MediaKind;
  name: string;
  vendor: string;
  blurb: string;      // one line, shown under the model picker
}

export const CURATED: CuratedModel[] = [
  // ---- video
  { id: "bytedance/seedance-2.0", kind: "video", name: "Seedance 2.0", vendor: "ByteDance", blurb: "Сильная консистентность персонажей, до 4K" },
  { id: "bytedance/seedance-2.0-fast", kind: "video", name: "Seedance 2.0 Fast", vendor: "ByteDance", blurb: "Быстрее и дешевле, до 720p" },
  { id: "bytedance/seedance-2.5", kind: "video", name: "Seedance 2.5", vendor: "ByteDance", blurb: "Длинные ролики до 30 секунд" },
  { id: "google/veo-3.1", kind: "video", name: "Veo 3.1", vendor: "Google", blurb: "Кинематографичное качество со звуком" },
  { id: "google/veo-3.1-fast", kind: "video", name: "Veo 3.1 Fast", vendor: "Google", blurb: "Veo подешевле для черновиков" },
  { id: "kwaivgi/kling-v3.0-pro", kind: "video", name: "Kling 3.0 Pro", vendor: "Kling", blurb: "Точная физика и движение" },
  { id: "minimax/hailuo-3", kind: "video", name: "Hailuo 3", vendor: "MiniMax", blurb: "Выразительная динамика, 2K" },
  { id: "alibaba/wan-3.0", kind: "video", name: "Wan 3.0", vendor: "Alibaba", blurb: "Самая доступная цена за секунду" },
  { id: "openai/sora-2-pro", kind: "video", name: "Sora 2 Pro", vendor: "OpenAI", blurb: "Только из текста, до 20 секунд" },

  // ---- image
  { id: "google/gemini-3-pro-image", kind: "image", name: "Nano Banana Pro", vendor: "Google", blurb: "Лучшая работа с референсами и текстом на картинке" },
  { id: "google/gemini-3.1-flash-image", kind: "image", name: "Nano Banana 2", vendor: "Google", blurb: "Быстрая и недорогая, до 4K" },
  { id: "openai/gpt-image-2", kind: "image", name: "GPT Image 2", vendor: "OpenAI", blurb: "Точное следование промту" },
  { id: "bytedance-seed/seedream-5-0-pro", kind: "image", name: "Seedream 5.0 Pro", vendor: "ByteDance", blurb: "Фотореализм, до 14 референсов" },
  { id: "black-forest-labs/flux.2-pro", kind: "image", name: "FLUX.2 Pro", vendor: "Black Forest Labs", blurb: "Детализация и стиль" },
  { id: "qwen/qwen-image-3", kind: "image", name: "Qwen Image 3", vendor: "Alibaba", blurb: "Недорогая универсальная модель" },
  { id: "recraft/recraft-v4.1", kind: "image", name: "Recraft V4.1", vendor: "Recraft", blurb: "Иллюстрации и дизайн" },

  // ---- text (prompt writing, image description, translation)
  { id: "google/gemini-3.8-flash", kind: "text", name: "Gemini 3.8 Flash", vendor: "Google", blurb: "Быстрая, понимает картинки" },
  { id: "anthropic/claude-sonnet-5", kind: "text", name: "Claude Sonnet 5", vendor: "Anthropic", blurb: "Лучшая для сложных сценариев и раскадровок" },
  { id: "deepseek/deepseek-v4.1-flash", kind: "text", name: "DeepSeek V4.1 Flash", vendor: "DeepSeek", blurb: "Почти бесплатная" },
];
