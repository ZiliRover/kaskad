/**
 * Top-ups. A payment row is created first; the balance grows only when the provider
 * confirms it, exactly once (unique ledger.payment_id).
 *
 * PAYMENTS_PROVIDER=test       a local checkout page that confirms instantly (development only)
 * PAYMENTS_PROVIDER=robokassa  ROBOKASSA_LOGIN + ROBOKASSA_PASSWORD1/2; cards, SBP, SberPay on
 *                              Robokassa's page; receipts for the self-employed via Robochecks
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { BRAND } from "@/config/brand";
import { db, payments, users } from "./db";

export const MIN_TOPUP_KOP = 100_00;
export const MAX_TOPUP_KOP = 100_000_00;

export type PaymentsProvider = "test" | "robokassa";

export function paymentsProvider(): PaymentsProvider | null {
  const p = process.env.PAYMENTS_PROVIDER?.trim();
  if (p === "robokassa") return "robokassa";
  // the test checkout credits any amount for free: never in production, even if configured,
  // or anyone with the link could top up and spend the owner's provider account
  if (process.env.NODE_ENV !== "production" && (p === "test" || !p)) return "test";
  return null; // production without a configured provider: top-ups are off
}

export async function createPayment(userId: string, amountKop: number): Promise<{ id: string; url: string }> {
  const provider = paymentsProvider();
  if (!provider) throw new Error("payments are not configured");
  const [p] = await db.insert(payments).values({ userId, provider, amountKop }).returning();
  const url = provider === "test" ? `/pay/${p.id}` : await robokassaUrl(p.invId, amountKop, userId);
  await db.update(payments).set({ confirmationUrl: url }).where(eq(payments.id, p.id));
  return { id: p.id, url };
}

/** Credit a payment to the balance. Idempotent: notifications and return pages may both call it. */
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

export async function getPayment(id: string, userId: string) {
  const [p] = await db.select().from(payments).where(and(eq(payments.id, id), eq(payments.userId, userId)));
  return p ?? null;
}

export async function paymentByInvId(invId: number) {
  const [p] = await db.select().from(payments).where(and(eq(payments.invId, invId), eq(payments.provider, "robokassa")));
  return p ?? null;
}

/** Status check from the return page: don't wait for the notification. */
export async function refreshPayment(id: string, userId: string) {
  const p = await getPayment(id, userId);
  if (p?.status === "pending" && p.provider === "robokassa" && !robokassaIsTest()) {
    await syncRobokassa(p.id, p.invId).catch((e) => console.error("[payments] robokassa status:", (e as Error).message));
    return getPayment(id, userId);
  }
  return p;
}

// ---- Robokassa (docs.robokassa.ru: pay-interface, notifications-and-redirects, xml-interfaces)

const ROBOKASSA_PAY = "https://auth.robokassa.ru/Merchant/Index.aspx";
const ROBOKASSA_STATE = "https://auth.robokassa.ru/Merchant/WebService/Service.asmx/OpStateExt";

function robokassaConfig() {
  const login = process.env.ROBOKASSA_LOGIN?.trim();
  const password1 = process.env.ROBOKASSA_PASSWORD1?.trim();
  const password2 = process.env.ROBOKASSA_PASSWORD2?.trim();
  if (!login || !password1 || !password2) throw new Error("ROBOKASSA_LOGIN / ROBOKASSA_PASSWORD1 / ROBOKASSA_PASSWORD2 are not set");
  return { login, password1, password2 };
}

/** IsTest=1: Robokassa's test mode, which uses the shop's separate test passwords. */
export const robokassaIsTest = () => process.env.ROBOKASSA_TEST?.trim() === "1";

/** Must match "Алгоритм расчёта хеша" in the shop's technical settings (MD5 by default). */
function robokassaHash(s: string): string {
  const alg = (process.env.ROBOKASSA_HASH?.trim().toLowerCase() || "md5").replace("-", "");
  return createHash(alg).update(s, "utf8").digest("hex");
}

/** "123.45" with a dot, as Robokassa wants OutSum. */
const outSum = (kop: number) => (kop / 100).toFixed(2);

async function robokassaUrl(invId: number, amountKop: number, userId: string): Promise<string> {
  const { login, password1 } = robokassaConfig();
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  const sum = outSum(amountKop);
  // what the buyer's receipt says (for the self-employed it goes to "Мой налог" as the service name)
  const receipt = encodeURIComponent(JSON.stringify({
    items: [{
      name: `Пополнение баланса сервиса ${BRAND.name}`.slice(0, 128),
      quantity: 1, sum: Number(sum), tax: "none",
      payment_method: "full_prepayment", payment_object: "service",
    }],
  }));
  const params = new URLSearchParams({
    MerchantLogin: login,
    OutSum: sum,
    InvId: String(invId),
    // plain text: Robokassa rejects special characters here (no ₽, no non-breaking spaces)
    Description: `Пополнение баланса ${BRAND.name} на ${amountKop / 100} руб.`.slice(0, 100),
    Culture: "ru",
    SignatureValue: robokassaHash(`${login}:${sum}:${invId}:${receipt}:${password1}`),
  });
  if (user?.email) params.set("Email", user.email);
  if (robokassaIsTest()) params.set("IsTest", "1");
  // Receipt goes in exactly as signed (already URL-encoded once), so it isn't run through URLSearchParams
  return `${ROBOKASSA_PAY}?${params.toString()}&Receipt=${encodeURIComponent(receipt)}`;
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a.toLowerCase()), y = Buffer.from(b.toLowerCase());
  return x.length === y.length && timingSafeEqual(x, y);
}

export type RobokassaResult = { ok: true; invId: number } | { ok: false; error: string };

/**
 * ResultURL: Robokassa's server says an invoice is paid. Trusted only when signed with
 * password #2 and the amount is exactly the one we issued.
 */
export async function handleRobokassaResult(f: { OutSum?: string; InvId?: string; SignatureValue?: string }): Promise<RobokassaResult> {
  const { password2 } = robokassaConfig();
  const invId = Number(f.InvId);
  if (!f.OutSum || !f.SignatureValue || !Number.isSafeInteger(invId) || invId <= 0) return { ok: false, error: "bad request" };
  if (!sameHash(robokassaHash(`${f.OutSum}:${f.InvId}:${password2}`), f.SignatureValue)) return { ok: false, error: "bad signature" };
  const p = await paymentByInvId(invId);
  if (!p) return { ok: false, error: "unknown invoice" };
  if (Math.round(Number(f.OutSum) * 100) !== p.amountKop) return { ok: false, error: "amount mismatch" };
  await markPaid(p.id);
  return { ok: true, invId };
}

/** Ask Robokassa about an invoice (works for real payments only, not IsTest ones). */
async function syncRobokassa(paymentId: string, invId: number) {
  const { login, password2 } = robokassaConfig();
  const q = new URLSearchParams({ MerchantLogin: login, InvoiceID: String(invId), Signature: robokassaHash(`${login}:${invId}:${password2}`) });
  const r = await fetch(`${ROBOKASSA_STATE}?${q}`, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`OpStateExt ${r.status}`);
  const xml = await r.text();
  const code = (tag: string) => new RegExp(`<${tag}>\\s*<Code>(\\d+)</Code>`).exec(xml)?.[1];
  if (code("Result") !== "0") return; // 3 = no such invoice yet: the buyer hasn't paid
  const state = code("State");
  if (state === "100") await markPaid(paymentId);
  else if (state === "10" || state === "60") await markCanceled(paymentId);
}
