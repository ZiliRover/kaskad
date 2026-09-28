import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { defaultModel, defaultParams, getModel, isBlocked, reconcileParams } from "@/lib/models/registry";
import { blockedVendors } from "./providers";
import type { GraphDoc } from "@/lib/graph/types";
import type { ProjectSummary } from "@/lib/projects";
import type { GraphState, JobStatus, NodeState, OutputVersion } from "@/lib/jobs";
import { db, graphs, jobs, outputs } from "./db";
import { fileUrl } from "./storage";

/** Fast Seedance at 480p: the whole starter chain costs about 30 ₽, well inside the welcome bonus. */
const STARTER_VIDEO = "bytedance/seedance-2.0-fast";

/** Starter canvas: a real chain (prompt → image → video) a new user can run on the welcome bonus. */
function starterDoc(): GraphDoc {
  const blocked = blockedVendors();
  const img = defaultModel("image", blocked);
  const fast = getModel(STARTER_VIDEO);
  const vid = fast && !isBlocked(fast.id, blocked) ? fast : defaultModel("video", blocked);
  const vidParams = reconcileParams(vid, { ...defaultParams(vid), resolution: "480p" });
  return {
    nodes: [
      {
        id: "p1", type: "prompt", position: { x: 0, y: 40 },
        // no people in the starter: some video models refuse frames that look like a real person
        data: { text: "Кинематографичный кадр: пустая ночная улица под дождём, неоновые вывески отражаются в мокром асфальте, красный зонт лежит у фонаря" },
      },
      {
        id: "m1", type: "model", position: { x: 400, y: 0 },
        data: { kind: "image", modelId: img.id, prompt: "", params: defaultParams(img) },
      },
      {
        id: "p2", type: "prompt", position: { x: 820, y: 260 },
        data: { text: "Камера медленно движется вперёд по улице, капли дождя падают, неон мерцает" },
      },
      {
        id: "m2", type: "model", position: { x: 1240, y: 0 },
        data: { kind: "video", modelId: vid.id, prompt: "", params: vidParams },
      },
    ],
    edges: [
      { id: "e1", source: "p1", sourceHandle: "text", target: "m1", targetHandle: "prompt" },
      { id: "e2", source: "m1", sourceHandle: "image", target: "m2", targetHandle: "first_frame" },
      { id: "e3", source: "p2", sourceHandle: "text", target: "m2", targetHandle: "prompt" },
    ],
    viewport: { x: 40, y: 140, zoom: 0.66 },
  };
}

/** The canvas a user opens: their most recently edited one, created on first visit. */
export async function userGraph(userId: string) {
  const [row] = await db.select().from(graphs).where(and(eq(graphs.ownerId, userId), isNull(graphs.appId)))
    .orderBy(desc(graphs.updatedAt)).limit(1);
  if (row) return row;
  const [created] = await db.insert(graphs)
    .values({ id: randomUUID(), ownerId: userId, name: "Без названия", doc: starterDoc() })
    .returning();
  return created;
}

/** A graph, only if this user owns it. Someone else's graph looks exactly like a missing one. */
export async function ownedGraph(id: string, userId: string) {
  const [row] = await db.select().from(graphs).where(and(eq(graphs.id, id), eq(graphs.ownerId, userId)));
  return row ?? null;
}


/** The user's canvases, most recently edited first. */
export async function listProjects(userId: string): Promise<ProjectSummary[]> {
  const rows = await db.select({ id: graphs.id, name: graphs.name, updatedAt: graphs.updatedAt, doc: graphs.doc })
    .from(graphs).where(and(eq(graphs.ownerId, userId), isNull(graphs.appId))).orderBy(desc(graphs.updatedAt));
  return rows.map((r) => ({
    id: r.id, name: r.name, updatedAt: r.updatedAt.toISOString(),
    nodes: r.doc.nodes.filter((n) => n.type !== "note" && n.type !== "group").length,
  }));
}

const EMPTY_DOC: GraphDoc = { nodes: [], edges: [], viewport: { x: 80, y: 80, zoom: 1 } };

/**
 * A new canvas: empty, the starter chain, or a copy of one of the user's canvases.
 * A copy takes the graph, not its results: picks of specific results are dropped.
 */
