import { NextResponse } from "next/server";
import { deleteApp } from "@/server/apps";
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
