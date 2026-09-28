import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { getPayment, markCanceled, markPaid } from "@/server/payments";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The test checkout's buttons. Real providers confirm through their webhook instead. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { id } = await params;
  const p = UUID.test(id) ? await getPayment(id, user.id) : null;
  if (!p || p.provider !== "test") return NextResponse.json({ error: "Платёж не найден" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (body?.action === "cancel") await markCanceled(p.id);
  else await markPaid(p.id);
  return NextResponse.json({ ok: true });
}
