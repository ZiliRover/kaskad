/**
 * Publishing a graph as an app, and running an app.
 *
 * Publishing freezes a copy of the graph. Files the app always uses (a style reference,
 * say) are copied under uploads/app-<id>/, readable by anyone running the app.
 * Running fills the fields into a private copy of that graph owned by the runner
 * (graphs.app_id), so results, billing and access all work like a normal run.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { AppField, AppInfo, AppValues } from "@/lib/apps";
import { listItems, type GraphDoc, type GraphNode } from "@/lib/graph/types";
import { fanOut } from "@/lib/graph/plan";
import { estimate } from "@/lib/models/pricing";
import { getModel } from "@/lib/models/registry";
import { canReadFile } from "./access";
import { apps, db, graphs, type AppRow } from "./db";
import { ownedGraph, saveGraph } from "./graphs";
import { createRun, type CreateRunResult } from "./runs";
import { mimeForKey, newKey, putFile, readStored } from "./storage";

export class AppError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function fieldType(n: GraphNode): Pick<AppField, "type" | "kind"> | null {
  if (n.type === "prompt") return { type: "text" };
  if (n.type === "image") return { type: "file", kind: n.data.kind ?? "image" };
  if (n.type === "list") return n.data.kind === "text" ? { type: "list-text" } : { type: "list-file", kind: n.data.kind };
  return null;
}

async function copyFile(key: string, appId: string): Promise<string> {
  const copy = newKey(`uploads/app-${appId}`, mimeForKey(key));
  await putFile(copy, new Uint8Array(await readStored(key)));
  return copy;
}

export async function publishApp(userId: string, graphId: string, input: {
  name: string; description: string; fields: AppField[]; outputs: string[];
}): Promise<AppRow> {
  const graph = await ownedGraph(graphId, userId);
  if (!graph) throw new AppError("Проект не найден", 404);
  const byId = new Map(graph.doc.nodes.map((n) => [n.id, n]));

  const fields: AppField[] = [];
  for (const f of input.fields) {
    const node = byId.get(f.nodeId);
    const t = node && fieldType(node);
    if (!t) throw new AppError("Поле формы ссылается на ноду, которой нет");
    fields.push({ ...f, ...t });
  }
  const outputs_ = [...new Set(input.outputs)].filter((id) => byId.get(id)?.type === "model");
  if (!outputs_.length) throw new AppError("Выбери хотя бы одну ноду с результатом");

  const id = randomUUID();
  const asField = new Set(fields.map((f) => f.nodeId));
  const nodes: GraphNode[] = [];
  for (const n of graph.doc.nodes) {
    if (n.type === "group") continue;
    if (n.type === "model") { nodes.push({ ...n, data: { ...n.data, pinnedOutputId: undefined } }); continue; }
    if (asField.has(n.id)) {
      // the runner brings these; keep the author's text as an example, never their files
      if (n.type === "image") nodes.push({ ...n, data: { ...n.data, fileKey: null, name: "" } });
      else if (n.type === "list" && n.data.kind !== "text") nodes.push({ ...n, data: { ...n.data, files: [] } });
      else nodes.push(n);
      continue;
    }
    // fixed inputs travel with the app: copy their files where runners may read them
    if (n.type === "image" && n.data.fileKey) nodes.push({ ...n, data: { ...n.data, fileKey: await copyFile(n.data.fileKey, id) } });
    else if (n.type === "list" && n.data.kind !== "text") {
      nodes.push({ ...n, data: { ...n.data, files: await Promise.all((n.data.files ?? []).map((k) => copyFile(k, id))) } });
    } else if (n.type === "asset") {
      nodes.push({ ...n, data: { ...n.data, files: await Promise.all(n.data.files.map((k) => copyFile(k, id))) } });
    } else nodes.push(n);
  }
  const doc: GraphDoc = { nodes, edges: graph.doc.edges, viewport: graph.doc.viewport };

  const [row] = await db.insert(apps).values({
    id, ownerId: userId, sourceGraphId: graphId,
    name: input.name.trim().slice(0, 80) || graph.name, description: input.description.trim().slice(0, 600),
    doc, fields, outputs: outputs_,
  }).returning();
  return row;
}

export async function listApps(userId: string) {
  return db.select({ id: apps.id, name: apps.name, createdAt: apps.createdAt, sourceGraphId: apps.sourceGraphId })
    .from(apps).where(eq(apps.ownerId, userId)).orderBy(desc(apps.createdAt));
}

export async function deleteApp(id: string, userId: string): Promise<boolean> {
  const r = await db.delete(apps).where(and(eq(apps.id, id), eq(apps.ownerId, userId))).returning({ id: apps.id });
  return r.length > 0;
}

export async function getApp(id: string): Promise<AppRow | null> {
  const [row] = await db.select().from(apps).where(eq(apps.id, id));
  return row ?? null;
}

export function appInfo(app: AppRow): AppInfo {
  const byId = new Map(app.doc.nodes.map((n) => [n.id, n]));
  return {
    id: app.id,
    name: app.name,
    description: app.description,
    fields: app.fields.map((f) => {
      const n = byId.get(f.nodeId);
      const def = n?.type === "prompt" ? n.data.text : n?.type === "list" && n.data.kind === "text" ? n.data.text ?? "" : undefined;
      return { ...f, default: def };
    }),
    outputs: app.outputs.flatMap((id) => {
      const n = byId.get(id);
      if (n?.type !== "model") return [];
      // a tool at the end (a caption, a join) is the result itself, not a model worth naming
      const spec = getModel(n.data.modelId);
      const label = !spec || spec.pricing.type === "free" ? "Результат" : spec.name;
      return [{ nodeId: id, label, kind: n.data.kind }];
    }),
  };
}

/** The runner's private graph for this app, created on the first run. */
async function runnerGraph(app: AppRow, userId: string) {
  const [g] = await db.select().from(graphs).where(and(eq(graphs.appId, app.id), eq(graphs.ownerId, userId)));
  if (g) return g;
  const [created] = await db.insert(graphs)
    .values({ id: randomUUID(), ownerId: userId, appId: app.id, name: app.name, doc: app.doc })
    .returning();
  return created;
}

