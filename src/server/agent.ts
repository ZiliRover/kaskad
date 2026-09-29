/**
 * Graph agent: a sentence in, a ready chain of nodes out. The language model only
 * proposes; everything it returns is checked against the registry (models, ports,
 * data types, settings) and laid out here, so the canvas never gets a broken graph.
 */
import { z } from "zod";
import { LIST_MAX, outputHandle, type GraphEdge, type GraphNode } from "@/lib/graph/types";
import { MODELS, TOOL_PREFIX, defaultParams, getModel, isBlocked, reconcileParams } from "@/lib/models/registry";
import type { ModelSpec, ParamValue } from "@/lib/models/types";
import { getProvider, providerMode, ProviderError } from "./providers";

const AGENT_MODEL = "anthropic/claude-sonnet-5";
const MAX_NODES = 14;

function describe(m: ModelSpec): string {
  const inputs = m.inputs.map((p) => `${p.key}:${p.dtype}(${p.min}-${p.max})`).join(", ");
  const params = m.params
    .filter((p) => p.type === "enum" || p.type === "boolean")
    .map((p) => (p.type === "enum" ? `${p.key}=[${p.options.map((o) => o.value).join("|")}]` : `${p.key}=true|false`))
    .join("; ");
  return `- ${m.id} | makes ${m.kind} | ${m.name}${m.blurb ? `: ${m.blurb}` : ""} | inputs: ${inputs || "none"}${params ? ` | params: ${params}` : ""}`;
}

function catalog(blocked: string[]): string {
  const usable = MODELS.filter((m) => !isBlocked(m.id, blocked) && (m.featured || m.id.startsWith(TOOL_PREFIX)));
  return usable.map(describe).join("\n");
}

function system(blocked: string[]): string {
  return `You design node graphs for Kaskad, a node-based studio for AI images and video.
Reply with ONE JSON object and nothing else:
{"title": string, "summary": string, "nodes": Node[], "edges": Edge[]}
Node is one of:
{"id": "a", "type": "prompt", "text": string}            a text prompt; its output type is text
{"id": "b", "type": "upload", "kind": "image"|"video"|"audio"}   a file the user uploads later
{"id": "c", "type": "list", "kind": "text", "text": "line1\\nline2"}  batch: the connected model runs once per line
{"id": "d", "type": "list", "kind": "image"}             batch of files the user adds later
{"id": "e", "type": "model", "model": "<model id>", "params": {"key": "value"}}
{"id": "f", "type": "note", "text": string}              a short instruction for the user, only when useful
Edge: {"from": "<node id>", "to": "<model node id>", "port": "<input key of that model>"}
An edge is valid only if the source's output type equals the port type (model output type = what it makes).

Available models and tools (tools are free, run locally):
${catalog(blocked)}

Rules:
- Build exactly what the user asked, with the fewest nodes that do it well (max ${MAX_NODES}).
- Every model whose prompt port is required needs a prompt node (or a text model) wired to "prompt".
- Write prompt texts yourself, specific and vivid, in the user's language. For video prompts describe motion and camera.
- When the user will bring their own photo or video, add an upload node and a short note telling them to add it.
- Use a list node only when the user asks for many items or variants of a batch.
- Prefer good value: Seedance 2.0 Fast at 480p for drafts, better models when the user asks for quality.
- Only set params that exist for that model, with listed values. Match aspect ratios across the chain.
- For long videos chain scenes with kaskad/last-frame and join them with kaskad/concat.
- title: 2-5 words in the user's language. summary: one or two plain sentences on what the graph does.`;
}

const proposal = z.object({
  title: z.string().max(80).catch("Новый граф"),
  summary: z.string().max(600).catch(""),
  nodes: z.array(z.object({
    // clip rather than refuse: a long prompt or id should not throw away the whole plan
    id: z.string().min(1).transform((v) => v.slice(0, 40)),
    type: z.enum(["prompt", "upload", "list", "model", "note"]),
    text: z.string().transform((v) => v.slice(0, 8000)).optional(),
    kind: z.enum(["image", "video", "audio", "text"]).optional(),
    model: z.string().max(200).optional(),
    params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  })).min(1).max(200).transform((a) => a.slice(0, 40)),
  edges: z.array(z.object({ from: z.string(), to: z.string(), port: z.string() })).max(400).default([]).transform((a) => a.slice(0, 80)),
});

export interface AgentResult {
  title: string;
  summary: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** what was dropped or fixed while checking the proposal */
  fixes: string[];
}

/** First {...} block of the reply; models sometimes wrap JSON in prose or fences. */
function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new ProviderError("Агент ответил не графом. Попробуй сформулировать иначе.");
  try { return JSON.parse(text.slice(start, end + 1)); } catch {
    throw new ProviderError("Агент ответил не графом. Попробуй сформулировать иначе.");
  }
}

const HEIGHT: Record<GraphNode["type"], number> = { prompt: 230, image: 300, list: 320, model: 560, note: 170, group: 200 };

