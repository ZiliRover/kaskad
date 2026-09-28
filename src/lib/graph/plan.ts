/**
 * Decides which model nodes a run executes and in what order.
 * Pure function, shared by the browser (pre-run cost confirmation) and the
 * server (the plan that is actually executed), so both always agree.
 *
 * Batches: a model fed by a List node runs once per item ("fans out"). Its results
 * travel item by item: a downstream model with a single-input port fans out too, and
 * item N waits only for item N upstream. A multi-input port (clips of a join, for
 * example) gathers all items of a fanned model instead.
 */
import type { InputRef, JobInput } from "../jobs";
import { estimate, type Estimate } from "../models/pricing";
import { getModel } from "../models/registry";
import { LIST_MAX, listItems, outputHandle, type GraphDoc, type GraphNode, type ModelNode } from "./types";

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

/** A dependency: a node's job for one item, or (no item) all of the node's jobs. */
export interface Wait { nodeId: string; item?: number }

export interface PlannedJob {
  nodeId: string;
  /** position in the batch; undefined for a single run */
  item?: number;
  kind: ModelNode["data"]["kind"];
  modelId: string;
  input: JobInput;
  /** upstream model jobs this job waits for (planned in this run or already active) */
  waitsFor: Wait[];
  estimate: Estimate;
}

export type PlanResult =
  | { ok: true; jobs: PlannedJob[]; totalUsd: number; approx: boolean }
  | { ok: false; nodeId: string; error: string };

/** One run may not start more jobs than this (a list of 50 through a chain of 4 models is 200). */
export const MAX_JOBS = 200;

class PlanError extends Error {
  constructor(public nodeId: string, message: string) { super(message); }
}

/**
 * How many times each model node runs: 0 = once, normally; N = once per item of the
 * list that feeds it, directly or through fanned models upstream.
 */
export function fanOut(doc: Pick<GraphDoc, "nodes" | "edges">): Map<string, number> {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const memo = new Map<string, number>();
  const visiting = new Set<string>();

  const of = (id: string): number => {
    if (memo.has(id)) return memo.get(id)!;
    const node = byId.get(id);
    if (!node || node.type !== "model" || visiting.has(id)) return 0;
    const spec = getModel(node.data.modelId);
    if (!spec) return 0;
    visiting.add(id);
    let n = 0;
    for (const e of doc.edges) {
      if (e.target !== id) continue;
      const port = spec.inputs.find((p) => p.key === e.targetHandle);
      const src = byId.get(e.source);
      if (!port || !src) continue;
      // lists always fan out; a fanned model fans out through single inputs, gathers into multi-inputs
      const len = src.type === "list" ? listItems(src.data).length
        : src.type === "model" && port.max === 1 ? of(src.id) : 0;
      if (len > n) n = len;
    }
    visiting.delete(id);
    memo.set(id, n);
    return n;
  };

  for (const n of doc.nodes) if (n.type === "model") of(n.id);
  return memo;
}

