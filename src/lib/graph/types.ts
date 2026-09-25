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
  kind: z.enum(["text", "image", "video"]),
  modelId: z.string().max(200),
  prompt: z.string().max(20000),
  params: z.record(z.string(), paramValue),
  /** result chosen to pass downstream; unset = the latest one */
  pinnedOutputId: z.string().uuid().optional(),
});

const position = z.object({ x: z.number(), y: z.number() });
const id = z.string().min(1).max(64);

export const graphNode = z.discriminatedUnion("type", [
  z.object({ id, type: z.literal("prompt"), position, data: promptData }),
  z.object({ id, type: z.literal("image"), position, data: imageData }),
  z.object({ id, type: z.literal("model"), position, data: modelData }),
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
export type GraphNode = z.infer<typeof graphNode>;
export type GraphEdge = z.infer<typeof graphEdge>;
export type GraphDoc = z.infer<typeof graphDoc>;

export type ModelNode = Extract<GraphNode, { type: "model" }>;

/** Output handle (= data type) of every node. Model nodes output their own kind. */
export function outputHandle(node: GraphNode): DType {
  if (node.type === "prompt") return "text";
  if (node.type === "image") return node.data.kind ?? "image";
  return node.data.kind;
}
