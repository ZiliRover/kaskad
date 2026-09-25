import { sql } from "drizzle-orm";
import { getModel } from "@/lib/models/registry";
import { db, type JobRow } from "../db";

const HEARTBEAT_STALE_SEC = 45;

type RawJob = Record<string, unknown>;

function toJob(r: RawJob): JobRow {
  return {
    id: r.id as string,
    runId: r.run_id as string,
    graphId: r.graph_id as string,
    nodeId: r.node_id as string,
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
  return rows[0] ? toJob(rows[0]) : null;
}

export async function heartbeat(jobId: string, externalId?: string) {
  await db.execute(sql`
    update jobs set heartbeat_at = now()
      ${externalId ? sql`, external_id = ${externalId}` : sql``}
    where id = ${jobId}
  `);
}

export async function completeJob(
  job: JobRow, result: { fileKey?: string; mime?: string; text?: string; costUsd: number | null },
) {
  const cost = result.costUsd === null ? null : String(result.costUsd);
  await db.transaction(async (tx) => {
    // only a still-running job may succeed: a result arriving after cancel is discarded
    const done = await tx.execute(sql`
      update jobs set status = 'succeeded', finished_at = now(), error = null, cost_usd = ${cost}
      where id = ${job.id} and status = 'running'
      returning id
    `);
    if (done.length) {
      await tx.execute(sql`
        insert into outputs (graph_id, node_id, job_id, kind, file_key, mime, text)
        values (${job.graphId}, ${job.nodeId}, ${job.id}, ${job.kind},
                ${result.fileKey ?? null}, ${result.mime ?? null}, ${result.text ?? null})
      `);
    } else {
      // canceled mid-flight, but the provider still billed it: keep spend accounting honest
      await tx.execute(sql`update jobs set cost_usd = ${cost} where id = ${job.id} and status = 'canceled'`);
    }
  });
}

export async function failJob(job: JobRow, error: string) {
  const r = await db.execute(sql`
    update jobs set status = 'failed', finished_at = now(), error = ${error}
    where id = ${job.id} and status = 'running'
    returning id
  `);
  if (r.length) await skipDependents(job, "failed");
}

export async function isCanceled(jobId: string): Promise<boolean> {
  const r = await db.execute<RawJob>(sql`select status from jobs where id = ${jobId}`);
  return r[0]?.status === "canceled";
}

/**
 * Stop a queued or running job. Queued jobs never reach the provider (free);
 * a running one stops being waited for, though the provider may still bill it.
 */
export async function cancelJob(jobId: string): Promise<"canceled" | "not-active"> {
  const rows = await db.execute<RawJob>(sql`
    update jobs set status = 'canceled', finished_at = now(), error = 'Отменено'
    where id = ${jobId} and status in ('queued', 'running')
    returning id, model_id
  `);
  if (!rows.length) return "not-active";
  await skipDependents({ id: jobId, modelId: rows[0].model_id as string }, "canceled");
  return "canceled";
}

/** Queued jobs waiting on a dead job can never run: tell the user why, all the way down the chain. */
async function skipDependents(dead: Pick<JobRow, "id" | "modelId">, why: "failed" | "canceled") {
  const name = getModel(dead.modelId)?.name ?? dead.modelId;
  const reason = why === "canceled" ? `Входная нода «${name}» отменена` : `Не выполнилась входная нода «${name}»`;
  const rows = await db.execute<RawJob>(sql`
    update jobs set status = 'skipped', finished_at = now(), error = ${reason}
    where status = 'queued' and ${dead.id}::uuid = any(depends_on)
    returning id, model_id
  `);
  for (const r of rows) await skipDependents({ id: r.id as string, modelId: r.model_id as string }, why);
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
