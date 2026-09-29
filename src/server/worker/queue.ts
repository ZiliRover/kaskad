import { sql } from "drizzle-orm";
import { getModel } from "@/lib/models/registry";
import { settleJob } from "../billing";
import { db, type JobRow } from "../db";
import { getFx } from "../fx";
import { publish } from "../live";

/** Tell everyone looking at the project that job states changed (they refetch). */
const notify = (graphId: string) => { void publish(graphId, { t: "state" }).catch(() => {}); };

const HEARTBEAT_STALE_SEC = 45;

type RawJob = Record<string, unknown>;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function toJob(r: RawJob): JobRow {
  return {
    id: r.id as string,
    runId: r.run_id as string,
    graphId: r.graph_id as string,
    nodeId: r.node_id as string,
    item: r.item === null || r.item === undefined ? null : Number(r.item),
    userId: (r.user_id as string | null) ?? null,
    holdKop: Number(r.hold_kop ?? 0),
    kind: r.kind as JobRow["kind"],
    modelId: r.model_id as string,
    input: r.input as JobRow["input"],
    dependsOn: (r.depends_on as string[]) ?? [],
    status: r.status as JobRow["status"],
    externalId: (r.external_id as string | null) ?? null,
    error: (r.error as string | null) ?? null,
    estimateUsd: (r.estimate_usd as string | null) ?? null,
    costUsd: (r.cost_usd as string | null) ?? null,
    attempts: Number(r.attempts ?? 0),
    createdAt: new Date(r.created_at as string),
    startedAt: r.started_at ? new Date(r.started_at as string) : null,
    heartbeatAt: r.heartbeat_at ? new Date(r.heartbeat_at as string) : null,
    finishedAt: r.finished_at ? new Date(r.finished_at as string) : null,
  };
}

/** Atomically take the oldest queued job whose dependencies have all succeeded. */
export async function claimJob(): Promise<JobRow | null> {
  const rows = await db.execute<RawJob>(sql`
    update jobs set status = 'running', attempts = attempts + 1,
                    started_at = coalesce(started_at, now()), heartbeat_at = now()
    where id = (
      select j.id from jobs j
      where j.status = 'queued'
        and not exists (
          select 1 from jobs d where d.id = any(j.depends_on) and d.status <> 'succeeded'
        )
      order by j.created_at
      for update skip locked
      limit 1
    )
    returning *
  `);
  const job = rows[0] ? toJob(rows[0]) : null;
  if (job) notify(job.graphId);
  return job;
}

export async function heartbeat(jobId: string, externalId?: string) {
  await db.execute(sql`
    update jobs set heartbeat_at = now()
      ${externalId ? sql`, external_id = ${externalId}` : sql``}
    where id = ${jobId}
  `);
}

export async function completeJob(
  job: JobRow, results: { fileKey?: string; mime?: string; text?: string }[], costUsd: number | null,
) {
  const cost = costUsd === null ? null : String(costUsd);
  const fx = costUsd ? await getFx() : null;
  await db.transaction(async (tx) => {
    // only a still-running job may succeed: a result arriving after cancel is discarded
    const done = await tx.execute(sql`
      update jobs set status = 'succeeded', finished_at = now(), error = null, cost_usd = ${cost}
      where id = ${job.id} and status = 'running'
      returning id
    `);
    if (done.length) {
      // one row per variant, in the order the provider returned them
      for (const result of results) {
        await tx.execute(sql`
          insert into outputs (graph_id, node_id, job_id, kind, file_key, mime, text, created_at)
          values (${job.graphId}, ${job.nodeId}, ${job.id}, ${job.kind},
                  ${result.fileKey ?? null}, ${result.mime ?? null}, ${result.text ?? null},
                  clock_timestamp()) -- now() is frozen per transaction; variants must keep their order
        `);
      }
    } else {
      // canceled mid-flight, but the provider still billed it: keep spend accounting honest
      await tx.execute(sql`update jobs set cost_usd = ${cost} where id = ${job.id} and status = 'canceled'`);
    }
    // the hold goes back and the real cost is charged, in the same transaction as the result
    await settleJob(tx, job.id, costUsd, fx);
  });
  notify(job.graphId);
}

