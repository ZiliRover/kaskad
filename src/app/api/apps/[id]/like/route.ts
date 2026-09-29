import { NextResponse } from "next/server";
import { toggleLike } from "@/server/apps";
import { requireUser } from "@/server/auth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { id } = await params;
  const r = UUID.test(id) ? await toggleLike(id, user.id) : null;
  return r ? NextResponse.json(r) : NextResponse.json({ error: "Не найдено" }, { status: 404 });
}