export async function runnerGraphId(appId: string, userId: string): Promise<string | null> {
  const [g] = await db.select({ id: graphs.id }).from(graphs).where(and(eq(graphs.appId, appId), eq(graphs.ownerId, userId)));
  return g?.id ?? null;
}

/** Fill the form into the app's graph and start it, billed to the runner. */
export async function runApp(app: AppRow, userId: string, values: AppValues, unlimited: boolean):
  Promise<CreateRunResult & { graphId: string }> {
  const doc: GraphDoc = structuredClone(app.doc);
  const byId = new Map(doc.nodes.map((n, i) => [n.id, i]));

  for (const f of app.fields) {
    const i = byId.get(f.nodeId);
    if (i === undefined) continue;
    const node = doc.nodes[i];
    const raw = values[f.nodeId];
    const list = Array.isArray(raw) ? raw.map((x) => x.trim()).filter(Boolean) : typeof raw === "string" && raw.trim() ? [raw.trim()] : [];
    if (f.required && !list.length) throw new AppError(`Заполни поле «${f.label}»`);
    if (!list.length) continue;
    if (f.type === "file" || f.type === "list-file") {
      for (const key of list) if (!(await canReadFile(key, userId))) throw new AppError(`Файл в поле «${f.label}» недоступен. Загрузи его заново.`);
    }
    if (node.type === "prompt" && f.type === "text") node.data = { text: list.join("\n") };
    else if (node.type === "image" && f.type === "file") node.data = { ...node.data, fileKey: list[0], name: "" };
    else if (node.type === "list" && f.type === "list-text") node.data = { ...node.data, text: list.join("\n") };
    else if (node.type === "list" && f.type === "list-file") node.data = { ...node.data, files: list };
    if (node.type === "list" && !listItems(node.data).length && f.required) throw new AppError(`Заполни поле «${f.label}»`);
  }

  const graph = await runnerGraph(app, userId);
  await saveGraph(graph.id, doc);
  const r = await createRun(graph.id, userId, doc, app.outputs, "all", unlimited);
  return { ...r, graphId: graph.id };
}

/**
 * Price of one run, for the form. List fields count as one item here; the page multiplies
 * by the number of items the runner enters. Computed on the server so the author's
 * prompts never reach the runner's browser.
 */
export function appPrice(app: AppRow): { unitUsd: number; approx: boolean; perItem: boolean } {
  const listFields = new Set(app.fields.filter((f) => f.type.startsWith("list")).map((f) => f.nodeId));
  const doc: GraphDoc = {
    ...app.doc,
    nodes: app.doc.nodes.map((n) => n.type === "list" && listFields.has(n.id)
      ? { ...n, data: n.data.kind === "text" ? { ...n.data, text: "x" } : { ...n.data, files: ["x"] } }
      : n),
  };
  const fans = fanOut(doc);
  let unitUsd = 0, approx = false;
  for (const n of doc.nodes) {
    if (n.type !== "model") continue;
    const spec = getModel(n.data.modelId);
    if (!spec) continue;
    const counts: Record<string, number> = {};
    for (const e of doc.edges) if (e.target === n.id) counts[e.targetHandle] = (counts[e.targetHandle] ?? 0) + 1;
    const est = estimate(spec, { params: n.data.params, inputCounts: counts, promptChars: 400 });
    if (est.usd === null) { approx = true; continue; }
    unitUsd += est.usd * Math.max(1, fans.get(n.id) ?? 0);
    approx ||= est.approx;
  }
  return { unitUsd, approx, perItem: listFields.size > 0 };
}

