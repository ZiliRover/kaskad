import { eq, sql } from "drizzle-orm";
import { defaultParams, getModel } from "@/lib/models/registry";
import type { GraphDoc } from "@/lib/graph/types";
import type { GraphState, JobStatus, NodeState } from "@/lib/jobs";
import { db, graphs } from "./db";
import { fileUrl } from "./storage";

export const DEFAULT_GRAPH_ID = "default";

/** Starter canvas: a real chain (prompt → image → video) the user can run immediately. */
function starterDoc(): GraphDoc {
  const img = getModel("google/gemini-3.1-flash-image")!;
  const vid = getModel("bytedance/seedance-2.0-fast")!;
  return {
    nodes: [
      {
        id: "p1", type: "prompt", position: { x: 0, y: 40 },
        data: { text: "Кинематографичный кадр: ночной город под дождём, неоновые вывески отражаются в мокром асфальте, одинокий прохожий с красным зонтом" },
      },
      {
        id: "m1", type: "model", position: { x: 400, y: 0 },
        data: { kind: "image", modelId: img.id, prompt: "", params: defaultParams(img) },
      },
      {
        id: "m2", type: "model", position: { x: 820, y: 0 },
        data: {
          kind: "video", modelId: vid.id,
          prompt: "Камера медленно наезжает на прохожего, капли дождя падают, неон мерцает",
          params: defaultParams(vid),
        },
      },
    ],
    edges: [
      { id: "e1", source: "p1", sourceHandle: "text", target: "m1", targetHandle: "prompt" },
      { id: "e2", source: "m1", sourceHandle: "image", target: "m2", targetHandle: "first_frame" },
    ],
    viewport: { x: 80, y: 120, zoom: 0.9 },
  };
}

export async function loadGraph(id: string) {
  const [row] = await db.select().from(graphs).where(eq(graphs.id, id));
  if (row) return row;
  if (id !== DEFAULT_GRAPH_ID) return null;
  const [created] = await db.insert(graphs)
    .values({ id, name: "Без названия", doc: starterDoc() })
    .onConflictDoNothing()
    .returning();
  return created ?? (await db.select().from(graphs).where(eq(graphs.id, id)))[0];
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
  job_created: Date | null;
  started_at: Date | null;
  output_id: string | null;
  kind: "text" | "image" | "video" | null;
  file_key: string | null;
  mime: string | null;
  text: string | null;
  output_created: Date | null;
  output_count: number;
}

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

/** Latest job and latest result for every node that has ever run. */
export async function graphState(graphId: string): Promise<GraphState> {
  const rows = await db.execute<StateRow>(sql`
    with lj as (
      select distinct on (node_id) node_id, id, status, error, cost_usd, created_at, started_at
      from jobs where graph_id = ${graphId}
      order by node_id, created_at desc
    ), lo as (
      select distinct on (node_id) node_id, id, kind, file_key, mime, text, created_at
      from outputs where graph_id = ${graphId}
      order by node_id, created_at desc
    ), oc as (
      select node_id, count(*)::int as n from outputs where graph_id = ${graphId} group by node_id
    )
    select coalesce(lj.node_id, lo.node_id) as node_id,
           lj.id as job_id, lj.status, lj.error, lj.cost_usd, lj.created_at as job_created, lj.started_at,
           lo.id as output_id, lo.kind, lo.file_key, lo.mime, lo.text, lo.created_at as output_created,
           coalesce(oc.n, 0) as output_count
    from lj full outer join lo on lo.node_id = lj.node_id
    left join oc on oc.node_id = coalesce(lj.node_id, lo.node_id)
  `);

  const state: GraphState = {};
  for (const r of rows) {
    const s: NodeState = {
      job: r.job_id ? {
        id: r.job_id,
        status: r.status!,
        error: r.error,
        costUsd: r.cost_usd === null ? null : Number(r.cost_usd),
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
    };
    state[r.node_id] = s;
  }
  return state;
}
