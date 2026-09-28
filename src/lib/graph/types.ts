import { z } from "zod";
import type { DType } from "../models/types";

/**
 * Canvas document. Stored as JSON in `graphs.doc`, validated on every write.
 * Results are NOT stored here: they live in `outputs`, so a stale autosave
 * from the browser can never wipe a finished generation.
 */

const paramValue = z.union([z.string().max(4000), z.number(), z.boolean()]);

export const promptData = z.object({ text: z.string().max(20000) });
/** An uploaded file. Historically images only, so `kind` defaults to image. */
export const imageData = z.object({
  fileKey: z.string().max(300).nullable(),
  name: z.string().max(300),
  kind: z.enum(["image", "video", "audio"]).optional(),
});
export const modelData = z.object({
  kind: z.enum(["text", "image", "video", "audio"]),
  modelId: z.string().max(200),
  prompt: z.string().max(20000),
  params: z.record(z.string(), paramValue),
  /** result chosen to pass downstream; unset = the latest one */
  pinnedOutputId: z.string().uuid().optional(),
});

/**
 * A batch: several prompts (one per line) or several files. A model fed by a list
 * runs once per item, and everything downstream follows item by item.
 */
export const LIST_MAX = 50;
export const listData = z.object({
  kind: z.enum(["text", "image", "video", "audio"]),
  text: z.string().max(40000).optional(),
  files: z.array(z.string().max(300)).max(LIST_MAX).optional(),
});

/** Canvas annotations: no inputs or outputs, never executed. */
export const NOTE_COLORS = ["yellow", "blue", "pink", "green", "gray"] as const;
export const noteData = z.object({
  text: z.string().max(20000),
  color: z.enum(NOTE_COLORS).optional(),
});
export const groupData = z.object({
  title: z.string().max(200),
  width: z.number().min(80).max(20000),
  height: z.number().min(60).max(20000),
});

const position = z.object({ x: z.number(), y: z.number() });
const id = z.string().min(1).max(64);

export const graphNode = z.discriminatedUnion("type", [
  z.object({ id, type: z.literal("prompt"), position, data: promptData }),
  z.object({ id, type: z.literal("image"), position, data: imageData }),
  z.object({ id, type: z.literal("model"), position, data: modelData }),
  z.object({ id, type: z.literal("list"), position, data: listData }),
  z.object({ id, type: z.literal("note"), position, data: noteData }),
  z.object({ id, type: z.literal("group"), position, data: groupData }),
]);

export const graphEdge = z.object({
  id,
  source: id,
  sourceHandle: z.string().max(64),
  target: id,
  targetHandle: z.string().max(64),
});

export const graphDoc = z.object({
  nodes: z.array(graphNode).max(500),
  edges: z.array(graphEdge).max(2000),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).optional(),
});

export type PromptData = z.infer<typeof promptData>;
export type ImageData = z.infer<typeof imageData>;
export type ModelData = z.infer<typeof modelData>;
export type ListData = z.infer<typeof listData>;
export type NoteData = z.infer<typeof noteData>;
export type GroupData = z.infer<typeof groupData>;
export type GraphNode = z.infer<typeof graphNode>;
export type GraphEdge = z.infer<typeof graphEdge>;
export type GraphDoc = z.infer<typeof graphDoc>;

export type ModelNode = Extract<GraphNode, { type: "model" }>;

/** Output handle (= data type) of a node; null for annotations, which have none. */
export function outputHandle(node: GraphNode): DType | null {
  if (node.type === "prompt") return "text";
  if (node.type === "image") return node.data.kind ?? "image";
  if (node.type === "model") return node.data.kind;
  if (node.type === "list") return node.data.kind;
  return null;
}

/** The items of a list node: non-empty lines, or uploaded files. */
export function listItems(data: ListData): string[] {
  const items = data.kind === "text"
    ? (data.text ?? "").split("\n").map((l) => l.trim()).filter(Boolean)
    : (data.files ?? []);
  return items.slice(0, LIST_MAX);
}