export function planRun(opts: PlanOptions): PlanResult {
  const { doc } = opts;
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const fans = fanOut(doc);
  const planned = new Map<string, PlannedJob[]>();
  const visiting = new Set<string>();

  const visit = (nodeId: string) => {
    if (planned.has(nodeId)) return;
    if (visiting.has(nodeId)) throw new PlanError(nodeId, "Связи образуют цикл");
    const node = byId.get(nodeId);
    if (!node || node.type !== "model") return;
    const spec = getModel(node.data.modelId);
    if (!spec) throw new PlanError(nodeId, "Модель больше недоступна, выбери другую");
    visiting.add(nodeId);

    const fan = fans.get(nodeId) ?? 0;
    const runs = fan || 1;

    // lists feeding this node must agree on their length
    for (const e of doc.edges) {
      if (e.target !== nodeId) continue;
      const src = byId.get(e.source);
      if (src?.type !== "list") continue;
      const len = listItems(src.data).length;
      if (!len) throw new PlanError(nodeId, "Подключённый список пустой");
      if (len !== fan) throw new PlanError(nodeId, `Списки разной длины: ${len} и ${fan}. Сделай их одинаковыми`);
    }
    for (const e of doc.edges) {
      if (e.target !== nodeId) continue;
      const src = byId.get(e.source);
      const port = spec.inputs.find((p) => p.key === e.targetHandle);
      if (src?.type === "model" && port?.max === 1 && fan && (fans.get(src.id) ?? 0) !== fan) {
        throw new PlanError(nodeId, `Пакеты разной длины: ${fans.get(src.id)} и ${fan}`);
      }
    }

    // upstream model nodes: run them first when needed (once, whatever the item)
    const upstream = new Map<string, "wait" | "done">();
    for (const port of spec.inputs) {
      for (const e of doc.edges.filter((x) => x.target === nodeId && x.targetHandle === port.key)) {
        const src = byId.get(e.source);
        if (src?.type !== "model" || upstream.has(src.id)) continue;
        if (opts.isActive(src.id)) upstream.set(src.id, "wait");
        else if (opts.mode === "all" || !opts.hasOutput(src.id)) { visit(src.id); upstream.set(src.id, "wait"); }
        else upstream.set(src.id, "done");
      }
    }

    const jobs: PlannedJob[] = [];
    for (let i = 0; i < runs; i++) {
      const item = fan ? i : undefined;
      const ports: Record<string, InputRef[]> = {};
      const inputCounts: Record<string, number> = {};
      const waits: Wait[] = [];

      for (const port of spec.inputs) {
        const edges = doc.edges.filter((e) => e.target === nodeId && e.targetHandle === port.key);
        const refs: InputRef[] = [];
        for (const e of edges) {
          const src = byId.get(e.source);
          if (!src || outputHandle(src) !== port.dtype) continue;
          if (src.type === "list") {
            refs.push(listRef(src, i, nodeId));
            continue;
          }
          const srcFan = src.type === "model" ? fans.get(src.id) ?? 0 : 0;
          if (srcFan && port.max === 1) {
            refs.push({ type: "node", nodeId: src.id, item: i }); // item by item
            if (upstream.get(src.id) === "wait") waits.push({ nodeId: src.id, item: i });
          } else if (srcFan) {
            for (let k = 0; k < srcFan; k++) refs.push({ type: "node", nodeId: src.id, item: k }); // gather
            if (upstream.get(src.id) === "wait") waits.push({ nodeId: src.id });
          } else {
            refs.push(refFor(src, nodeId, port.label));
            if (src.type === "model" && upstream.get(src.id) === "wait") waits.push({ nodeId: src.id });
          }
        }
        const kept = refs.slice(0, port.max);
        if (kept.length) { ports[port.key] = kept; inputCounts[port.key] = kept.length; }
        if (refs.length > port.max) {
          throw new PlanError(nodeId, `Во вход «${port.label}» приходит ${refs.length}, а модель принимает до ${port.max}`);
        }
        if (kept.length < port.min) {
          throw new PlanError(nodeId, port.min === 1
            ? `Подключи вход «${port.label}»: без него модель не работает`
            : `Подключи минимум ${port.min} во вход «${port.label}»`);
        }
      }

      if (!ports.prompt) {
        const text = node.data.prompt.trim();
        if (text) ports.prompt = [{ type: "text", text }];
        else if (!spec.promptOptional) throw new PlanError(nodeId, "Нет промта: подключи ноду «Промт»");
      }

      const promptChars = (ports.prompt ?? []).reduce((s, r) => s + (r.type === "text" ? r.text.length : 400), 0);
      jobs.push({
        nodeId,
        item,
        kind: node.data.kind,
        modelId: spec.id,
        input: { ports, params: node.data.params },
        waitsFor: waits,
        estimate: estimate(spec, { params: node.data.params, inputCounts, promptChars }),
      });
    }

    visiting.delete(nodeId);
    planned.set(nodeId, jobs);
  };

  let jobs: PlannedJob[];
  try {
    for (const t of opts.targets) visit(t);
    jobs = [...planned.values()].flat(); // insertion order is dependency order (post-order DFS)
    if (jobs.length > MAX_JOBS) {
      throw new PlanError(opts.targets[0] ?? "", `Слишком большой запуск: ${jobs.length} генераций, можно до ${MAX_JOBS}`);
    }
  } catch (e) {
    if (e instanceof PlanError) return { ok: false, nodeId: e.nodeId, error: e.message };
    throw e;
  }

  const known = jobs.map((j) => j.estimate.usd).filter((v): v is number => v !== null);
  return {
    ok: true,
    jobs,
    totalUsd: known.reduce((a, b) => a + b, 0),
    approx: jobs.some((j) => j.estimate.approx || j.estimate.usd === null),
  };
}

function listRef(src: Extract<GraphNode, { type: "list" }>, i: number, targetId: string): InputRef {
  const items = listItems(src.data);
  const value = items[i];
  if (value === undefined) throw new PlanError(targetId, "В списке меньше элементов, чем нужно");
  if (items.length > LIST_MAX) throw new PlanError(targetId, `В списке больше ${LIST_MAX} элементов`);
  return src.data.kind === "text" ? { type: "text", text: value } : { type: "file", key: value };
}

function refFor(src: GraphNode, targetId: string, portLabel: string): InputRef {
  if (src.type === "prompt") {
    const text = src.data.text.trim();
    if (!text) throw new PlanError(targetId, `Подключённый промт («${portLabel}») пустой`);
    return { type: "text", text };
  }
  if (src.type === "image") {
    if (!src.data.fileKey) throw new PlanError(targetId, "В подключённую ноду загрузки не добавлен файл");
    return { type: "file", key: src.data.fileKey };
  }
  if (src.type !== "model") throw new PlanError(targetId, "Заметки и группы не передают данные");
  // the user may have picked an earlier result/variant to pass on
  return src.data.pinnedOutputId
    ? { type: "node", nodeId: src.id, outputId: src.data.pinnedOutputId }
    : { type: "node", nodeId: src.id };
}
