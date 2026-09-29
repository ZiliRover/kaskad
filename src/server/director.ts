/**
 * Director: an idea in, a whole video pipeline out. The language model writes the script
 * (scenes, narration, music); the graph itself is built here from a fixed recipe, so it
 * always runs: scene frames → scene videos → montage → voice and music → subtitles.
 */
import { z } from "zod";
import type { GraphEdge, GraphNode } from "@/lib/graph/types";
import { defaultParams, getModel, isBlocked, reconcileParams } from "@/lib/models/registry";
import type { ParamValue } from "@/lib/models/types";
import { getProvider, providerMode, ProviderError } from "./providers";

export const directorRequest = z.object({
  idea: z.string().trim().min(3).max(2000),
  seconds: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  aspect: z.enum(["9:16", "16:9", "1:1"]),
  voice: z.string().max(80).nullable(),
  subtitles: z.boolean(),
  music: z.boolean(),
  quality: z.enum(["draft", "final"]),
});
export type DirectorRequest = z.infer<typeof directorRequest>;

const SCENE_SECONDS = 5;
const SCRIPT_MODEL = "anthropic/claude-sonnet-5";

const script = z.object({
  title: z.string().max(80).catch("Ролик"),
  narration: z.string().max(3000).catch(""),
  music: z.string().max(400).catch(""),
  scenes: z.array(z.object({ image: z.string().max(1500), motion: z.string().max(800) })).min(1).max(12),
});
type Script = z.infer<typeof script>;

function system(req: DirectorRequest, scenes: number): string {
  const words = Math.round(req.seconds * 2.3);
  return `You are a director of short videos. Write a script as ONE JSON object and nothing else:
{"title": string, "narration": string, "music": string, "scenes": [{"image": string, "motion": string}]}
- Exactly ${scenes} scenes of ${SCENE_SECONDS} seconds, frame ${req.aspect}. They tell one story with a clear start and finish.
- "image": a detailed prompt for the first frame of the scene: subject, setting, light, lens, colour. Keep the same characters, product and visual style in every scene, repeating their description word for word. No real, recognisable people.
- "motion": what moves in the scene and how the camera moves, one or two sentences.
- "narration": voice-over for the whole video, about ${words} words, natural spoken language${req.voice ? "" : " (it will be shown as subtitles, not spoken)"}.
- "music": ${req.music ? "a short description of background music: genre, mood, tempo, no vocals" : "an empty string"}.
- title: 2-5 words. Write everything in the language of the idea.`;
}

function mockScript(req: DirectorRequest, scenes: number): Script {
  return {
    title: "Тестовый ролик",
    narration: `Тестовый режим: сценарий не пишется моделью. ${req.idea}`,
    music: req.music ? "Спокойная электронная музыка без слов" : "",
    scenes: Array.from({ length: scenes }, (_, i) => ({
      image: `${req.idea}. Сцена ${i + 1}, кинематографичный кадр`,
      motion: "Камера плавно движется вперёд",
    })),
  };
}

async function writeScript(req: DirectorRequest, scenes: number): Promise<{ script: Script; costUsd: number | null }> {
  if (providerMode() === "mock") return { script: mockScript(req, scenes), costUsd: 0 };
  const r = await getProvider().text({ model: SCRIPT_MODEL, system: system(req, scenes), prompt: req.idea, images: [] });
  const start = r.text.indexOf("{"), end = r.text.lastIndexOf("}");
  let raw: unknown = null;
  try { raw = JSON.parse(r.text.slice(start, end + 1)); } catch { /* handled below */ }
  const parsed = script.safeParse(raw);
  if (!parsed.success) throw new ProviderError("Не получилось написать сценарий. Попробуй сформулировать идею иначе.");
  // the video recipe needs a fixed number of scenes
  const s = parsed.data;
  while (s.scenes.length < scenes) s.scenes.push(s.scenes[s.scenes.length - 1]);
  s.scenes = s.scenes.slice(0, scenes);
  return { script: s, costUsd: r.costUsd };
}