export async function createProject(userId: string, opts: { name?: string; from?: "empty" | "starter"; copyOf?: string }) {
  let doc: GraphDoc = opts.from === "starter" ? starterDoc() : EMPTY_DOC;
  let name = opts.name?.trim() || "Новый проект";
  if (opts.copyOf) {
    const src = await ownedGraph(opts.copyOf, userId);
    if (!src) return null;
    doc = {
      ...src.doc,
      nodes: src.doc.nodes.map((n) => n.type === "model" ? { ...n, data: { ...n.data, pinnedOutputId: undefined } } : n),
    };
    name = opts.name?.trim() || `${src.name} (копия)`;
  }
  const [row] = await db.insert(graphs).values({ id: randomUUID(), ownerId: userId, name: name.slice(0, 80), doc }).returning();
  return row;
}

export async function renameProject(id: string, userId: string, name: string) {
  const r = await db.update(graphs).set({ name: name.trim().slice(0, 80) })
    .where(and(eq(graphs.id, id), eq(graphs.ownerId, userId))).returning({ id: graphs.id });
  return r.length > 0;
}

/** Deletes a canvas with its runs and results. Refused while something on it is generating. */
export async function deleteProject(id: string, userId: string): Promise<"deleted" | "busy" | "missing"> {
  if (!(await ownedGraph(id, userId))) return "missing";
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(jobs)
    .where(and(eq(jobs.graphId, id), sql`${jobs.status} in ('queued', 'running')`));
  if (n > 0) return "busy";
  await db.delete(graphs).where(and(eq(graphs.id, id), eq(graphs.ownerId, userId)));
  return "deleted";
}

export async function graphOwner(id: string): Promise<string | null> {
  const [row] = await db.select({ ownerId: graphs.ownerId }).from(graphs).where(eq(graphs.id, id));
  return row?.ownerId ?? null;
}

/** Results of one node (its versions), or of the whole graph (gallery) when nodeId is null. */
export async function listOutputs(graphId: string, nodeId: string | null, limit = 100): Promise<OutputVersion[]> {
  const rows = await db.select({
    id: outputs.id, nodeId: outputs.nodeId, kind: outputs.kind, fileKey: outputs.fileKey, mime: outputs.mime,
    text: outputs.text, createdAt: outputs.createdAt, costUsd: jobs.costUsd,
  })
    .from(outputs)
    .innerJoin(jobs, eq(jobs.id, outputs.jobId))
    .where(nodeId ? and(eq(outputs.graphId, graphId), eq(outputs.nodeId, nodeId)) : eq(outputs.graphId, graphId))
    .orderBy(desc(outputs.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    nodeId: r.nodeId,
    fileKey: r.fileKey,
    kind: r.kind,
    url: r.fileKey ? fileUrl(r.fileKey) : null,
    mime: r.mime,
    text: r.text,
    createdAt: iso(r.createdAt)!,
    costUsd: r.costUsd === null ? null : Number(r.costUsd),
  }));
}

export async function saveGraph(id: string, doc: GraphDoc) {
  await db.update(graphs).set({ doc, updatedAt: new Date() }).where(eq(graphs.id, id));
}

interface StateRow extends Record<string, unknown> {
  node_id: string;
  first_id: string | null;
  first_status: JobStatus | null;
  total: number | null;
  done: number | null;
  bad: number | null;
  running: number | null;
  queued: number | null;
  canceled: number | null;
  fanned: boolean | null;
  error: string | null;
  cost_usd: string | null;
  charged_kop: string | null;
  model_id: string | null;
  params: Record<string, unknown> | null;
  job_created: Date | null;
  started_at: Date | null;
  active_ids: string[] | null;
  output_id: string | null;
  kind: "text" | "image" | "video" | "audio" | null;
  file_key: string | null;
  mime: string | null;
  text: string | null;
  output_created: Date | null;
  output_count: number;
  batch: { id: string; file_key: string | null }[] | null;
}

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

/** One status for a node's latest run, which may be a batch of jobs. */
function runStatus(r: StateRow): JobStatus {
  if (r.running) return "running";
  if (r.queued) return "queued";
  if (r.done) return "succeeded";
  if (r.canceled && !r.bad) return "canceled";
  return r.first_status ?? "failed";
}

