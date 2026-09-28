/**
 * Money. Every movement is a ledger row in kopecks; the balance is their sum.
 *
 * Run lifecycle: when a run is queued each job reserves its estimate ("hold", negative).
 * When the job ends, the hold is returned ("release") and what the provider really
 * billed is charged ("charge") at the current CBR rate x markup. Failed and skipped jobs
 * cost nothing. Unique indexes make every settlement exactly-once.
 */
import { sql } from "drizzle-orm";
import { toKop, type Fx } from "@/lib/money";
import type { MediaKind } from "@/lib/models/types";
import { isAdmin } from "./admin";
import { db } from "./db";

// drizzle's transaction type is awkward to name; both db and tx expose execute()
type Exec = { execute: typeof db.execute };

/** Reserve when the price can't be estimated up front (edit/upscale of unknown length). */
const FALLBACK_HOLD_KOP: Record<MediaKind, number> = { video: 300_00, image: 30_00, text: 5_00 };

export function holdKop(estimateUsd: number | null, kind: MediaKind, fx: Fx, free: boolean): number {
  if (free) return 0;
  return estimateUsd === null ? FALLBACK_HOLD_KOP[kind] : toKop(estimateUsd, fx);
}

export const WELCOME_BONUS_KOP = Math.max(0, Math.round(Number(process.env.WELCOME_BONUS_RUB ?? 50) * 100));

export async function balanceKop(userId: string, tx: Exec = db): Promise<number> {
  const [r] = await tx.execute<{ b: string | null }>(sql`select sum(amount_kop) as b from ledger where user_id = ${userId}`);
  return Number(r?.b ?? 0);
}

/** Money currently reserved by jobs that haven't finished. */
export async function reservedKop(userId: string, tx: Exec = db): Promise<number> {
  const [r] = await tx.execute<{ r: string | null }>(sql`
    select coalesce(sum(-h.amount_kop), 0) as r from ledger h
    where h.user_id = ${userId} and h.kind = 'hold'
      and not exists (select 1 from ledger x where x.job_id = h.job_id and x.kind = 'release')
  `);
  return Number(r?.r ?? 0);
}

export async function addHold(tx: Exec, userId: string, jobId: string, kop: number) {
  if (kop <= 0) return;
  await tx.execute(sql`
    insert into ledger (user_id, amount_kop, kind, job_id) values (${userId}, ${-kop}, 'hold', ${jobId})
    on conflict do nothing
  `);
}

/**
 * Close a job's money: give back its hold and charge the real provider cost (if any).
 * Safe to call more than once; a late cost after cancel still gets charged once.
 */
export async function settleJob(tx: Exec, jobId: string, costUsd: number | null, fx: Fx | null) {
  const [job] = await tx.execute<{ user_id: string | null; hold_kop: string; model_id: string; email: string | null }>(sql`
    select j.user_id, j.hold_kop, j.model_id, u.email from jobs j left join users u on u.id = j.user_id where j.id = ${jobId}
  `);
  if (!job?.user_id) return; // jobs from before accounts
  const hold = Number(job.hold_kop);
  if (hold > 0) {
    await tx.execute(sql`
      insert into ledger (user_id, amount_kop, kind, job_id) values (${job.user_id}, ${hold}, 'release', ${jobId})
      on conflict do nothing
    `);
  }
  // operators pay the provider directly; their site balance stays untouched
  if (costUsd && costUsd > 0 && fx && !(job.email && isAdmin({ email: job.email }))) {
    await tx.execute(sql`
      insert into ledger (user_id, amount_kop, kind, job_id, note)
      values (${job.user_id}, ${-toKop(costUsd, fx)}, 'charge', ${jobId}, ${job.model_id})
      on conflict do nothing
    `);
  }
}

export async function grantWelcomeBonus(tx: Exec, userId: string) {
  if (WELCOME_BONUS_KOP <= 0) return;
  await tx.execute(sql`
    insert into ledger (user_id, amount_kop, kind, note) values (${userId}, ${WELCOME_BONUS_KOP}, 'bonus', 'Приветственный бонус')
  `);
}

export interface LedgerEntry {
  id: string;
  kind: "topup" | "bonus" | "charge" | "adjust";
  amountKop: number;
  note: string | null;
  createdAt: string;
}

/** History for people: holds/releases are bookkeeping, only real movements are shown. */
export async function history(userId: string, limit = 50): Promise<LedgerEntry[]> {
  const rows = await db.execute<{ id: string; kind: LedgerEntry["kind"]; amount_kop: string; note: string | null; created_at: string }>(sql`
    select id, kind, amount_kop, note, created_at from ledger
    where user_id = ${userId} and kind in ('topup', 'bonus', 'charge', 'adjust')
    order by created_at desc limit ${limit}
  `);
  return rows.map((r) => ({
    id: r.id, kind: r.kind, amountKop: Number(r.amount_kop), note: r.note, createdAt: new Date(r.created_at).toISOString(),
  }));
}
