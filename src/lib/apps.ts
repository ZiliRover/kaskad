import { z } from "zod";
import { LIST_MAX } from "./graph/types";

/**
 * Apps: a graph published behind a simple form. Each field is one input node of the
 * graph (a prompt, an upload or a list) that the person running the app fills in.
 */
export const appField = z.object({
  nodeId: z.string().min(1).max(64),
  label: z.string().trim().min(1).max(80),
  hint: z.string().max(300).default(""),
  /** text: a prompt node; file: an upload node; list-text / list-file: a list node */
  type: z.enum(["text", "file", "list-text", "list-file"]),
  kind: z.enum(["image", "video", "audio"]).optional(),
  required: z.boolean().default(true),
});
export type AppField = z.infer<typeof appField>;

/** What the runner sends: text for text fields, storage keys for files, arrays for lists. */
export const appValues = z.record(z.string(), z.union([
  z.string().max(20000),
  z.array(z.string().max(20000)).max(LIST_MAX),
]));
export type AppValues = z.infer<typeof appValues>;

/** Public view of an app for its runners. */
export interface AppInfo {
  id: string;
  name: string;
  description: string;
  fields: (AppField & { default?: string })[];
  /** output nodes with what they make and a name to show */
  outputs: { nodeId: string; label: string; kind: "text" | "image" | "video" | "audio" }[];
}
