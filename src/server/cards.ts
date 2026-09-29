/**
 * "Карточки для маркетплейса" without the canvas: the seller fills a form, reads and
 * edits the planned slides, and gets the finished set. Underneath it is an ordinary
 * project (the seller kit graph), so it can always be opened in the editor.
 */
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { CardsProgress } from "@/lib/cards";
import type { GraphDoc } from "@/lib/graph/types";
import { canReadFile } from "./access";
import { db } from "./db";
import { createProject, deleteProject } from "./graphs";
import { createRun, type CreateRunResult } from "./runs";
import { CARDS_OUT, cardsGraph } from "./seller";
import { fileUrl } from "./storage";

export const cardsStart = z.object({
  title: z.string().trim().min(1).max(80),
  photoKey: z.string().min(1).max(300),
  marketplace: z.enum(["wb", "ozon"]),
  slides: z.array(z.string().trim().min(3).max(2000)).min(1).max(10),
});
export type CardsStart = z.infer<typeof cardsStart>;

export async function startCards(userId: string, req: CardsStart, unlimited: boolean):
  Promise<CreateRunResult & { graphId?: string }> {
  if (!(await canReadFile(req.photoKey, userId))) return { ok: false, nodeId: "", error: "Фото недоступно, загрузи его заново" };
  // one slide per line of the list node: line breaks inside a slide would split it
  const slides = req.slides.map((s) => s.replace(/\s*\n+\s*/g, " "));
  const { nodes, edges } = cardsGraph(req.photoKey, req.marketplace, slides);
  const doc: GraphDoc = { nodes, edges, viewport: { x: 60, y: 260, zoom: 0.7 } };
  const project = await createProject(userId, { name: req.title, doc });
  if (!project) return { ok: false, nodeId: "", error: "Не удалось создать проект" };
  const r = await createRun(project.id, userId, doc, [CARDS_OUT], "all", unlimited);
  // nothing started (not enough money, for example): don't leave an empty project behind
  if (!r.ok) { await deleteProject(project.id, userId); return r; }
  return { ...r, graphId: project.id };
}

/** Where each slide of a cards project is: the latest run, slide by slide. */
export async function cardsProgress(graphId: string, userId: string): Promise<CardsProgress | null> {
  const [g] = await db.execute<{ name: string; doc: GraphDoc }>(sql`
    select name, doc from graphs where id = ${graphId} and owner_id = ${userId}
  `);
  const out = g?.doc.nodes.find((n) => n.id === CARDS_OUT);
  if (!g || !out || out.type !== "model") return null;
  const rows = await db.execute<{ node_id: string; item: number | null; status: string; error: string | null; file_key: string | null }>(sql`
    with last as (
      select run_id from jobs where graph_id = ${graphId} and node_id = ${CARDS_OUT}
      order by created_at desc limit 1
    )
    select j.node_id, j.item, j.status, j.error, o.file_key
    from jobs j join last on last.run_id = j.run_id
    left join outputs o on o.job_id = j.id
    where j.node_id in ('s-card', ${CARDS_OUT})
    order by j.item nulls first
  `);
  const [{ kop }] = await db.execute<{ kop: string | null }>(sql`
    select -sum(l.amount_kop) as kop from ledger l join jobs j on j.id = l.job_id
    where l.kind = 'charge' and j.graph_id = ${graphId}
      and j.run_id = (select run_id from jobs where graph_id = ${graphId} and node_id = ${CARDS_OUT} order by created_at desc limit 1)
  `);

  const byItem = new Map<number, { card?: (typeof rows)[number]; fit?: (typeof rows)[number] }>();
  for (const r of rows) {
    const i = r.item ?? 0;
    const e = byItem.get(i) ?? {};
    if (r.node_id === CARDS_OUT) e.fit = r; else e.card = r;
    byItem.set(i, e);
  }
  const slides = [...byItem.keys()].sort((a, b) => a - b).map((i): CardsProgress["slides"][number] => {
    const { card, fit } = byItem.get(i)!;
    if (fit?.status === "succeeded") return { status: "done", url: fit.file_key ? fileUrl(fit.file_key) : null, error: null };
    // a slide the image model refused skips the fitting: the reason is on the image job
    const failed = [fit, card].find((r) => r && (r.status === "failed" || r.status === "canceled"));
    if (failed || fit?.status === "skipped") {
      return { status: "failed", url: null, error: failed?.error ?? card?.error ?? fit?.error ?? "Не получилось" };
    }
    return { status: card?.status === "running" || fit?.status === "running" || card?.status === "succeeded" ? "working" : "waiting", url: null, error: null };
  });
  const market = out.data.params.market;
  return { name: g.name, marketplace: market === "ozon" ? "ozon" : "wb", slides, chargedKop: kop === null ? null : Number(kop) };
}
