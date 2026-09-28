import { NextResponse } from "next/server";
import { paymentsProvider, syncYookassa } from "@/server/payments";

/**
 * YooKassa notifications. The body only tells us which payment changed; its status is
 * re-read from the API with our credentials, so a forged request can't credit anything.
 */
export async function POST(req: Request) {
  if (paymentsProvider() !== "yookassa") return new Response(null, { status: 404 });
  const body = await req.json().catch(() => null);
  const id = body?.object?.id;
  if (typeof id !== "string" || id.length > 64) return NextResponse.json({ ok: false }, { status: 400 });
  try {
    await syncYookassa(id);
  } catch (e) {
    console.error("[payments] webhook sync failed:", (e as Error).message);
    return NextResponse.json({ ok: false }, { status: 500 }); // YooKassa retries
  }
  return NextResponse.json({ ok: true });
}
