// Model catalog. Video models are refreshed live from OpenRouter /videos/models;
// this bundled copy is the offline fallback (snapshot 2026-09).

const FALLBACK_VIDEO_MODELS = [
  {
    id: "bytedance/seedance-2.5", name: "Seedance 2.5",
    resolutions: ["480p", "720p"],
    aspect_ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"],
    durations: [4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30],
    audio: true,
  },
  {
    id: "bytedance/seedance-2.0", name: "Seedance 2.0",
    resolutions: ["480p", "720p", "1080p", "4K"],
    aspect_ratios: ["1:1", "3:4", "9:16", "4:3", "16:9", "21:9", "9:21"],
    durations: [4,5,6,7,8,9,10,11,12,13,14,15],
    audio: true,
  },
  {
    id: "bytedance/seedance-2.0-fast", name: "Seedance 2.0 Fast",
    resolutions: ["480p", "720p"],
    aspect_ratios: ["1:1", "3:4", "9:16", "4:3", "16:9", "21:9", "9:21"],
    durations: [4,5,6,7,8,9,10,11,12,13,14,15],
    audio: true,
  },
  {
    id: "bytedance/seedance-2.0-mini", name: "Seedance 2.0 Mini",
    resolutions: ["480p", "720p"],
    aspect_ratios: ["1:1", "3:4", "9:16", "4:3", "16:9", "21:9", "9:21"],
    durations: [4,5,6,7,8,9,10,11,12,13,14,15],
    audio: true,
  },
  {
    id: "bytedance/seedance-1-5-pro", name: "Seedance 1.5 Pro",
    resolutions: ["480p", "720p", "1080p"],
    aspect_ratios: ["1:1", "3:4", "9:16", "9:21", "4:3", "16:9", "21:9"],
    durations: [4,5,6,7,8,9,10,11,12],
    audio: true,
  },
];

const IMAGE_MODELS = [
  { id: "google/gemini-3-pro-image", name: "Nano Banana Pro" },
  { id: "google/gemini-3.1-flash-image", name: "Nano Banana 2" },
  { id: "google/gemini-2.5-flash-image", name: "Nano Banana" },
  { id: "openai/gpt-5-image", name: "GPT-5 Image" },
  { id: "openai/gpt-5-image-mini", name: "GPT-5 Image Mini" },
];

const LLM_MODELS = [
  { id: "bytedance-seed/seed-2-1-turbo", name: "Seed 2.1 Turbo" },
  { id: "bytedance-seed/seed-2.0-code", name: "Seed 2.0 Code" },
  { id: "bytedance-seed/seed-2.0-lite", name: "Seed 2.0 Lite" },
  { id: "bytedance-seed/seed-2.0-mini", name: "Seed 2.0 Mini" },
  { id: "bytedance-seed/seed-1.6", name: "Seed 1.6" },
  { id: "bytedance-seed/seed-1.6-flash", name: "Seed 1.6 Flash" },
];

// Node type definitions. dtype colors: text=sky, image=amber, video=rose.
const NODE_TYPES = {
  prompt: {
    title: "Промт", dot: "text",
    desc: "Текст для моделей",
    inputs: [],
    outputs: [{ key: "text", dtype: "text", label: "Текст" }],
  },
  image: {
    title: "Изображение", dot: "image",
    desc: "Загрузка картинки",
    inputs: [],
    outputs: [{ key: "image", dtype: "image", label: "Картинка" }],
  },
  video: {
    title: "Seedance Видео", dot: "video",
    desc: "Семейство Seedance",
    inputs: [
      { key: "prompt", dtype: "text", label: "Промт" },
      { key: "first_frame", dtype: "image", label: "Первый кадр" },
      { key: "last_frame", dtype: "image", label: "Последний кадр" },
    ],
    outputs: [{ key: "video", dtype: "video", label: "Видео" }],
  },
  imagegen: {
    title: "Генерация картинки", dot: "image",
    desc: "Nano Banana, GPT Image",
    inputs: [
      { key: "prompt", dtype: "text", label: "Промт" },
      { key: "reference", dtype: "image", label: "Референс" },
    ],
    outputs: [{ key: "image", dtype: "image", label: "Картинка" }],
  },
  llm: {
    title: "Seed LLM", dot: "text",
    desc: "Текстовые модели ByteDance",
    inputs: [{ key: "prompt", dtype: "text", label: "Промт" }],
    outputs: [{ key: "text", dtype: "text", label: "Ответ" }],
  },
};

const SIDEBAR_ORDER = ["prompt", "image", "video", "imagegen", "llm"];
