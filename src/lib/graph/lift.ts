/**
 * Prompts live in Prompt nodes. Older documents kept a prompt inside the model node;
 * this moves each such prompt into its own Prompt node wired to the model, so nothing
 * the user wrote is lost and the graph shows where every text comes from.
 */
import { getModel } from "../models/registry";
import type { GraphDoc, GraphEdge, GraphNode } from "./types";

// rough footprints; exact sizes are only known after render
const PROMPT_W = 320, PROMPT_H = 190, GAP = 40;
const box = (n: GraphNode) => ({ x: n.position.x, y: n.position.y, w: 340, h: n.type === "model" ? 520 : 240 });

export function liftInlinePrompts<D extends Pick<GraphDoc, "nodes" | "edges">>(doc: D): { doc: D; changed: boolean } {
  const nodes = [...doc.nodes];
  const edges: GraphEdge[] = [...doc.edges];
  let changed = false;

  for (const [i, n] of doc.nodes.entries()) {
    if (n.type !== "model" || !n.data.prompt.trim()) continue;
    if (!getModel(n.data.modelId)?.inputs.some((p) => p.key === "prompt")) continue;
    if (edges.some((e) => e.target === n.id && e.targetHandle === "prompt")) continue;

    // left of the model, moving up until it doesn't cover another node
    const x = n.position.x - PROMPT_W - 60;
    let y = n.position.y;
    const hits = (yy: number) => nodes.some((o) => {
      if (o.type === "group") return false;
      const b = box(o);
      return x < b.x + b.w + GAP && x + PROMPT_W + GAP > b.x && yy < b.y + b.h + GAP && yy + PROMPT_H + GAP > b.y;
    });
    for (let k = 0; k < 12 && hits(y); k++) y -= PROMPT_H + GAP;

    const id = `${n.id}-prompt`;
    nodes.push({ id, type: "prompt", position: { x, y }, data: { text: n.data.prompt } });
    edges.push({ id: `${id}-edge`, source: id, sourceHandle: "text", target: n.id, targetHandle: "prompt" });
    nodes[i] = { ...n, data: { ...n.data, prompt: "" } };
    changed = true;
  }
  return { doc: changed ? { ...doc, nodes, edges } : doc, changed };
}
