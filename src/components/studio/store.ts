"use client";

import {
  addEdge, applyEdgeChanges, applyNodeChanges,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type Viewport,
} from "@xyflow/react";
import { create } from "zustand";
import type { GraphDoc, ImageData, ModelData, PromptData } from "@/lib/graph/types";
import { planRun, type PlanResult } from "@/lib/graph/plan";
import { ACTIVE_STATUSES, type GraphState } from "@/lib/jobs";
import { defaultModel, defaultParams, getModel, reconcileParams } from "@/lib/models/registry";
import { uploadFile } from "./upload";
import type { DType, MediaKind } from "@/lib/models/types";
import { formatRub, type Fx } from "@/lib/money";

export type PromptNodeT = Node<PromptData, "prompt">;
export type ImageNodeT = Node<ImageData, "image">;
export type ModelNodeT = Node<ModelData, "model">;
export type StudioNode = PromptNodeT | ImageNodeT | ModelNodeT;

export interface Toast { id: number; text: string; error?: boolean; action?: { label: string; run: () => void } }
export interface ConfirmRequest { title: string; body: string; confirm: string; resolve: (ok: boolean) => void }

interface StudioStore {
  graphId: string;
  nodes: StudioNode[];
  edges: Edge[];
  viewport: Viewport;
  state: GraphState;
  /** validation / request errors not tied to a server job */
  localErrors: Record<string, string>;
  /** nodes whose run request is in flight (before the server confirms a job) */
  submitting: Record<string, true>;
  toasts: Toast[];
  confirm: ConfirmRequest | null;
  lightbox: string | null;
  fx: Fx;
  /** last deletion, restorable with Ctrl+Z or the toast button */
  trash: { nodes: StudioNode[]; edges: Edge[] } | null;

  init(graphId: string, doc: GraphDoc, state: GraphState, fx: Fx): void;
  onNodesChange(changes: NodeChange<StudioNode>[]): void;
  onEdgesChange(changes: EdgeChange[]): void;
  onConnect(c: Connection): void;
  setViewport(v: Viewport): void;
  /** Adds a node and returns its id. exact: keep the position (drop at cursor); otherwise nudge to free space */
  addNode(type: StudioNode["type"], position: { x: number; y: number }, opts?: { kind?: MediaKind; modelId?: string; exact?: boolean }): string;
  /** Upload files and place one upload node per file, fanned out from `at` */
  addFiles(files: File[], at: { x: number; y: number }): Promise<void>;
  /** Fill an upload node; wires the new file type can't feed are removed */
  setUpload(id: string, file: { fileKey: string; name: string; kind: "image" | "video" | "audio" }): void;
  /** Choose which result a node passes downstream (null = latest) */
  pin(id: string, outputId: string | null): void;
  copySelection(): number;
  paste(): void;
  duplicateSelection(): void;
  updateData<T extends StudioNode>(id: string, patch: Partial<T["data"]>): void;
  setModel(id: string, modelId: string): void;
  removeNode(id: string): void;
  setState(s: GraphState): void;
  toast(text: string, error?: boolean, action?: Toast["action"]): void;
  undoDelete(): void;
  cancel(nodeId: string): Promise<void>;
  ask(req: Omit<ConfirmRequest, "resolve">): Promise<boolean>;
  closeConfirm(ok: boolean): void;
  setLightbox(url: string | null): void;
  run(targets: string[], mode: "missing" | "all"): Promise<void>;
}

// ---------------------------------------------------------------- helpers

export const edgeClass = (e: Pick<Edge, "sourceHandle">) => `edge-${e.sourceHandle ?? "text"}`;

export function toDoc(nodes: StudioNode[], edges: Edge[], viewport: Viewport): GraphDoc {
  return {
    nodes: nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }) as GraphDoc["nodes"][number]),
    edges: edges.map((e) => ({
      id: e.id, source: e.source, target: e.target,
      sourceHandle: e.sourceHandle ?? "", targetHandle: e.targetHandle ?? "",
    })),
    viewport,
  };
}

