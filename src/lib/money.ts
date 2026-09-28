/**
 * The single place prices are turned into what the user sees and pays.
 * Providers bill in USD; users pay rubles: provider cost x CBR rate x markup.
 * The server passes the same Fx to the browser, so shown and charged prices match.
 */

export interface Fx {
  usdRub: number;
  /** ISO date of the rate */
  date: string;
  /** "cbr" = today's Central Bank rate, "fallback" = configured constant (feed unavailable) */
  source: "cbr" | "fallback";
  /** our price = provider cost x markup (PRICE_MARKUP) */
  markup: number;
}

const rubFmt = (digits: number) =>
  new Intl.NumberFormat("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function toRub(usd: number, fx: Fx): number {
  return usd * fx.markup * fx.usdRub;
}

/** What the user is charged, in kopecks (rounded up: never undercharge a fraction). */
export function toKop(usd: number, fx: Fx): number {
  return Math.ceil(toRub(usd, fx) * 100 - 1e-6);
}

/** 123456 kop -> "1 234,56 ₽" (whole rubles when there are no kopecks) */
export function formatKop(kop: number): string {
  const rub = kop / 100;
  const whole = Number.isInteger(rub);
  return `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(rub)} ₽`;
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
  return `${formatUsd(usd)} у провайдера, ${src}${fx.markup !== 1 ? `, наценка сервиса ×${fx.markup}` : ""}`;
}
