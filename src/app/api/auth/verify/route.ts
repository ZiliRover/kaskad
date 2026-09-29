import { NextResponse } from "next/server";
import { clientIp, normalizeEmail, startSession, verifyCode } from "@/server/auth";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? normalizeEmail(body.email) : null;
  const code = typeof body?.code === "string" ? body.code.replace(/\D/g, "") : "";
  if (!email || code.length !== 6) return NextResponse.json({ error: "Введите 6 цифр из письма" }, { status: 400 });
  const r = await verifyCode(email, code, clientIp(req));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  await startSession(r.user.id);
  return NextResponse.json({ ok: true, isNew: r.isNew });
}
