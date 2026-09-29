"use client";

import {
  addEdge, applyEdgeChanges, applyNodeChanges,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type Viewport,
} from "@xyflow/react";
import { create } from "zustand";
import type { AssetData, GraphDoc, GroupData, ImageData, ListData, ModelData, NoteData, PromptData } from "@/lib/graph/types";
import type { LibraryItem } from "@/lib/library";
import type { Peer } from "./Live";
import type { Comment } from "@/lib/comments";
import { planRun, type PlanResult } from "@/lib/graph/plan";
import { liftInlinePrompts } from "@/lib/graph/lift";
import { ACTIVE_STATUSES, type GraphState } from "@/lib/jobs";
import { defaultModel, defaultParams, getModel, reconcileParams } from "@/lib/models/registry";
import type { Template } from "@/lib/templates";
import { uploadFile } from "./upload";
import type { DType, MediaKind } from "@/lib/models/types";
import { formatRub, type Fx } from "@/lib/money";

export type PromptNodeT = Node<PromptData, "prompt">;
export type ImageNodeT = Node<ImageData, "image">;
export type ModelNodeT = Node<ModelData, "model">;
export type NoteNodeT = Node<NoteData, "note">;
export type ListNodeT = Node<ListData, "list">;
export type AssetNodeT = Node<AssetData, "asset">;
export type GroupNodeT = Node<GroupData, "group">;
export type StudioNode = PromptNodeT | ImageNodeT | ModelNodeT | NoteNodeT | GroupNodeT | ListNodeT | AssetNodeT;

export interface Toast { id: number; text: string; error?: boolean; action?: { label: string; run: () => void } }
export interface Account {
  email: string;
  /** spendable now: reservations of running jobs are already subtracted */
  availableKop: number;
  reservedKop: number;
  /** null: top-ups are switched off on this server */
  payments: "test" | "yookassa" | null;
  /** operator of the service (ADMIN_EMAILS) */
  admin: boolean;
  /** what is left on the OpenRouter account, operators only */
  providerUsd: number | null;
}

export interface ConfirmRequest { title: string; body: string; confirm: string; resolve: (ok: boolean) => void }

export interface StudioStore {
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
  galleryOpen: boolean;
  templatesOpen: boolean;
  /** vendors this server can't reach (see BLOCKED_VENDORS) */
  blockedVendors: string[];
  account: Account | null;
  billingOpen: boolean;
  /** nodes shown side by side in the compare view; empty = closed */
  compareIds: string[];
  publishOpen: boolean;
  /** your role in this project; viewers can't change or run it */
  role: "owner" | "editor" | "viewer";
  me: { id: string; email: string } | null;
  /** other open tabs of this project, by client id */
  peers: Record<string, Peer>;
  /** bumps when comments change somewhere */
  commentsRev: number;
  comments: Comment[];
  /** clicking the canvas places a comment */
  commentMode: boolean;
  openThread: string | null;
  draftPin: { x: number; y: number } | null;
  library: LibraryItem[];
  /** library item open in the editor ("new" = creating one) */
  libraryEdit: LibraryItem | "new" | null;
  /** photos to start a new library item with (from the media library) */
  libraryPrefill: string[] | null;
  /** draft mode: runs use the cheapest settings of every model */
  draft: boolean;
  setDraft(on: boolean): void;

