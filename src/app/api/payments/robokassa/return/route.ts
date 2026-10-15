import { NextResponse } from "next/server";
import { paymentByInvId } from "@/server/payments";

/**
 * Robokassa Success URL and Fail URL (both: <APP_URL>/api/payments/robokassa/return, and
 * <APP_URL>/api/payments/robokassa/return?failed=1 for Fail). Only routes the buyer back to the
 * studio: these redirects are not proof of payment, the balance moves on ResultURL alone.
 */
async function handle(req: Request, fields: URLSearchParams) {
  const url = new URL(req.url);
  const invId = Number(fields.get("InvId"));
  const p = Number.isSafeInteger(invId) && invId > 0 ? await paymentByInvId(invId) : null;
  const to = new URL("/studio", appOrigin(url));
  if (p) to.searchParams.set("payment", p.id);
  if (url.searchParams.get("failed")) to.searchParams.set("failed", "1");
  return NextResponse.redirect(to, 303);
}

/** Behind a tunnel or proxy the request URL says localhost; send people to the public address. */
function appOrigin(url: URL): string {
  return (process.env.APP_URL?.trim() || process.env.PUBLIC_BASE_URL?.trim() || url.origin).replace(/\/+$/, "");
}

export async function GET(req: Request) {
  return handle(req, new URL(req.url).searchParams);
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const fields = new URLSearchParams();
  form?.forEach((v, k) => { if (typeof v === "string") fields.set(k, v); });
  return handle(req, fields);
}
