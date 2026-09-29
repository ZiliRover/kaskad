import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { cardsProgress } from "@/server/cards";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { id } = await params;
  const p = UUID.test(id) ? await cardsProgress(id, user.id) : null;
  return p ? NextResponse.json(p, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "Не найдено" }, { status: 404 });
}