  init(graphId: string, doc: GraphDoc, state: GraphState, fx: Fx): void;
  onNodesChange(changes: NodeChange<StudioNode>[]): void;
  onEdgesChange(changes: EdgeChange[]): void;
  onConnect(c: Connection): void;
  setViewport(v: Viewport): void;
  /** Adds a node and returns its id. exact: keep the position (drop at cursor); otherwise nudge to free space */
  addNode(type: StudioNode["type"], position: { x: number; y: number }, opts?: { kind?: MediaKind; modelId?: string; exact?: boolean; listKind?: ListData["kind"]; assetId?: string }): string;
  /** Create a Prompt node left of a model node and wire it into its prompt input */
  addPromptFor(nodeId: string): void;
  /** Upload files and place one upload node per file, fanned out from `at` */
  addFiles(files: File[], at: { x: number; y: number }): Promise<void>;
  /** Fill an upload node; wires the new file type can't feed are removed */
  setUpload(id: string, file: { fileKey: string; name: string; kind: "image" | "video" | "audio" }): void;
  /** Choose which result a node passes downstream (null = latest) */
  pin(id: string, outputId: string | null): void;
  copySelection(): number;
  paste(): void;
  duplicateSelection(): void;
  /** Frame the selected nodes with a group (Ctrl+G) */
  groupSelection(): void;
  /** Drop a template next to the existing graph; returns the new node ids */
  insertTemplate(t: Template): string[];
  setPanel(p: { galleryOpen?: boolean; templatesOpen?: boolean; billingOpen?: boolean; compareIds?: string[]; publishOpen?: boolean }): void;
  /** Copies of a model node with other models on the same inputs, stacked under it; returns all ids */
  compareWith(nodeId: string, modelIds: string[]): string[];
  refreshBalance(): Promise<void>;
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

/** React Flow presentation props derived from our node data. */
function present(n: StudioNode): StudioNode {
  if (n.type === "group") {
    // groups sit behind everything and are sized by their data
    return { ...n, dragHandle: ".group-head", zIndex: -1, width: n.data.width, height: n.data.height };
  }
  return { ...n, dragHandle: ".node-head" };
}

function fromDoc(doc: GraphDoc): { nodes: StudioNode[]; edges: Edge[] } {
  return {
    nodes: doc.nodes.map((n) => present(n as StudioNode)),
    edges: doc.edges.map((e) => ({ ...e, className: edgeClass(e) })),
  };
}

export function isActive(state: GraphState, nodeId: string): boolean {
  const s = state[nodeId]?.job?.status;
  return !!s && ACTIVE_STATUSES.includes(s);
}

/** Output handle id of a node = its data type; null for notes and groups. */
export function outputType(n: StudioNode): DType | null {
  if (n.type === "prompt") return "text";
  if (n.type === "image") return n.data.kind ?? "image";
  if (n.type === "list") return n.data.kind;
  if (n.type === "asset") return n.data.files.length ? "image" : "text";
  if (n.type === "model") return n.data.kind;
  return null;
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
  if (!src || !port || !outputType(src) || outputType(src) !== port.dtype) return false;
  return !reaches(edges, c.target, c.source); // no cycles
}

/** Nearest spot to `want` where a new node doesn't cover an existing one. */
function freeSpot(nodes: StudioNode[], want: { x: number; y: number }) {
  const W = 340, H = 260, GAP = 24;
  const hits = (x: number, y: number) => nodes.some((n) => {
    if (n.type === "group") return false; // new nodes may land inside a group
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
  if (useStudio.getState().role === "viewer") return; // nothing a viewer does is saved
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 700);
}

/** Write any pending edit now; resolves when every save has landed (before leaving the canvas). */
export function flushPendingSave(): Promise<unknown> {
  if (saveTimer) flushSave();
  return saving;
}

/** This tab, as the live channel knows it: our own edits don't come back to us. */
export const clientId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2);

/**
 * What the server has, node by node and wire by wire (as JSON). Saving sends only what
 * differs from it, so collaborators editing other nodes never overwrite each other.
 */
const synced = { nodes: new Map<string, string>(), edges: new Map<string, string>() };

/** JSON with sorted keys: the database reorders object keys, a plain stringify would see changes everywhere. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export function markSynced(doc: Pick<GraphDoc, "nodes" | "edges">, reset = false) {
  if (reset) { synced.nodes.clear(); synced.edges.clear(); }
  for (const n of doc.nodes) synced.nodes.set(n.id, stable(n));
  for (const e of doc.edges) synced.edges.set(e.id, stable(e));
}

/** Local changes not yet on the server: a remote edit to such a node waits for ours. */
export function isDirty(id: string): boolean {
  const n = useStudio.getState().nodes.find((x) => x.id === id);
  if (!n) return false;
  return synced.nodes.get(id) !== stable(toDoc([n], [], { x: 0, y: 0, zoom: 1 }).nodes[0]);
}

function flushSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  const { graphId, nodes, edges, viewport } = useStudio.getState();
  const doc = toDoc(nodes, edges, viewport);
  const ids = new Set(doc.nodes.map((n) => n.id)), eids = new Set(doc.edges.map((e) => e.id));
  const ops = {
    client: clientId,
    nodes: doc.nodes.filter((n) => synced.nodes.get(n.id) !== stable(n)),
    edges: doc.edges.filter((e) => synced.edges.get(e.id) !== stable(e)),
    removeNodes: [...synced.nodes.keys()].filter((id) => !ids.has(id)),
    removeEdges: [...synced.edges.keys()].filter((id) => !eids.has(id)),
  };
  if (!ops.nodes.length && !ops.edges.length && !ops.removeNodes.length && !ops.removeEdges.length) return saving;
  // counted as synced right away, so a quick second edit sends only itself; a failure puts them back
  const before = { nodes: new Map(synced.nodes), edges: new Map(synced.edges) };
  for (const id of ops.removeNodes) synced.nodes.delete(id);
  for (const id of ops.removeEdges) synced.edges.delete(id);
  markSynced(ops);
  const body = JSON.stringify(ops);
  // chain saves so an older one can never land after a newer one
  saving = saving.then(() =>
    fetch(`/api/graphs/${graphId}/ops`, { method: "POST", headers: { "Content-Type": "application/json" }, body })
      .then((r) => { if (authLost(r)) return; if (!r.ok) throw new Error(); })
      .catch(() => {
        synced.nodes = before.nodes; synced.edges = before.edges;
        useStudio.getState().toast("Не удалось сохранить изменения. Проверьте соединение.", true);
      }),
  );
  return saving;
}