/** Latest run and latest result for every node that has ever run. A batch run is summed up. */
export async function graphState(graphId: string): Promise<GraphState> {
  const rows = await db.execute<StateRow>(sql`
    with lr as (
      select distinct on (node_id) node_id, run_id
      from jobs where graph_id = ${graphId}
      order by node_id, created_at desc
    ), agg as (
      select j.node_id,
             (array_agg(j.id order by j.item nulls first, j.created_at))[1] as first_id,
             (array_agg(j.status order by j.item nulls first, j.created_at))[1] as first_status,
             count(*)::int as total,
             count(*) filter (where j.status = 'succeeded')::int as done,
             count(*) filter (where j.status in ('failed', 'skipped'))::int as bad,
             count(*) filter (where j.status = 'running')::int as running,
             count(*) filter (where j.status = 'queued')::int as queued,
             count(*) filter (where j.status = 'canceled')::int as canceled,
             bool_or(j.item is not null) as fanned,
             (array_agg(j.error order by j.item nulls first) filter (where j.error is not null))[1] as error,
             sum(j.cost_usd) as cost_usd,
             (array_agg(j.model_id))[1] as model_id,
             (array_agg(j.input->'params'))[1] as params,
             max(j.created_at) as job_created,
             min(j.started_at) as started_at,
             coalesce(array_agg(j.id) filter (where j.status in ('queued', 'running')), '{}') as active_ids,
             (select -sum(l.amount_kop) from ledger l
               where l.kind = 'charge' and l.job_id = any(array_agg(j.id))) as charged_kop
      from jobs j join lr on lr.node_id = j.node_id and lr.run_id = j.run_id
      where j.graph_id = ${graphId}
      group by j.node_id
    ), lo as (
      select distinct on (node_id) node_id, id, kind, file_key, mime, text, created_at
      from outputs where graph_id = ${graphId}
      order by node_id, created_at desc
    ), oc as (
      select node_id, count(*)::int as n from outputs where graph_id = ${graphId} group by node_id
    ), lsr as (
      -- the latest run that produced something: its results are the node's current batch
      select distinct on (node_id) node_id, run_id
      from jobs where graph_id = ${graphId} and status = 'succeeded'
      order by node_id, created_at desc
    ), b as (
      select j.node_id,
             json_agg(json_build_object('id', o.id, 'file_key', o.file_key) order by j.item nulls first, o.created_at, o.id) as batch
      from outputs o
      join jobs j on j.id = o.job_id
      join lsr on lsr.node_id = j.node_id and lsr.run_id = j.run_id
      where j.status = 'succeeded'
      group by j.node_id having count(*) > 1
    )
    select coalesce(agg.node_id, lo.node_id) as node_id,
           agg.first_id, agg.first_status, agg.total, agg.done, agg.bad, agg.running, agg.queued, agg.canceled,
           agg.fanned, agg.error, agg.cost_usd, agg.charged_kop, agg.model_id, agg.params,
           agg.job_created, agg.started_at, agg.active_ids,
           lo.id as output_id, lo.kind, lo.file_key, lo.mime, lo.text, lo.created_at as output_created,
           coalesce(oc.n, 0) as output_count, b.batch
    from agg full outer join lo on lo.node_id = agg.node_id
    left join oc on oc.node_id = coalesce(agg.node_id, lo.node_id)
    left join b on b.node_id = coalesce(agg.node_id, lo.node_id)
  `);

  const state: GraphState = {};
  for (const r of rows) {
    const status = r.first_id ? runStatus(r) : null;
    const s: NodeState = {
      job: r.first_id && status ? {
        id: r.first_id,
        status,
        // a batch that partly failed still shows why
        error: status === "succeeded" && !r.bad ? null : r.error,
        costUsd: r.cost_usd === null ? null : Number(r.cost_usd),
        chargedKop: r.charged_kop === null ? null : Number(r.charged_kop),
        modelId: r.model_id ?? "",
        params: r.params ?? {},
        createdAt: iso(r.job_created)!,
        startedAt: iso(r.started_at),
        activeIds: r.active_ids ?? [],
        items: r.fanned ? { total: r.total ?? 0, done: r.done ?? 0, failed: r.bad ?? 0 } : null,
      } : null,
      output: r.output_id ? {
        id: r.output_id,
        kind: r.kind!,
        url: r.file_key ? fileUrl(r.file_key) : null,
        mime: r.mime,
        text: r.text,
        createdAt: iso(r.output_created)!,
      } : null,
      outputCount: r.output_count,
      batch: (r.batch ?? []).map((x) => ({ id: x.id, url: x.file_key ? fileUrl(x.file_key) : null })),
    };
    state[r.node_id] = s;
  }
  return state;
}
