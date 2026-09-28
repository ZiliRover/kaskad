import { and, eq, inArray, sql } from "drizzle-orm";
import { planRun } from "@/lib/graph/plan";
import { getModel, isBlocked } from "@/lib/models/registry";
import { blockedVendors } from "./providers";
import type { GraphDoc } from "@/lib/graph/types";
import { ACTIVE_STATUSES } from "@/lib/jobs";
import { db, jobs, outputs, runs } from "./db";
import { saveGraph } from "./graphs";

export type CreateRunResult =
  | { ok: true; runId: string; jobCount: number; totalUsd: number }
  | { ok: false; nodeId: string; error: string };

/**
 * Plans and enqueues a run. The browser sends its current document so the run
 * uses exactly what the user sees, even if the last autosave hasn't landed yet.
 */
export async function createRun(
  graphId: string, doc: GraphDoc, targets: string[], mode: "missing" | "all",
): Promise<CreateRunResult> {
  await saveGraph(graphId, doc);

  return db.transaction(async (tx) => {
    // serialize runs per graph: a double click must not start the same node twice
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${graphId}))`);
    const withOutput = new Set(
      (await tx.selectDistinct({ nodeId: outputs.nodeId }).from(outputs).where(eq(outputs.graphId, graphId)))
        .map((r) => r.nodeId),
    );
    const active = await tx.select({ id: jobs.id, nodeId: jobs.nodeId }).from(jobs)
      .where(and(eq(jobs.graphId, graphId), inArray(jobs.status, ACTIVE_STATUSES)));
    const activeByNode = new Map(active.map((j) => [j.nodeId, j.id]));

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

    const [run] = await tx.insert(runs)
      .values({ graphId, estimateUsd: String(plan.totalUsd) })
      .returning({ id: runs.id });

    const jobIdByNode = new Map(activeByNode);
    for (const pj of plan.jobs) {
      // plan order is dependency order, so every upstream job id is known here
      const dependsOn = pj.waitsFor.map((n) => jobIdByNode.get(n)).filter((x): x is string => !!x);
      const [row] = await tx.insert(jobs).values({
        runId: run.id,
        graphId,
        nodeId: pj.nodeId,
        kind: pj.kind,
        modelId: pj.modelId,
        input: pj.input,
        dependsOn,
        estimateUsd: pj.estimate.usd === null ? null : String(pj.estimate.usd),
      }).returning({ id: jobs.id });
      jobIdByNode.set(pj.nodeId, row.id);
    }

    return { ok: true as const, runId: run.id, jobCount: plan.jobs.length, totalUsd: plan.totalUsd };
  });
}
