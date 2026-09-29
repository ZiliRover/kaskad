import { NextResponse } from "next/server";
import { deleteApp, setListed } from "@/server/apps";
import { requireUser } from "@/server/auth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Unpublish: the link stops working; results people already made stay theirs. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { id } = await params;
  if (!UUID.test(id) || !(await deleteApp(id, user.id))) return NextResponse.json({ error: "Приложение не найдено" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** Show or hide the app in the showcase. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!UUID.test(id) || typeof body?.listed !== "boolean") return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  if (!(await setListed(id, user.id, body.listed))) return NextResponse.json({ error: "Приложение не найдено" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
