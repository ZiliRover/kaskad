import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { graphDoc, graphEdge, graphNode, type GraphDoc } from "@/lib/graph/types";
import { requireUser } from "@/server/auth";
import { db, graphs } from "@/server/db";
import { publish } from "@/server/live";
import { canEdit, graphAccess } from "@/server/sharing";

const ops = z.object({
  client: z.string().min(1).max(64),
  nodes: z.array(graphNode).max(500).default([]),
  edges: z.array(graphEdge).max(2000).default([]),
  removeNodes: z.array(z.string().max(64)).max(500).default([]),
  removeEdges: z.array(z.string().max(64)).max(2000).default([]),
});

/**
 * Edits by node and wire, not whole documents: two people changing different nodes
 * never overwrite each other. The change is applied under a row lock and broadcast.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { id } = await params;
  const parsed = ops.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Некорректные изменения" }, { status: 400 });
  const a = await graphAccess(id, user.id);
  if (!a) return NextResponse.json({ error: "Граф не найден" }, { status: 404 });
  if (!canEdit(a.role)) return NextResponse.json({ error: "Только просмотр: изменения не сохраняются" }, { status: 403 });
  const o = parsed.data;

  const saved = await db.transaction(async (tx) => {
    const [row] = await tx.execute<{ doc: GraphDoc }>(sql`select doc from graphs where id = ${id} for update`);
    const doc = row.doc;
    const gone = new Set(o.removeNodes);
    const nodes = new Map(doc.nodes.filter((n) => !gone.has(n.id)).map((n) => [n.id, n]));
    for (const n of o.nodes) if (!gone.has(n.id)) nodes.set(n.id, n);
    const goneEdges = new Set(o.removeEdges);
    const edges = new Map(doc.edges.filter((e) => !goneEdges.has(e.id)).map((e) => [e.id, e]));
    for (const e of o.edges) if (!goneEdges.has(e.id)) edges.set(e.id, e);
    // wires of removed nodes go with them
    const next = {
      nodes: [...nodes.values()],
      edges: [...edges.values()].filter((e) => nodes.has(e.source) && nodes.has(e.target)),
      viewport: doc.viewport,
    };
    const valid = graphDoc.safeParse(next);
    if (!valid.success) return null;
    await tx.update(graphs).set({ doc: valid.data, updatedAt: new Date() }).where(eq(graphs.id, id));
    return valid.data;
  });
  if (!saved) return NextResponse.json({ error: "Граф стал бы некорректным" }, { status: 400 });
  await publish(id, { t: "ops", from: o.client, ops: { nodes: o.nodes, edges: o.edges, removeNodes: o.removeNodes, removeEdges: o.removeEdges } });
  return NextResponse.json({ ok: true });
}