/** Someone else changed the project: take their nodes and wires, except ones we are editing right now. */
export function applyRemote(ops: { nodes?: GraphDoc["nodes"]; edges?: GraphDoc["edges"]; removeNodes?: string[]; removeEdges?: string[] }) {
  const s = useStudio.getState();
  const upNodes = (ops.nodes ?? []).filter((n) => !isDirty(n.id));
  const goneNodes = new Set(ops.removeNodes ?? []);
  const goneEdges = new Set(ops.removeEdges ?? []);
  const byId = new Map(s.nodes.map((n) => [n.id, n]));
  for (const n of upNodes) {
    const cur = byId.get(n.id);
    byId.set(n.id, { ...present(n as StudioNode), selected: cur?.selected ?? false, measured: cur?.measured } as StudioNode);
  }
  for (const id of goneNodes) byId.delete(id);
  const edges = new Map(s.edges.map((e) => [e.id, e]));
  for (const e of ops.edges ?? []) edges.set(e.id, { ...e, className: edgeClass(e) });
  for (const id of goneEdges) edges.delete(id);
  const nodes = [...byId.values()];
  const alive = new Set(nodes.map((n) => n.id));
  useStudio.setState({ nodes, edges: [...edges.values()].filter((e) => alive.has(e.source) && alive.has(e.target)) });
  markSynced({ nodes: upNodes, edges: ops.edges ?? [] });
  for (const id of goneNodes) synced.nodes.delete(id);
  for (const id of goneEdges) synced.edges.delete(id);
}

