/**
 * The single place prices are turned into what the user sees.
 * Providers bill in USD; users think in rubles. Today this shows our cost at the
 * CBR rate; when credits land, the markup is applied here and nowhere else.
 */

export interface Fx {
  usdRub: number;
  /** ISO date of the rate */
  date: string;
  /** "cbr" = today's Central Bank rate, "fallback" = configured constant (feed unavailable) */
  source: "cbr" | "fallback";
}

/** Our price = provider cost × markup. 1 until credits and pricing are decided (PRODUCT.md §5). */
export const MARKUP = 1;

const rubFmt = (digits: number) =>
  new Intl.NumberFormat("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function toRub(usd: number, fx: Fx): number {
  return usd * MARKUP * fx.usdRub;
}

/** 0.4 ₽ → "<1 ₽", 5.94 → "5,9 ₽", 38.2 → "38 ₽", 1840 → "1 840 ₽" */
export function formatRub(usd: number, fx: Fx): string {
  const rub = toRub(usd, fx);
  if (rub > 0 && rub < 1) return "<1 ₽";
  return `${rubFmt(rub < 10 ? 1 : 0).format(rub)} ₽`;
}

export function formatUsd(usd: number): string {
  if (usd > 0 && usd < 0.01) return "<$0.01";
  return "$" + usd.toFixed(2);
}

/** Tooltip text that keeps the conversion honest. */
export function priceTitle(usd: number, fx: Fx): string {
  const rate = rubFmt(2).format(fx.usdRub);
  const src = fx.source === "cbr" ? `курс ЦБ ${rate} ₽ за $1` : `курс ${rate} ₽ за $1 (ЦБ недоступен)`;
  return `${formatUsd(usd)} у провайдера, ${src}`;
}
