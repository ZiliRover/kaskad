/**
 * Top-ups. A payment row is created first; the balance grows only when the provider
 * confirms it, exactly once (unique ledger.payment_id).
 *
 * PAYMENTS_PROVIDER=test      a local checkout page that confirms instantly (default outside production)
 * PAYMENTS_PROVIDER=yookassa  YOOKASSA_SHOP_ID + YOOKASSA_SECRET_KEY; the webhook re-fetches the payment
 */
import { and, eq, sql } from "drizzle-orm";
import { BRAND } from "@/config/brand";
import { formatKop } from "@/lib/money";
import { db, payments } from "./db";

export const MIN_TOPUP_KOP = 100_00;
export const MAX_TOPUP_KOP = 100_000_00;

export type PaymentsProvider = "test" | "yookassa";

export function paymentsProvider(): PaymentsProvider | null {
  const p = process.env.PAYMENTS_PROVIDER?.trim();
  if (p === "yookassa") return "yookassa";
  if (p === "test" || (!p && process.env.NODE_ENV !== "production")) return "test";
  return null; // production without a configured provider: top-ups are off
}

/** Where the browser returns after paying. */
function appUrl(): string {
  return (process.env.APP_URL ?? process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

const YOOKASSA_API = "https://api.yookassa.ru/v3";

function yookassaAuth(): string {
  const shop = process.env.YOOKASSA_SHOP_ID?.trim(), key = process.env.YOOKASSA_SECRET_KEY?.trim();
  if (!shop || !key) throw new Error("YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY are not set");
  return "Basic " + Buffer.from(`${shop}:${key}`).toString("base64");
}

interface YooPayment {
  id: string;
  status: "pending" | "waiting_for_capture" | "succeeded" | "canceled";
  paid: boolean;
  amount: { value: string; currency: string };
  metadata?: { paymentId?: string };
  confirmation?: { confirmation_url?: string };
}

export async function createPayment(userId: string, amountKop: number): Promise<{ id: string; url: string }> {
  const provider = paymentsProvider();
  if (!provider) throw new Error("payments are not configured");
  const [p] = await db.insert(payments).values({ userId, provider, amountKop }).returning();

  if (provider === "test") {
    const url = `/pay/${p.id}`;
    await db.update(payments).set({ confirmationUrl: url }).where(eq(payments.id, p.id));
    return { id: p.id, url };
  }

  const r = await fetch(`${YOOKASSA_API}/payments`, {
    method: "POST",
    headers: { Authorization: yookassaAuth(), "Idempotence-Key": p.id, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: { value: (amountKop / 100).toFixed(2), currency: "RUB" },
      capture: true,
      confirmation: { type: "redirect", return_url: `${appUrl()}/studio?payment=${p.id}` },
      description: `Пополнение баланса ${BRAND.name} на ${formatKop(amountKop)}`,
      metadata: { paymentId: p.id },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const y = (await r.json().catch(() => null)) as YooPayment | null;
  if (!r.ok || !y?.confirmation?.confirmation_url) {
    await db.update(payments).set({ status: "canceled" }).where(eq(payments.id, p.id));
    throw new Error(`yookassa ${r.status}`);
  }
  await db.update(payments).set({ externalId: y.id, confirmationUrl: y.confirmation.confirmation_url })
    .where(eq(payments.id, p.id));
  return { id: p.id, url: y.confirmation.confirmation_url };
}

/** Credit a payment to the balance. Idempotent: webhooks and return pages may both call it. */
export async function markPaid(paymentId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [p] = await tx.update(payments).set({ status: "succeeded", paidAt: sql`now()` })
      .where(and(eq(payments.id, paymentId), eq(payments.status, "pending")))
      .returning();
    if (!p) return false;
    await tx.execute(sql`
      insert into ledger (user_id, amount_kop, kind, payment_id, note)
      values (${p.userId}, ${p.amountKop}, 'topup', ${p.id}, 'Пополнение')
      on conflict do nothing
    `);
    return true;
  });
}

export async function markCanceled(paymentId: string) {
  await db.update(payments).set({ status: "canceled" })
    .where(and(eq(payments.id, paymentId), eq(payments.status, "pending")));
}

/**
 * Ask YooKassa for the truth about a payment. Webhook bodies are never trusted as-is:
 * only what the API returns for our own shop credentials counts.
 */
export async function syncYookassa(externalId: string) {
  const r = await fetch(`${YOOKASSA_API}/payments/${encodeURIComponent(externalId)}`, {
    headers: { Authorization: yookassaAuth() },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) return;
  const y = (await r.json()) as YooPayment;
  const [p] = await db.select().from(payments).where(eq(payments.externalId, y.id));
  if (!p) return;
  if (y.status === "succeeded" && y.paid && y.amount.currency === "RUB"
      && Math.round(Number(y.amount.value) * 100) === p.amountKop) {
    await markPaid(p.id);
  } else if (y.status === "canceled") {
    await markCanceled(p.id);
  }
}

export async function getPayment(id: string, userId: string) {
  const [p] = await db.select().from(payments).where(and(eq(payments.id, id), eq(payments.userId, userId)));
  return p ?? null;
}

/** Status check from the return page: for YooKassa, don't wait for the webhook. */
export async function refreshPayment(id: string, userId: string) {
  const p = await getPayment(id, userId);
  if (p?.status === "pending" && p.provider === "yookassa" && p.externalId) {
    await syncYookassa(p.externalId).catch(() => {});
    return getPayment(id, userId);
  }
  return p;
}
