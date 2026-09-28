import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { defaultModel, defaultParams } from "@/lib/models/registry";
import { blockedVendors } from "./providers";
import type { GraphDoc } from "@/lib/graph/types";
import type { GraphState, JobStatus, NodeState, OutputVersion } from "@/lib/jobs";
import { db, graphs, jobs, outputs } from "./db";
import { fileUrl } from "./storage";

/** Starter canvas: a real chain (prompt → image → video) the user can run immediately. */
function starterDoc(): GraphDoc {
  const blocked = blockedVendors();
  const img = defaultModel("image", blocked);
  const vid = defaultModel("video", blocked);
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
        data: { kind: "video", modelId: vid.id, prompt: "", params: defaultParams(vid) },
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
  const [row] = await db.select().from(graphs).where(eq(graphs.ownerId, userId)).orderBy(desc(graphs.updatedAt)).limit(1);
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
  job_id: string | null;
  status: JobStatus | null;
  error: string | null;
  cost_usd: string | null;
  charged_kop: string | null;
  model_id: string | null;
  params: Record<string, unknown> | null;
  job_created: Date | null;
  started_at: Date | null;
  output_id: string | null;
  kind: "text" | "image" | "video" | null;
  file_key: string | null;
  mime: string | null;
  text: string | null;
  output_created: Date | null;
  output_count: number;
  batch: { id: string; file_key: string | null }[] | null;
}

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

/** Latest job and latest result for every node that has ever run. */
export async function graphState(graphId: string): Promise<GraphState> {
  const rows = await db.execute<StateRow>(sql`
    with lj as (
      select distinct on (node_id) node_id, id, status, error, cost_usd, created_at, started_at,
             model_id, input->'params' as params
      from jobs where graph_id = ${graphId}
      order by node_id, created_at desc
    ), lo as (
      select distinct on (node_id) node_id, id, kind, file_key, mime, text, created_at
      from outputs where graph_id = ${graphId}
      order by node_id, created_at desc
    ), oc as (
      select node_id, count(*)::int as n from outputs where graph_id = ${graphId} group by node_id
    ), lsj as (
      select distinct on (node_id) node_id, id
      from jobs where graph_id = ${graphId} and status = 'succeeded'
      order by node_id, created_at desc
    ), b as (
      select o.node_id, json_agg(json_build_object('id', o.id, 'file_key', o.file_key) order by o.created_at, o.id) as batch
      from outputs o join lsj on lsj.id = o.job_id
      group by o.node_id having count(*) > 1
    )
    select coalesce(lj.node_id, lo.node_id) as node_id,
           lj.id as job_id, lj.status, lj.error, lj.cost_usd, lj.created_at as job_created, lj.started_at,
           lj.model_id, lj.params,
           (select -l.amount_kop from ledger l where l.job_id = lj.id and l.kind = 'charge') as charged_kop,
           lo.id as output_id, lo.kind, lo.file_key, lo.mime, lo.text, lo.created_at as output_created,
           coalesce(oc.n, 0) as output_count, b.batch
    from lj full outer join lo on lo.node_id = lj.node_id
    left join oc on oc.node_id = coalesce(lj.node_id, lo.node_id)
    left join b on b.node_id = coalesce(lj.node_id, lo.node_id)
  `);

  const state: GraphState = {};
  for (const r of rows) {
    const s: NodeState = {
      job: r.job_id ? {
        id: r.job_id,
        status: r.status!,
        error: r.error,
        costUsd: r.cost_usd === null ? null : Number(r.cost_usd),
        chargedKop: r.charged_kop === null ? null : Number(r.charged_kop),
        modelId: r.model_id ?? "",
        params: r.params ?? {},
        createdAt: iso(r.job_created)!,
        startedAt: iso(r.started_at),
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
