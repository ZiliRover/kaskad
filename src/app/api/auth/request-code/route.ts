import { NextResponse } from "next/server";
import { clientIp, normalizeEmail, requestCode } from "@/server/auth";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? normalizeEmail(body.email) : null;
  if (!email) return NextResponse.json({ error: "Проверьте адрес почты" }, { status: 400 });
  const r = await requestCode(email, clientIp(req));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, devCode: r.devCode });
}
