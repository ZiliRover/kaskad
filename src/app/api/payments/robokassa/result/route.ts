import { handleRobokassaResult, paymentsProvider } from "@/server/payments";

/**
 * Robokassa ResultURL (set it in the shop's technical settings: <APP_URL>/api/payments/robokassa/result).
 * Robokassa expects "OK<InvId>" back; anything else and it treats the notification as not delivered.
 */
async function handle(fields: Record<string, string>) {
  if (paymentsProvider() !== "robokassa") return new Response(null, { status: 404 });
  try {
    const r = await handleRobokassaResult(fields);
    if (!r.ok) {
      console.error("[payments] robokassa result rejected:", r.error, fields.InvId);
      return new Response(r.error, { status: 400 });
    }
    return new Response(`OK${r.invId}`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  } catch (e) {
    console.error("[payments] robokassa result failed:", (e as Error).message);
    return new Response("error", { status: 500 });
  }
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const fields: Record<string, string> = {};
  form?.forEach((v, k) => { if (typeof v === "string") fields[k] = v; });
  return handle(fields);
}

export async function GET(req: Request) {
  return handle(Object.fromEntries(new URL(req.url).searchParams));
}
