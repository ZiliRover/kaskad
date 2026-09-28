import { and, eq, inArray, sql } from "drizzle-orm";
import { planRun } from "@/lib/graph/plan";
import { getModel, isBlocked } from "@/lib/models/registry";
import type { GraphDoc } from "@/lib/graph/types";
import { ACTIVE_STATUSES } from "@/lib/jobs";
import { formatKop } from "@/lib/money";
import { canReadFile } from "./access";
import { addHold, balanceKop, holdKop } from "./billing";
import { db, jobs, outputs, runs } from "./db";
import { getFx } from "./fx";
import { saveGraph } from "./graphs";
import { blockedVendors } from "./providers";

export type CreateRunResult =
  | { ok: true; runId: string; jobCount: number; totalUsd: number; holdKop: number }
  | { ok: false; nodeId: string; error: string; code?: "funds"; needKop?: number; balanceKop?: number };

/**
 * Plans and enqueues a run, reserving its estimated price from the user's balance.
 * The browser sends its current document so the run uses exactly what the user sees,
 * even if the last autosave hasn't landed yet.
 */
export async function createRun(
  graphId: string, userId: string, doc: GraphDoc, targets: string[], mode: "missing" | "all",
  /** operators generate straight from the provider account: nothing is reserved or charged */
  unlimited = false,
): Promise<CreateRunResult> {
  // a document may only feed the worker files its author can read
  for (const n of doc.nodes) {
    const keys = n.type === "image" && n.data.fileKey ? [n.data.fileKey]
      : n.type === "list" && n.data.kind !== "text" ? n.data.files ?? [] : [];
    for (const key of keys) {
      if (!(await canReadFile(key, userId))) {
        return { ok: false, nodeId: n.id, error: "Файл недоступен. Загрузите его заново." };
      }
    }
  }
  await saveGraph(graphId, doc);
  const fx = await getFx();

  return db.transaction(async (tx) => {
    // serialize runs per graph: a double click must not start the same node twice
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${graphId}))`);
    const withOutput = new Set(
      (await tx.selectDistinct({ nodeId: outputs.nodeId }).from(outputs).where(eq(outputs.graphId, graphId)))
        .map((r) => r.nodeId),
    );
    const active = await tx.select({ id: jobs.id, nodeId: jobs.nodeId }).from(jobs)
      .where(and(eq(jobs.graphId, graphId), inArray(jobs.status, ACTIVE_STATUSES)));
    const activeByNode = new Map<string, string[]>();
    for (const j of active) activeByNode.set(j.nodeId, [...(activeByNode.get(j.nodeId) ?? []), j.id]);

    // a node that is already generating is not started twice
    const plan = planRun({
      doc,
      targets: targets.filter((t) => !activeByNode.has(t)),
      mode,
      hasOutput: (id) => withOutput.has(id),
      isActive: (id) => activeByNode.has(id),
    });
    if (!plan.ok) return plan;
    const blocked = blockedVendors();
    const refused = plan.jobs.find((j) => isBlocked(j.modelId, blocked));
    if (refused) {
      return {
        ok: false as const, nodeId: refused.nodeId,
        error: `${getModel(refused.modelId)?.name ?? refused.modelId}: производитель не обслуживает регион сервера. Выбери другую модель.`,
      };
    }
    if (!plan.jobs.length) return { ok: false as const, nodeId: targets[0] ?? "", error: "Нода уже генерируется" };

    const holds = plan.jobs.map((pj) => unlimited ? 0
      : holdKop(pj.estimate.usd, pj.kind, fx, getModel(pj.modelId)?.pricing.type === "free"));
    const need = holds.reduce((a, b) => a + b, 0);

    // serialize spending per user: two tabs must not both spend the same rubles
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`user:${userId}`}))`);
    const balance = await balanceKop(userId, tx);
    if (!unlimited && need > balance) {
      return {
        ok: false as const, nodeId: plan.jobs[0].nodeId, code: "funds" as const, needKop: need, balanceKop: balance,
        error: `Не хватает средств: запуск резервирует ${formatKop(need)}, на балансе ${formatKop(Math.max(0, balance))}.`,
      };
    }

    const [run] = await tx.insert(runs)
      .values({ graphId, estimateUsd: String(plan.totalUsd) })
      .returning({ id: runs.id });

    // job ids per node (all items) and per node item; already active jobs count as upstream too
    const idsByNode = new Map(activeByNode);
    const idByItem = new Map<string, string>();
    for (const [i, pj] of plan.jobs.entries()) {
      // plan order is dependency order, so every upstream job id is known here
      const dependsOn = [...new Set(pj.waitsFor.flatMap((w) => {
        const one = w.item !== undefined ? idByItem.get(`${w.nodeId}#${w.item}`) : undefined;
        return one ? [one] : idsByNode.get(w.nodeId) ?? [];
      }))];
      const [row] = await tx.insert(jobs).values({
        runId: run.id,
        graphId,
        nodeId: pj.nodeId,
        item: pj.item ?? null,
        userId,
        holdKop: holds[i],
        kind: pj.kind,
        modelId: pj.modelId,
        input: pj.input,
        dependsOn,
        estimateUsd: pj.estimate.usd === null ? null : String(pj.estimate.usd),
      }).returning({ id: jobs.id });
      await addHold(tx, userId, row.id, holds[i]);
      idsByNode.set(pj.nodeId, [...(idsByNode.get(pj.nodeId) ?? []).filter((id) => !active.some((a) => a.id === id)), row.id]);
      if (pj.item !== undefined) idByItem.set(`${pj.nodeId}#${pj.item}`, row.id);
    }

    return { ok: true as const, runId: run.id, jobCount: plan.jobs.length, totalUsd: plan.totalUsd, holdKop: need };
  });
}
