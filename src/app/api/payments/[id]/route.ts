import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { refreshPayment } from "@/server/payments";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { id } = await params;
  const p = UUID.test(id) ? await refreshPayment(id, user.id) : null;
  if (!p) return NextResponse.json({ error: "Платёж не найден" }, { status: 404 });
  return NextResponse.json({ id: p.id, status: p.status, amountKop: p.amountKop });
}