function fromDoc(doc: GraphDoc): { nodes: StudioNode[]; edges: Edge[] } {
  return {
    nodes: doc.nodes.map((n) => ({ ...n, dragHandle: ".node-head" }) as StudioNode),
    edges: doc.edges.map((e) => ({ ...e, className: edgeClass(e) })),
  };
}

export function isActive(state: GraphState, nodeId: string): boolean {
  const s = state[nodeId]?.job?.status;
  return !!s && ACTIVE_STATUSES.includes(s);
}

/** Output handle id of a node = its data type. */
export function outputType(n: StudioNode): DType {
  return n.type === "prompt" ? "text" : n.type === "image" ? n.data.kind ?? "image" : n.data.kind;
}

/** Input port spec for a node's target handle (only model nodes have inputs). */
export function inputPort(n: StudioNode | undefined, handle: string | null | undefined) {
  if (!n || n.type !== "model") return undefined;
  return getModel(n.data.modelId)?.inputs.find((p) => p.key === handle);
}

function reaches(edges: Edge[], from: string, to: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === to) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const e of edges) if (e.source === cur) stack.push(e.target);
  }
  return false;
}

export function canConnect(nodes: StudioNode[], edges: Edge[], c: Connection | Edge): boolean {
  if (c.source === c.target) return false;
  const src = nodes.find((n) => n.id === c.source);
  const port = inputPort(nodes.find((n) => n.id === c.target), c.targetHandle);
  if (!src || !port || outputType(src) !== port.dtype) return false;
  return !reaches(edges, c.target, c.source); // no cycles
}

/** Nearest spot to `want` where a new node doesn't cover an existing one. */
function freeSpot(nodes: StudioNode[], want: { x: number; y: number }) {
  const W = 340, H = 260, GAP = 24;
  const hits = (x: number, y: number) => nodes.some((n) => {
    const w = n.measured?.width ?? 332, h = n.measured?.height ?? 300;
    return x < n.position.x + w + GAP && x + W + GAP > n.position.x
      && y < n.position.y + h + GAP && y + H + GAP > n.position.y;
  });
  const STEP = 60;
  for (let ring = 0; ring <= 15; ring++) {
    for (let i = -ring; i <= ring; i++) {
      for (const [dx, dy] of [[i, -ring], [i, ring], [-ring, i], [ring, i]]) {
        const x = want.x + dx * STEP, y = want.y + dy * STEP;
        if (!hits(x, y)) return { x, y };
      }
    }
  }
  return want;
}

/** In-app clipboard for Ctrl+C / Ctrl+V of nodes. */
let clipboard: { nodes: StudioNode[]; edges: Edge[] } | null = null;

let nextId = 1;
const newId = (p: string) => `${p}${Date.now().toString(36)}${(nextId++).toString(36)}`;

// ---------------------------------------------------------------- persistence

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<unknown> = Promise.resolve();

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 700);
}

function flushSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  const { graphId, nodes, edges, viewport } = useStudio.getState();
  const body = JSON.stringify({ doc: toDoc(nodes, edges, viewport) });
  // chain saves so an older one can never land after a newer one
  saving = saving.then(() =>
    fetch(`/api/graphs/${graphId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body })
      .then((r) => { if (!r.ok) throw new Error(); })
      .catch(() => useStudio.getState().toast("Не удалось сохранить изменения. Проверьте соединение.", true)),
  );
  return saving;
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => { if (saveTimer) flushSave(); });
}

// ---------------------------------------------------------------- polling

let pollTimer: ReturnType<typeof setTimeout> | null = null;

export async function refreshState() {
  const { graphId } = useStudio.getState();
  try {
    const r = await fetch(`/api/graphs/${graphId}/state`, { cache: "no-store" });
    if (r.ok) useStudio.getState().setState(await r.json());
  } catch { /* transient; next poll retries */ }
}

function ensurePolling() {
  if (pollTimer) return;
  const loop = async () => {
    await refreshState();
    const { state, submitting } = useStudio.getState();
    const busy = Object.keys(submitting).length > 0 || Object.keys(state).some((id) => isActive(state, id));
    pollTimer = busy ? setTimeout(loop, 1500) : null;
  };
  pollTimer = setTimeout(loop, 400);
}

// ---------------------------------------------------------------- store

let toastSeq = 0;

/** Keep what was just deleted so it can be restored (Ctrl+Z or the toast button). */
export function remember(nodes: StudioNode[], edges: Edge[]) {
  const s = useStudio.getState();
  if (!nodes.length && !edges.length) return;
  useStudio.setState({ trash: { nodes, edges } });
  const what = nodes.length > 1 ? `Удалено нод: ${nodes.length}` : nodes.length ? "Нода удалена" : "Связь удалена";
  s.toast(what, false, { label: "Вернуть", run: () => useStudio.getState().undoDelete() });
}

export const useStudio = create<StudioStore>((set, get) => ({
  graphId: "",
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  state: {},
  localErrors: {},
  submitting: {},
  toasts: [],
  confirm: null,
  lightbox: null,
  fx: { usdRub: 85, date: "", source: "fallback" },
  trash: null,

  init(graphId, doc, state, fx) {
    const { nodes, edges } = fromDoc(doc);
    set({ graphId, nodes, edges, viewport: doc.viewport ?? { x: 80, y: 80, zoom: 1 }, state, fx });
    if (Object.keys(state).some((id) => isActive(state, id))) ensurePolling();
  },

  onNodesChange(changes) {
    const removed = changes.filter((c) => c.type === "remove").map((c) => c.id);
    set((s) => ({
      nodes: applyNodeChanges(changes, s.nodes),
      edges: removed.length ? s.edges.filter((e) => !removed.includes(e.source) && !removed.includes(e.target)) : s.edges,
    }));
    // selection and live drag frames aren't worth a save; drag end and removal are
    if (changes.some((c) => c.type === "remove" || (c.type === "position" && !c.dragging) || c.type === "add")) scheduleSave();
  },

  onEdgesChange(changes) {
    set((s) => ({ edges: applyEdgeChanges(changes, s.edges) }));
    if (changes.some((c) => c.type === "remove")) scheduleSave();
  },

  onConnect(c) {
    const { nodes, edges } = get();
    if (!canConnect(nodes, edges, c)) return;
    const port = inputPort(nodes.find((n) => n.id === c.target), c.targetHandle)!;
    let next = edges;
    const into = edges.filter((e) => e.target === c.target && e.targetHandle === c.targetHandle);
    // single-input port: the new wire replaces the old one; multi-input: drop the oldest when full
    if (into.length >= port.max) {
      const drop = port.max === 1 ? into.map((e) => e.id) : [into[0].id];
      next = edges.filter((e) => !drop.includes(e.id));
    }
    const edge: Edge = { ...c, id: newId("e"), className: edgeClass(c) };
    set({ edges: addEdge(edge, next) });
    scheduleSave();
  },

  setViewport(v) {
    set({ viewport: v });
    scheduleSave();
  },

  addNode(type, at, opts = {}) {
    const id = newId("n");
    const position = opts.exact ? at : freeSpot(get().nodes, at);
    let node: StudioNode;
    if (type === "prompt") node = { id, type, position, data: { text: "" } };
    else if (type === "image") node = { id, type, position, data: { fileKey: null, name: "", kind: "image" } };
    else {
      const spec = (opts.modelId && getModel(opts.modelId)) || defaultModel(opts.kind ?? "image");
      node = { id, type: "model", position, data: { kind: spec.kind, modelId: spec.id, prompt: "", params: defaultParams(spec) } };
    }
    set((s) => ({ nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), { ...node, dragHandle: ".node-head", selected: true }] }));
    scheduleSave();
    return id;
  },

  async addFiles(files, at) {
    const accepted = files.slice(0, 12);
    const ids = accepted.map((f, i) =>
      get().addNode("image", { x: at.x + i * 36, y: at.y + i * 36 }, { exact: true }));
    await Promise.all(accepted.map(async (file, i) => {
      try {
        const r = await uploadFile(file);
        get().setUpload(ids[i], { fileKey: r.key, name: file.name, kind: r.kind });
      } catch (e) {
        get().toast(`${file.name}: ${(e as Error).message}`, true);
        set((s) => ({ nodes: s.nodes.filter((n) => n.id !== ids[i]) })); // nothing to show
      }
    }));
    if (files.length > accepted.length) get().toast("За раз можно добавить до 12 файлов", true);
  },

  setUpload(id, file) {
    set((s) => {
      const nodes = s.nodes.map((n) => (n.id === id && n.type === "image" ? { ...n, data: { ...n.data, ...file } } : n));
      const node = nodes.find((n) => n.id === id);
      const edges = s.edges.filter((e) => {
        if (e.source !== id || !node) return true;
        const port = inputPort(nodes.find((n) => n.id === e.target), e.targetHandle);
        return port?.dtype === file.kind;
      });
      return { nodes, edges: edges.map((e) => (e.source === id ? { ...e, sourceHandle: file.kind, className: edgeClass({ sourceHandle: file.kind }) } : e)) };
    });
    scheduleSave();
  },

  pin(id, outputId) {
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (n.id !== id || n.type !== "model") return n;
        const data = { ...n.data };
        if (outputId) data.pinnedOutputId = outputId; else delete data.pinnedOutputId;
        return { ...n, data };
      }),
    }));
    scheduleSave();
  },

  copySelection() {
    const { nodes, edges } = get();
    const picked = nodes.filter((n) => n.selected);
    const ids = new Set(picked.map((n) => n.id));
    clipboard = picked.length ? { nodes: picked, edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)) } : null;
    return picked.length;
  },

  paste() {
    if (!clipboard) return;
    const idMap = new Map<string, string>();
    const nodes = clipboard.nodes.map((n) => {
      const id = newId("n");
      idMap.set(n.id, id);
      const data = n.type === "model" ? (({ pinnedOutputId: _p, ...rest }) => rest)(n.data) : n.data; // results belong to the original
      return { ...n, id, data, position: { x: n.position.x + 48, y: n.position.y + 48 }, selected: true } as StudioNode;
    });
    const edges = clipboard.edges.map((e) => ({
      ...e, id: newId("e"), source: idMap.get(e.source)!, target: idMap.get(e.target)!, selected: false,
    }));
    set((s) => ({ nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), ...nodes], edges: [...s.edges, ...edges] }));
    // pasting again cascades instead of stacking on the same spot
    clipboard = { nodes, edges };
    scheduleSave();
  },

  duplicateSelection() {
    if (get().copySelection()) get().paste();
  },

  updateData(id, patch) {
    set((s) => {
      const { [id]: _drop, ...localErrors } = s.localErrors;
      return {
        nodes: s.nodes.map((n) => (n.id === id ? ({ ...n, data: { ...n.data, ...patch } } as StudioNode) : n)),
        localErrors,
      };
    });
    scheduleSave();
  },

  setModel(id, modelId) {
    const spec = getModel(modelId);
    if (!spec) return;
    set((s) => {
      const nodes = s.nodes.map((n) =>
        n.id === id && n.type === "model"
          ? { ...n, data: { ...n.data, modelId, params: reconcileParams(spec, n.data.params) } }
          : n);
      // wires into ports the new model doesn't have are removed; over-capacity ones trimmed
      const keep = new Map(spec.inputs.map((p) => [p.key, p.max]));
      const counts: Record<string, number> = {};
      const edges = s.edges.filter((e) => {
        if (e.target !== id) return true;
        const max = keep.get(e.targetHandle ?? "");
        if (!max) return false;
        counts[e.targetHandle!] = (counts[e.targetHandle!] ?? 0) + 1;
        return counts[e.targetHandle!] <= max;
      });
      return { nodes, edges };
    });
    scheduleSave();
  },

  removeNode(id) {
    const { nodes, edges } = get();
    remember(nodes.filter((n) => n.id === id), edges.filter((e) => e.source === id || e.target === id));
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== id),
      edges: s.edges.filter((e) => e.source !== id && e.target !== id),
    }));
    scheduleSave();
  },

  setState(state) {
    set({ state });
  },

  toast(text, error, action) {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, text, error, action }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), error || action ? 6000 : 3200);
  },

  undoDelete() {
    const t = get().trash;
    if (!t) return;
    set((s) => {
      const ids = new Set(s.nodes.map((n) => n.id));
      const nodes = [...s.nodes, ...t.nodes.filter((n) => !ids.has(n.id)).map((n) => ({ ...n, selected: false }))];
      const present = new Set(nodes.map((n) => n.id));
      const edgeIds = new Set(s.edges.map((e) => e.id));
      const edges = [...s.edges, ...t.edges.filter((e) => !edgeIds.has(e.id) && present.has(e.source) && present.has(e.target))];
      return { nodes, edges, trash: null, toasts: s.toasts.filter((x) => !x.action) };
    });
    scheduleSave();
  },

  async cancel(nodeId) {
    const job = get().state[nodeId]?.job;
    if (!job || !isActive(get().state, nodeId)) return;
    if (job.status === "running" && get().nodes.find((n) => n.id === nodeId && n.type === "model" && n.data.kind === "video")) {
      const ok = await get().ask({
        title: "Остановить генерацию?",
        body: "Провайдер уже делает это видео. Если остановить, оплату за него могут всё равно списать, а результат не сохранится.",
        confirm: "Остановить",
      });
      if (!ok) return;
    }
    try {
      const r = await fetch(`/api/jobs/${job.id}/cancel`, { method: "POST" });
      if (!r.ok && r.status !== 409) throw new Error();
    } catch {
      get().toast("Не удалось отменить. Проверьте соединение.", true);
    }
    await refreshState();
  },

  ask(req) {
    return new Promise((resolve) => set({ confirm: { ...req, resolve } }));
  },

  closeConfirm(ok) {
    get().confirm?.resolve(ok);
    set({ confirm: null });
  },

  setLightbox(url) {
    set({ lightbox: url });
  },

  async run(targets, mode) {
    const { nodes, edges, viewport, state, graphId } = get();
    const doc = toDoc(nodes, edges, viewport);
    const plan: PlanResult = planRun({
      doc,
      targets: targets.filter((t) => !isActive(state, t)),
      mode,
      hasOutput: (id) => !!state[id]?.output,
      isActive: (id) => isActive(state, id),
    });
    if (!plan.ok) {
      set((s) => ({ localErrors: { ...s.localErrors, [plan.nodeId]: plan.error } }));
      if (!targets.includes(plan.nodeId) || targets.length > 1) get().toast(plan.error, true);
      return;
    }
    if (!plan.jobs.length) return;

    // anything beyond "the node I clicked" spends money the user didn't point at: confirm
    if (plan.jobs.length > 1) {
      const price = plan.totalUsd > 0
        ? `${plan.approx ? "примерно " : ""}${formatRub(plan.totalUsd, get().fx)}`
        : "станет известна после запуска";
      const ok = await get().ask({
        title: mode === "all" ? "Запустить весь граф?" : "Запустить цепочку?",
        body: `Будет запущено нод: ${plan.jobs.length}. Стоимость: ${price}.`,
        confirm: "Запустить",
      });
      if (!ok) return;
    }

    const ids = plan.jobs.map((j) => j.nodeId);
    // a node that runs again passes on its fresh result, not an old pick
    for (const id of ids) get().pin(id, null);
    set((s) => {
      const localErrors = { ...s.localErrors };
      const submitting = { ...s.submitting };
      for (const id of ids) { delete localErrors[id]; submitting[id] = true; }
      return { localErrors, submitting };
    });
    if (saveTimer) flushSave();

    try {
      const r = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // fresh snapshot: pins of re-running nodes were just cleared
        body: JSON.stringify({ graphId, doc: toDoc(get().nodes, get().edges, get().viewport), targets, mode }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = data.error ?? "Не удалось запустить";
        if (data.nodeId) set((s) => ({ localErrors: { ...s.localErrors, [data.nodeId]: msg } }));
        else get().toast(msg, true);
      }
      await refreshState();
    } catch {
      get().toast("Нет связи с сервером", true);
    } finally {
      set((s) => {
        const submitting = { ...s.submitting };
        for (const id of ids) delete submitting[id];
        return { submitting };
      });
      ensurePolling();
    }
  },
}));
