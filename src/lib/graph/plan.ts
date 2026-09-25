/**
 * Decides which model nodes a run executes and in what order.
 * Pure function, shared by the browser (pre-run cost confirmation) and the
 * server (the plan that is actually executed), so both always agree.
 */
import type { InputRef, JobInput } from "../jobs";
import { estimate, type Estimate } from "../models/pricing";
import { getModel } from "../models/registry";
import { outputHandle, type GraphDoc, type GraphNode, type ModelNode } from "./types";

export interface PlanOptions {
  doc: GraphDoc;
  /** model nodes the user asked to run */
  targets: string[];
  /** "missing": upstream model nodes run only if they have no result yet; "all": everything reruns */
  mode: "missing" | "all";
  hasOutput: (nodeId: string) => boolean;
  /** upstream nodes already generating: depend on that job instead of starting a second one */
  isActive: (nodeId: string) => boolean;
}

export interface PlannedJob {
  nodeId: string;
  kind: ModelNode["data"]["kind"];
  modelId: string;
  input: JobInput;
  /** upstream model nodes this job waits for (planned in this run or already active) */
  waitsFor: string[];
  estimate: Estimate;
}

export type PlanResult =
  | { ok: true; jobs: PlannedJob[]; totalUsd: number; approx: boolean }
  | { ok: false; nodeId: string; error: string };

class PlanError extends Error {
  constructor(public nodeId: string, message: string) { super(message); }
}

export function planRun(opts: PlanOptions): PlanResult {
  const { doc } = opts;
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const planned = new Map<string, PlannedJob>();
  const visiting = new Set<string>();

  const visit = (nodeId: string) => {
    if (planned.has(nodeId)) return;
    if (visiting.has(nodeId)) throw new PlanError(nodeId, "Связи образуют цикл");
    const node = byId.get(nodeId);
    if (!node || node.type !== "model") return;
    const spec = getModel(node.data.modelId);
    if (!spec) throw new PlanError(nodeId, "Модель больше недоступна, выбери другую");
    visiting.add(nodeId);

    const ports: Record<string, InputRef[]> = {};
    const waitsFor: string[] = [];
    const inputCounts: Record<string, number> = {};

    for (const port of spec.inputs) {
      const edges = doc.edges.filter((e) => e.target === nodeId && e.targetHandle === port.key).slice(0, port.max);
      const refs: InputRef[] = [];
      for (const e of edges) {
        const src = byId.get(e.source);
        if (!src || outputHandle(src) !== port.dtype) continue;
        refs.push(refFor(src, nodeId, port.label));
        if (src.type === "model") {
          if (opts.isActive(src.id)) waitsFor.push(src.id);
          else if (opts.mode === "all" || !opts.hasOutput(src.id)) { visit(src.id); waitsFor.push(src.id); }
        }
      }
      if (refs.length) { ports[port.key] = refs; inputCounts[port.key] = refs.length; }
    }

    if (!ports.prompt) {
      const text = node.data.prompt.trim();
      if (!text) throw new PlanError(nodeId, "Нет промта: напиши его в ноде или подключи ноду «Промт»");
      ports.prompt = [{ type: "text", text }];
    }

    const promptChars = ports.prompt.reduce((s, r) => s + (r.type === "text" ? r.text.length : 400), 0);
    visiting.delete(nodeId);
    planned.set(nodeId, {
      nodeId,
      kind: node.data.kind,
      modelId: spec.id,
      input: { ports, params: node.data.params },
      waitsFor,
      estimate: estimate(spec, { params: node.data.params, inputCounts, promptChars }),
    });
  };

  try {
    for (const t of opts.targets) visit(t);
  } catch (e) {
    if (e instanceof PlanError) return { ok: false, nodeId: e.nodeId, error: e.message };
    throw e;
  }

  const jobs = [...planned.values()]; // insertion order is dependency order (post-order DFS)
  const known = jobs.map((j) => j.estimate.usd).filter((v): v is number => v !== null);
  return {
    ok: true,
    jobs,
    totalUsd: known.reduce((a, b) => a + b, 0),
    approx: jobs.some((j) => j.estimate.approx || j.estimate.usd === null),
  };
}

function refFor(src: GraphNode, targetId: string, portLabel: string): InputRef {
  if (src.type === "prompt") {
    const text = src.data.text.trim();
    if (!text) throw new PlanError(targetId, `Подключённый промт («${portLabel}») пустой`);
    return { type: "text", text };
  }
  if (src.type === "image") {
    if (!src.data.fileKey) throw new PlanError(targetId, `В подключённую ноду «Изображение» не загружена картинка`);
    return { type: "file", key: src.data.fileKey };
  }
  return { type: "node", nodeId: src.id };
}
