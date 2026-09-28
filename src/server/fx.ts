import type { Fx } from "@/lib/money";

/** Central Bank of Russia daily rates, mirrored as JSON. */
const CBR_URL = "https://www.cbr-xml-daily.ru/daily_json.js";
const TTL_MS = 6 * 60 * 60_000;
const FALLBACK = Number(process.env.USD_RUB_FALLBACK ?? 85);
/** covers FX spread, acquiring fees, taxes and refunds of failed runs (PRODUCT.md §5) */
export const MARKUP = Math.max(1, Number(process.env.PRICE_MARKUP ?? 1.5) || 1.5);

const g = globalThis as unknown as { __fx?: { value: Fx; at: number } };

export async function getFx(): Promise<Fx> {
  const cached = g.__fx;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  try {
    const r = await fetch(CBR_URL, { signal: AbortSignal.timeout(4000), cache: "no-store" });
    const d = await r.json();
    const usdRub = Number(d?.Valute?.USD?.Value);
    if (!Number.isFinite(usdRub) || usdRub <= 0) throw new Error("bad rate");
    const value: Fx = { usdRub, date: String(d.Date ?? new Date().toISOString()), source: "cbr", markup: MARKUP };
    g.__fx = { value, at: Date.now() };
    return value;
  } catch {
    // keep the last good rate if we have one; otherwise a clearly-labelled constant
    return cached?.value ?? { usdRub: FALLBACK, date: new Date().toISOString(), source: "fallback", markup: MARKUP };
  }
}
