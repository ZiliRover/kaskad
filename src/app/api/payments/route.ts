import { NextResponse } from "next/server";
import { formatKop } from "@/lib/money";
import { requireUser } from "@/server/auth";
import { createPayment, MAX_TOPUP_KOP, MIN_TOPUP_KOP, paymentsProvider } from "@/server/payments";

export async function POST(req: Request) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  if (!paymentsProvider()) return NextResponse.json({ error: "Пополнение временно недоступно" }, { status: 503 });
  const body = await req.json().catch(() => null);
  const kop = Math.round(Number(body?.amountRub) * 100);
  if (!Number.isFinite(kop) || kop < MIN_TOPUP_KOP || kop > MAX_TOPUP_KOP) {
    return NextResponse.json({ error: `Сумма от ${formatKop(MIN_TOPUP_KOP)} до ${formatKop(MAX_TOPUP_KOP)}` }, { status: 400 });
  }
  try {
    return NextResponse.json(await createPayment(user.id, kop));
  } catch (e) {
    console.error("[payments] create failed:", (e as Error).message);
    return NextResponse.json({ error: "Платёжный сервис не ответил. Попробуйте ещё раз." }, { status: 502 });
  }
}
