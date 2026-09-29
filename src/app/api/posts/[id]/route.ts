import { NextResponse } from "next/server";
import { isAdmin } from "@/server/admin";
import { requireUser } from "@/server/auth";
import { removePost } from "@/server/posts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Take your work out of the showcase (operators: anyone's). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { id } = await params;
  if (!UUID.test(id) || !(await removePost(id, user.id, isAdmin(user)))) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