export async function direct(req: DirectorRequest, blocked: string[]) {
  const scenes = req.seconds / SCENE_SECONDS;
  const { script: sc, costUsd } = await writeScript(req, scenes);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const fixes: string[] = [];
  const at = (col: number, y: number) => ({ x: col * 440, y });
  const wire = (source: string, sourceHandle: string, target: string, targetHandle: string) =>
    edges.push({ id: `${source}-${target}-${targetHandle}`, source, sourceHandle, target, targetHandle });
  const model = (id: string, col: number, y: number, modelId: string, params: Record<string, ParamValue> = {}) => {
    const spec = getModel(modelId)!;
    nodes.push({ id, type: "model", position: at(col, y), data: {
      kind: spec.kind, modelId, prompt: "", params: reconcileParams(spec, { ...defaultParams(spec), ...params }),
    } });
  };

  const final = req.quality === "final";
  const imageModel = "openai/gpt-image-2";
  const videoModel = final ? "bytedance/seedance-2.0" : "bytedance/seedance-2.0-fast";

  nodes.push({ id: "d-note", type: "note", position: at(0, -200), data: {
    text: `${sc.title}. ${scenes} сцен по ${SCENE_SECONDS} с. ${final ? "Финальное качество." : "Черновик: дёшево и быстро, для финала переключи модели на лучшие."} Порядок и обрезку сцен меняй в «Монтаже».`,
    color: "blue",
  } });
  nodes.push({ id: "d-frames", type: "list", position: at(0, 0), data: { kind: "text", text: sc.scenes.map((s) => s.image.replace(/\n/g, " ")).join("\n") } });
  nodes.push({ id: "d-motion", type: "list", position: at(0, 380), data: { kind: "text", text: sc.scenes.map((s) => s.motion.replace(/\n/g, " ")).join("\n") } });
  model("d-image", 1, 0, imageModel, { aspect_ratio: req.aspect, quality: final ? "medium" : "low", n: "1" });
  model("d-video", 2, 0, videoModel, {
    aspect_ratio: req.aspect, resolution: final ? "720p" : "480p", duration: SCENE_SECONDS, generate_audio: false,
  });
  model("d-cut", 3, 0, "kaskad/timeline", { transition: "fade", mode: "replace" });
  wire("d-frames", "text", "d-image", "prompt");
  wire("d-image", "image", "d-video", "first_frame");
  wire("d-motion", "text", "d-video", "prompt");
  wire("d-video", "video", "d-cut", "clips");

  let last = "d-cut";
  let col = 4;
  if (req.voice && sc.narration) {
    nodes.push({ id: "d-voice-text", type: "prompt", position: at(1, 1080), data: { text: sc.narration } });
    model("d-voice", 2, 1080, "minimax/speech-2.8-turbo", { voice: req.voice });
    wire("d-voice-text", "text", "d-voice", "prompt");
    wire("d-voice", "audio", "d-cut", "audio");
  }
  const musicModel = "google/lyria-3-clip-preview";
  if (req.music && sc.music) {
    if (isBlocked(musicModel, blocked)) fixes.push("Музыка (Lyria от Google) недоступна в регионе сервера: узел добавлен, но не запустится");
    nodes.push({ id: "d-music-text", type: "prompt", position: at(1, 1400), data: { text: sc.music } });
    model("d-music", 2, 1400, musicModel);
    wire("d-music-text", "text", "d-music", "prompt");
    if (req.voice) {
      model("d-mix", col, 0, "kaskad/add-audio", { mode: "mix" });
      wire(last, "video", "d-mix", "video");
      wire("d-music", "audio", "d-mix", "audio");
      last = "d-mix";
      col++;
    } else {
      wire("d-music", "audio", "d-cut", "audio");
    }
  }
  if (req.subtitles && sc.narration) {
    model("d-subs", col, 0, "kaskad/subtitles", { look: "reels", position: req.aspect === "9:16" ? "center" : "bottom", size: "m" });
    wire(last, "video", "d-subs", "video");
    if (!req.voice) {
      // nothing is spoken: the narration text is timed over the video instead
      nodes.push({ id: "d-subs-text", type: "prompt", position: at(col - 1, 900), data: { text: sc.narration } });
      wire("d-subs-text", "text", "d-subs", "prompt");
    }
  }

  return {
    title: sc.title,
    summary: `${scenes} сцен по ${SCENE_SECONDS} секунд, ${req.aspect}${req.voice ? ", голос за кадром" : ""}${req.music ? ", музыка" : ""}${req.subtitles ? ", субтитры" : ""}. Запусти «Монтаж» или последнюю ноду, и вся цепочка соберётся.`,
    nodes, edges, fixes, costUsd,
  };
}