/** A failed generation is free for the user: the hold is released, nothing is charged. */
export async function failJob(job: JobRow, error: string) {
  await db.transaction(async (tx) => {
    const r = await tx.execute(sql`
      update jobs set status = 'failed', finished_at = now(), error = ${error}
      where id = ${job.id} and status = 'running'
      returning id
    `);
    if (!r.length) return;
    await settleJob(tx, job.id, null, null);
    await skipDependents(tx, job, "failed");
  });
  notify(job.graphId);
}

export async function isCanceled(jobId: string): Promise<boolean> {
  const r = await db.execute<RawJob>(sql`select status from jobs where id = ${jobId}`);
  return r[0]?.status === "canceled";
}

/**
 * Stop a queued or running job. Queued jobs never reach the provider (free);
 * a running one stops being waited for, though the provider may still bill it.
 */
export async function cancelJob(jobId: string, userId: string): Promise<"canceled" | "not-active"> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute<RawJob>(sql`
      update jobs j set status = 'canceled', finished_at = now(), error = 'Отменено'
      from (select id, status as prev, external_id, estimate_usd from jobs where id = ${jobId} for update) old
      where j.id = old.id and j.status in ('queued', 'running')
        and (j.user_id = ${userId}
          or exists (select 1 from graphs g where g.id = j.graph_id and g.owner_id = ${userId}::text)
          or exists (select 1 from graph_members m where m.graph_id = j.graph_id and m.user_id = ${userId} and m.role = 'editor'))
      returning j.id, j.model_id, j.graph_id, old.prev, old.external_id, old.estimate_usd
    `);
    if (!rows.length) return "not-active" as const;
    const r = rows[0];
    // a generation the provider already accepted is billed to us anyway: it costs its estimate
    const billed = r.prev === "running" && r.external_id && r.estimate_usd !== null ? Number(r.estimate_usd) : null;
    await settleJob(tx, jobId, billed, billed ? await getFx() : null);
    await skipDependents(tx, { id: jobId, modelId: rows[0].model_id as string }, "canceled");
    notify(rows[0].graph_id as string);
    return "canceled" as const;
  });
}

/** Queued jobs waiting on a dead job can never run: tell the user why, all the way down the chain. */
async function skipDependents(tx: Tx, dead: Pick<JobRow, "id" | "modelId">, why: "failed" | "canceled") {
  const name = getModel(dead.modelId)?.name ?? dead.modelId;
  const reason = why === "canceled" ? `Входная нода «${name}» отменена` : `Не выполнилась входная нода «${name}»`;
  const rows = await tx.execute<RawJob>(sql`
    update jobs set status = 'skipped', finished_at = now(), error = ${reason}
    where status = 'queued' and ${dead.id}::uuid = any(depends_on)
    returning id, model_id
  `);
  for (const r of rows) {
    await settleJob(tx, r.id as string, null, null);
    await skipDependents(tx, { id: r.id as string, modelId: r.model_id as string }, why);
  }
}

/**
 * Jobs whose worker died. Async jobs with a provider id resume polling (no double charge);
 * image/text calls are safe to retry (the provider bills only delivered results);
 * a video that died mid-submit is failed rather than risk paying twice.
 */
export async function recoverStale() {
  const stale = await db.execute<RawJob>(sql`
    select * from jobs
    where status = 'running' and heartbeat_at < now() - make_interval(secs => ${HEARTBEAT_STALE_SEC})
  `);
  for (const r of stale) {
    const job = toJob(r);
    if (job.externalId || (job.kind !== "video" && job.attempts < 3)) {
      await db.execute(sql`update jobs set status = 'queued' where id = ${job.id} and status = 'running'`);
    } else {
      await failJob(job, "Генерация прервана сбоем сервера. Запустите ещё раз.");
    }
  }
  return stale.length;
}