/** Columns by depth (longest path from a source), stacked top to bottom. */
function layout(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
  const depth = new Map<string, number>();
  const into = (id: string) => edges.filter((e) => e.target === id).map((e) => e.source);
  const d = (id: string, seen = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const v = Math.max(-1, ...into(id).map((s) => d(s, seen))) + 1;
    depth.set(id, v);
    return v;
  };
  // notes sit above the node they explain: next to the first model
  for (const n of nodes) d(n.id);
  const columns = new Map<number, GraphNode[]>();
  for (const n of nodes) {
    const c = n.type === "note" ? 1 : depth.get(n.id) ?? 0;
    columns.set(c, [...(columns.get(c) ?? []), n]);
  }
  const out: GraphNode[] = [];
  for (const [c, col] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    let y = 0;
    for (const n of col.sort((a, b) => (a.type === "note" ? -1 : b.type === "note" ? 1 : 0))) {
      out.push({ ...n, position: { x: c * 440, y } } as GraphNode);
      y += HEIGHT[n.type] + 40;
    }
  }
  return out;
}

/** Turn the model's proposal into a valid graph fragment. */
export function materialize(raw: unknown, blocked: string[]): AgentResult {
  const parsed = proposal.safeParse(raw);
  if (!parsed.success) throw new ProviderError("Агент ответил не графом. Попробуй сформулировать иначе.");
  const p = parsed.data;
  const fixes: string[] = [];
  const nodes: GraphNode[] = [];
  const ids = new Set<string>();

  for (const n of p.nodes.slice(0, MAX_NODES)) {
    const id = `a-${n.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 30) || nodes.length}`;
    if (ids.has(id)) continue;
    const position = { x: 0, y: 0 };
    if (n.type === "prompt") nodes.push({ id, type: "prompt", position, data: { text: (n.text ?? "").slice(0, 8000) } });
    else if (n.type === "note") nodes.push({ id, type: "note", position, data: { text: n.text ?? "", color: "yellow" } });
    else if (n.type === "upload") {
      const kind = n.kind === "video" || n.kind === "audio" ? n.kind : "image";
      nodes.push({ id, type: "image", position, data: { fileKey: null, name: "", kind } });
    } else if (n.type === "list") {
      nodes.push(n.kind === "text" || (!n.kind && n.text)
        ? { id, type: "list", position, data: { kind: "text", text: (n.text ?? "").split("\n").slice(0, LIST_MAX).join("\n") } }
        : { id, type: "list", position, data: { kind: n.kind === "video" || n.kind === "audio" ? n.kind : "image", files: [] } });
    } else {
      const spec = n.model ? getModel(n.model) : undefined;
      if (!spec) { fixes.push(`Убрана неизвестная модель ${n.model ?? ""}`.trim()); continue; }
      if (isBlocked(spec.id, blocked)) { fixes.push(`${spec.name} недоступна в регионе сервера, убрана`); continue; }
      const params = reconcileParams(spec, { ...defaultParams(spec), ...(n.params as Record<string, ParamValue> | undefined) });
      nodes.push({ id, type: "model", position, data: { kind: spec.kind, modelId: spec.id, prompt: "", params } });
    }
    ids.add(id);
  }
  if (!nodes.some((n) => n.type === "model")) throw new ProviderError("Агент не подобрал ни одной модели. Попробуй описать задачу подробнее.");

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const key = (raw: string) => `a-${raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 30)}`;
  const edges: GraphEdge[] = [];
  for (const e of p.edges) {
    const src = byId.get(key(e.from)), dst = byId.get(key(e.to));
    if (!src || !dst || dst.type !== "model") continue;
    const port = getModel(dst.data.modelId)?.inputs.find((x) => x.key === e.port);
    const dtype = outputHandle(src);
    if (!port || !dtype || dtype !== port.dtype) { fixes.push(`Связь ${e.from} → ${e.to} (${e.port}) не подходит по типу, убрана`); continue; }
    if (edges.filter((x) => x.target === dst.id && x.targetHandle === port.key).length >= port.max) continue;
    if (edges.some((x) => x.source === src.id && x.target === dst.id && x.targetHandle === port.key)) continue;
    edges.push({ id: `${src.id}-${dst.id}-${port.key}`, source: src.id, sourceHandle: dtype, target: dst.id, targetHandle: port.key });
  }

  return { title: p.title, summary: p.summary, nodes: layout(nodes, edges), edges, fixes };
}

/** Test mode makes no API calls: a typical chain matching the request's words. */
function mockProposal(request: string) {
  const video = /видео|ролик|клип|анимац|video/i.test(request);
  return {
    title: video ? "Кадр и видео" : "Картинка по описанию",
    summary: "Тестовый режим: агент не вызывается, это типовая цепочка. В рабочем режиме граф соберётся под задачу.",
    nodes: [
      { id: "p", type: "prompt", text: request },
      { id: "img", type: "model", model: "openai/gpt-image-2" },
      ...(video ? [{ id: "m", type: "prompt", text: "Камера плавно движется вперёд" }, { id: "v", type: "model", model: "bytedance/seedance-2.0-fast", params: { resolution: "480p" } }] : []),
    ],
    edges: [
      { from: "p", to: "img", port: "prompt" },
      ...(video ? [{ from: "img", to: "v", port: "first_frame" }, { from: "m", to: "v", port: "prompt" }] : []),
    ],
  };
}

export async function buildGraph(request: string, blocked: string[]): Promise<AgentResult & { costUsd: number | null }> {
  if (providerMode() === "mock") return { ...materialize(mockProposal(request), blocked), costUsd: 0 };
  const r = await getProvider().text({ model: AGENT_MODEL, system: system(blocked), prompt: request, images: [] });
  return { ...materialize(extractJson(r.text), blocked), costUsd: r.costUsd };
}
