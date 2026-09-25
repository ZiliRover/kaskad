import { NextResponse } from "next/server";
import { graphDoc } from "@/lib/graph/types";
import { graphState, loadGraph, saveGraph } from "@/server/graphs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const g = await loadGraph(id);
  if (!g) return NextResponse.json({ error: "Граф не найден" }, { status: 404 });
  return NextResponse.json({ id: g.id, name: g.name, doc: g.doc, state: await graphState(id) });
}

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = graphDoc.safeParse(body?.doc);
  if (!parsed.success) return NextResponse.json({ error: "Некорректный граф" }, { status: 400 });
  if (!(await loadGraph(id))) return NextResponse.json({ error: "Граф не найден" }, { status: 404 });
  await saveGraph(id, parsed.data);
  return NextResponse.json({ ok: true });
}
