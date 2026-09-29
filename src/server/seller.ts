/**
 * Seller kit: a product photo and a few words in, a full set of marketplace slides out.
 * The language model plans the slides (what each one says and shows); the graph is a
 * fixed recipe: photo + slide list → GPT Image 2 → marketplace rules.
 */
import { z } from "zod";
import type { GraphEdge, GraphNode } from "@/lib/graph/types";
import { defaultParams, getModel, reconcileParams } from "@/lib/models/registry";
import type { ParamValue } from "@/lib/models/types";
import { getProvider, providerMode, ProviderError } from "./providers";

export const sellerRequest = z.object({
  product: z.string().trim().min(3).max(2000),
  photoKey: z.string().min(1).max(300),
  marketplace: z.enum(["wb", "ozon"]),
  slides: z.union([z.literal(5), z.literal(7), z.literal(10)]),
  style: z.string().max(300).default(""),
});
export type SellerRequest = z.infer<typeof sellerRequest>;

const PLAN_MODEL = "anthropic/claude-sonnet-5";
const plan = z.object({
  title: z.string().max(80).catch("Карточки товара"),
  slides: z.array(z.object({ prompt: z.string().max(2000) })).min(1).max(10),
});

function system(req: SellerRequest): string {
  return `You plan product card slides for ${req.marketplace === "wb" ? "Wildberries" : "Ozon"} (Russian marketplace), portrait 3:4.
Reply with ONE JSON object only: {"title": string, "slides": [{"prompt": string}]}.
Exactly ${req.slides} slides, in this order: 1) cover with the product large and a short strong headline; then benefits (one per slide),
materials or composition, size or dimensions, how to use or in-use scene, and a final slide with a summary of benefits.
Each "prompt" is an image-generation prompt in Russian that: keeps the product exactly as in the reference photo;
describes background, lighting, composition and graphic elements; and contains the exact Russian text to render in quotes
(a headline up to 4 words and at most 3 short bullet points). Consistent visual style across all slides${req.style ? `: ${req.style}` : ""}.
No prices, no discounts, no marketplace logos, no claims like "лучший" or "№1".`;
}

export async function planCards(req: SellerRequest) {
  let slides: string[];
  let title = "Карточки товара";
  let costUsd: number | null = 0;
  if (providerMode() === "mock") {
    slides = Array.from({ length: req.slides }, (_, i) => `Слайд ${i + 1} карточки: ${req.product}. Заголовок "Слайд ${i + 1}"`);
  } else {
    const r = await getProvider().text({ model: PLAN_MODEL, system: system(req), prompt: req.product, images: [] });
    costUsd = r.costUsd;
    let raw: unknown = null;
    try { raw = JSON.parse(r.text.slice(r.text.indexOf("{"), r.text.lastIndexOf("}") + 1)); } catch { /* below */ }
    const p = plan.safeParse(raw);
    if (!p.success) throw new ProviderError("Не получилось спланировать слайды. Опиши товар подробнее.");
    title = p.data.title;
    slides = p.data.slides.map((s) => s.prompt.replace(/\n/g, " ")).slice(0, req.slides);
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const at = (col: number, y: number) => ({ x: col * 440, y });
  const model = (id: string, col: number, modelId: string, params: Record<string, ParamValue>) => {
    const spec = getModel(modelId)!;
    nodes.push({ id, type: "model", position: at(col, 0), data: {
      kind: spec.kind, modelId, prompt: "", params: reconcileParams(spec, { ...defaultParams(spec), ...params }),
    } });
  };
  nodes.push({ id: "s-note", type: "note", position: at(1, -190), data: {
    text: `${slides.length} слайдов для ${req.marketplace === "wb" ? "WB" : "Ozon"}. Поправь тексты в списке, если нужно, и запусти последнюю ноду. Всё скачивается одним архивом.`,
    color: "yellow",
  } });
  nodes.push({ id: "s-photo", type: "image", position: at(0, 0), data: { fileKey: req.photoKey, name: "Фото товара", kind: "image" } });
  nodes.push({ id: "s-slides", type: "list", position: at(0, 340), data: { kind: "text", text: slides.join("\n") } });
  model("s-card", 1, "openai/gpt-image-2", { aspect_ratio: "3:4", quality: "medium", n: "1" });
  model("s-fit", 2, "kaskad/marketplace", { market: req.marketplace, fill: "blur" });
  edges.push(
    { id: "s1", source: "s-photo", sourceHandle: "image", target: "s-card", targetHandle: "references" },
    { id: "s2", source: "s-slides", sourceHandle: "text", target: "s-card", targetHandle: "prompt" },
    { id: "s3", source: "s-card", sourceHandle: "image", target: "s-fit", targetHandle: "image" },
  );
  return {
    title, nodes, edges, fixes: [] as string[], costUsd,
    summary: `${slides.length} слайдов в едином стиле по твоему фото, сразу в формате ${req.marketplace === "wb" ? "Wildberries" : "Ozon"} 900×1200.`,
  };
}
