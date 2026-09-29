import { NextResponse } from "next/server";
import { graphDoc } from "@/lib/graph/types";
import { requireUser } from "@/server/auth";
import { deleteProject, graphState, renameProject, saveGraph } from "@/server/graphs";
import { canEdit, graphAccess } from "@/server/sharing";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { id } = await params;
  const a = await graphAccess(id, user.id);
  if (!a) return NextResponse.json({ error: "Граф не найден" }, { status: 404 });
  return NextResponse.json({ id: a.graph.id, name: a.graph.name, doc: a.graph.doc, role: a.role, state: await graphState(id) });
}

export async function PUT(req: Request, { params }: Ctx) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = graphDoc.safeParse(body?.doc);
  if (!parsed.success) return NextResponse.json({ error: "Некорректный граф" }, { status: 400 });
  const a = await graphAccess(id, user.id);
  if (!a) return NextResponse.json({ error: "Граф не найден" }, { status: 404 });
  if (!canEdit(a.role)) return NextResponse.json({ error: "Только просмотр: изменения не сохраняются" }, { status: 403 });
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
