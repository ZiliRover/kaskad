import { NextResponse } from "next/server";
import { graphDoc } from "@/lib/graph/types";
import { requireUser } from "@/server/auth";
import { deleteProject, graphState, ownedGraph, renameProject, saveGraph } from "@/server/graphs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { id } = await params;
  const g = await ownedGraph(id, user.id);
  if (!g) return NextResponse.json({ error: "Граф не найден" }, { status: 404 });
  return NextResponse.json({ id: g.id, name: g.name, doc: g.doc, state: await graphState(id) });
}

export async function PUT(req: Request, { params }: Ctx) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = graphDoc.safeParse(body?.doc);
  if (!parsed.success) return NextResponse.json({ error: "Некорректный граф" }, { status: 400 });
  if (!(await ownedGraph(id, user.id))) return NextResponse.json({ error: "Граф не найден" }, { status: 404 });
  await saveGraph(id, parsed.data);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 80) return NextResponse.json({ error: "Название от 1 до 80 символов" }, { status: 400 });
  if (!(await renameProject(id, user.id, name))) return NextResponse.json({ error: "Граф не найден" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { id } = await params;
  const r = await deleteProject(id, user.id);
  if (r === "missing") return NextResponse.json({ error: "Граф не найден" }, { status: 404 });
  if (r === "busy") return NextResponse.json({ error: "В проекте идут генерации. Дождись их или останови." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