/** Too many changes for one message: fetch the whole document and take what we are not editing. */
export async function reloadRemote() {
  const { graphId } = useStudio.getState();
  const r = await fetch(`/api/graphs/${graphId}`, { cache: "no-store" }).catch(() => null);
  if (!r?.ok) return;
  const d = await r.json();
  const doc = d.doc as GraphDoc;
  const keep = new Set(doc.nodes.map((n) => n.id)), keepE = new Set(doc.edges.map((e) => e.id));
  applyRemote({
    nodes: doc.nodes, edges: doc.edges,
    removeNodes: [...synced.nodes.keys()].filter((id) => !keep.has(id) && !isDirty(id)),
    removeEdges: [...synced.edges.keys()].filter((id) => !keepE.has(id)),
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => { if (saveTimer) flushSave(); });
}

/** The session ended (logged out elsewhere, expired): back to sign-in, keeping nothing half-done. */
export function authLost(r: Response): boolean {
  if (r.status !== 401) return false;
  if (typeof window !== "undefined") window.location.assign("/login");
  return true;
}

// ---------------------------------------------------------------- polling

let pollTimer: ReturnType<typeof setTimeout> | null = null;

export async function refreshState() {
  const { graphId } = useStudio.getState();
  try {
    const r = await fetch(`/api/graphs/${graphId}/state`, { cache: "no-store" });
    if (authLost(r)) return;
    if (r.ok) useStudio.getState().setState(await r.json());
  } catch { /* transient; next poll retries */ }
}

export function ensurePolling() {
  if (pollTimer) return;
  const loop = async () => {
    await refreshState();
    const { state, submitting } = useStudio.getState();
    const busy = Object.keys(submitting).length > 0 || Object.keys(state).some((id) => isActive(state, id));
    pollTimer = busy ? setTimeout(loop, 1500) : null;
    if (!busy) void useStudio.getState().refreshBalance(); // everything settled: show the final charge
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
  fx: { usdRub: 85, date: "", source: "fallback", markup: 1.5 },
  trash: null,
  galleryOpen: false,
  templatesOpen: false,
  account: null,
  billingOpen: false,
  compareIds: [],
  publishOpen: false,
  role: "owner",
  me: null,
  peers: {},
  commentsRev: 0,
  comments: [],
  commentMode: false,
  openThread: null,
  draftPin: null,
  library: [],
  libraryEdit: null,
  libraryPrefill: null,
  draft: false,

  setDraft(on) {
    set({ draft: on });
    try { localStorage.setItem(`kaskad-draft-${get().graphId}`, on ? "1" : "0"); } catch { /* convenience only */ }
  },
  blockedVendors: [],

  setPanel(p) {
    set(p);
  },

  insertTemplate(t) {
    const { nodes: tn, edges: te } = liftInlinePrompts(t.build()).doc;
    const existing = get().nodes;
    // to the right of everything already on the canvas, top-aligned with it
    const right = existing.length ? Math.max(...existing.map((n) => n.position.x + (n.measured?.width ?? 340))) + 160 : 0;
    const top = existing.length ? Math.min(...existing.map((n) => n.position.y)) : 0;
    const minX = Math.min(...tn.map((n) => n.position.x)), minY = Math.min(...tn.map((n) => n.position.y));
    const ids = new Map(tn.map((n) => [n.id, newId("n")]));
    const nodes = tn.map((n) => present({
      ...n, id: ids.get(n.id)!, selected: true,
      position: { x: right + n.position.x - minX, y: top + n.position.y - minY },
    } as StudioNode));
    const edges: Edge[] = te.map((e) => ({
      ...e, id: newId("e"), source: ids.get(e.source)!, target: ids.get(e.target)!, className: edgeClass(e),
    }));
    set((s) => ({ nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), ...nodes], edges: [...s.edges, ...edges] }));
    scheduleSave();
    return nodes.map((n) => n.id);
  },

  init(graphId, doc, state, fx) {
    let draft = false;
    try { draft = localStorage.getItem(`kaskad-draft-${graphId}`) === "1"; } catch { /* convenience only */ }
    set({ draft });
    const lifted = liftInlinePrompts(doc);
    const { nodes, edges } = fromDoc(lifted.doc);
    // everyone keeps their own view of a shared canvas
    let viewport = doc.viewport ?? { x: 80, y: 80, zoom: 1 };
    try { const v = localStorage.getItem(`kaskad-vp-${graphId}`); if (v) viewport = JSON.parse(v); } catch { /* default view */ }
    markSynced(doc, true);
    set({ graphId, nodes, edges, viewport, state, fx });
    if (lifted.changed) scheduleSave();
    if (Object.keys(state).some((id) => isActive(state, id))) ensurePolling();
  },

  addPromptFor(nodeId) {
    const target = get().nodes.find((n) => n.id === nodeId);
    if (!target) return;
    const position = freeSpot(get().nodes, { x: target.position.x - 380, y: target.position.y });
    const id = newId("n");
    const node = present({ id, type: "prompt", position, data: { text: "" }, selected: true } as StudioNode);
    const edge: Edge = { id: newId("e"), source: id, sourceHandle: "text", target: nodeId, targetHandle: "prompt", className: edgeClass({ sourceHandle: "text" }) };
    set((s) => ({ nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), node], edges: [...s.edges, edge] }));
    scheduleSave();
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
    try { localStorage.setItem(`kaskad-vp-${get().graphId}`, JSON.stringify(v)); } catch { /* convenience only */ }
  },

  addNode(type, at, opts = {}) {
    const id = newId("n");
    const position = opts.exact ? at : freeSpot(get().nodes, at);
    let node: StudioNode;
    if (type === "prompt") node = { id, type, position, data: { text: "" } };
    else if (type === "image") node = { id, type, position, data: { fileKey: null, name: "", kind: "image" } };
    else if (type === "note") node = { id, type, position, data: { text: "", color: "yellow" } };
    else if (type === "group") node = { id, type, position, data: { title: "Группа", width: 720, height: 420 } };
    else if (type === "asset") {
      const item = get().library.find((l) => l.id === opts.assetId);
      if (!item) return "";
      node = { id, type, position, data: { assetId: item.id, kind: item.kind, name: item.name, text: item.description, files: item.files, addText: true } };
    }
    else if (type === "list") {
      node = opts.listKind && opts.listKind !== "text"
        ? { id, type, position, data: { kind: opts.listKind, files: [] } }
        : { id, type, position, data: { kind: "text", text: "" } };
    }
    else {
      const spec = (opts.modelId && getModel(opts.modelId)) || defaultModel(opts.kind ?? "image", get().blockedVendors);
      node = { id, type: "model", position, data: { kind: spec.kind, modelId: spec.id, prompt: "", params: defaultParams(spec) } };
    }
    set((s) => ({ nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), { ...present(node), selected: true }] }));
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
      return present({ ...n, id, data, position: { x: n.position.x + 48, y: n.position.y + 48 }, selected: true } as StudioNode);
    });
    const edges = clipboard.edges.map((e) => ({
      ...e, id: newId("e"), source: idMap.get(e.source)!, target: idMap.get(e.target)!, selected: false,
    }));
    set((s) => ({ nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), ...nodes], edges: [...s.edges, ...edges] }));
    // pasting again cascades instead of stacking on the same spot
    clipboard = { nodes, edges };
    scheduleSave();
  },

  compareWith(nodeId, modelIds) {
    const src = get().nodes.find((n) => n.id === nodeId);
    if (!src || src.type !== "model") return [];
    const inbound = get().edges.filter((e) => e.target === nodeId);
    const created: StudioNode[] = [];
    const edges: Edge[] = [];
    let y = src.position.y + (src.measured?.height ?? 420) + 40;
    for (const modelId of modelIds) {
      const spec = getModel(modelId);
      if (!spec) continue;
      const id = newId("n");
      const position = freeSpot([...get().nodes, ...created], { x: src.position.x, y });
      created.push(present({
        id, type: "model", position, selected: true,
        data: { kind: spec.kind, modelId, prompt: src.data.prompt, params: reconcileParams(spec, src.data.params) },
      } as StudioNode));
      y = position.y + 460;
      // same inputs, where the other model has a port for them
      for (const e of inbound) {
        if (!spec.inputs.some((p) => p.key === e.targetHandle)) continue;
        edges.push({ ...e, id: newId("e"), target: id });
      }
    }
    set((s) => ({
      nodes: [...s.nodes.map((n) => ({ ...n, selected: n.id === nodeId })), ...created],
      edges: [...s.edges, ...edges],
    }));
    scheduleSave();
    return [nodeId, ...created.map((n) => n.id)];
  },

  duplicateSelection() {
    if (get().copySelection()) get().paste();
  },

  groupSelection() {
    const picked = get().nodes.filter((n) => n.selected && n.type !== "group");
    if (!picked.length) { get().toast("Выдели ноды, чтобы собрать их в группу"); return; }
    const PAD = 36, HEAD = 44;
    const x0 = Math.min(...picked.map((n) => n.position.x)) - PAD;
    const y0 = Math.min(...picked.map((n) => n.position.y)) - PAD - HEAD;
    const x1 = Math.max(...picked.map((n) => n.position.x + (n.measured?.width ?? 320))) + PAD;
    const y1 = Math.max(...picked.map((n) => n.position.y + (n.measured?.height ?? 240))) + PAD;
    const node: GroupNodeT = {
      id: newId("g"), type: "group", position: { x: x0, y: y0 },
      data: { title: "Группа", width: Math.round(x1 - x0), height: Math.round(y1 - y0) },
    };
    set((s) => ({ nodes: [present(node), ...s.nodes] }));
    scheduleSave();
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

  async refreshBalance() {
    const account = get().account;
    if (!account) return;
    try {
      const [r, pr] = await Promise.all([
        fetch("/api/billing", { cache: "no-store" }),
        account.admin ? fetch("/api/admin/provider-balance", { cache: "no-store" }).catch(() => null) : null,
      ]);
      if (authLost(r) || !r.ok) return;
      const b = await r.json();
      const p = pr?.ok ? await pr.json() : null;
      set({ account: {
        ...get().account!, availableKop: b.balanceKop, reservedKop: b.reservedKop,
        providerUsd: p ? p.usd : account.providerUsd,
      } });
    } catch { /* keep the last known balance */ }
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
        body: "Провайдер уже делает это видео и возьмёт за него оплату. Если остановить, стоимость спишется, а результат не сохранится.",
        confirm: "Остановить",
      });
      if (!ok) return;
    }
    try {
      // a batch stops as a whole
      const ids = job.activeIds.length ? job.activeIds : [job.id];
      const rs = await Promise.all(ids.map((jid) => fetch(`/api/jobs/${jid}/cancel`, { method: "POST" })));
      if (rs.some(authLost)) return;
      if (rs.some((r) => !r.ok && r.status !== 409)) throw new Error();
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
    if (get().role === "viewer") { get().toast("Только просмотр: запускать может владелец или редактор", true); return; }
    const { nodes, edges, viewport, state, graphId } = get();
    const doc = toDoc(nodes, edges, viewport);
    const plan: PlanResult = planRun({
      doc,
      targets: targets.filter((t) => !isActive(state, t)),
      mode,
      hasOutput: (id) => !!state[id]?.output,
      isActive: (id) => isActive(state, id),
      draft: get().draft,
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
        body: JSON.stringify({ graphId, doc: toDoc(get().nodes, get().edges, get().viewport), targets, mode, draft: get().draft }),
      });
      if (authLost(r)) return;
      const data = await r.json().catch(() => ({}));
      if (r.status === 402) {
        const canPay = !!get().account?.payments;
        get().toast(data.error ?? "Не хватает средств", true,
          canPay ? { label: "Пополнить", run: () => get().setPanel({ billingOpen: true }) } : undefined);
      } else if (!r.ok) {
        const msg = data.error ?? "Не удалось запустить";
        if (data.nodeId) set((s) => ({ localErrors: { ...s.localErrors, [data.nodeId]: msg } }));
        else get().toast(msg, true);
      }
      await Promise.all([refreshState(), get().refreshBalance()]);
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
